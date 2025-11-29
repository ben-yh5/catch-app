import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()

const CATCH_RADIUS_METERS = 100 // Define acceptable proximity (100 meters)

// Haversine formula to calculate distance between two coordinates
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

export const validateCatch = functions.https.onCall(async (data, context) => {
    // Check authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in to validate catch'
        )
    }

    const { postId, userLat, userLng } = data

    // Validate input
    if (!postId || userLat === undefined || userLng === undefined) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Missing required fields: postId, userLat, userLng'
        )
    }

    try {
        // Verify post exists
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

        // Get post location from private collection (server-side only)
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
        const { latitude: postLat, longitude: postLng } = locationData

        // Calculate distance between user and post location
        const distance = getDistanceInMeters(userLat, userLng, postLat, postLng)

        // Check if within acceptable radius
        const isValid = distance <= CATCH_RADIUS_METERS

        return {
            isValid,
            distance: Math.round(distance), // Return distance for UI feedback
            requiredDistance: CATCH_RADIUS_METERS,
        }
    } catch (error: any) {
        functions.logger.error('Error validating catch:', error)
        throw new functions.https.HttpsError(
            'internal',
            'Failed to validate catch location'
        )
    }
})

// Firestore trigger: When a post is created, increment user's post count and notify followers
export const onPostCreated = functions.firestore
    .document('posts/{postId}')
    .onCreate(async (snap) => {
        const postData = snap.data()
        const authorId = postData.authorId
        const postId = snap.id

        if (!authorId) {
            functions.logger.warn('Post created without authorId:', snap.id)
            return
        }

        try {
            const userRef = admin.firestore().collection('users').doc(authorId)

            // Increment totalCatches if this is a catch (not an original post)
            if (postData.parentPostId && !postData.isOriginal) {
                await userRef.update({
                    totalCatches: admin.firestore.FieldValue.increment(1),
                })
                functions.logger.info(`Incremented totalCatches for user ${authorId}`)
            }

            // Send notifications to followers (only for original posts, not catches)
            if (postData.isOriginal) {
                const authorDoc = await userRef.get()
                if (!authorDoc.exists) {
                    functions.logger.warn(`Author ${authorId} not found`)
                    return
                }

                const authorData = authorDoc.data()
                const authorUsername = authorData?.username || 'Someone'
                const followers = authorData?.followers || []

                functions.logger.info(
                    `Notifying ${followers.length} followers about new post from ${authorUsername}`
                )

                // Notify each follower
                for (const followerId of followers) {
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
                        const pushToken = followerData?.pushToken

                        if (!pushToken) {
                            functions.logger.info(
                                `Follower ${followerId} has no push token, skipping`
                            )
                            continue
                        }

                        // Send push notification
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

                        functions.logger.info(
                            `Sent new post notification to follower ${followerId}`
                        )
                    } catch (error) {
                        functions.logger.error(
                            `Error sending notification to follower ${followerId}:`,
                            error
                        )
                        // Continue with other followers even if one fails
                    }
                }
            }
        } catch (error) {
            functions.logger.error('Error in onPostCreated trigger:', error)
        }
    })

// Firestore trigger: When a post is deleted, handle thread promotion and user counts
export const onPostDeleted = functions.firestore
    .document('posts/{postId}')
    .onDelete(async (snap) => {
        const postData = snap.data()
        const postId = snap.id
        const authorId = postData.authorId

        if (!authorId) {
            functions.logger.warn('Deleted post had no authorId:', postId)
            return
        }

        try {
            const userRef = admin.firestore().collection('users').doc(authorId)

            // Decrement totalCatches if this was a catch
            if (postData.parentPostId && !postData.isOriginal) {
                await userRef.update({
                    totalCatches: admin.firestore.FieldValue.increment(-1),
                })
                functions.logger.info(`Decremented totalCatches for user ${authorId}`)
            }

            // Handle root post deletion - promote oldest catch to new root
            if (postData.isOriginal) {
                functions.logger.info(`Root post ${postId} deleted, checking for thread promotion`)

                // Find all catches in this thread
                const catchesQuery = await admin
                    .firestore()
                    .collection('posts')
                    .where('rootPostId', '==', postId)
                    .orderBy('createdAt', 'asc')
                    .get()

                if (!catchesQuery.empty) {
                    // Get the oldest catch to promote
                    const newRootDoc = catchesQuery.docs[0]
                    const newRootId = newRootDoc.id

                    functions.logger.info(`Promoting catch ${newRootId} to new root`)

                    // Update the new root post
                    const batch = admin.firestore().batch()

                    // Make the oldest catch the new root
                    batch.update(newRootDoc.ref, {
                        isOriginal: true,
                        parentPostId: null,
                        rootPostId: null,
                        catchCount: postData.catchCount - 1, // Transfer catch count minus 1 (this catch no longer counts)
                    })

                    // Update all other catches to point to the new root
                    for (let i = 1; i < catchesQuery.docs.length; i++) {
                        const catchDoc = catchesQuery.docs[i]
                        batch.update(catchDoc.ref, {
                            rootPostId: newRootId,
                            parentPostId: newRootId,
                        })
                    }

                    // Transfer location data from deleted root to new root
                    const oldLocationQuery = await admin
                        .firestore()
                        .collection('post_locations')
                        .where('postId', '==', postId)
                        .limit(1)
                        .get()

                    // The new root should already have location data (it was a valid catch)
                    // But if for some reason it doesn't and the old root did, we could copy it
                    // For now, the new root keeps its own location data

                    // Delete the old root's location data
                    if (!oldLocationQuery.empty) {
                        batch.delete(oldLocationQuery.docs[0].ref)
                    }

                    await batch.commit()
                    functions.logger.info(`Thread promotion complete. New root: ${newRootId}`)
                } else {
                    // No catches in thread, just delete the location data
                    const locationQuery = await admin
                        .firestore()
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
                // Non-root post deleted - decrement root's catchCount
                const rootPostId = postData.rootPostId
                if (rootPostId) {
                    const rootRef = admin.firestore().collection('posts').doc(rootPostId)
                    const rootDoc = await rootRef.get()
                    if (rootDoc.exists) {
                        await rootRef.update({
                            catchCount: admin.firestore.FieldValue.increment(-1),
                        })
                        functions.logger.info(`Decremented catchCount for root post ${rootPostId}`)
                    }
                }

                // Delete the catch's location data
                const locationQuery = await admin
                    .firestore()
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

// Helper function to send push notification via FCM
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

// Firestore trigger: When a user's followers array is updated, send notification
export const onUserFollowed = functions.firestore
    .document('users/{userId}')
    .onUpdate(async (change, context) => {
        const userId = context.params.userId
        const beforeData = change.before.data()
        const afterData = change.after.data()

        // Check if followers array was modified
        const beforeFollowers = beforeData.followers || []
        const afterFollowers = afterData.followers || []

        // Find new followers (added to the array)
        const newFollowers = afterFollowers.filter(
            (followerId: string) => !beforeFollowers.includes(followerId)
        )

        if (newFollowers.length === 0) {
            return // No new followers
        }

        const pushToken = afterData.pushToken
        if (!pushToken) {
            functions.logger.info(
                `User ${userId} has no push token, skipping notification`
            )
            return
        }

        // Get the follower's username for each new follower
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

                // Send push notification
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
