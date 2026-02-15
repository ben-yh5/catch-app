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
 * List - Collection of posts curated by a user
 *
 * Lists can be:
 * - Private (isPublic=false) - only creator can see
 * - Public (isPublic=true) - visible to all users
 * - Special "Saved" list (isSavedList=true) - auto-created default list
 */
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
