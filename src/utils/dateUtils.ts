/**
 * Date Formatting Utilities
 *
 * Shared date formatting functions used across the app.
 */

/** Normalizes the three timestamp shapes the app sees into a Date (or null) */
function toDate(timestamp: any): Date | null {
    if (!timestamp) return null

    let date: Date
    if (timestamp.toDate) {
        // Native Firestore Timestamp (from direct Firestore reads)
        date = timestamp.toDate()
    } else if (timestamp._seconds !== undefined) {
        // Serialized Firestore Timestamp (from httpsCallable responses)
        date = new Date(timestamp._seconds * 1000)
    } else {
        date = new Date(timestamp)
    }

    return isNaN(date.getTime()) ? null : date
}

/**
 * Formats a Firestore timestamp or Date for display on posts.
 *
 * Recent dates read relatively ("2m ago", "3h ago", "5d ago") — an absolute
 * "Sep 2, 2026" on a post from two minutes ago reads as stale. Older than a
 * week falls back to the absolute date, which is what a place's long-term
 * timeline wants.
 */
export function formatPostDate(timestamp: any): string {
    const date = toDate(timestamp)
    if (!date) return ''

    const diffMs = Date.now() - date.getTime()
    if (diffMs >= 0 && diffMs < 7 * 24 * 3600000) {
        if (diffMs < 60000) return 'Just now'
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`
        if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`
        return `${Math.floor(diffMs / 86400000)}d ago`
    }

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}
