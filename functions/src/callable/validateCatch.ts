import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { distanceBetween } from 'geofire-common'
import { CATCH_RADIUS_METERS, MAX_INSTANCES } from '../lib/constants'

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
export const validateCatch = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to validate catch'
            )
        }

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
                throw new functions.https.HttpsError(
                    'not-found',
                    'Post not found'
                )
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
            const existingCatchQuery = await db
                .collection('posts')
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

            const distance =
                distanceBetween([userLat, userLng], [postLat, postLng]) * 1000 // km to meters
            const isValid = distance <= CATCH_RADIUS_METERS

            return {
                isValid,
                distance: Math.round(distance),
                requiredDistance: CATCH_RADIUS_METERS,
                heading: locationData.heading, // Optional
                pitch: locationData.pitch, // Optional
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
