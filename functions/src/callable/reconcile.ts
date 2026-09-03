import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { requireAdmin } from '../lib/adminAuth'
import { MAX_INSTANCES } from '../lib/constants'

/**
 * Admin-only: Reconciles user counters against the canonical source of
 * truth — surviving posts.
 *
 * By design, a user's counters are fully derivable from their posts:
 *   totalPosts    = count of original posts
 *   totalCatches  = count of catch posts
 *
 * Any drift (from historical trigger bugs or partial failures) is detected
 * and — unless dryRun — corrected by writing the recomputed absolute values.
 *
 * @param data.dryRun - If true (default), report discrepancies without fixing
 * @returns Summary with per-user discrepancies (capped at 200 entries)
 *
 * Caveat: values are recomputed from a live scan, so run during quiet periods
 * — a post created or deleted mid-scan can register as a false discrepancy or
 * clobber a concurrent trigger update.
 */
export const reconcileCounters = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '512MB',
        maxInstances: MAX_INSTANCES.ADMIN,
    })
    .https.onCall(async (data, context) => {
        requireAdmin(context)

        const dryRun = data?.dryRun !== false // default true
        const db = admin.firestore()
        const PAGE_SIZE = 500

        // --- Phase 1: aggregate expected counters from all posts ---
        const expected = new Map<
            string,
            { totalPosts: number; totalCatches: number }
        >()

        let postsScanned = 0
        let lastPostDoc: admin.firestore.QueryDocumentSnapshot | null = null
        while (true) {
            let q: admin.firestore.Query = db
                .collection('posts')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(PAGE_SIZE)
            if (lastPostDoc) q = q.startAfter(lastPostDoc)

            const snapshot = await q.get()
            if (snapshot.empty) break

            for (const postDoc of snapshot.docs) {
                const post = postDoc.data()
                const authorId = post.authorId
                if (!authorId) continue

                const entry = expected.get(authorId) ?? {
                    totalPosts: 0,
                    totalCatches: 0,
                }
                if (post.isOriginal) {
                    entry.totalPosts += 1
                } else if (post.parentPostId) {
                    entry.totalCatches += 1
                }
                expected.set(authorId, entry)
            }

            postsScanned += snapshot.docs.length
            lastPostDoc = snapshot.docs[snapshot.docs.length - 1]
            if (snapshot.docs.length < PAGE_SIZE) break
        }

        functions.logger.info(
            `[reconcileCounters] Scanned ${postsScanned} posts covering ${expected.size} authors`
        )

        // --- Phase 2: compare every user against expected, fix drift ---
        const discrepancies: {
            userId: string
            field: string
            actual: number
            expected: number
        }[] = []
        let usersChecked = 0
        let usersFixed = 0

        let lastUserDoc: admin.firestore.QueryDocumentSnapshot | null = null
        while (true) {
            let q: admin.firestore.Query = db
                .collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(PAGE_SIZE)
            if (lastUserDoc) q = q.startAfter(lastUserDoc)

            const snapshot = await q.get()
            if (snapshot.empty) break

            const batch = db.batch()
            let batchHasWrites = false

            for (const userDoc of snapshot.docs) {
                usersChecked++
                const userData = userDoc.data()
                const exp = expected.get(userDoc.id) ?? {
                    totalPosts: 0,
                    totalCatches: 0,
                }

                const fields: ['totalPosts' | 'totalCatches', number][] = [
                    ['totalPosts', userData.totalPosts || 0],
                    ['totalCatches', userData.totalCatches || 0],
                ]

                const update: Record<string, number> = {}
                for (const [field, actual] of fields) {
                    if (actual !== exp[field]) {
                        if (discrepancies.length < 200) {
                            discrepancies.push({
                                userId: userDoc.id,
                                field,
                                actual,
                                expected: exp[field],
                            })
                        }
                        update[field] = exp[field]
                    }
                }

                if (Object.keys(update).length > 0) {
                    if (!dryRun) {
                        batch.update(userDoc.ref, update)
                        batchHasWrites = true
                    }
                    usersFixed++
                }
            }

            if (batchHasWrites) {
                await batch.commit()
            }

            lastUserDoc = snapshot.docs[snapshot.docs.length - 1]
            if (snapshot.docs.length < PAGE_SIZE) break
        }

        functions.logger.info(
            `[reconcileCounters] dryRun=${dryRun}: ${usersChecked} users checked, ${usersFixed} with drift, ${discrepancies.length} discrepancies reported`
        )

        return {
            dryRun,
            postsScanned,
            usersChecked,
            usersWithDrift: usersFixed,
            discrepancies,
        }
    })
