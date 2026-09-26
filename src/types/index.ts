/**
 * Shared Type Definitions
 *
 * Central location for TypeScript interfaces used across the app.
 * Import from '@/types' instead of defining locally.
 */

/**
 * Post - Core content type representing a photo post
 *
 * Posts can be either:
 * - Original posts (isOriginal=true, rootPostId=null)
 * - Catch posts (isOriginal=false, rootPostId=<original_post_id>)
 */
export interface Post {
    id: string
    authorId: string
    authorUsername: string
    photoURL: string
    title?: string
    caption: string
    hasLocation: boolean
    catchCount: number
    parentPostId: string | null
    rootPostId: string | null
    isOriginal: boolean
    createdAt: any // Firestore Timestamp or Date — submit time
    capturedAt?: any // Firestore Timestamp or Date — shutter time (absent on pre-Sept-2026 posts)
    // Optional location fields (only present in some contexts like MapScreen)
    latitude?: number
    longitude?: number
    thumbnailURL?: string
    mediumURL?: string
    isPioneer?: boolean
    lastCaughtAt?: any // Firestore Timestamp — set when post is caught, used for lost-place classification
    hotScore?: number // server-computed place rank (root posts only) — sort key for Trending/pins/For You
    // Denormalized place identity, written server-side by onPostCreated after
    // geocoding (catches inherit the root's). Display-safe: coordinates stay
    // server-only. Absent until enrichment runs or when geocoding failed.
    city?: string
    country?: string
}

/**
 * PostSummary - Lightweight post data returned alongside location data
 * from getPostsInArea when includeSummary is true.
 * Contains enough data for map pins + CompactPostCard rendering.
 */
export interface PostSummary {
    id: string
    authorId: string
    authorUsername: string
    caption: string
    photoURL: string
    thumbnailURL?: string
    catchCount: number
    createdAt: number // epoch millis (converted server-side)
    isOriginal: boolean
    isPioneer?: boolean
    lastCaughtAt?: number // epoch millis
    hotScore: number // 0 until backfillHotScores has run
}

/**
 * RecommendedPost - Post with recommendation metadata
 *
 * Returned by the getRecommendedFeed Cloud Function.
 * Extends Post with a reason label explaining why this post was recommended.
 */
export interface RecommendedPost extends Post {
    reasonLabel: string // "Posted by @jane", "Near you", "Popular in Tokyo"
    reasonType: 'social' | 'nearby' | 'saved_city'
}

/**
 * List - Collection of posts curated by a user
 *
 * Lists can be:
 * - Private (isPublic=false) - only creator can see
 * - Public (isPublic=true) - visible to all users
 *
 * (One-tap bookmarks are NOT lists — they live in users/{uid}/saves;
 * legacy "Saved" lists are migrated by the migrateLegacySavedLists
 * admin callable.)
 */
/**
 * SearchPost - Post data returned by the searchPosts Cloud Function
 *
 * Includes location metadata (city, country) and visual metadata (tags, scene)
 * from the vector search index. Uses `postId` (not `id`) matching the response.
 */
export interface SearchPost {
    postId: string
    authorId: string
    authorUsername: string
    caption: string
    photoURL: string
    thumbnailURL: string | null
    mediumURL: string | null
    catchCount: number
    isPioneer: boolean
    isOriginal: boolean
    createdAt: any
    city: string | null
    country: string | null
    tags: string[]
    scene: string | null
    distanceKm: number | null
    latitude: number
    longitude: number
    vectorDistance: number
}

export { Notification } from './Notification'

export interface List {
    id: string
    name: string
    description?: string
    creatorId: string
    creatorUsername?: string
    postIds: string[]
    isPublic: boolean
    createdAt: any // Firestore Timestamp or Date
    updatedAt: any // Firestore Timestamp or Date
    thumbnails?: string[] // Cached thumbnail URLs for preview
}
