import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { requireAdmin } from '../lib/adminAuth'
import { MAX_INSTANCES } from '../lib/constants'
import { passportCityKey } from '../lib/coverage'

/**
 * One-time admin function to backfill geohash_cells and user_coverage
 * (cells + passport cities) from existing post_locations data.
 *
 * Run once after deploying the coverage feature to populate historical data.
 * Uses FieldValue.increment() and arrayUnion() so it's safe to re-run,
 * but will over-count if run multiple times without clearing geohash_cells first.
 */
export const backfillCoverage = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '512MB',
        maxInstances: MAX_INSTANCES.ADMIN,
    })
    .https.onCall(async (_data, context) => {
        requireAdmin(context)

        const db = admin.firestore()
        const BATCH_SIZE = 500

        // --- Phase 1: Delete all existing geohash_cells and user_coverage ---
        functions.logger.info(
            '[backfillCoverage] Phase 1: Clearing old coverage data'
        )

        const collectionsToDelete = ['geohash_cells', 'user_coverage']
        for (const collName of collectionsToDelete) {
            let deletedCount = 0
            while (true) {
                const snapshot = await db
                    .collection(collName)
                    .limit(BATCH_SIZE)
                    .get()
                if (snapshot.empty) break
                const batch = db.batch()
                snapshot.docs.forEach((d) => batch.delete(d.ref))
                await batch.commit()
                deletedCount += snapshot.docs.length
            }
            functions.logger.info(
                `[backfillCoverage] Deleted ${deletedCount} docs from ${collName}`
            )
        }

        // --- Phase 2: Rebuild with precision 5 and 6 ---
        functions.logger.info(
            '[backfillCoverage] Phase 2: Rebuilding coverage at precision 5+6'
        )

        let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null
        let totalProcessed = 0
        let totalErrors = 0

        // Accumulated across all batches for the passport-cities rebuild in
        // Phase 3. Entries are tiny (a few strings per post), so holding the
        // full set in memory is fine at current scale.
        const postMeta = new Map<
            string,
            {
                authorId: string
                isOriginal: boolean
                isPioneer: boolean
                rootPostId: string | null
            }
        >()
        const cityByPostId = new Map<
            string,
            { country: string; city: string }
        >()

        while (true) {
            let q: admin.firestore.Query = db
                .collection('post_locations')
                .orderBy('geohash')
                .limit(BATCH_SIZE)

            if (lastDoc) {
                q = q.startAfter(lastDoc)
            }

            const snapshot = await q.get()
            if (snapshot.empty) break

            // Fetch associated post docs to get authorId
            const postIds = snapshot.docs
                .map((d) => d.data().postId)
                .filter(Boolean)
            const authorMap = new Map<string, string>()

            // Batch getAll in chunks of 100
            for (let i = 0; i < postIds.length; i += 100) {
                const chunk = postIds.slice(i, i + 100)
                const postRefs = chunk.map((id) =>
                    db.collection('posts').doc(id)
                )
                const postSnaps = await db.getAll(...postRefs)
                postSnaps.forEach((snap) => {
                    if (snap.exists) {
                        const data = snap.data()!
                        authorMap.set(snap.id, data.authorId)
                        postMeta.set(snap.id, {
                            authorId: data.authorId,
                            isOriginal: data.isOriginal === true,
                            isPioneer: data.isPioneer === true,
                            rootPostId: data.rootPostId ?? null,
                        })
                    }
                })
            }

            // Accumulate counts in memory before writing
            const cellCounts = new Map<
                string,
                { geohash: string; precision: number; count: number }
            >()
            const userCells = new Map<
                string,
                { cells5: Set<string>; cells6: Set<string> }
            >()

            for (const doc of snapshot.docs) {
                const data = doc.data()
                const geohash = data.geohash
                const postId = data.postId
                const authorId = authorMap.get(postId)

                if (
                    postId &&
                    data.locationMeta?.country &&
                    data.locationMeta?.city
                ) {
                    cityByPostId.set(postId, {
                        country: data.locationMeta.country,
                        city: data.locationMeta.city,
                    })
                }

                if (!geohash || !authorId) continue

                const gh5 = geohash.substring(0, 5)
                const gh6 = geohash.substring(0, 6)

                const key5 = `p5_${gh5}`
                const key6 = `p6_${gh6}`

                if (!cellCounts.has(key5))
                    cellCounts.set(key5, {
                        geohash: gh5,
                        precision: 5,
                        count: 0,
                    })
                cellCounts.get(key5)!.count++

                if (!cellCounts.has(key6))
                    cellCounts.set(key6, {
                        geohash: gh6,
                        precision: 6,
                        count: 0,
                    })
                cellCounts.get(key6)!.count++

                if (!userCells.has(authorId)) {
                    userCells.set(authorId, {
                        cells5: new Set(),
                        cells6: new Set(),
                    })
                }
                userCells.get(authorId)!.cells5.add(gh5)
                userCells.get(authorId)!.cells6.add(gh6)
            }

            // Write cell counts in batches of 500
            try {
                const cellEntries = Array.from(cellCounts.entries())
                for (let i = 0; i < cellEntries.length; i += 500) {
                    const batch = db.batch()
                    const chunk = cellEntries.slice(i, i + 500)
                    for (const [docId, cell] of chunk) {
                        batch.set(
                            db.collection('geohash_cells').doc(docId),
                            {
                                geohash: cell.geohash,
                                precision: cell.precision,
                                postCount: admin.firestore.FieldValue.increment(
                                    cell.count
                                ),
                                lastUpdated:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            { merge: true }
                        )
                    }
                    await batch.commit()
                }

                // Write user coverage
                for (const [userId, cells] of userCells) {
                    await db
                        .collection('user_coverage')
                        .doc(userId)
                        .set(
                            {
                                cells5: admin.firestore.FieldValue.arrayUnion(
                                    ...Array.from(cells.cells5)
                                ),
                                cells6: admin.firestore.FieldValue.arrayUnion(
                                    ...Array.from(cells.cells6)
                                ),
                                lastUpdated:
                                    admin.firestore.FieldValue.serverTimestamp(),
                            },
                            { merge: true }
                        )
                }

                totalProcessed += snapshot.docs.length
            } catch (e) {
                totalErrors++
                functions.logger.error(`[backfillCoverage] Batch error:`, e)
            }

            lastDoc = snapshot.docs[snapshot.docs.length - 1]
            functions.logger.info(
                `[backfillCoverage] Processed ${totalProcessed} locations`
            )
        }

        // --- Phase 3: Rebuild passport cities on user_coverage ---
        // Originals stamp their own city; catches inherit the root's city
        // (catches aren't geocoded — they happen within the catch radius of
        // the root). Posts whose city is unknown (enrichment never ran, or
        // root deleted) are skipped and logged.
        functions.logger.info(
            '[backfillCoverage] Phase 3: Rebuilding passport cities'
        )

        type CityStats = {
            country: string
            city: string
            posted: number
            caught: number
            pioneers: number
        }
        const userCities = new Map<string, Map<string, CityStats>>()
        let cityUnknown = 0

        for (const [postId, meta] of postMeta) {
            const citySourceId = meta.isOriginal ? postId : meta.rootPostId
            const cityInfo = citySourceId
                ? cityByPostId.get(citySourceId)
                : undefined
            if (!cityInfo) {
                cityUnknown++
                continue
            }

            const key = passportCityKey(cityInfo.country, cityInfo.city)
            if (!userCities.has(meta.authorId)) {
                userCities.set(meta.authorId, new Map())
            }
            const cities = userCities.get(meta.authorId)!
            if (!cities.has(key)) {
                cities.set(key, {
                    country: cityInfo.country,
                    city: cityInfo.city,
                    posted: 0,
                    caught: 0,
                    pioneers: 0,
                })
            }
            const stats = cities.get(key)!
            if (meta.isOriginal) {
                stats.posted++
                if (meta.isPioneer) stats.pioneers++
            } else {
                stats.caught++
            }
        }

        let cityUsersWritten = 0
        for (const [userId, cities] of userCities) {
            try {
                const citiesField: Record<string, unknown> = {}
                for (const [key, stats] of cities) {
                    citiesField[key] = {
                        ...stats,
                        lastActivity:
                            admin.firestore.FieldValue.serverTimestamp(),
                    }
                }
                await db
                    .collection('user_coverage')
                    .doc(userId)
                    .set({ cities: citiesField }, { merge: true })
                cityUsersWritten++
            } catch (e) {
                totalErrors++
                functions.logger.error(
                    `[backfillCoverage] Passport cities write failed for user ${userId}:`,
                    e
                )
            }
        }

        const summary = {
            totalProcessed,
            totalErrors,
            cityUsersWritten,
            cityUnknown,
        }
        functions.logger.info(`[backfillCoverage] Complete:`, summary)
        return summary
    })
