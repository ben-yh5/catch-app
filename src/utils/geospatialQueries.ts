import { getFunctions, httpsCallable } from 'firebase/functions'
import { distanceBetween } from 'geofire-common'
import { PostSummary } from '@/types'

const functions = getFunctions()

export interface MapBounds {
    north: number
    south: number
    east: number
    west: number
}

export interface CircleArea {
    centerLat: number
    centerLng: number
    radiusInMeters: number
}

export interface PostLocation {
    postId: string
    latitude: number
    longitude: number
    geohash: string
}

export interface EnrichedPostLocation extends PostLocation {
    summary?: PostSummary
}

export interface AreaQueryOptions {
    includeSummary?: boolean
    filterOriginal?: boolean
}

// Cache for viewport queries (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000
const cache = new Map<
    string,
    { data: EnrichedPostLocation[]; timestamp: number }
>()

/**
 * Drop all cached viewport results. Called after a post is created or
 * deleted so the map reflects the change on its next fetch instead of
 * serving up-to-5-minute-old data.
 */
export function invalidateAreaCache(): void {
    cache.clear()
}

function getCacheKey(bounds: MapBounds, options?: AreaQueryOptions): string {
    // Round to 3 decimal places (~100m precision) for cache key
    const base = `v2:${bounds.north.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.west.toFixed(3)}`
    if (options?.includeSummary) return base + ':s'
    return base
}

/**
 * Get posts within a map viewport
 */
export async function getPostsInViewport(
    bounds: MapBounds,
    options?: AreaQueryOptions
): Promise<EnrichedPostLocation[]> {
    const cacheKey = getCacheKey(bounds, options)
    const cached = cache.get(cacheKey)

    // Return cached data if fresh
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Returning cached posts for viewport')
        return cached.data
    }

    try {
        // Calculate center and radius from bounds to use the radius-based query
        // This ensures compatibility even if the cloud function doesn't support bounds natively yet
        const centerLat = (bounds.north + bounds.south) / 2
        const centerLng = (bounds.east + bounds.west) / 2

        // Calculate radius (distance from center to corner)
        // We use the simpler radius query which is known to be stable
        const radiusInMeters = calculateDistance(
            centerLat,
            centerLng,
            bounds.north,
            bounds.east
        )

        // Add a small buffer to radius to ensure we cover the corners, cap at 100km
        const bufferRadius = Math.min(radiusInMeters * 1.1, 100000)

        const results = await getPostsInRadius(
            {
                centerLat,
                centerLng,
                radiusInMeters: bufferRadius,
            },
            options
        )

        // Optional: Filter results to strictly match the rectangular bounds
        // This removes points that are in the circle but outside the rectangle
        const filteredResults = results.filter(
            (loc) =>
                loc.latitude <= bounds.north &&
                loc.latitude >= bounds.south &&
                loc.longitude <= bounds.east &&
                loc.longitude >= bounds.west
        )

        // Cache the result
        cache.set(cacheKey, {
            data: filteredResults,
            timestamp: Date.now(),
        })

        // Clean old cache entries
        if (cache.size > 50) {
            const entries = Array.from(cache.entries())
            const sorted = entries.sort(
                (a, b) => a[1].timestamp - b[1].timestamp
            )
            const toDelete = sorted.slice(0, 25) // Remove oldest 25
            toDelete.forEach(([key]) => cache.delete(key))
        }

        return filteredResults
    } catch (error) {
        console.error('Error fetching posts in viewport:', error)
        throw error
    }
}

/**
 * Get posts within a circular radius
 */
export async function getPostsInRadius(
    area: CircleArea,
    options?: AreaQueryOptions
): Promise<EnrichedPostLocation[]> {
    try {
        const getPostsInArea = httpsCallable<
            CircleArea & AreaQueryOptions,
            { posts: EnrichedPostLocation[]; count: number }
        >(functions, 'getPostsInArea')

        const result = await getPostsInArea({
            ...area,
            includeSummary: options?.includeSummary,
            filterOriginal: options?.filterOriginal,
        })
        return result.data.posts
    } catch (error) {
        console.error('Error fetching posts in radius:', error)
        throw error
    }
}

/**
 * Calculate distance between two points in meters
 * Can be called with either:
 * - 4 numbers: calculateDistance(lat1, lon1, lat2, lon2)
 * - 2 point objects: calculateDistance({lat, lng}, {lat, lng})
 */
export function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    return distanceBetween([lat1, lon1], [lat2, lon2]) * 1000 // Convert km to meters
}

/**
 * Get locations for specific posts by ID
 */
export async function getPostLocations(
    postIds: string[]
): Promise<PostLocation[]> {
    try {
        const getPostLocationsFn = httpsCallable<
            { postIds: string[] },
            { locations: PostLocation[] }
        >(functions, 'getPostLocations')

        const result = await getPostLocationsFn({ postIds })
        return result.data.locations
    } catch (error) {
        console.error('Error fetching post locations:', error)
        throw error
    }
}
