/**
 * Date Formatting Utilities
 *
 * Shared date formatting functions used across the app.
 */

/**
 * Formats a Firestore timestamp or Date for display on posts
 * @param timestamp - Firestore Timestamp or Date object
 * @returns Formatted date string (e.g., "Jan 24, 2026")
 */
export function formatPostDate(timestamp: any): string {
    if (!timestamp) return ''

    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

