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
import { distanceBetween, geohashForLocation, geohashQueryBounds } from 'geofire-common'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { onImageUpload } from './triggers/onImageUpload'

admin.initializeApp()

export { onImageUpload }

// Gemini SDK (lazy-init to avoid cold start cost when unused)
let genAI: GoogleGenerativeAI | null = null

function getGenAI(): GoogleGenerativeAI {
    if (!genAI) {
        const key = process.env.GEMINI_API_KEY
        if (!key) throw new Error('GEMINI_API_KEY not set')
        genAI = new GoogleGenerativeAI(key)
    }
    return genAI
}

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

        const distance = distanceBetween([userLat, userLng], [postLat, postLng]) * 1000 // km to meters
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

                // Log xp_catch to catcher's activity feed
                try {
                    await db.collection('users').doc(authorId).collection('notifications').add({
                        type: 'xp_catch',
                        amount: catchPoints,
                        postId: rootPostId || postData.parentPostId,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        read: true,
                    })
                } catch (e) {
                    functions.logger.error(`[onPostCreated] Failed to create xp_catch notification`, e)
                }
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

                    // --- AI Search: Enrich post with metadata + embedding ---
                    // Runs async after Pioneer classification. Each step is independent
                    // and wrapped in try/catch so failures don't block post creation.
                    const locationDocRef = locationQuery.docs[0].ref
                    const enrichmentUpdate: Record<string, any> = {}

                    // 1. Reverse geocode via Nominatim (free, no API key)
                    try {
                        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${newPostLocation.latitude}&lon=${newPostLocation.longitude}&format=json&addressdetails=1`
                        const geoResponse = await fetch(nominatimUrl, {
                            headers: { 'User-Agent': 'CatchApp/1.0' },
                        })
                        if (geoResponse.ok) {
                            const geoData = await geoResponse.json()
                            enrichmentUpdate.locationMeta = {
                                country: geoData.address?.country || null,
                                city: geoData.address?.city || geoData.address?.town || geoData.address?.village || null,
                                neighborhood: geoData.address?.suburb || geoData.address?.neighbourhood || null,
                                street: geoData.address?.road || null,
                                formattedAddress: geoData.display_name || null,
                            }
                        }
                    } catch (e) {
                        functions.logger.warn(`[onPostCreated] Nominatim geocoding failed for post ${postId}`, e)
                    }

                    // 2. Vision auto-tagging via Gemini Flash
                    try {
                        const photoPath = postData.photoURL
                        // Extract Storage path from download URL
                        const storagePathMatch = photoPath?.match(/\/o\/(.+?)\?/)
                        if (storagePathMatch) {
                            const storagePath = decodeURIComponent(storagePathMatch[1])
                            const bucket = admin.storage().bucket()
                            const [imageBuffer] = await Promise.race([
                                bucket.file(storagePath).download(),
                                new Promise<never>((_, reject) =>
                                    setTimeout(() => reject(new Error('Image download timeout')), 10000)
                                ),
                            ])
                            const imageBase64 = imageBuffer.toString('base64')

                            const model = getGenAI().getGenerativeModel({ model: 'gemini-2.0-flash' })
                            const result = await Promise.race([
                                model.generateContent([
                                    { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
                                    'Analyze this travel/location photo. Return ONLY valid JSON, no markdown:\n{\n  "tags": ["tag1", "tag2"],\n  "scene": "one-line scene description",\n  "landmark": "name or null",\n  "mood": "one-word mood"\n}',
                                ]),
                                new Promise<never>((_, reject) =>
                                    setTimeout(() => reject(new Error('Gemini timeout')), 15000)
                                ),
                            ])

                            const text = result.response.text()
                            // Strip markdown code fences if present
                            const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
                            const visualMeta = JSON.parse(jsonStr)
                            enrichmentUpdate.visualMeta = {
                                tags: Array.isArray(visualMeta.tags) ? visualMeta.tags : [],
                                scene: typeof visualMeta.scene === 'string' ? visualMeta.scene : null,
                                landmark: typeof visualMeta.landmark === 'string' ? visualMeta.landmark : null,
                                mood: typeof visualMeta.mood === 'string' ? visualMeta.mood : null,
                            }
                        }
                    } catch (e) {
                        functions.logger.warn(`[onPostCreated] Vision tagging failed for post ${postId}`, e)
                    }

                    // 3. Generate text embedding via OpenAI
                    try {
                        const embeddingParts = [
                            postData.caption,
                            enrichmentUpdate.locationMeta?.formattedAddress,
                            enrichmentUpdate.locationMeta?.city,
                            enrichmentUpdate.visualMeta?.scene,
                            enrichmentUpdate.visualMeta?.tags?.join(', '),
                            enrichmentUpdate.visualMeta?.mood,
                            enrichmentUpdate.visualMeta?.landmark,
                        ].filter(Boolean)

                        if (embeddingParts.length > 0) {
                            const embeddingText = embeddingParts.join('. ')
                            const embModel = getGenAI().getGenerativeModel({ model: 'gemini-embedding-001' })
                            const embResult = await embModel.embedContent({ content: { role: 'user', parts: [{ text: embeddingText }] }, outputDimensionality: 768 } as any)
                            enrichmentUpdate.embedding = admin.firestore.FieldValue.vector(
                                embResult.embedding.values
                            )
                        }
                    } catch (e) {
                        functions.logger.warn(`[onPostCreated] Embedding generation failed for post ${postId}`, e)
                    }

                    // Write all enrichment data in a single update
                    if (Object.keys(enrichmentUpdate).length > 0) {
                        enrichmentUpdate.metadataVersion = 1
                        await locationDocRef.update(enrichmentUpdate)
                        functions.logger.info(`[onPostCreated] Enriched post ${postId} with ${Object.keys(enrichmentUpdate).join(', ')}`)
                    }
                    // --- End AI Search enrichment ---
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

                // Log xp_post to author's activity feed
                try {
                    await db.collection('users').doc(authorId).collection('notifications').add({
                        type: 'xp_post',
                        amount: contributionAmount,
                        isPioneer,
                        postId,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        read: true,
                    })
                } catch (e) {
                    functions.logger.error(`[onPostCreated] Failed to create xp_post notification`, e)
                }

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

// ─── Report User ────────────────────────────────────────────────────────────

export const reportUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to report a user'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'reportUser', RATE_LIMITS.SETUP)

    const { targetUserId, reason, details } = data
    const reporterId = context.auth.uid

    functions.logger.info('[reportUser] Received data:', { targetUserId, reason, details: typeof details, reporterId })

    if (!targetUserId || typeof targetUserId !== 'string') {
        functions.logger.warn('[reportUser] Invalid targetUserId:', targetUserId)
        throw new functions.https.HttpsError('invalid-argument', 'Target user ID is required')
    }

    if (targetUserId === reporterId) {
        functions.logger.warn('[reportUser] Self-report attempt')
        throw new functions.https.HttpsError('invalid-argument', 'Cannot report yourself')
    }

    const VALID_REASONS = ['harassment', 'spam', 'impersonation', 'inappropriate_content', 'other']
    if (!reason || !VALID_REASONS.includes(reason)) {
        functions.logger.warn('[reportUser] Invalid reason:', reason)
        throw new functions.https.HttpsError('invalid-argument', 'Invalid report reason')
    }

    const sanitizedDetails = (typeof details === 'string') ? details.trim().slice(0, 500) : ''

    try {
        const db = admin.firestore()

        const targetDoc = await db.collection('users').doc(targetUserId).get()
        if (!targetDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found')
        }

        const existingReport = await db.collection('reports')
            .where('reporterId', '==', reporterId)
            .where('targetUserId', '==', targetUserId)
            .where('targetType', '==', 'user')
            .limit(1)
            .get()

        if (!existingReport.empty) {
            throw new functions.https.HttpsError('already-exists', 'You have already reported this user')
        }

        await db.collection('reports').add({
            reporterId,
            targetUserId,
            targetType: 'user',
            reason,
            details: sanitizedDetails,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        functions.logger.info(`[reportUser] User ${reporterId} reported user ${targetUserId} for ${reason}`)
        return { success: true }
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) {
            throw error
        }
        functions.logger.error('Error reporting user:', error)
        throw new functions.https.HttpsError('internal', 'Failed to submit report')
    }
})

// ─── Account Deletion ───────────────────────────────────────────────────────

/**
 * HTTPS Callable Function: Permanently deletes a user's account and all associated data
 *
 * Deletion order:
 * 1. All user's posts (triggers onPostDeleted for thread promotion, cleanup)
 * 2. Remove from other users' followers/following arrays
 * 3. User's lists
 * 4. Notifications subcollection
 * 5. user_recommendations, rate_limits, usernames index, training_pairs
 * 6. Storage files
 * 7. User document
 * 8. Firebase Auth account (last)
 */
export const deleteAccount = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to delete account'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'deleteAccount', RATE_LIMITS.SETUP)

    const userId = context.auth.uid
    const db = admin.firestore()
    const bucket = admin.storage().bucket()

    functions.logger.info(`[deleteAccount] Starting account deletion for user ${userId}`)

    // Read user doc first to get username for cleanup later
    let username: string | null = null
    try {
        const userDoc = await db.collection('users').doc(userId).get()
        if (userDoc.exists) {
            username = userDoc.data()?.username?.toLowerCase() || null
        }
    } catch (error) {
        functions.logger.error('[deleteAccount] Error reading user doc:', error)
    }

    // 1. Delete all user's posts (onPostDeleted handles thread promotion, location cleanup, list removal)
    try {
        const postsQuery = await db.collection('posts')
            .where('authorId', '==', userId)
            .get()

        functions.logger.info(`[deleteAccount] Deleting ${postsQuery.size} posts`)
        for (const postDoc of postsQuery.docs) {
            await postDoc.ref.delete()
        }
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting posts:', error)
    }

    // 2. Remove from other users' followers arrays
    try {
        const followersQuery = await db.collection('users')
            .where('followers', 'array-contains', userId)
            .get()

        if (!followersQuery.empty) {
            const batches: admin.firestore.WriteBatch[] = [db.batch()]
            let opCount = 0
            for (const doc of followersQuery.docs) {
                if (opCount >= 500) {
                    batches.push(db.batch())
                    opCount = 0
                }
                batches[batches.length - 1].update(doc.ref, {
                    followers: admin.firestore.FieldValue.arrayRemove(userId),
                })
                opCount++
            }
            for (const batch of batches) {
                await batch.commit()
            }
            functions.logger.info(`[deleteAccount] Removed from ${followersQuery.size} users' followers`)
        }
    } catch (error) {
        functions.logger.error('[deleteAccount] Error cleaning followers:', error)
    }

    // 3. Remove from other users' following arrays
    try {
        const followingQuery = await db.collection('users')
            .where('following', 'array-contains', userId)
            .get()

        if (!followingQuery.empty) {
            const batches: admin.firestore.WriteBatch[] = [db.batch()]
            let opCount = 0
            for (const doc of followingQuery.docs) {
                if (opCount >= 500) {
                    batches.push(db.batch())
                    opCount = 0
                }
                batches[batches.length - 1].update(doc.ref, {
                    following: admin.firestore.FieldValue.arrayRemove(userId),
                })
                opCount++
            }
            for (const batch of batches) {
                await batch.commit()
            }
            functions.logger.info(`[deleteAccount] Removed from ${followingQuery.size} users' following`)
        }
    } catch (error) {
        functions.logger.error('[deleteAccount] Error cleaning following:', error)
    }

    // 4. Delete user's lists
    try {
        const listsQuery = await db.collection('lists')
            .where('userId', '==', userId)
            .get()

        if (!listsQuery.empty) {
            const batches: admin.firestore.WriteBatch[] = [db.batch()]
            let opCount = 0
            for (const doc of listsQuery.docs) {
                if (opCount >= 500) {
                    batches.push(db.batch())
                    opCount = 0
                }
                batches[batches.length - 1].delete(doc.ref)
                opCount++
            }
            for (const batch of batches) {
                await batch.commit()
            }
            functions.logger.info(`[deleteAccount] Deleted ${listsQuery.size} lists`)
        }
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting lists:', error)
    }

    // 5. Delete notifications subcollection
    try {
        const notifsQuery = await db.collection('users').doc(userId)
            .collection('notifications')
            .get()

        if (!notifsQuery.empty) {
            const batches: admin.firestore.WriteBatch[] = [db.batch()]
            let opCount = 0
            for (const doc of notifsQuery.docs) {
                if (opCount >= 500) {
                    batches.push(db.batch())
                    opCount = 0
                }
                batches[batches.length - 1].delete(doc.ref)
                opCount++
            }
            for (const batch of batches) {
                await batch.commit()
            }
            functions.logger.info(`[deleteAccount] Deleted ${notifsQuery.size} notifications`)
        }
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting notifications:', error)
    }

    // 6. Delete user_recommendations, rate_limits, username index
    try {
        await db.collection('user_recommendations').doc(userId).delete()
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting recommendations:', error)
    }

    try {
        await db.collection('rate_limits').doc(userId).delete()
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting rate limits:', error)
    }

    if (username) {
        try {
            await db.collection('usernames').doc(username).delete()
            functions.logger.info(`[deleteAccount] Deleted username index: ${username}`)
        } catch (error) {
            functions.logger.error('[deleteAccount] Error deleting username index:', error)
        }
    }

    // 7. Delete training_pairs contributed by this user
    try {
        const trainingQuery = await db.collection('training_pairs')
            .where('userId', '==', userId)
            .get()

        if (!trainingQuery.empty) {
            const batches: admin.firestore.WriteBatch[] = [db.batch()]
            let opCount = 0
            for (const doc of trainingQuery.docs) {
                if (opCount >= 500) {
                    batches.push(db.batch())
                    opCount = 0
                }
                batches[batches.length - 1].delete(doc.ref)
                opCount++
            }
            for (const batch of batches) {
                await batch.commit()
            }
            functions.logger.info(`[deleteAccount] Deleted ${trainingQuery.size} training pairs`)
        }
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting training pairs:', error)
    }

    // 8. Delete Storage files
    try {
        await bucket.deleteFiles({ prefix: `posts/${userId}/` })
        functions.logger.info(`[deleteAccount] Deleted Storage files for posts/${userId}/`)
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting storage files:', error)
    }

    // 9. Delete user document
    try {
        await db.collection('users').doc(userId).delete()
        functions.logger.info(`[deleteAccount] Deleted user document`)
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting user doc:', error)
    }

    // 10. Delete Firebase Auth account (must be last)
    try {
        await admin.auth().deleteUser(userId)
        functions.logger.info(`[deleteAccount] Deleted Firebase Auth account`)
    } catch (error) {
        functions.logger.error('[deleteAccount] Error deleting auth account:', error)
    }

    functions.logger.info(`[deleteAccount] Account deletion complete for user ${userId}`)
    return { success: true }
})

// ─── Recommendation System (Phase 1) ────────────────────────────────────────

/** Maximum active cities per user */
const MAX_ACTIVE_CITIES = 10

/** Cities within this distance are considered duplicates */
const CITY_DEDUP_RADIUS_KM = 50

/** How long a searched city stays active (days) */
const CITY_EXPIRY_DAYS = 30

/** Radius for city trending queries (meters) */
const CITY_TRENDING_RADIUS = 25000

/** Max following IDs per Firestore 'in' query */
const FOLLOWING_BATCH_SIZE = 30

/**
 * HTTPS Callable Function: Records a city search intent for recommendations
 *
 * When a user searches for a city on the explore page, this records it as an
 * "active city" so the recommendation feed can surface trending posts from there.
 *
 * @param data.cityName - Display name of the city (e.g. "Tokyo")
 * @param data.latitude - City center latitude
 * @param data.longitude - City center longitude
 */
export const recordCityIntent = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to record city intent'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'recordCityIntent', RATE_LIMITS.GENERAL)

    const { cityName, latitude, longitude } = data
    const userId = context.auth.uid

    // Validate inputs
    if (!cityName || typeof cityName !== 'string' || cityName.length > 100) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'cityName must be a string (max 100 chars)'
        )
    }
    if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'latitude must be between -90 and 90'
        )
    }
    if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'longitude must be between -180 and 180'
        )
    }

    const db = admin.firestore()

    try {
        const geohash = geohashForLocation([latitude, longitude])
        const now = Date.now()
        const expiresAt = now + CITY_EXPIRY_DAYS * 24 * 60 * 60 * 1000

        const recRef = db.collection('user_recommendations').doc(userId)
        const recDoc = await recRef.get()
        let activeCities: any[] = recDoc.exists ? (recDoc.data()?.activeCities || []) : []

        // Prune expired cities
        activeCities = activeCities.filter((c: any) => c.expiresAt > now)

        // Check for duplicate (same city within dedup radius)
        const existingIndex = activeCities.findIndex((c: any) => {
            const dist = distanceBetween([latitude, longitude], [c.latitude, c.longitude])
            return dist <= CITY_DEDUP_RADIUS_KM
        })

        if (existingIndex >= 0) {
            // Refresh existing city
            activeCities[existingIndex] = {
                ...activeCities[existingIndex],
                name: cityName,
                weight: 0.7,
                expiresAt,
            }
        } else {
            // Add new city
            const newCity = {
                name: cityName,
                latitude,
                longitude,
                geohash,
                source: 'search',
                weight: 0.7,
                createdAt: now,
                expiresAt,
            }
            activeCities.push(newCity)

            // Cap at max cities (drop oldest by createdAt)
            if (activeCities.length > MAX_ACTIVE_CITIES) {
                activeCities.sort((a: any, b: any) => b.createdAt - a.createdAt)
                activeCities = activeCities.slice(0, MAX_ACTIVE_CITIES)
            }
        }

        await recRef.set({ activeCities, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })

        functions.logger.info(`[recordCityIntent] Recorded city "${cityName}" for user ${userId}`)
        return { success: true }
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) throw error
        functions.logger.error('Error recording city intent:', error)
        throw new functions.https.HttpsError('internal', 'Failed to record city intent')
    }
})

/**
 * HTTPS Callable Function: Returns a paginated personalized feed
 *
 * Combines two candidate sources:
 * 1. Social feed — posts/catches from followed users
 * 2. City trending — popular posts in cities the user has searched for
 *
 * Each post includes a reason label explaining why it was recommended.
 *
 * @param data.cursor - Opaque pagination cursor from previous response
 * @param data.pageSize - Number of posts to return (default 20, max 50)
 * @returns { posts, nextCursor, hasMore }
 */
export const getRecommendedFeed = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to get recommendations'
        )
    }

    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'getRecommendedFeed', RATE_LIMITS.EXPENSIVE)

    const userId = context.auth.uid
    const pageSize = Math.min(Math.max(data?.pageSize || 20, 1), 50)
    const cursor = data?.cursor ? JSON.parse(data.cursor) : null // { lastScore, lastPostId }

    const db = admin.firestore()

    try {
        // ── Step 1: Get user's following list ──
        const userDoc = await db.collection('users').doc(userId).get()
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found')
        }
        const following: string[] = userDoc.data()?.following || []

        // ── Step 2: Social feed — posts from followed users ──
        const socialPosts: any[] = []

        if (following.length > 0) {
            const socialLimit = pageSize * 2 // Fetch extra for merging

            for (let i = 0; i < following.length; i += FOLLOWING_BATCH_SIZE) {
                const batch = following.slice(i, i + FOLLOWING_BATCH_SIZE)
                const q = db.collection('posts')
                    .where('authorId', 'in', batch)
                    .orderBy('createdAt', 'desc')
                    .limit(socialLimit)
                const snap = await q.get()

                snap.docs.forEach(doc => {
                    const postData = doc.data()
                    // Skip user's own posts
                    if (postData.authorId === userId) return

                    const isOriginal = postData.isOriginal ?? true
                    const reasonLabel = isOriginal
                        ? `Posted by @${postData.authorUsername}`
                        : `@${postData.authorUsername} caught this`

                    // Recency bonus: posts < 7 days get up to 50 extra score
                    const ageHours = (Date.now() - (postData.createdAt?.toMillis?.() || 0)) / (1000 * 60 * 60)
                    const recencyBonus = 50 * Math.max(0, 1 - ageHours / 168)

                    socialPosts.push({
                        id: doc.id,
                        authorId: postData.authorId,
                        authorUsername: postData.authorUsername,
                        caption: postData.caption || '',
                        photoURL: postData.photoURL,
                        thumbnailURL: postData.thumbnailURL || null,
                        mediumURL: postData.mediumURL || null,
                        catchCount: postData.catchCount || 0,
                        createdAt: postData.createdAt?.toMillis?.() ?? null,
                        isOriginal,
                        isPioneer: postData.isPioneer || false,
                        hasLocation: postData.hasLocation ?? false,
                        parentPostId: postData.parentPostId || null,
                        rootPostId: postData.rootPostId || null,
                        reasonLabel,
                        reasonType: 'social',
                        score: 100 + recencyBonus,
                    })
                })
            }
        }

        // ── Step 3: City trending — popular posts in active cities ──
        const cityPosts: any[] = []

        const recDoc = await db.collection('user_recommendations').doc(userId).get()
        let activeCities: any[] = recDoc.exists ? (recDoc.data()?.activeCities || []) : []

        // Filter expired, sort by weight, take top 5
        const now = Date.now()
        activeCities = activeCities
            .filter((c: any) => c.expiresAt > now)
            .sort((a: any, b: any) => b.weight - a.weight)
            .slice(0, 5)

        for (const city of activeCities) {
            const center: [number, number] = [city.latitude, city.longitude]
            const bounds = geohashQueryBounds(center, CITY_TRENDING_RADIUS)

            const locationPromises = bounds.map(([start, end]) =>
                db.collection('post_locations')
                    .where('geohash', '>=', start)
                    .where('geohash', '<=', end)
                    .limit(GEOHASH_QUERY_LIMIT)
                    .get()
            )
            const locationSnapshots = await Promise.all(locationPromises)

            // Collect post IDs within actual radius
            const cityPostIds: string[] = []
            locationSnapshots.forEach(snapshot => {
                snapshot.docs.forEach(doc => {
                    const loc = doc.data()
                    const dist = distanceBetween(center, [loc.latitude, loc.longitude])
                    if (dist <= CITY_TRENDING_RADIUS / 1000) { // distanceBetween returns km
                        cityPostIds.push(loc.postId)
                    }
                })
            })

            if (cityPostIds.length === 0) continue

            // Fetch post data in batches of 100
            const uniquePostIds = [...new Set(cityPostIds)].slice(0, 100)
            const postRefs = uniquePostIds.map(id => db.collection('posts').doc(id))

            for (let i = 0; i < postRefs.length; i += 100) {
                const chunk = postRefs.slice(i, i + 100)
                const postSnaps = await db.getAll(...chunk)

                postSnaps.forEach(snap => {
                    if (!snap.exists) return
                    const postData = snap.data()!
                    // Skip user's own posts and non-originals
                    if (postData.authorId === userId) return
                    if (!postData.isOriginal) return

                    const catchCount = postData.catchCount || 0
                    const score = 50 + (catchCount * 2) + (city.weight * 20)

                    cityPosts.push({
                        id: snap.id,
                        authorId: postData.authorId,
                        authorUsername: postData.authorUsername,
                        caption: postData.caption || '',
                        photoURL: postData.photoURL,
                        thumbnailURL: postData.thumbnailURL || null,
                        mediumURL: postData.mediumURL || null,
                        catchCount,
                        createdAt: postData.createdAt?.toMillis?.() ?? null,
                        isOriginal: true,
                        isPioneer: postData.isPioneer || false,
                        hasLocation: postData.hasLocation ?? false,
                        parentPostId: postData.parentPostId || null,
                        rootPostId: postData.rootPostId || null,
                        reasonLabel: `Trending in ${city.name}`,
                        reasonType: 'city_trending',
                        score,
                    })
                })
            }
        }

        // ── Step 4: Merge, deduplicate, sort, paginate ──
        const seenIds = new Set<string>()
        const allPosts: any[] = []

        // Social posts first (preferred reason when duplicated)
        for (const post of socialPosts) {
            if (!seenIds.has(post.id)) {
                seenIds.add(post.id)
                allPosts.push(post)
            }
        }
        for (const post of cityPosts) {
            if (!seenIds.has(post.id)) {
                seenIds.add(post.id)
                allPosts.push(post)
            }
        }

        // Sort by score descending, then by createdAt descending for ties
        allPosts.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            return (b.createdAt || 0) - (a.createdAt || 0)
        })

        // Apply cursor-based pagination
        let startIndex = 0
        if (cursor) {
            startIndex = allPosts.findIndex(p =>
                p.score < cursor.lastScore ||
                (p.score === cursor.lastScore && p.id === cursor.lastPostId)
            )
            if (startIndex === -1) startIndex = allPosts.length
            // Skip past the cursor post itself
            if (startIndex < allPosts.length && allPosts[startIndex].id === cursor.lastPostId) {
                startIndex++
            }
        }

        const pagePosts = allPosts.slice(startIndex, startIndex + pageSize)
        const hasMore = startIndex + pageSize < allPosts.length

        let nextCursor: string | null = null
        if (hasMore && pagePosts.length > 0) {
            const lastPost = pagePosts[pagePosts.length - 1]
            nextCursor = JSON.stringify({ lastScore: lastPost.score, lastPostId: lastPost.id })
        }

        functions.logger.info(
            `[getRecommendedFeed] User ${userId}: ${socialPosts.length} social, ` +
            `${cityPosts.length} city trending, ${pagePosts.length} returned (page ${startIndex / pageSize})`
        )

        return { posts: pagePosts, nextCursor, hasMore }
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) throw error
        functions.logger.error('Error getting recommended feed:', error)
        throw new functions.https.HttpsError('internal', 'Failed to get recommended feed')
    }
})

/**
 * Semantic search across posts using vector similarity.
 * Embeds the user's query and finds nearest matches in post_locations.
 */
export const searchPosts = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in')
    }
    verifyAppCheck(context)
    await checkRateLimit(context.auth.uid, 'searchPosts', RATE_LIMITS.GENERAL)

    const { query, location } = data
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Query is required')
    }
    if (query.length > 200) {
        throw new functions.https.HttpsError('invalid-argument', 'Query too long')
    }

    const hasLocation = location && typeof location.lat === 'number' && typeof location.lng === 'number'
    const db = admin.firestore()

    try {
        // 1. Embed the search query
        const embModel = getGenAI().getGenerativeModel({ model: 'gemini-embedding-001' })
        const embResult = await embModel.embedContent({ content: { role: 'user', parts: [{ text: query.trim() }] }, outputDimensionality: 768 } as any)
        const queryVector = embResult.embedding.values

        // 2. Vector similarity search via Firestore findNearest
        const vectorQuery = db.collection('post_locations').findNearest({
            vectorField: 'embedding',
            queryVector,
            limit: 50,
            distanceMeasure: 'COSINE',
            distanceResultField: 'vectorDistance',
        })
        const snapshot = await vectorQuery.get()

        // 3. Compute geo distance + re-rank if user location available
        let locationResults = snapshot.docs.map(doc => {
            const d = doc.data()
            let distanceKm: number | null = null
            if (hasLocation) {
                distanceKm = distanceBetween(
                    [location.lat, location.lng],
                    [d.latitude, d.longitude]
                )
            }
            return { id: doc.id, ...d, distanceKm }
        })

        if (hasLocation) {
            // Re-rank: boost nearby results using log-scaled distance penalty
            // 1km → 1.09x, 10km → 1.31x, 100km → 1.60x, 1000km → 1.90x
            locationResults.sort((a: any, b: any) => {
                const aScore = (a.vectorDistance || 0) * (1 + Math.log10(1 + (a.distanceKm || 0)) * 0.3)
                const bScore = (b.vectorDistance || 0) * (1 + Math.log10(1 + (b.distanceKm || 0)) * 0.3)
                return aScore - bScore
            })
        }

        // Filter by relevance: cosine distance > 0.6 means weak/unrelated match
        locationResults = locationResults.filter((r: any) => (r.vectorDistance || 0) < 0.6)

        // Take top 50 after re-ranking
        locationResults = locationResults.slice(0, 50)

        if (locationResults.length === 0) {
            return { posts: [] }
        }

        // 4. Batch fetch post documents for summaries
        const postIds = locationResults.map((r: any) => r.postId)
        const postMap: Record<string, any> = {}

        for (let i = 0; i < postIds.length; i += 100) {
            const batch = postIds.slice(i, i + 100)
            const refs = batch.map((id: string) => db.collection('posts').doc(id))
            const docs = await db.getAll(...refs)
            for (const doc of docs) {
                if (doc.exists) {
                    postMap[doc.id] = doc.data()
                }
            }
        }

        // 5. Return merged results
        const posts = locationResults
            .filter((r: any) => postMap[r.postId])
            .map((r: any) => {
                const post = postMap[r.postId]
                return {
                    postId: r.postId,
                    authorId: post.authorId,
                    authorUsername: post.authorUsername,
                    caption: post.caption,
                    photoURL: post.photoURL,
                    thumbnailURL: post.thumbnailURL || null,
                    mediumURL: post.mediumURL || null,
                    catchCount: post.catchCount || 0,
                    isPioneer: post.isPioneer || false,
                    isOriginal: post.isOriginal,
                    createdAt: post.createdAt,
                    city: r.locationMeta?.city || null,
                    country: r.locationMeta?.country || null,
                    tags: r.visualMeta?.tags || [],
                    scene: r.visualMeta?.scene || null,
                    distanceKm: r.distanceKm !== null ? Math.round(r.distanceKm * 10) / 10 : null,
                    latitude: r.latitude,
                    longitude: r.longitude,
                    vectorDistance: r.vectorDistance || 0,
                }
            })

        functions.logger.info(`[searchPosts] Query "${query}" returned ${posts.length} results`)
        return { posts }
    } catch (error: any) {
        const msg = error?.message || String(error)
        functions.logger.error('Error in searchPosts:', msg, error)
        throw new functions.https.HttpsError('internal', `Search failed: ${msg}`)
    }
})

// ============================================================================
// BACKFILL EMBEDDINGS
// One-time admin function to enrich existing post_locations with
// locationMeta, visualMeta, and vector embeddings for search.
// ============================================================================
export const backfillEmbeddings = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated')
        }

        const db = admin.firestore()
        const snapshot = await db.collection('post_locations').get()

        let processed = 0
        let skipped = 0
        let errors = 0

        for (const doc of snapshot.docs) {
            const locData = doc.data()

            // Skip docs that already have an embedding
            if (locData.embedding) {
                skipped++
                continue
            }

            try {
                const enrichmentUpdate: Record<string, any> = {}

                // 1. Reverse geocode if missing locationMeta
                if (!locData.locationMeta && locData.latitude && locData.longitude) {
                    try {
                        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${locData.latitude}&lon=${locData.longitude}&format=json&addressdetails=1`
                        const geoResponse = await fetch(nominatimUrl, {
                            headers: { 'User-Agent': 'CatchApp/1.0' },
                        })
                        if (geoResponse.ok) {
                            const geoData = await geoResponse.json()
                            enrichmentUpdate.locationMeta = {
                                country: geoData.address?.country || null,
                                city: geoData.address?.city || geoData.address?.town || geoData.address?.village || null,
                                neighborhood: geoData.address?.suburb || geoData.address?.neighbourhood || null,
                                street: geoData.address?.road || null,
                                formattedAddress: geoData.display_name || null,
                            }
                        }
                        // Nominatim rate limit: 1 req/sec
                        await new Promise(resolve => setTimeout(resolve, 1100))
                    } catch (e) {
                        functions.logger.warn(`[backfill] Geocoding failed for ${doc.id}`, e)
                    }
                }

                // 2. Vision tagging if missing visualMeta
                if (!locData.visualMeta && locData.postId) {
                    try {
                        const postDoc = await db.collection('posts').doc(locData.postId).get()
                        const postData = postDoc.data()
                        const photoPath = postData?.photoURL
                        const storagePathMatch = photoPath?.match(/\/o\/(.+?)\?/)
                        if (storagePathMatch) {
                            const storagePath = decodeURIComponent(storagePathMatch[1])
                            const bucket = admin.storage().bucket()
                            const [imageBuffer] = await Promise.race([
                                bucket.file(storagePath).download(),
                                new Promise<never>((_, reject) =>
                                    setTimeout(() => reject(new Error('Image download timeout')), 10000)
                                ),
                            ])
                            const imageBase64 = imageBuffer.toString('base64')

                            const model = getGenAI().getGenerativeModel({ model: 'gemini-2.0-flash' })
                            const result = await Promise.race([
                                model.generateContent([
                                    { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
                                    'Analyze this travel/location photo. Return ONLY valid JSON, no markdown:\n{\n  "tags": ["tag1", "tag2"],\n  "scene": "one-line scene description",\n  "landmark": "name or null",\n  "mood": "one-word mood"\n}',
                                ]),
                                new Promise<never>((_, reject) =>
                                    setTimeout(() => reject(new Error('Gemini timeout')), 15000)
                                ),
                            ])

                            const text = result.response.text()
                            const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
                            const visualMeta = JSON.parse(jsonStr)
                            enrichmentUpdate.visualMeta = {
                                tags: Array.isArray(visualMeta.tags) ? visualMeta.tags : [],
                                scene: typeof visualMeta.scene === 'string' ? visualMeta.scene : null,
                                landmark: typeof visualMeta.landmark === 'string' ? visualMeta.landmark : null,
                                mood: typeof visualMeta.mood === 'string' ? visualMeta.mood : null,
                            }
                        }
                    } catch (e) {
                        functions.logger.warn(`[backfill] Vision tagging failed for ${doc.id}`, e)
                    }
                }

                // 3. Generate embedding from all available text
                try {
                    const meta = enrichmentUpdate.locationMeta || locData.locationMeta || {}
                    const visual = enrichmentUpdate.visualMeta || locData.visualMeta || {}

                    // Fetch caption from posts collection
                    let caption = ''
                    if (locData.postId) {
                        const postDoc = await db.collection('posts').doc(locData.postId).get()
                        caption = postDoc.data()?.caption || ''
                    }

                    const embeddingParts = [
                        caption,
                        meta.formattedAddress,
                        meta.city,
                        visual.scene,
                        visual.tags?.join(', '),
                        visual.mood,
                        visual.landmark,
                    ].filter(Boolean)

                    if (embeddingParts.length > 0) {
                        const embeddingText = embeddingParts.join('. ')
                        const embModel = getGenAI().getGenerativeModel({ model: 'gemini-embedding-001' })
                        const embResult = await embModel.embedContent({ content: { role: 'user', parts: [{ text: embeddingText }] }, outputDimensionality: 768 } as any)
                        enrichmentUpdate.embedding = admin.firestore.FieldValue.vector(
                            embResult.embedding.values
                        )
                    }
                } catch (e) {
                    functions.logger.warn(`[backfill] Embedding failed for ${doc.id}`, e)
                }

                // 4. Write updates
                if (Object.keys(enrichmentUpdate).length > 0) {
                    enrichmentUpdate.metadataVersion = 1
                    await doc.ref.update(enrichmentUpdate)
                    processed++
                    functions.logger.info(`[backfill] Enriched ${doc.id} (${processed}/${snapshot.docs.length - skipped})`)
                }
            } catch (e) {
                errors++
                functions.logger.warn(`[backfill] Failed for ${doc.id}`, e)
            }
        }

        const summary = { processed, skipped, errors, total: snapshot.docs.length }
        functions.logger.info(`[backfill] Complete:`, summary)
        return summary
    })
