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

/**
 * Formats a timestamp for relative display (e.g., "2 hours ago")
 * @param timestamp - Firestore Timestamp or Date object
 * @returns Relative time string
 */
export function formatRelativeTime(timestamp: any): string {
    if (!timestamp) return ''

    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffSecs < 60) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return formatPostDate(timestamp)
}
