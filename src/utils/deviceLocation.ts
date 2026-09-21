/**
 * deviceLocation - The shutter-time location fix.
 *
 * Post and catch coordinates are captured once, at shutter press, and
 * never refetched at submit — the pin marks where the shot was taken.
 * Both flows (PostScreen originals, useCatchFlow catches) must use the
 * same strict fix: highest accuracy, bounded by a timeout, and no
 * last-known-position fallback — a stale fix is worse than none for
 * data that gates proximity checks and map pins.
 */

import * as Location from 'expo-location'

const FIX_TIMEOUT_MS = 10000

export interface ShutterFix {
    latitude: number
    longitude: number
}

/** Rejects on timeout or provider error — callers surface a retake. */
export async function getShutterFix(): Promise<ShutterFix> {
    const fixPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
    })
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
            () => reject(new Error('Location request timed out')),
            FIX_TIMEOUT_MS
        )
    })
    const location = await Promise.race([fixPromise, timeoutPromise])
    return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
    }
}
