/**
 * Catch recency — presents catching as an EVENT in a line of text, never a
 * tally (batch 5 minimal cut: this line is what replaced the CatchBadge
 * count chips). Zero-schema: derives entirely from catchCount +
 * lastCaughtAt, which already exist on every root post doc.
 *
 * Three states, matching the lost-place threshold so the vocabulary is
 * consistent with LostPlaceWhisper:
 * - fresh catch (≤ LOST_PLACE_INACTIVITY_DAYS): "caught yesterday" — the
 *   live state, marked with the caught ink
 * - stale ("lost place"): "last caught in June" — a gap in the record,
 *   stated as a fact, no penalty framing
 * - never: "not yet caught" — the standing invitation
 */

import { Post } from '@/types'
import { LOST_PLACE_INACTIVITY_DAYS } from '@/utils/postClassification'

export interface CatchRecency {
    text: string
    /** True only for a fresh catch — drives the caught-ink dot */
    caught: boolean
    /**
     * fresh = within the lost-place threshold · stale = past it ·
     * legacy = caught but no timestamp · never = no catch yet
     */
    state: 'fresh' | 'stale' | 'legacy' | 'never'
}

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

function toMillis(value: any): number {
    if (!value) return 0
    if (typeof value.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'number') return value
    return 0
}

/**
 * Returns the recency line for a ROOT post, or null when the post carries
 * no line (catches themselves don't — the thread's story belongs to the
 * root).
 */
export function getCatchRecency(
    post: Pick<Post, 'isOriginal' | 'catchCount' | 'lastCaughtAt'>,
    now: number = Date.now()
): CatchRecency | null {
    if (!post.isOriginal) return null

    const catchCount = post.catchCount ?? 0
    const lastCaughtMs = toMillis(post.lastCaughtAt)

    if (catchCount === 0) {
        return { text: 'not yet caught', caught: false, state: 'never' }
    }

    // Caught, but no timestamp (docs/payloads predating lastCaughtAt) —
    // state the fact without claiming freshness
    if (lastCaughtMs === 0) {
        return { text: 'caught before', caught: false, state: 'legacy' }
    }

    const dayMs = 24 * 60 * 60 * 1000
    const days = Math.floor((now - lastCaughtMs) / dayMs)

    if (days > LOST_PLACE_INACTIVITY_DAYS) {
        const then = new Date(lastCaughtMs)
        const sameYear = then.getFullYear() === new Date(now).getFullYear()
        const month = MONTHS[then.getMonth()]
        return {
            text: sameYear
                ? `last caught in ${month}`
                : `last caught in ${month} ${then.getFullYear()}`,
            caught: false,
            state: 'stale',
        }
    }

    if (days <= 0) return { text: 'caught today', caught: true, state: 'fresh' }
    if (days === 1)
        return { text: 'caught yesterday', caught: true, state: 'fresh' }
    if (days < 7)
        return { text: `caught ${days} days ago`, caught: true, state: 'fresh' }
    const weeks = Math.floor(days / 7)
    return {
        text: weeks === 1 ? 'caught last week' : `caught ${weeks} weeks ago`,
        caught: true,
        state: 'fresh',
    }
}
