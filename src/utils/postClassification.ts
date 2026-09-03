import { Post } from '@/types'

/** Days since last catch before a post counts as a "lost place" */
export const LOST_PLACE_INACTIVITY_DAYS = 30

/**
 * A "lost place" (gold pin) is a spot whose photographic record has a gap
 * worth filling: never caught, or last caught more than
 * LOST_PLACE_INACTIVITY_DAYS ago.
 */
export function isLostPlace(post: Post): boolean {
    const catchCount = post.catchCount ?? 0

    if (catchCount === 0) return true

    if (post.lastCaughtAt) {
        const lastCaughtMs =
            post.lastCaughtAt?.toMillis?.() ??
            (post.lastCaughtAt instanceof Date
                ? post.lastCaughtAt.getTime()
                : 0)
        if (lastCaughtMs > 0) {
            const inactivityMs =
                LOST_PLACE_INACTIVITY_DAYS * 24 * 60 * 60 * 1000
            if (Date.now() - lastCaughtMs > inactivityMs) return true
        }
    }

    return false
}
