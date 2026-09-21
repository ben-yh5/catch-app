import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { requireAdmin } from '../lib/adminAuth'
import { MAX_INSTANCES } from '../lib/constants'

/**
 * Admin-only, one-time: migrate legacy "saved" lists (from before the
 * saves/lists split) into `users/{uid}/saves/*` — LISTS_REDESIGN.md §E.
 *
 * A legacy list is one with `isSavedList == true` or named 'Saved' /
 * 'My List'. Each of its postIds becomes a save doc with
 * `savedAt = list.updatedAt` (falling back to createdAt, then now);
 * save docs that already exist are left untouched, so re-running never
 * clobbers newer saves or their list tags. The legacy list doc is then
 * deleted. User-created lists are untouched.
 *
 * @param data.dryRun - If true (the default), report what would happen
 *   without writing. Pass { dryRun: false } to execute.
 */
export const migrateLegacySavedLists = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '512MB',
        maxInstances: MAX_INSTANCES.ADMIN,
    })
    .https.onCall(async (data, context) => {
        requireAdmin(context)

        const dryRun = data?.dryRun !== false // default true: report only
        const db = admin.firestore()
        const LEGACY_NAMES = new Set(['saved', 'my list'])

        const listsSnap = await db.collection('lists').get()

        let legacyLists = 0
        let savesCreated = 0
        let savesSkipped = 0
        let listsDeleted = 0
        const skippedNoCreator: string[] = []
        const details: {
            listId: string
            creatorId: string
            name: string
            postCount: number
        }[] = []

        for (const listDoc of listsSnap.docs) {
            const list = listDoc.data()
            const isLegacy =
                list.isSavedList === true ||
                LEGACY_NAMES.has(String(list.name ?? '').toLowerCase())
            if (!isLegacy) continue
            legacyLists++

            const creatorId = list.creatorId
            if (!creatorId || typeof creatorId !== 'string') {
                // Data-critical anomaly: surface it, never guess an owner
                functions.logger.warn(
                    `[legacySavedLists] list ${listDoc.id} has no creatorId — skipped`
                )
                skippedNoCreator.push(listDoc.id)
                continue
            }

            const postIds: string[] = Array.isArray(list.postIds)
                ? list.postIds.filter((id: unknown) => typeof id === 'string')
                : []
            const savedAt =
                list.updatedAt ??
                list.createdAt ??
                admin.firestore.Timestamp.now()

            const savesColl = db
                .collection('users')
                .doc(creatorId)
                .collection('saves')

            // Existence checks in getAll chunks of 100
            const missing: string[] = []
            for (let i = 0; i < postIds.length; i += 100) {
                const refs = postIds
                    .slice(i, i + 100)
                    .map((postId) => savesColl.doc(postId))
                if (refs.length === 0) continue
                const snaps = await db.getAll(...refs)
                for (const snap of snaps) {
                    if (snap.exists) {
                        savesSkipped++
                    } else {
                        missing.push(snap.id)
                    }
                }
            }

            if (!dryRun) {
                // Save docs in batches; the list doc is deleted only after
                // every save write committed, so a partial failure leaves
                // the legacy list in place for a safe re-run
                for (let i = 0; i < missing.length; i += 400) {
                    const batch = db.batch()
                    for (const postId of missing.slice(i, i + 400)) {
                        batch.set(savesColl.doc(postId), {
                            postId,
                            savedAt,
                            listIds: [],
                        })
                    }
                    await batch.commit()
                }
                await listDoc.ref.delete()
                listsDeleted++
            }
            savesCreated += missing.length

            details.push({
                listId: listDoc.id,
                creatorId,
                name: String(list.name ?? ''),
                postCount: postIds.length,
            })
        }

        return {
            dryRun,
            listsScanned: listsSnap.size,
            legacyLists,
            savesCreated,
            savesSkipped,
            listsDeleted,
            skippedNoCreator,
            details,
        }
    })
