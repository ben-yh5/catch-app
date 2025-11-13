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
