import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { requireAdmin } from '../lib/adminAuth'
import { MAX_INSTANCES } from '../lib/constants'

/**
 * One-time admin function to backfill the denormalized city/country fields
 * onto post docs from post_locations.locationMeta.
 *
 * Originals take their own geocoded city; catches inherit the root's
 * (catches aren't geocoded themselves — they happen within the catch radius
 * of the root). Posts whose city is unknown (enrichment never ran, or root
 * deleted) are skipped and counted. Safe to re-run: writes are idempotent
 * overwrites of the same values.
 */
export const backfillPostCities = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '512MB',
        maxInstances: MAX_INSTANCES.ADMIN,
    })
    .https.onCall(async (_data, context) => {
        requireAdmin(context)

        const db = admin.firestore()
        const BATCH_SIZE = 500

        // --- Pass 1: city/country by postId from post_locations ---
        const cityByPostId = new Map<
            string,
            { city: string | null; country: string | null }
        >()

        let lastLocDoc: admin.firestore.QueryDocumentSnapshot | null = null
        while (true) {
            let q: admin.firestore.Query = db
                .collection('post_locations')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(BATCH_SIZE)
            if (lastLocDoc) q = q.startAfter(lastLocDoc)

            const snapshot = await q.get()
            if (snapshot.empty) break

            for (const doc of snapshot.docs) {
                const data = doc.data()
                if (data.postId && data.locationMeta) {
                    cityByPostId.set(data.postId, {
                        city: data.locationMeta.city ?? null,
                        country: data.locationMeta.country ?? null,
                    })
                }
            }
            lastLocDoc = snapshot.docs[snapshot.docs.length - 1]
        }

        // --- Pass 2: write city/country onto post docs ---
        let updated = 0
        let skipped = 0
        let errors = 0

        let lastPostDoc: admin.firestore.QueryDocumentSnapshot | null = null
        while (true) {
            let q: admin.firestore.Query = db
                .collection('posts')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(BATCH_SIZE)
            if (lastPostDoc) q = q.startAfter(lastPostDoc)

            const snapshot = await q.get()
            if (snapshot.empty) break

            const batch = db.batch()
            let batchWrites = 0

            for (const doc of snapshot.docs) {
                const data = doc.data()
                const citySourceId =
                    data.isOriginal === true ? doc.id : data.rootPostId
                const info = citySourceId
                    ? cityByPostId.get(citySourceId)
                    : undefined

                const placeUpdate: Record<string, string> = {}
                if (info?.city) placeUpdate.city = info.city
                if (info?.country) placeUpdate.country = info.country

                if (Object.keys(placeUpdate).length === 0) {
                    skipped++
                    continue
                }

                batch.update(doc.ref, placeUpdate)
                batchWrites++
            }

            if (batchWrites > 0) {
                try {
                    await batch.commit()
                    updated += batchWrites
                } catch (e) {
                    errors++
                    functions.logger.error(
                        '[backfillPostCities] Batch commit failed:',
                        e
                    )
                }
            }

            lastPostDoc = snapshot.docs[snapshot.docs.length - 1]
            functions.logger.info(
                `[backfillPostCities] Progress: ${updated} updated, ${skipped} skipped`
            )
        }

        const summary = { updated, skipped, errors }
        functions.logger.info('[backfillPostCities] Complete:', summary)
        return summary
    })
