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

    if (isNaN(date.getTime())) return ''

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}
