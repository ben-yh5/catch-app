/**
 * Catch Validation Utility
 *
 * Client-side wrapper for the validateCatch Cloud Function.
 * Validates whether a user is close enough to a post's location to catch it.
 *
 * Security: Post coordinates are never exposed to the client - validation
 * happens entirely server-side using the private post_locations collection.
 */

import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'

/**
 * Mirrors CATCH_RADIUS_METERS in functions/src/lib/constants.ts.
 * Display-only hint (live distance indicator, onboarding copy) — the
 * server-side validateCatch check remains the authority.
 */
export const CATCH_RADIUS_METERS = 100

interface ValidateCatchRequest {
    postId: string
    userLat: number
    userLng: number
}

interface ValidateCatchResponse {
    isValid: boolean
    distance: number
    requiredDistance: number
    heading?: number // Original post's heading (0-360)
    pitch?: number // Original post's pitch (-90 to 90)
}

/**
 * Validates if the user is within the acceptable radius to catch a post.
 * The actual post coordinates are never sent to the client - validation happens server-side.
 *
 * @param postId - The ID of the post to catch
 * @param userLat - User's current latitude
 * @param userLng - User's current longitude
 * @returns Promise with validation result including isValid, distance, and requiredDistance
 */
export const validateCatch = async (
    postId: string,
    userLat: number,
    userLng: number
): Promise<ValidateCatchResponse> => {
    const validateCatchFunction = httpsCallable<
        ValidateCatchRequest,
        ValidateCatchResponse
    >(functions, 'validateCatch')

    const result = await validateCatchFunction({
        postId,
        userLat,
        userLng,
    })

    return result.data
}
