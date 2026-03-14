import { Post } from '@/types'
import { CONTRIBUTION } from './contributionConfig'

export type BountyStatus = 'bounty' | 'trending' | 'normal'

/**
 * Determines the bounty status of a post for map pin coloring and catch multipliers.
 *
 * - Bounty (Gold): 0 catches OR last caught >30 days ago — 3x catch pts
 * - Trending (Silver): catchCount >= threshold AND not bounty — 1.5x catch pts
 * - Normal: everything else — 1x catch pts
 */
export function getPostBountyStatus(post: Post): BountyStatus {
    const catchCount = post.catchCount ?? 0

    // Bounty: never caught or inactive for too long
    if (catchCount === 0) return 'bounty'

    if (post.lastCaughtAt) {
        const lastCaughtMs =
            post.lastCaughtAt?.toMillis?.() ??
            (post.lastCaughtAt instanceof Date
                ? post.lastCaughtAt.getTime()
                : 0)
        if (lastCaughtMs > 0) {
            const inactivityMs =
                CONTRIBUTION.BOUNTY_INACTIVITY_DAYS * 24 * 60 * 60 * 1000
            if (Date.now() - lastCaughtMs > inactivityMs) return 'bounty'
        }
    }

    // Trending: popular posts with enough catches
    if (catchCount >= CONTRIBUTION.TRENDING_THRESHOLD) return 'trending'

    return 'normal'
}
