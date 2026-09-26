import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { requireAdmin } from '../lib/adminAuth'
import { MAX_INSTANCES } from '../lib/constants'
import { computeHotScore, lastActivityMs } from '../lib/hotScore'

/**
 * Admin-only: writes hotScore onto every root post from its catchCount and
 * last activity (lastCaughtAt, else creation). Triggers keep it current after
 * that; run once after deploy, and again any time the formula or
 * HOT_SCORE_PERIOD_SECONDS changes. Safe to re-run — values are derived.
 *
 * @param data.dryRun - If true, count what would change without writing
 *   (default false)
 */
export const backfillHotScores = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '512MB',
        maxInstances: MAX_INSTANCES.ADMIN,
    })
    .https.onCall(async (data, context) => {
        requireAdmin(context)

        const dryRun = data?.dryRun === true
        const db = admin.firestore()
        const PAGE_SIZE = 500

        let scanned = 0
        let updated = 0
        let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null
        while (true) {
            let q: admin.firestore.Query = db
                .collection('posts')
                .where('isOriginal', '==', true)
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(PAGE_SIZE)
            if (lastDoc) q = q.startAfter(lastDoc)

            const snapshot = await q.get()
            if (snapshot.empty) break

            const batch = db.batch()
            for (const doc of snapshot.docs) {
                const hotScore = computeHotScore(
                    doc.get('catchCount') ?? 0,
                    lastActivityMs(doc)
                )
                if (doc.get('hotScore') !== hotScore) {
                    if (!dryRun) batch.update(doc.ref, { hotScore })
                    updated++
                }
            }
            if (!dryRun) await batch.commit()

            scanned += snapshot.docs.length
            lastDoc = snapshot.docs[snapshot.docs.length - 1]
            if (snapshot.docs.length < PAGE_SIZE) break
        }

        functions.logger.info(
            `[backfillHotScores] dryRun=${dryRun}: ${scanned} roots scanned, ${updated} updated`
        )
        return { dryRun, scanned, updated }
    })
