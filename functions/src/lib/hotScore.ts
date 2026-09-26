import * as admin from 'firebase-admin'
import { HOT_SCORE_PERIOD_SECONDS } from './constants'

/**
 * Place ranking score for root posts (Reddit "hot" form):
 *   log10(1 + catchCount) + lastActivitySeconds / HOT_SCORE_PERIOD_SECONDS
 *
 * Time sits in the score itself, so it never goes stale — no batch job
 * re-decays it. Written by onPostCreated/onPostDeleted whenever catchCount
 * or activity changes, and by backfillHotScores. Sorts map pins (when a
 * viewport exceeds the cap), the Trending shelf, and the For You feed.
 */
export function computeHotScore(
    catchCount: number,
    lastActivityMs: number
): number {
    return (
        Math.log10(1 + Math.max(0, catchCount)) +
        lastActivityMs / 1000 / HOT_SCORE_PERIOD_SECONDS
    )
}

/**
 * Last activity of a root post: its most recent catch, else its creation.
 * Uses the document's server createTime — the client-supplied createdAt
 * field is not trusted for ranking.
 */
export function lastActivityMs(rootDoc: admin.firestore.DocumentSnapshot): number {
    const createdMs = rootDoc.createTime!.toMillis()
    const caughtMs = rootDoc.get('lastCaughtAt')?.toMillis?.() ?? 0
    return Math.max(createdMs, caughtMs)
}
