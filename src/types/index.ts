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
    createdAt: any // Firestore Timestamp or Date
    // Optional location fields (only present in some contexts like MapScreen)
    latitude?: number
    longitude?: number
    thumbnailURL?: string
    mediumURL?: string
    isPioneer?: boolean
    contributionEarned?: number
    lastCaughtAt?: any // Firestore Timestamp — set when post is caught, used for bounty classification
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
    createdAt: number    // epoch millis (converted server-side)
    isOriginal: boolean
    isPioneer?: boolean
    lastCaughtAt?: number // epoch millis
}

/**
 * RecommendedPost - Post with recommendation metadata
 *
 * Returned by the getRecommendedFeed Cloud Function.
 * Extends Post with a reason label explaining why this post was recommended.
 */
export interface RecommendedPost extends Post {
    reasonLabel: string       // "Posted by @jane", "Trending in Tokyo"
    reasonType: 'social' | 'city_trending'
    score: number
}

/**
 * List - Collection of posts curated by a user
 *
 * Lists can be:
 * - Private (isPublic=false) - only creator can see
 * - Public (isPublic=true) - visible to all users
 * - Special "Saved" list (isSavedList=true) - auto-created default list
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

export interface List {
    id: string
    name: string
    description?: string
    creatorId: string
    creatorUsername?: string
    postIds: string[]
    isPublic: boolean
    isSavedList?: boolean // Special flag for the default "My List"
    createdAt: any // Firestore Timestamp or Date
    updatedAt: any // Firestore Timestamp or Date
    thumbnails?: string[] // Cached thumbnail URLs for preview
}
