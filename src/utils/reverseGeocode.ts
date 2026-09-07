/**
 * Display-layer reverse geocoding for the passport stamp.
 *
 * Uses the OS geocoder (expo-location) — NOT the server-side Nominatim
 * pipeline that writes locationMeta. This result is never persisted; it
 * only decorates the stamp on the post/catch payoff screens, so failure
 * degrades to a stamp without a place line rather than an error.
 */

import { StampPlace } from '@/components/PassportStamp'
import * as Location from 'expo-location'

const GEOCODE_TIMEOUT_MS = 2500

export async function reverseGeocodeForStamp(
    latitude: number,
    longitude: number
): Promise<StampPlace | null> {
    try {
        const timeout = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), GEOCODE_TIMEOUT_MS)
        )
        const results = await Promise.race([
            Location.reverseGeocodeAsync({ latitude, longitude }),
            timeout,
        ])
        const first = results?.[0]
        if (!first) return null
        const city = first.city ?? first.subregion ?? first.region ?? undefined
        const country = first.country ?? undefined
        if (!city && !country) return null
        return { city, country }
    } catch {
        return null
    }
}
