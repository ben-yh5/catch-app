/**
 * Utility functions for generating thumbnail URLs from Firebase Storage URLs
 */

/**
 * Generates a thumbnail URL by appending size parameters
 * For Firebase Storage, we can't dynamically resize, but we can optimize loading
 * by using expo-image's built-in caching and resizing capabilities.
 *
 * In the future, this could be extended to:
 * - Use Firebase Storage image transformation (if enabled)
 * - Use a CDN with image transformation
 * - Generate actual thumbnail files during upload
 */
export function getThumbnailUrl(fullUrl: string, size: number = 400): string {
    // For now, return the full URL and let expo-image handle the resizing
    // expo-image with cachePolicy="memory-disk" will cache the resized version
    return fullUrl
}

/**
 * Configuration for thumbnail sizes in different contexts
 */
export const THUMBNAIL_SIZES = {
    GRID: 400,      // Grid view thumbnails (profile, saved)
    FEED: 600,      // Feed thumbnails (slightly larger)
    FULL: 1080,     // Full resolution
} as const
