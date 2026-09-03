import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { decrementCoverageCells } from '../lib/coverage'
import { MAX_INSTANCES } from '../lib/constants'

/**
 * Firestore Trigger: Handles post deletion events
 *
 * Deletion scenarios:
 * 1. Catch deleted: Decrements user's totalCatches and root post's catchCount
 * 2. Root with catches deleted: Promotes oldest catch to new root, updates all
 *    thread references
 * 3. Root without catches deleted: Simply cleans up location data
 *
 * Also removes the post from any lists containing it.
 *
 * Structure: counter writes run in a single transaction that also owns the
 * processed_events dedup marker — all-or-nothing, applied exactly once.
 * Cleanup steps (lists, thread promotion, location data, coverage) run
 * afterwards, each in its own try/catch, so one failure — e.g. the author's
 * user doc already being gone during account deletion — can't skip the
 * remaining cleanup.
 */
export const onPostDeleted = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .firestore.document('posts/{postId}')
    .onDelete(async (snap, context) => {
        const db = admin.firestore()

        const postData = snap.data()
        const postId = snap.id
        const authorId = postData.authorId

        if (!authorId) {
            functions.logger.warn('Deleted post had no authorId:', postId)
            return
        }

        const eventRef = db.collection('processed_events').doc(context.eventId)
        const userRef = db.collection('users').doc(authorId)
        const isCatch = Boolean(postData.parentPostId) && !postData.isOriginal
        const rootPostId = isCatch ? postData.rootPostId : null

        // Catches rejected by onPostCreated (no valid permit) never had their
        // counters incremented — skip the decrements or they'd drift negative.
        const wasRejected = Boolean(postData.rejectedNoPermit)

        // --- Counter writes: one transaction, exactly once ---
        let alreadyProcessed = false
        try {
            alreadyProcessed = await db.runTransaction(async (t) => {
                // All reads first, then writes
                const marker = await t.get(eventRef)
                if (marker.exists) return true

                const userDoc = await t.get(userRef)

                const rootRef = rootPostId
                    ? db.collection('posts').doc(rootPostId)
                    : null
                const rootDoc = rootRef ? await t.get(rootRef) : null

                // Author may already be gone (account deletion race) — skip
                // author writes but continue with everything else.
                if (userDoc.exists && !wasRejected) {
                    const authorUpdate: Record<string, any> = {}
                    if (isCatch) {
                        authorUpdate.totalCatches =
                            admin.firestore.FieldValue.increment(-1)
                    }
                    if (postData.isOriginal) {
                        authorUpdate.totalPosts =
                            admin.firestore.FieldValue.increment(-1)
                    }
                    if (Object.keys(authorUpdate).length > 0) {
                        t.update(userRef, authorUpdate)
                    }
                }

                if (isCatch && !wasRejected && rootDoc?.exists && rootRef) {
                    t.update(rootRef, {
                        catchCount: admin.firestore.FieldValue.increment(-1),
                    })
                }

                t.set(eventRef, {
                    processedAt: admin.firestore.FieldValue.serverTimestamp(),
                })
                return false
            })
        } catch (error) {
            functions.logger.error(
                `[onPostDeleted] Counter transaction failed for post ${postId}:`,
                error
            )
            // Fall through to cleanup — location/list cleanup is still better
            // done than skipped, and the marker wasn't set so a redelivery
            // can retry the counters.
        }

        if (alreadyProcessed) {
            functions.logger.info(
                `[onPostDeleted] Duplicate event ${context.eventId}, skipping`
            )
            return
        }

        // --- Cleanup: each step independent, failures don't cascade ---

        // Remove post from any lists that contain it
        try {
            const listsQuery = await db
                .collection('lists')
                .where('postIds', 'array-contains', postId)
                .get()

            if (!listsQuery.empty) {
                const batch = db.batch()
                listsQuery.docs.forEach((listDoc) => {
                    batch.update(listDoc.ref, {
                        postIds: admin.firestore.FieldValue.arrayRemove(postId),
                    })
                })
                await batch.commit()
                functions.logger.info(
                    `Removed post ${postId} from ${listsQuery.size} list(s)`
                )
            }
        } catch (error) {
            functions.logger.error(
                `[onPostDeleted] List cleanup failed for post ${postId}:`,
                error
            )
        }

        // Handle root post deletion - promote oldest catch to new root
        if (postData.isOriginal) {
            try {
                const catchesQuery = await db
                    .collection('posts')
                    .where('rootPostId', '==', postId)
                    .orderBy('createdAt', 'asc')
                    .get()

                if (!catchesQuery.empty) {
                    const newRootDoc = catchesQuery.docs[0]
                    const newRootId = newRootDoc.id

                    functions.logger.info(
                        `Promoting catch ${newRootId} to new root`
                    )

                    const batch = db.batch()

                    // Promote oldest catch to root. catchCount is derived
                    // from the surviving catches (the old root's counter may
                    // be missing or stale). isPioneer is inherited from the
                    // deleted root — it's a property of the location, not the
                    // author.
                    batch.update(newRootDoc.ref, {
                        isOriginal: true,
                        parentPostId: null,
                        rootPostId: null,
                        catchCount: catchesQuery.docs.length - 1,
                        isPioneer: postData.isPioneer ?? true,
                    })

                    // Update remaining catches to point to new root
                    for (let i = 1; i < catchesQuery.docs.length; i++) {
                        const catchDoc = catchesQuery.docs[i]
                        batch.update(catchDoc.ref, {
                            rootPostId: newRootId,
                            parentPostId: newRootId,
                        })
                    }

                    await batch.commit()
                    functions.logger.info(
                        `Thread promotion complete. New root: ${newRootId}`
                    )
                }
            } catch (error) {
                functions.logger.error(
                    `[onPostDeleted] Thread promotion failed for post ${postId}:`,
                    error
                )
            }
        }

        // Delete the post's location data + decrement coverage
        // (applies to catches, and to roots whether or not a promotion
        // happened — the promoted root keeps its own location doc)
        try {
            const locationQuery = await db
                .collection('post_locations')
                .where('postId', '==', postId)
                .limit(1)
                .get()

            if (!locationQuery.empty) {
                const geohash = locationQuery.docs[0].data().geohash
                await locationQuery.docs[0].ref.delete()
                if (geohash) {
                    await decrementCoverageCells(db, geohash)
                }
                functions.logger.info(
                    `Deleted location data for post ${postId}`
                )
            }
        } catch (error) {
            functions.logger.error(
                `[onPostDeleted] Location cleanup failed for post ${postId}:`,
                error
            )
        }
    })
