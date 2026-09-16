/**
 * Judge Metrics Service
 *
 * Fire-and-forget instrumentation for the on-device visual matcher ("the
 * Judge"): one doc per catch attempt recording the similarity score and
 * outcome, so the false-reject rate is measurable before the threshold is
 * tuned or the model retrained.
 *
 * Deliberately anonymous — no uid, no coordinates — so rows are operational
 * telemetry, not personal data (and need no deleteAccount cleanup). Reads are
 * server-only; the offline analysis lives in the catch-ml-training repo.
 */

import { db } from '@/services/firebase'
import { addDoc, collection } from 'firebase/firestore'

export type JudgeOutcome = 'pass' | 'reject' | 'unavailable'

export const logJudgeMetric = (
    rootPostId: string,
    outcome: JudgeOutcome,
    score: number | null,
    threshold: number
): void => {
    addDoc(collection(db, 'judge_metrics'), {
        rootPostId,
        outcome,
        score,
        threshold,
        createdAt: new Date().toISOString(),
    }).catch((error) => {
        // Telemetry must never block or fail a catch
        console.warn('[JudgeMetrics] Failed to log metric:', error)
    })
}
