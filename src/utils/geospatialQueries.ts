import { getFunctions, httpsCallable } from 'firebase/functions'
import { distanceBetween } from 'geofire-common'

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

// Cache for viewport queries (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000
const cache = new Map<string, { data: PostLocation[]; timestamp: number }>()

function getCacheKey(bounds: MapBounds): string {
    // Round to 3 decimal places (~100m precision) for cache key
    return `${bounds.north.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.west.toFixed(3)}`
}

/**
 * Get posts within a map viewport
 */
export async function getPostsInViewport(
    bounds: MapBounds
): Promise<PostLocation[]> {
    const cacheKey = getCacheKey(bounds)
    const cached = cache.get(cacheKey)

    // Return cached data if fresh
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log('Returning cached posts for viewport')
        return cached.data
    }

    try {
        const getPostsInArea = httpsCallable<
            MapBounds,
            { posts: PostLocation[]; count: number }
        >(functions, 'getPostsInArea')

        const result = await getPostsInArea(bounds)

        // Cache the result
        cache.set(cacheKey, {
            data: result.data.posts,
            timestamp: Date.now(),
        })

        // Clean old cache entries
        if (cache.size > 50) {
            const entries = Array.from(cache.entries())
            const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
            const toDelete = sorted.slice(0, 25) // Remove oldest 25
            toDelete.forEach(([key]) => cache.delete(key))
        }

        return result.data.posts
    } catch (error) {
        console.error('Error fetching posts in viewport:', error)
        throw error
    }
}

/**
 * Get posts within a circular radius
 */
export async function getPostsInRadius(
    area: CircleArea
): Promise<PostLocation[]> {
    try {
        const getPostsInArea = httpsCallable<
            CircleArea,
            { posts: PostLocation[]; count: number }
        >(functions, 'getPostsInArea')

        const result = await getPostsInArea(area)
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
export async function getPostLocations(postIds: string[]): Promise<PostLocation[]> {
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
