import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { decrementCoverageCells } from '../lib/coverage'
import { CONTRIBUTION, MAX_INSTANCES } from '../lib/constants'

/**
 * Firestore Trigger: Handles post deletion events
 *
 * Complex logic handles different deletion scenarios:
 * 1. Catch deleted: Decrements user's totalCatches and root post's catchCount
 * 2. Root with catches deleted: Promotes oldest catch to new root, updates all thread references
 * 3. Root without catches deleted: Simply cleans up location data
 *
 * Also removes the post from any lists containing it
 */
export const onPostDeleted = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .firestore.document('posts/{postId}')
    .onDelete(async (snap, context) => {
        const db = admin.firestore()

        // Deduplicate: Firestore triggers have at-least-once delivery semantics
        const eventRef = db.collection('processed_events').doc(context.eventId)
        const existing = await eventRef.get()
        if (existing.exists) {
            functions.logger.info(
                `[onPostDeleted] Duplicate event ${context.eventId}, skipping`
            )
            return
        }
        await eventRef.set({
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        const postData = snap.data()
        const postId = snap.id
        const authorId = postData.authorId

        if (!authorId) {
            functions.logger.warn('Deleted post had no authorId:', postId)
            return
        }

        try {
            const userRef = db.collection('users').doc(authorId)

            // Subtract contributionEarned from author
            const contributionEarned = postData.contributionEarned || 0
            if (contributionEarned > 0) {
                await userRef.update({
                    contribution:
                        admin.firestore.FieldValue.increment(
                            -contributionEarned
                        ),
                })
                functions.logger.info(
                    `Subtracted ${contributionEarned} contribution from user ${authorId}`
                )
            }

            // Decrement totalCatches if this was a catch
            if (postData.parentPostId && !postData.isOriginal) {
                await userRef.update({
                    totalCatches: admin.firestore.FieldValue.increment(-1),
                })
                functions.logger.info(
                    `Decremented totalCatches for user ${authorId}`
                )
            }

            // Decrement totalPosts if this was an original post
            if (postData.isOriginal) {
                await userRef.update({
                    totalPosts: admin.firestore.FieldValue.increment(-1),
                })
                functions.logger.info(
                    `Decremented totalPosts for user ${authorId}`
                )
            }

            // Remove post from any lists that contain it
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

            // Handle root post deletion - promote oldest catch to new root
            if (postData.isOriginal) {
                functions.logger.info(
                    `Root post ${postId} deleted, checking for thread promotion`
                )

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

                    // Promote oldest catch to root
                    batch.update(newRootDoc.ref, {
                        isOriginal: true,
                        parentPostId: null,
                        rootPostId: null,
                        catchCount: postData.catchCount - 1,
                    })

                    // Update remaining catches to point to new root
                    for (let i = 1; i < catchesQuery.docs.length; i++) {
                        const catchDoc = catchesQuery.docs[i]
                        batch.update(catchDoc.ref, {
                            rootPostId: newRootId,
                            parentPostId: newRootId,
                        })
                    }

                    // Delete old root's location data (new root keeps its own)
                    const oldLocationQuery = await db
                        .collection('post_locations')
                        .where('postId', '==', postId)
                        .limit(1)
                        .get()

                    if (!oldLocationQuery.empty) {
                        const oldGeohash =
                            oldLocationQuery.docs[0].data().geohash
                        batch.delete(oldLocationQuery.docs[0].ref)
                        // Decrement coverage cells after batch commit
                        await batch.commit()
                        if (oldGeohash) {
                            await decrementCoverageCells(db, oldGeohash)
                        }
                    } else {
                        await batch.commit()
                    }

                    functions.logger.info(
                        `Thread promotion complete. New root: ${newRootId}`
                    )
                } else {
                    // No catches in thread, just delete location data
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
                }
            } else {
                // Catch deleted - decrement root's catchCount and claw back royalty
                const rootPostId = postData.rootPostId
                if (rootPostId) {
                    const rootRef = db.collection('posts').doc(rootPostId)
                    const rootDoc = await rootRef.get()
                    if (rootDoc.exists) {
                        const rootData = rootDoc.data()!
                        const isPioneer = rootData.isPioneer ?? true
                        const royalty = isPioneer
                            ? CONTRIBUTION.ROYALTY_PIONEER
                            : CONTRIBUTION.ROYALTY_NEARBY

                        await rootRef.update({
                            catchCount:
                                admin.firestore.FieldValue.increment(-1),
                            contributionEarned:
                                admin.firestore.FieldValue.increment(-royalty),
                        })
                        functions.logger.info(
                            `Decremented catchCount and contributionEarned (${royalty}) for root post ${rootPostId}`
                        )

                        // Claw back royalty from original poster
                        const rootAuthorId = rootData.authorId
                        if (rootAuthorId && rootAuthorId !== authorId) {
                            await db
                                .collection('users')
                                .doc(rootAuthorId)
                                .update({
                                    contribution:
                                        admin.firestore.FieldValue.increment(
                                            -royalty
                                        ),
                                })
                            functions.logger.info(
                                `Clawed back ${royalty} royalty from original poster ${rootAuthorId}`
                            )
                        }
                    }
                }

                // Delete catch's location data
                const locationQuery = await db
                    .collection('post_locations')
                    .where('postId', '==', postId)
                    .limit(1)
                    .get()

                if (!locationQuery.empty) {
                    const catchGeohash = locationQuery.docs[0].data().geohash
                    await locationQuery.docs[0].ref.delete()
                    if (catchGeohash) {
                        await decrementCoverageCells(db, catchGeohash)
                    }
                    functions.logger.info(
                        `Deleted location data for catch ${postId}`
                    )
                }
            }
        } catch (error) {
            functions.logger.error('Error handling post deletion:', error)
        }
    })
