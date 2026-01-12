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
 */
export function calculateDistance(
    point1: { lat: number; lng: number },
    point2: { lat: number; lng: number }
): number {
    return distanceBetween([point1.lat, point1.lng], [point2.lat, point2.lng])
}

/**
 * Helper: Get map bounds from Mapbox map instance
 */
export async function getMapBounds(map: any): Promise<MapBounds> {
    const bounds = await map.getVisibleBounds()
    return {
        north: bounds[1][1], // northeast latitude
        south: bounds[0][1], // southwest latitude
        east: bounds[1][0],  // northeast longitude
        west: bounds[0][0],  // southwest longitude
    }
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

/**
 * Clear the cache (useful for debugging or forcing refresh)
 */
export function clearCache() {
    cache.clear()
}
