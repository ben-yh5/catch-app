/**
 * Firebase Cloud Functions for Catch App
 *
 * This module provides server-side functions for:
 * - Location validation for catch functionality
 * - Post location data retrieval
 * - Post lifecycle management (creation/deletion)
 * - Push notifications for social features
 */

import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { distanceBetween, geohashQueryBounds } from 'geofire-common'
import { onImageUpload } from './triggers/onImageUpload'

admin.initializeApp()

export { onImageUpload }

/** Maximum distance (in meters) a user must be from a post location to catch it */
const CATCH_RADIUS_METERS = 100

/** Contribution System Constants */
const CONTRIBUTION = {
    PIONEER_POST: 10,      // Creating a post >50m from existing pins
    NEARBY_POST: 2,        // Creating a post within 50m of existing pins
    CATCH: 14,             // Catching any post
    ROYALTY_PIONEER: 7,    // Royalty to original poster when Pioneer post is caught
    ROYALTY_NEARBY: 2,     // Royalty to original poster when Nearby post is caught
    NEARBY_THRESHOLD_METERS: 50,
    BOUNTY_MULTIPLIER: 3,       // Gold pin: 3x catch pts for dead posts
    TRENDING_MULTIPLIER: 1.5,   // Silver pin: 1.5x catch pts for popular posts
    TRENDING_THRESHOLD: 5,      // Catches needed to be trending
    BOUNTY_INACTIVITY_DAYS: 30, // Days since last catch to become bounty
}

/** Maximum results per geohash sub-query in getPostsInArea */
const GEOHASH_QUERY_LIMIT = 200

/** Maximum total results returned from getPostsInArea */
const MAX_AREA_RESULTS = 500

/** Rate limiting configuration */
const RATE_LIMITS = {
    /** General callable functions (30 requests per minute) */
    GENERAL: { windowMs: 60 * 1000, maxRequests: 30 },
    /** Expensive operations (10 requests per minute) */
    EXPENSIVE: { windowMs: 60 * 1000, maxRequests: 10 },
    /** Account setup operations (5 requests per minute) */
    SETUP: { windowMs: 60 * 1000, maxRequests: 5 },
}

/**
 * Checks and enforces per-user rate limiting using Firestore.
 * Uses a sliding window counter stored in rate_limits/{userId}.
 * Fails open: if the rate limit check itself errors, the request proceeds.
 */
async function checkRateLimit(
    userId: string,
    functionName: string,
    config: { windowMs: number; maxRequests: number }
): Promise<void> {
    const db = admin.firestore()
    const rateLimitRef = db.collection('rate_limits').doc(userId)
    const now = Date.now()
    const windowStart = now - config.windowMs
    const fieldTimestamps = `${functionName}_ts`

    try {
        const doc = await rateLimitRef.get()
        const data = doc.data() || {}
        const timestamps: number[] = data[fieldTimestamps] || []

        // Filter to only timestamps within the current window
        const recentTimestamps = timestamps.filter((t: number) => t > windowStart)

        if (recentTimestamps.length >= config.maxRequests) {
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'Rate limit exceeded. Try again later.'
            )
        }

        // Add current timestamp and prune old ones
        recentTimestamps.push(now)
        await rateLimitRef.set(
            { [fieldTimestamps]: recentTimestamps },
            { merge: true }
        )
    } catch (error) {
        // Re-throw rate limit errors
        if (error instanceof functions.https.HttpsError) {
            throw error
        }
        // If rate limiting itself fails, log but don't block the request
        functions.logger.error('Rate limit check failed:', error)
    }
}

/**
 * App Check enforcement mode.
 * 'warn' = log warnings but allow requests (for initial rollout)
 * 'enforce' = reject requests without valid App Check token
 *
 * TODO: Switch to 'enforce' after validating that updated clients send valid App Check tokens.
 * Requires: Apple Developer Program (App Attest) and Google Play Console (Play Integrity).
 */
const APP_CHECK_MODE: 'warn' | 'enforce' = 'warn'

/**
 * Verifies App Check token on a callable function context.
 * In 'warn' mode, logs a warning but allows the request.
 * In 'enforce' mode, throws an error for requests without valid tokens.
 */
function verifyAppCheck(context: functions.https.CallableContext): void {
    if (context.app == undefined) {
        if (APP_CHECK_MODE === 'enforce') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'The function must be called from an App Check verified app.'
            )
        } else {
            functions.logger.warn(
                'App Check token missing or invalid. ' +
                'Request allowed in warn mode. ' +
                `User: ${context.auth?.uid || 'unauthenticated'}`
            )
        }
    }
}

/**
 * Calculates the distance between two geographic coordinates using the Haversine formula
 * @param lat1 - Latitude of first point
 * @param lon1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lon2 - Longitude of second point
 * @returns Distance in meters between the two points
 */
function getDistanceInMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371e3 // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lon2 - lon1) * Math.PI) / 180

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
}

/**
 * HTTPS Callable Function: Validates if a user is close enough to catch a post
 *
 * Security: Post coordinates are stored in a private collection (post_locations) that
 * clients cannot access. This function is the only way to validate catch proximity
 * without exposing exact coordinates to the client.
 *
 * @param data.postId - The ID of the post to catch
 * @param data.userLat - User's current latitude
 * @param data.userLng - User's current longitude
 * @returns Object with validation result, distance, and required distance
 */
export const validateCatch = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to validate catch'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'validateCatch', RATE_LIMITS.GENERAL)

    const { postId, userLat, userLng } = data

    if (!postId || userLat === undefined || userLng === undefined) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Missing required fields: postId, userLat, userLng'
        )
    }

    try {
        const db = admin.firestore()
        const postRef = db.collection('posts').doc(postId)
        const postDoc = await postRef.get()

        if (!postDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Post not found')
        }

        const postData = postDoc.data()

        if (!postData?.hasLocation) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Post has no location data'
            )
        }

        // Prevent self-catch: user cannot catch their own post
        if (postData.authorId === context.auth.uid) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'You cannot catch your own post'
            )
        }

        // Determine rootPostId for duplicate check (original posts use their own ID)
        const rootPostId = postData.rootPostId || postId

        // Prevent duplicate catch: check if user already caught this thread
        const existingCatchQuery = await db.collection('posts')
            .where('authorId', '==', context.auth.uid)
            .where('rootPostId', '==', rootPostId)
            .where('isOriginal', '==', false)
            .limit(1)
            .get()

        if (!existingCatchQuery.empty) {
            throw new functions.https.HttpsError(
                'already-exists',
                'You have already caught this post'
            )
        }

        // Fetch coordinates from private collection (server-side only access)
        const locationQuery = await db
            .collection('post_locations')
            .where('postId', '==', postId)
            .limit(1)
            .get()

        if (locationQuery.empty) {
            throw new functions.https.HttpsError(
                'not-found',
                'Location data not found'
            )
        }

        const locationData = locationQuery.docs[0].data()
        const { latitude: postLat, longitude: postLng } = locationData

        const distance = getDistanceInMeters(userLat, userLng, postLat, postLng)
        const isValid = distance <= CATCH_RADIUS_METERS

        return {
            isValid,
            distance: Math.round(distance),
            requiredDistance: CATCH_RADIUS_METERS,
            heading: locationData.heading, // Optional
            pitch: locationData.pitch,     // Optional
        }
    } catch (error: any) {
        // Re-throw HttpsErrors as-is so clients get proper error codes
        if (error instanceof functions.https.HttpsError) {
            throw error
        }
        functions.logger.error('Error validating catch:', error)
        throw new functions.https.HttpsError(
            'internal',
            'Failed to validate catch location'
        )
    }
})

/**
 * HTTPS Callable Function: Retrieves coordinates for a single post
 *
 * Used for map pins and providing directions. Unlike validateCatch, this function
 * returns the actual coordinates since they're needed for display.
 *
 * @param data.postId - The ID of the post
 * @returns Object with postId, latitude, and longitude
 */
export const getPostLocation = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to get post location'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'getPostLocation', RATE_LIMITS.GENERAL)

    const { postId } = data

    if (!postId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Missing required field: postId'
        )
    }

    try {
        const postRef = admin.firestore().collection('posts').doc(postId)
        const postDoc = await postRef.get()

        if (!postDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Post not found')
        }

        const postData = postDoc.data()

        if (!postData?.hasLocation) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Post has no location data'
            )
        }

        const locationQuery = await admin
            .firestore()
            .collection('post_locations')
            .where('postId', '==', postId)
            .limit(1)
            .get()

        if (locationQuery.empty) {
            throw new functions.https.HttpsError(
                'not-found',
                'Location data not found'
            )
        }

        const locationData = locationQuery.docs[0].data()
        const { latitude, longitude } = locationData

        return {
            postId,
            latitude,
            longitude,
            heading: locationData.heading, // Optional
            pitch: locationData.pitch,     // Optional
        }
    } catch (error: any) {
        functions.logger.error('Error getting post location:', error)
        throw new functions.https.HttpsError(
            'internal',
            'Failed to get post location'
        )
    }
})

/**
 * HTTPS Callable Function: Retrieves coordinates for multiple posts at once
 *
 * Optimized for map views where multiple post locations need to be displayed.
 * Uses batched Firestore queries to work around the 'in' operator's 10-item limit.
 *
 * @param data.postIds - Array of post IDs (max 500)
 * @returns Object containing array of locations with postId, latitude, longitude
 */
export const getPostLocations = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to get post locations'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'getPostLocations', RATE_LIMITS.GENERAL)

    const { postIds } = data

    if (!postIds || !Array.isArray(postIds)) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'postIds must be an array'
        )
    }

    if (postIds.length === 0) {
        return { locations: [] }
    }

    if (postIds.length > 500) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Cannot fetch more than 500 post locations at once'
        )
    }

    try {
        const locations: {
            postId: string
            latitude: number
            longitude: number
            heading?: number
            pitch?: number
        }[] = []

        // Firestore 'in' queries are limited to 10 items, so batch the requests
        const batchSize = 10
        for (let i = 0; i < postIds.length; i += batchSize) {
            const batch = postIds.slice(i, i + batchSize)

            const locationQuery = await admin
                .firestore()
                .collection('post_locations')
                .where('postId', 'in', batch)
                .get()

            locationQuery.docs.forEach((doc) => {
                const locationData = doc.data()
                locations.push({
                    postId: locationData.postId,
                    latitude: locationData.latitude,
                    longitude: locationData.longitude,
                    heading: locationData.heading, // Optional
                    pitch: locationData.pitch,     // Optional
                })
            })
        }

        return { locations }
    } catch (error: any) {
        functions.logger.error('Error getting post locations:', error)
        throw new functions.https.HttpsError(
            'internal',
            'Failed to get post locations'
        )
    }
})

/**
 * Firestore Trigger: Handles post creation events
 *
 * Performs:
 * 1. Contribution points for original posts (Pioneer vs Nearby check)
 * 2. Contribution points for catches + royalties to original poster
 * 3. Increments user's totalCatches/totalPosts counters
 * 4. Sends push notifications to followers for original posts
 */
export const onPostCreated = functions.firestore
    .document('posts/{postId}')
    .onCreate(async (snap, context) => {
        const db = admin.firestore()

        // Deduplicate: Firestore triggers have at-least-once delivery semantics
        const eventRef = db.collection('processed_events').doc(context.eventId)
        const existing = await eventRef.get()
        if (existing.exists) {
            functions.logger.info(`[onPostCreated] Duplicate event ${context.eventId}, skipping`)
            return
        }
        await eventRef.set({ processedAt: admin.firestore.FieldValue.serverTimestamp() })

        const postData = snap.data()
        const authorId = postData.authorId
        const postId = snap.id

        if (!authorId) {
            functions.logger.warn('Post created without authorId:', snap.id)
            return
        }

        functions.logger.info(`[onPostCreated] Triggered for post ${postId} by author ${authorId}`)

        try {
            const userRef = db.collection('users').doc(authorId)
            const postRef = snap.ref

            // Handle CATCH posts
            if (postData.parentPostId && !postData.isOriginal) {
                // Determine bounty/trending status of root post for catch multiplier
                let catchPoints = CONTRIBUTION.CATCH
                let catchMultiplier = 1
                const rootPostId = postData.rootPostId

                if (rootPostId) {
                    const rootPostDoc = await db.collection('posts').doc(rootPostId).get()
                    if (rootPostDoc.exists) {
                        const rootData = rootPostDoc.data()!
                        const rootCatchCount = rootData.catchCount ?? 0
                        const lastCaughtAt = rootData.lastCaughtAt?.toMillis?.() ?? 0
                        const thirtyDaysAgo = Date.now() - CONTRIBUTION.BOUNTY_INACTIVITY_DAYS * 24 * 60 * 60 * 1000

                        const isBountyPost = rootCatchCount === 0 || (lastCaughtAt > 0 && lastCaughtAt < thirtyDaysAgo)
                        const isTrendingPost = !isBountyPost && rootCatchCount >= CONTRIBUTION.TRENDING_THRESHOLD

                        if (isBountyPost) {
                            catchMultiplier = CONTRIBUTION.BOUNTY_MULTIPLIER
                        } else if (isTrendingPost) {
                            catchMultiplier = CONTRIBUTION.TRENDING_MULTIPLIER
                        }
                        catchPoints = Math.round(CONTRIBUTION.CATCH * catchMultiplier)
                        functions.logger.info(`Catch multiplier: ${catchMultiplier}x (bounty=${isBountyPost}, trending=${isTrendingPost}), points=${catchPoints}`)

                        // Award royalty to original poster (unmultiplied)
                        const rootAuthorId = rootData.authorId
                        const isPioneer = rootData.isPioneer ?? true
                        const royalty = isPioneer ? CONTRIBUTION.ROYALTY_PIONEER : CONTRIBUTION.ROYALTY_NEARBY

                        if (rootAuthorId && rootAuthorId !== authorId) {
                            await db.collection('users').doc(rootAuthorId).update({
                                contribution: admin.firestore.FieldValue.increment(royalty),
                            })
                            functions.logger.info(`Awarded ${royalty} royalty to original poster ${rootAuthorId}`)

                            try {
                                await db.collection('users').doc(rootAuthorId).collection('notifications').add({
                                    type: 'royalty',
                                    amount: royalty,
                                    fromUserId: authorId,
                                    postId: rootPostId,
                                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                    read: false,
                                })
                                functions.logger.info(`[onPostCreated] Created royalty notification for ${rootAuthorId}`)
                            } catch (e) {
                                functions.logger.error(`[onPostCreated] Failed to create royalty notification for ${rootAuthorId}`, e)
                            }
                        }

                        // Update root post: increment contributionEarned, catchCount, and set lastCaughtAt
                        await rootPostDoc.ref.update({
                            contributionEarned: admin.firestore.FieldValue.increment(royalty),
                            catchCount: admin.firestore.FieldValue.increment(1),
                            lastCaughtAt: admin.firestore.FieldValue.serverTimestamp(),
                        })
                    }
                }

                // Award catch contribution to catcher (with multiplier)
                await userRef.update({
                    totalCatches: admin.firestore.FieldValue.increment(1),
                    contribution: admin.firestore.FieldValue.increment(catchPoints),
                })
                functions.logger.info(`Awarded ${catchPoints} contribution to catcher ${authorId}`)

                // Store actual catch points earned on the catch post
                await postRef.update({
                    contributionEarned: catchPoints,
                })
            }

            // Handle ORIGINAL posts
            if (postData.isOriginal) {
                // Check if Pioneer (no posts within threshold distance)
                const locationQuery = await db
                    .collection('post_locations')
                    .where('postId', '==', postId)
                    .limit(1)
                    .get()

                let isPioneer = true
                let contributionAmount = CONTRIBUTION.PIONEER_POST

                if (!locationQuery.empty) {
                    const newPostLocation = locationQuery.docs[0].data()
                    const center: [number, number] = [newPostLocation.latitude, newPostLocation.longitude]

                    // Query nearby posts using geohash
                    const bounds = geohashQueryBounds(center, CONTRIBUTION.NEARBY_THRESHOLD_METERS)

                    const nearbyPromises = bounds.map(([start, end]) =>
                        db.collection('post_locations')
                            .where('geohash', '>=', start)
                            .where('geohash', '<=', end)
                            .get()
                    )

                    const nearbySnapshots = await Promise.all(nearbyPromises)

                    for (const snapshot of nearbySnapshots) {
                        for (const doc of snapshot.docs) {
                            // Skip self
                            if (doc.data().postId === postId) continue

                            const otherLocation = doc.data()
                            const distance = distanceBetween(
                                center,
                                [otherLocation.latitude, otherLocation.longitude]
                            ) * 1000 // Convert km to meters

                            if (distance <= CONTRIBUTION.NEARBY_THRESHOLD_METERS) {
                                isPioneer = false
                                contributionAmount = CONTRIBUTION.NEARBY_POST
                                break
                            }
                        }
                        if (!isPioneer) break
                    }
                }

                // Update post with isPioneer flag and initial contributionEarned
                await postRef.update({
                    isPioneer,
                    contributionEarned: contributionAmount,
                })

                // Award contribution to author
                await userRef.update({
                    totalPosts: admin.firestore.FieldValue.increment(1),
                    contribution: admin.firestore.FieldValue.increment(contributionAmount),
                })

                functions.logger.info(`Post ${postId} isPioneer=${isPioneer}, awarded ${contributionAmount} contribution to ${authorId}`)

                // Send notifications to followers
                const authorDoc = await userRef.get()
                if (authorDoc.exists) {
                    const authorData = authorDoc.data()
                    const authorUsername = authorData?.username || 'Someone'
                    const followers = authorData?.followers || []

                    for (const followerId of followers) {
                        try {
                            // Create in-app notification
                            functions.logger.info(`[onPostCreated] Creating new_post notification for follower ${followerId}`)
                            await db.collection('users').doc(followerId).collection('notifications').add({
                                type: 'new_post',
                                fromUserId: authorId,
                                postId: postId,
                                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                read: false,
                            })
                            functions.logger.info(`[onPostCreated] Successfully created notification for ${followerId}`)

                            const followerDoc = await db.collection('users').doc(followerId).get()
                            if (!followerDoc.exists) continue

                            const followerData = followerDoc.data()
                            const pushToken = followerData?.pushToken
                            if (!pushToken) continue

                            await sendPushNotification(
                                pushToken,
                                'New Post',
                                `@${authorUsername} just made a new post!`,
                                {
                                    userId: authorId,
                                    postId: postId,
                                    type: 'new_post',
                                }
                            )
                        } catch (error) {
                            functions.logger.error(`Error sending notification to follower ${followerId}:`, error)
                        }
                    }
                }
            }
        } catch (error) {
            functions.logger.error('Error in onPostCreated trigger:', error)
        }
    })

/**
 * Firestore Trigger: Handles post deletion events
 *
 * Complex logic handles different deletion scenarios:
 * 1. Catch deleted: Decrements user's totalCatches and root post's catchCount
 * 2. Root with catches deleted: Promotes oldest catch to new root, updates all thread references
 * 3. Root without catches deleted: Simply cleans up location data
 *
 * Also removes the post from any lists containing it
 */
export const onPostDeleted = functions.firestore
    .document('posts/{postId}')
    .onDelete(async (snap, context) => {
        const db = admin.firestore()

        // Deduplicate: Firestore triggers have at-least-once delivery semantics
        const eventRef = db.collection('processed_events').doc(context.eventId)
        const existing = await eventRef.get()
        if (existing.exists) {
            functions.logger.info(`[onPostDeleted] Duplicate event ${context.eventId}, skipping`)
            return
        }
        await eventRef.set({ processedAt: admin.firestore.FieldValue.serverTimestamp() })

        const postData = snap.data()
        const postId = snap.id
        const authorId = postData.authorId

        if (!authorId) {
            functions.logger.warn('Deleted post had no authorId:', postId)
            return
        }

        try {
            const userRef = db.collection('users').doc(authorId)

            // Subtract contributionEarned from author
            const contributionEarned = postData.contributionEarned || 0
            if (contributionEarned > 0) {
                await userRef.update({
                    contribution: admin.firestore.FieldValue.increment(-contributionEarned),
                })
                functions.logger.info(`Subtracted ${contributionEarned} contribution from user ${authorId}`)
            }

            // Decrement totalCatches if this was a catch
            if (postData.parentPostId && !postData.isOriginal) {
                await userRef.update({
                    totalCatches: admin.firestore.FieldValue.increment(-1),
                })
                functions.logger.info(`Decremented totalCatches for user ${authorId}`)
            }

            // Decrement totalPosts if this was an original post
            if (postData.isOriginal) {
                await userRef.update({
                    totalPosts: admin.firestore.FieldValue.increment(-1),
                })
                functions.logger.info(`Decremented totalPosts for user ${authorId}`)
            }

            // Remove post from any lists that contain it
            const listsQuery = await db
                .collection('lists')
                .where('postIds', 'array-contains', postId)
                .get()

            if (!listsQuery.empty) {
                const batch = db.batch()
                listsQuery.docs.forEach((listDoc) => {
                    batch.update(listDoc.ref, {
                        postIds: admin.firestore.FieldValue.arrayRemove(postId),
                    })
                })
                await batch.commit()
                functions.logger.info(`Removed post ${postId} from ${listsQuery.size} list(s)`)
            }

            // Handle root post deletion - promote oldest catch to new root
            if (postData.isOriginal) {
                functions.logger.info(`Root post ${postId} deleted, checking for thread promotion`)

                const catchesQuery = await db
                    .collection('posts')
                    .where('rootPostId', '==', postId)
                    .orderBy('createdAt', 'asc')
                    .get()

                if (!catchesQuery.empty) {
                    const newRootDoc = catchesQuery.docs[0]
                    const newRootId = newRootDoc.id

                    functions.logger.info(`Promoting catch ${newRootId} to new root`)

                    const batch = db.batch()

                    // Promote oldest catch to root
                    batch.update(newRootDoc.ref, {
                        isOriginal: true,
                        parentPostId: null,
                        rootPostId: null,
                        catchCount: postData.catchCount - 1,
                    })

                    // Update remaining catches to point to new root
                    for (let i = 1; i < catchesQuery.docs.length; i++) {
                        const catchDoc = catchesQuery.docs[i]
                        batch.update(catchDoc.ref, {
                            rootPostId: newRootId,
                            parentPostId: newRootId,
                        })
                    }

                    // Delete old root's location data (new root keeps its own)
                    const oldLocationQuery = await db
                        .collection('post_locations')
                        .where('postId', '==', postId)
                        .limit(1)
                        .get()

                    if (!oldLocationQuery.empty) {
                        batch.delete(oldLocationQuery.docs[0].ref)
                    }

                    await batch.commit()
                    functions.logger.info(`Thread promotion complete. New root: ${newRootId}`)
                } else {
                    // No catches in thread, just delete location data
                    const locationQuery = await db
                        .collection('post_locations')
                        .where('postId', '==', postId)
                        .limit(1)
                        .get()

                    if (!locationQuery.empty) {
                        await locationQuery.docs[0].ref.delete()
                        functions.logger.info(`Deleted location data for post ${postId}`)
                    }
                }
            } else {
                // Catch deleted - decrement root's catchCount and claw back royalty
                const rootPostId = postData.rootPostId
                if (rootPostId) {
                    const rootRef = db.collection('posts').doc(rootPostId)
                    const rootDoc = await rootRef.get()
                    if (rootDoc.exists) {
                        const rootData = rootDoc.data()!
                        const isPioneer = rootData.isPioneer ?? true
                        const royalty = isPioneer ? CONTRIBUTION.ROYALTY_PIONEER : CONTRIBUTION.ROYALTY_NEARBY

                        await rootRef.update({
                            catchCount: admin.firestore.FieldValue.increment(-1),
                            contributionEarned: admin.firestore.FieldValue.increment(-royalty),
                        })
                        functions.logger.info(`Decremented catchCount and contributionEarned (${royalty}) for root post ${rootPostId}`)

                        // Claw back royalty from original poster
                        const rootAuthorId = rootData.authorId
                        if (rootAuthorId && rootAuthorId !== authorId) {
                            await db.collection('users').doc(rootAuthorId).update({
                                contribution: admin.firestore.FieldValue.increment(-royalty),
                            })
                            functions.logger.info(`Clawed back ${royalty} royalty from original poster ${rootAuthorId}`)
                        }
                    }
                }

                // Delete catch's location data
                const locationQuery = await db
                    .collection('post_locations')
                    .where('postId', '==', postId)
                    .limit(1)
                    .get()

                if (!locationQuery.empty) {
                    await locationQuery.docs[0].ref.delete()
                    functions.logger.info(`Deleted location data for catch ${postId}`)
                }
            }
        } catch (error) {
            functions.logger.error('Error handling post deletion:', error)
        }
    })

/**
 * Helper function to send push notifications via Firebase Cloud Messaging
 *
 * Supports both Android (FCM) and iOS (APNs) with platform-specific options
 *
 * @param pushToken - Device push token from user document
 * @param title - Notification title
 * @param body - Notification message body
 * @param data - Optional data payload for deep linking and custom handling
 */
async function sendPushNotification(
    pushToken: string,
    title: string,
    body: string,
    data?: any
) {
    try {
        const message: admin.messaging.Message = {
            notification: {
                title,
                body,
            },
            data: data || {},
            token: pushToken,
            android: {
                priority: 'high',
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                    },
                },
            },
        }

        const result = await admin.messaging().send(message)
        functions.logger.info('Push notification sent:', result)
        return result
    } catch (error) {
        functions.logger.error('Error sending push notification:', error)
        throw error
    }
}

/**
 * Firestore Trigger: Handles new follower notifications
 *
 * Detects when a user gains new followers by comparing before/after states
 * of the followers array, then sends a push notification for each new follower
 */
export const onUserFollowed = functions.firestore
    .document('users/{userId}')
    .onUpdate(async (change, context) => {
        const userId = context.params.userId
        const beforeData = change.before.data()
        const afterData = change.after.data()

        const beforeFollowers = beforeData.followers || []
        const afterFollowers = afterData.followers || []

        // Find new followers added to the array
        const newFollowers = afterFollowers.filter(
            (followerId: string) => !beforeFollowers.includes(followerId)
        )

        if (newFollowers.length === 0) {
            return
        }

        const db = admin.firestore()

        // Create notification docs for each new follower
        for (const followerId of newFollowers) {
            try {
                functions.logger.info(`[onUserFollowed] Creating follow notification for user ${userId} from ${followerId}`)
                await db.collection('users').doc(userId).collection('notifications').add({
                    type: 'follow',
                    fromUserId: followerId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    read: false,
                })
                functions.logger.info(`[onUserFollowed] Successfully created follow notification`)
            } catch (e) {
                functions.logger.error(`[onUserFollowed] Failed to create follow notification`, e)
            }
        }

        const pushToken = afterData.pushToken
        if (!pushToken) {
            functions.logger.info(
                `User ${userId} has no push token, skipping notification`
            )
            return
        }

        for (const followerId of newFollowers) {
            try {
                const followerDoc = await admin
                    .firestore()
                    .collection('users')
                    .doc(followerId)
                    .get()

                if (!followerDoc.exists) {
                    functions.logger.warn(`Follower ${followerId} not found`)
                    continue
                }

                const followerData = followerDoc.data()
                const followerUsername = followerData?.username || 'Someone'

                await sendPushNotification(
                    pushToken,
                    'New Follower',
                    `@${followerUsername} started following you!`,
                    {
                        userId: followerId,
                        type: 'new_follower',
                    }
                )

                functions.logger.info(
                    `Sent follower notification to user ${userId} for follower ${followerId}`
                )
            } catch (error) {
                functions.logger.error(
                    `Error sending notification for follower ${followerId}:`,
                    error
                )
            }
        }
    })

// backfillGeohashes: REMOVED — one-time migration completed, unauthenticated HTTP endpoint was a security risk

/**
 * HTTPS Callable Function: Get posts within a map viewport or circular radius
 *
 * Supports two query modes:
 * 1. Bounding box (map viewport): north, south, east, west
 * 2. Circular radius: centerLat, centerLng, radiusInMeters
 *
 * @param data.north - Northern latitude (if using bounds)
 * @param data.south - Southern latitude (if using bounds)
 * @param data.east - Eastern longitude (if using bounds)
 * @param data.west - Western longitude (if using bounds)
 * @param data.centerLat - Center latitude (if using radius)
 * @param data.centerLng - Center longitude (if using radius)
 * @param data.radiusInMeters - Radius in meters (if using radius)
 * @returns Object with posts array and count
 */
export const getPostsInArea = functions.https.onCall(async (data, context) => {
    // Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'User must be authenticated to fetch post locations'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'getPostsInArea', RATE_LIMITS.EXPENSIVE)

    const db = admin.firestore()

    try {
        let postLocations: any[] = []

        // OPTION A: Query by radius (circular area)
        if (data.centerLat && data.centerLng && data.radiusInMeters) {
            const center: [number, number] = [data.centerLat, data.centerLng]
            const radiusInM = data.radiusInMeters

            // Validate radius to prevent abuse
            if (radiusInM <= 0 || radiusInM > 100000) {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'Radius must be between 0 and 100km'
                )
            }

            // Validate coordinate ranges
            if (data.centerLat < -90 || data.centerLat > 90 || data.centerLng < -180 || data.centerLng > 180) {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'Coordinates out of valid range'
                )
            }

            // Get geohash ranges that cover this circular area
            const bounds = geohashQueryBounds(center, radiusInM)

            functions.logger.info(`Querying ${bounds.length} geohash ranges for radius ${radiusInM}m`)

            // Execute queries in parallel (with per-query limit to prevent abuse)
            const promises = bounds.map(([start, end]) => {
                return db.collection('post_locations')
                    .where('geohash', '>=', start)
                    .where('geohash', '<=', end)
                    .limit(GEOHASH_QUERY_LIMIT)
                    .get()
            })

            const snapshots = await Promise.all(promises)

            // Combine all results
            const allResults: any[] = []
            snapshots.forEach(snapshot => {
                snapshot.docs.forEach(doc => {
                    const locationData = doc.data()
                    allResults.push({
                        postId: locationData.postId,
                        latitude: locationData.latitude,
                        longitude: locationData.longitude,
                        geohash: locationData.geohash,
                        heading: locationData.heading, // Optional
                        pitch: locationData.pitch      // Optional
                    })
                })
            })

            // Filter to exact distance (geohash gives us a rectangle, we want a circle)
            postLocations = allResults.filter(location => {
                const distance = distanceBetween(
                    center,
                    [location.latitude, location.longitude]
                )
                return distance <= radiusInM
            })

            // Cap total results
            if (postLocations.length > MAX_AREA_RESULTS) {
                postLocations = postLocations.slice(0, MAX_AREA_RESULTS)
            }

            functions.logger.info(`Found ${allResults.length} posts in geohash bounds, ${postLocations.length} returned (max ${MAX_AREA_RESULTS})`)
        }

        // OPTION B: Query by bounding box (map viewport)
        else if (data.north !== undefined && data.south !== undefined && data.east !== undefined && data.west !== undefined) {
            // Validate viewport bounds
            if (data.north < data.south) {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'North must be greater than south'
                )
            }
            if (data.north < -90 || data.north > 90 || data.south < -90 || data.south > 90 ||
                data.east < -180 || data.east > 180 || data.west < -180 || data.west > 180) {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'Coordinates out of valid range'
                )
            }

            // Calculate center point and approximate radius from bounds
            const centerLat = (data.north + data.south) / 2
            const centerLng = (data.east + data.west) / 2

            // Calculate diagonal distance as radius (ensures we cover entire viewport)
            const radiusInM = distanceBetween(
                [data.south, data.west],
                [data.north, data.east]
            ) / 2

            functions.logger.info(`Viewport center: ${centerLat}, ${centerLng}, radius: ${radiusInM}m`)

            // Use same geohash query approach
            const center: [number, number] = [centerLat, centerLng]
            const bounds = geohashQueryBounds(center, radiusInM)

            const promises = bounds.map(([start, end]) => {
                return db.collection('post_locations')
                    .where('geohash', '>=', start)
                    .where('geohash', '<=', end)
                    .limit(GEOHASH_QUERY_LIMIT)
                    .get()
            })

            const snapshots = await Promise.all(promises)

            const allResults: any[] = []
            snapshots.forEach(snapshot => {
                snapshot.docs.forEach(doc => {
                    const locationData = doc.data()
                    allResults.push({
                        postId: locationData.postId,
                        latitude: locationData.latitude,
                        longitude: locationData.longitude,
                        geohash: locationData.geohash
                    })
                })
            })

            // Filter to exact bounding box
            postLocations = allResults.filter(location => {
                return (
                    location.latitude >= data.south &&
                    location.latitude <= data.north &&
                    location.longitude >= data.west &&
                    location.longitude <= data.east
                )
            })

            // Cap total results
            if (postLocations.length > MAX_AREA_RESULTS) {
                postLocations = postLocations.slice(0, MAX_AREA_RESULTS)
            }

            functions.logger.info(`Found ${allResults.length} posts in geohash bounds, ${postLocations.length} returned (max ${MAX_AREA_RESULTS})`)
        }

        else {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Must provide either (centerLat, centerLng, radiusInMeters) or (north, south, east, west)'
            )
        }

        // Optional: enrich locations with post summary data
        // filterOriginal implies includeSummary (need post data to filter)
        const shouldEnrich = data.includeSummary || data.filterOriginal

        if (shouldEnrich && postLocations.length > 0) {
            const postIds = postLocations.map((loc: any) => loc.postId)
            const postRefs = postIds.map((id: string) =>
                db.collection('posts').doc(id)
            )

            // Batch fetch post documents using admin SDK getAll (chunks of 100)
            const ENRICH_BATCH_SIZE = 100
            const postDataMap = new Map<string, any>()

            for (let i = 0; i < postRefs.length; i += ENRICH_BATCH_SIZE) {
                const chunk = postRefs.slice(i, i + ENRICH_BATCH_SIZE)
                const snapshots = await db.getAll(...chunk)
                snapshots.forEach(snap => {
                    if (snap.exists) {
                        postDataMap.set(snap.id, snap.data())
                    }
                })
            }

            // Attach summaries to location data
            postLocations = postLocations
                .map((loc: any) => {
                    const postData = postDataMap.get(loc.postId)
                    if (!postData) return null // Post deleted between queries

                    return {
                        ...loc,
                        summary: {
                            id: loc.postId,
                            authorId: postData.authorId,
                            authorUsername: postData.authorUsername,
                            caption: postData.caption || '',
                            photoURL: postData.photoURL,
                            thumbnailURL: postData.thumbnailURL || null,
                            catchCount: postData.catchCount || 0,
                            createdAt: postData.createdAt?.toMillis?.() ?? null,
                            isOriginal: postData.isOriginal ?? true,
                            isPioneer: postData.isPioneer || false,
                            lastCaughtAt: postData.lastCaughtAt?.toMillis?.() ?? null,
                        },
                    }
                })
                .filter((loc: any) => loc !== null)

            // Server-side isOriginal filter
            if (data.filterOriginal) {
                postLocations = postLocations.filter(
                    (loc: any) => loc.summary?.isOriginal === true
                )
            }

            functions.logger.info(`Enriched ${postLocations.length} posts with summaries`)
        }

        return {
            posts: postLocations,
            count: postLocations.length
        }

    } catch (error: any) {
        functions.logger.error('Error querying posts in area:', error)
        throw new functions.https.HttpsError(
            'internal',
            'Error querying posts in area'
        )
    }
})

/**
 * HTTPS Callable Function: Recalculates user stats based on their posts
 *
 * Fixes inaccuracies in totalPosts, totalCatches, and contribution scores
 * by re-tallying all documents in the posts collection.
 * Restricted to the authenticated user's own data only.
 *
 * @returns Object with the new stats
 */
export const recountUserData = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to recount data'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'recountUserData', RATE_LIMITS.EXPENSIVE)

    // Only allow recounting own data — prevents any user from overwriting another's stats
    const targetUserId = context.auth.uid

    try {
        const db = admin.firestore()
        const postsQuery = await db.collection('posts')
            .where('authorId', '==', targetUserId)
            .get()

        let totalPosts = 0
        let totalCatches = 0
        let calculatedContribution = 0

        const batch = db.batch()
        let batchCount = 0

        for (const doc of postsQuery.docs) {
            const postData = doc.data()

            if (postData.isOriginal) {
                totalPosts++
                calculatedContribution += (postData.contributionEarned || 0)
            } else {
                totalCatches++
                // Catches are worth fixed amount
                // If the catch post doesn't have contributionEarned stored, we assume the constant
                const catchValue = CONTRIBUTION.CATCH
                calculatedContribution += catchValue

                // Self-healing: if catch didn't store its value, store it now
                // so onPostDeleted works correctly in the future
                if (postData.contributionEarned !== catchValue) {
                    batch.update(doc.ref, { contributionEarned: catchValue })
                    batchCount++
                }
            }
        }

        // Commit any fixes to post documents
        if (batchCount > 0) {
            await batch.commit()
            functions.logger.info(`Fixed contributionEarned on ${batchCount} catch posts`)
        }

        // Update user stats
        await db.collection('users').doc(targetUserId).update({
            totalPosts,
            totalCatches,
            contribution: calculatedContribution
        })

        return {
            success: true,
            stats: {
                totalPosts,
                totalCatches,
                contribution: calculatedContribution
            }
        }
    } catch (error) {
        functions.logger.error('Error recounting user data:', error)
        throw new functions.https.HttpsError(
            'internal',
            'Failed to recount user data'
        )
    }
})

// backfillThumbnails: REMOVED — one-time migration completed, unauthenticated HTTP endpoint was a security risk

/**
 * HTTPS Callable Function: Atomically sets up a username for a new user
 *
 * Prevents TOCTOU race condition where two users could claim the same username.
 * Uses a `usernames` collection as a uniqueness index with document ID = lowercase username.
 * Runs inside a Firestore transaction so check + create is atomic.
 *
 * @param data.username - The desired username
 * @returns Object with success status
 */
export const setupUsername = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to set up username'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'setupUsername', RATE_LIMITS.SETUP)

    const { username } = data

    if (!username || typeof username !== 'string') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Username is required'
        )
    }

    // Server-side format validation (mirrors client-side rules)
    const trimmed = username.trim()
    if (trimmed.length < 3 || trimmed.length > 20) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Username must be 3-20 characters'
        )
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Username can only contain letters, numbers, underscores, and hyphens'
        )
    }

    const db = admin.firestore()
    const uid = context.auth.uid
    const usernameLower = trimmed.toLowerCase()

    try {
        await db.runTransaction(async (transaction) => {
            // Check if user already has a document (prevent double setup)
            const userRef = db.collection('users').doc(uid)
            const userDoc = await transaction.get(userRef)
            if (userDoc.exists) {
                throw new functions.https.HttpsError(
                    'already-exists',
                    'User account already set up'
                )
            }

            // Check username uniqueness via the usernames index
            const usernameRef = db.collection('usernames').doc(usernameLower)
            const usernameDoc = await transaction.get(usernameRef)
            if (usernameDoc.exists) {
                throw new functions.https.HttpsError(
                    'already-exists',
                    'Username is already taken'
                )
            }

            // Atomically claim the username and create the user document
            transaction.set(usernameRef, { uid })
            transaction.set(userRef, {
                username: trimmed,
                email: context.auth!.token.email || '',
                totalPosts: 0,
                totalCatches: 0,
                contribution: 0,
                followers: [],
                following: [],
                pushToken: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })
        })

        return { success: true }
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) {
            throw error
        }
        functions.logger.error('Error setting up username:', error)
        throw new functions.https.HttpsError(
            'internal',
            'Failed to set up username'
        )
    }
})

/**
 * HTTPS Callable Function: Atomically follows a user
 *
 * Updates both the current user's `following` array and the target user's `followers` array
 * in a single transaction, ensuring consistency. Also prevents self-follow.
 *
 * @param data.targetUserId - The user ID to follow
 * @returns Object with success status
 */
export const followUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to follow a user'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'followUser', RATE_LIMITS.GENERAL)

    const { targetUserId } = data
    const currentUserId = context.auth.uid

    if (!targetUserId || typeof targetUserId !== 'string') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Target user ID is required'
        )
    }

    if (targetUserId === currentUserId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Cannot follow yourself'
        )
    }

    const db = admin.firestore()

    try {
        await db.runTransaction(async (transaction) => {
            const currentUserRef = db.collection('users').doc(currentUserId)
            const targetUserRef = db.collection('users').doc(targetUserId)

            const [currentUserDoc, targetUserDoc] = await Promise.all([
                transaction.get(currentUserRef),
                transaction.get(targetUserRef),
            ])

            if (!currentUserDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Your user account was not found')
            }
            if (!targetUserDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Target user not found')
            }

            // arrayUnion is idempotent — always write both sides to self-heal any inconsistency
            transaction.update(currentUserRef, {
                following: admin.firestore.FieldValue.arrayUnion(targetUserId),
            })
            transaction.update(targetUserRef, {
                followers: admin.firestore.FieldValue.arrayUnion(currentUserId),
            })
        })

        return { success: true }
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) {
            throw error
        }
        functions.logger.error('Error following user:', error)
        throw new functions.https.HttpsError('internal', 'Failed to follow user')
    }
})

/**
 * HTTPS Callable Function: Atomically unfollows a user
 *
 * Updates both the current user's `following` array and the target user's `followers` array
 * in a single transaction, ensuring consistency.
 *
 * @param data.targetUserId - The user ID to unfollow
 * @returns Object with success status
 */
export const unfollowUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to unfollow a user'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'unfollowUser', RATE_LIMITS.GENERAL)

    const { targetUserId } = data
    const currentUserId = context.auth.uid

    if (!targetUserId || typeof targetUserId !== 'string') {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Target user ID is required'
        )
    }

    const db = admin.firestore()

    try {
        await db.runTransaction(async (transaction) => {
            const currentUserRef = db.collection('users').doc(currentUserId)
            const targetUserRef = db.collection('users').doc(targetUserId)

            const [currentUserDoc, targetUserDoc] = await Promise.all([
                transaction.get(currentUserRef),
                transaction.get(targetUserRef),
            ])

            if (!currentUserDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Your user account was not found')
            }
            if (!targetUserDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Target user not found')
            }

            // arrayRemove is idempotent — always write both sides to self-heal any inconsistency
            transaction.update(currentUserRef, {
                following: admin.firestore.FieldValue.arrayRemove(targetUserId),
            })
            transaction.update(targetUserRef, {
                followers: admin.firestore.FieldValue.arrayRemove(currentUserId),
            })
        })

        return { success: true }
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) {
            throw error
        }
        functions.logger.error('Error unfollowing user:', error)
        throw new functions.https.HttpsError('internal', 'Failed to unfollow user')
    }
})
