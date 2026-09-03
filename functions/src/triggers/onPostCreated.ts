import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { distanceBetween, geohashQueryBounds } from 'geofire-common'
import { TaskType } from '@google/generative-ai'
import { getGenAI } from '../lib/gemini'
import { updateCoverageCells } from '../lib/coverage'
import { NEARBY_THRESHOLD_METERS, MAX_INSTANCES } from '../lib/constants'
import { sendPushNotification } from '../lib/notifications'

/**
 * Firestore Trigger: Handles post creation events
 *
 * Performs:
 * 1. Pioneer attribution for original posts (first find at this spot)
 * 2. Increments user's totalCatches/totalPosts counters and the root's
 *    catchCount/lastCaughtAt for catches
 * 3. Notifies the original poster when their spot is caught
 * 4. Sends push notifications to followers for original posts
 *
 * All counter writes happen in a single transaction that also owns the
 * processed_events dedup marker — all-or-nothing, applied exactly once even
 * on duplicate delivery. Best-effort work (notifications, coverage, AI
 * enrichment) runs after the transaction.
 */
export const onPostCreated = functions
    .runWith({ maxInstances: MAX_INSTANCES.EXPENSIVE })
    .firestore.document('posts/{postId}')
    .onCreate(async (snap, context) => {
        const db = admin.firestore()

        const postData = snap.data()
        const authorId = postData.authorId
        const postId = snap.id

        if (!authorId) {
            functions.logger.warn('Post created without authorId:', snap.id)
            return
        }

        functions.logger.info(
            `[onPostCreated] Triggered for post ${postId} by author ${authorId}`
        )

        const eventRef = db.collection('processed_events').doc(context.eventId)
        const userRef = db.collection('users').doc(authorId)
        const postRef = snap.ref

        try {
            // Handle CATCH posts
            if (postData.parentPostId && !postData.isOriginal) {
                const rootPostId = postData.rootPostId
                const permitRef = rootPostId
                    ? db
                          .collection('catch_permits')
                          .doc(`${authorId}_${rootPostId}`)
                    : null

                const txnResult = await db.runTransaction(async (t) => {
                    // All reads first (transaction requirement), then writes
                    const marker = await t.get(eventRef)
                    if (marker.exists) return { duplicate: true } as const

                    const postDoc = await t.get(postRef)
                    const userDoc = await t.get(userRef)
                    const rootDoc = rootPostId
                        ? await t.get(db.collection('posts').doc(rootPostId))
                        : null
                    const permitDoc = permitRef ? await t.get(permitRef) : null

                    // Post already deleted (rapid create -> delete): write
                    // nothing — including no root catchCount update — so the
                    // counters stay balanced. Marker is still set so a
                    // redelivery doesn't retry.
                    if (!postDoc.exists) {
                        t.set(eventRef, {
                            processedAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        })
                        return { postDeleted: true } as const
                    }

                    // Permit check: validateCatch issues a short-lived permit
                    // on success, and it's consumed here — first catch wins.
                    // A catch without a live permit (forged write, or a second
                    // post racing the same permit) is rejected: stamp it so
                    // onPostDeleted skips counter decrements, then delete it
                    // after the transaction.
                    const permitValid =
                        permitDoc?.exists &&
                        (permitDoc.data()?.expiresAt?.toMillis?.() ?? 0) >
                            Date.now()
                    if (!permitValid) {
                        t.update(postRef, { rejectedNoPermit: true })
                        t.set(eventRef, {
                            processedAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        })
                        return { rejected: true } as const
                    }
                    t.delete(permitRef!)

                    let rootAuthorId: string | null = null

                    if (rootDoc?.exists) {
                        rootAuthorId = rootDoc.data()!.authorId ?? null
                        t.update(rootDoc.ref, {
                            catchCount: admin.firestore.FieldValue.increment(1),
                            lastCaughtAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        })
                    }

                    if (userDoc.exists) {
                        t.update(userRef, {
                            totalCatches: admin.firestore.FieldValue.increment(1),
                        })
                    }

                    t.set(eventRef, {
                        processedAt:
                            admin.firestore.FieldValue.serverTimestamp(),
                    })

                    return { rootAuthorId } as const
                })

                if ('duplicate' in txnResult) {
                    functions.logger.info(
                        `[onPostCreated] Duplicate event ${context.eventId}, skipping`
                    )
                    return
                }
                if ('postDeleted' in txnResult) {
                    functions.logger.info(
                        `[onPostCreated] Post ${postId} deleted before award, skipping`
                    )
                    return
                }
                if ('rejected' in txnResult) {
                    functions.logger.warn(
                        `[onPostCreated] Catch ${postId} by ${authorId} had no valid permit — deleting forged/duplicate catch`
                    )
                    try {
                        await postRef.delete()
                    } catch (e) {
                        functions.logger.error(
                            `[onPostCreated] Failed to delete rejected catch ${postId}`,
                            e
                        )
                    }
                    return
                }

                functions.logger.info(
                    `Catch ${postId} recorded for catcher ${authorId} on root ${rootPostId ?? 'unknown'}`
                )

                // --- Best-effort work below (failures don't affect counters) ---

                // Notify the original poster that someone stood where they
                // stood — this is the reward for having found the spot.
                if (
                    txnResult.rootAuthorId &&
                    txnResult.rootAuthorId !== authorId
                ) {
                    try {
                        await db
                            .collection('users')
                            .doc(txnResult.rootAuthorId)
                            .collection('notifications')
                            .add({
                                type: 'caught',
                                fromUserId: authorId,
                                postId: rootPostId,
                                createdAt:
                                    admin.firestore.FieldValue.serverTimestamp(),
                                read: false,
                            })

                        const recipientDoc = await db
                            .collection('users')
                            .doc(txnResult.rootAuthorId)
                            .get()
                        const pushToken = recipientDoc.data()?.pushToken
                        if (pushToken) {
                            const catcherUsername =
                                postData.authorUsername || 'Someone'
                            await sendPushNotification(
                                pushToken,
                                'Your spot was caught!',
                                `@${catcherUsername} stood where you stood and re-took your photo.`,
                                {
                                    userId: authorId,
                                    postId: rootPostId,
                                    type: 'caught',
                                }
                            )
                        }
                    } catch (e) {
                        functions.logger.error(
                            `[onPostCreated] Failed to notify ${txnResult.rootAuthorId} of catch`,
                            e
                        )
                    }
                }

                // Update coverage cells for catch post
                try {
                    const catchLocationQuery = await db
                        .collection('post_locations')
                        .where('postId', '==', postId)
                        .limit(1)
                        .get()

                    if (!catchLocationQuery.empty) {
                        const catchGeohash =
                            catchLocationQuery.docs[0].data().geohash
                        await updateCoverageCells(db, catchGeohash, authorId)
                        functions.logger.info(
                            `[onPostCreated] Updated coverage cells for catch ${postId}`
                        )
                    }
                } catch (e) {
                    functions.logger.warn(
                        `[onPostCreated] Coverage cell update failed for catch ${postId}`,
                        e
                    )
                }
            }

            // Handle ORIGINAL posts
            if (postData.isOriginal) {
                // Pioneer classification (geohash queries) runs outside the
                // transaction — it's a point-in-time check. Pioneer is pure
                // attribution: "first found at this spot".
                const locationQuery = await db
                    .collection('post_locations')
                    .where('postId', '==', postId)
                    .limit(1)
                    .get()

                let isPioneer = true

                if (!locationQuery.empty) {
                    const newPostLocation = locationQuery.docs[0].data()
                    const center: [number, number] = [
                        newPostLocation.latitude,
                        newPostLocation.longitude,
                    ]

                    // Query nearby posts using geohash
                    const bounds = geohashQueryBounds(
                        center,
                        NEARBY_THRESHOLD_METERS
                    )

                    const nearbyPromises = bounds.map(([start, end]) =>
                        db
                            .collection('post_locations')
                            .where('geohash', '>=', start)
                            .where('geohash', '<=', end)
                            .get()
                    )

                    const nearbySnapshots = await Promise.all(nearbyPromises)

                    for (const snapshot of nearbySnapshots) {
                        for (const doc of snapshot.docs) {
                            // Skip self
                            if (doc.data().postId === postId) continue

                            const otherLocation = doc.data()
                            const distance =
                                distanceBetween(center, [
                                    otherLocation.latitude,
                                    otherLocation.longitude,
                                ]) * 1000 // Convert km to meters

                            if (distance <= NEARBY_THRESHOLD_METERS) {
                                isPioneer = false
                                break
                            }
                        }
                        if (!isPioneer) break
                    }
                }

                const txnResult = await db.runTransaction(async (t) => {
                    const marker = await t.get(eventRef)
                    if (marker.exists) return { duplicate: true } as const

                    const postDoc = await t.get(postRef)
                    const userDoc = await t.get(userRef)

                    // Post already deleted: skip writes, keep counters balanced
                    if (!postDoc.exists) {
                        t.set(eventRef, {
                            processedAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        })
                        return { postDeleted: true } as const
                    }

                    t.update(postRef, { isPioneer })

                    if (userDoc.exists) {
                        t.update(userRef, {
                            totalPosts: admin.firestore.FieldValue.increment(1),
                        })
                    }

                    t.set(eventRef, {
                        processedAt:
                            admin.firestore.FieldValue.serverTimestamp(),
                    })

                    return { awarded: true } as const
                })

                if ('duplicate' in txnResult) {
                    functions.logger.info(
                        `[onPostCreated] Duplicate event ${context.eventId}, skipping`
                    )
                    return
                }
                if ('postDeleted' in txnResult) {
                    functions.logger.info(
                        `[onPostCreated] Post ${postId} deleted before award, skipping`
                    )
                    return
                }

                functions.logger.info(
                    `Post ${postId} isPioneer=${isPioneer} by ${authorId}`
                )

                // --- Best-effort work below (failures don't affect counters) ---

                // --- AI Search: Enrich post with metadata + embedding ---
                // Each step is independent and wrapped in try/catch so
                // failures don't block anything else. Runs after the award
                // transaction so slow external APIs can't delay balances.
                if (!locationQuery.empty) {
                    const newPostLocation = locationQuery.docs[0].data()
                    const locationDocRef = locationQuery.docs[0].ref
                    const enrichmentUpdate: Record<string, any> = {}

                    // 1. Reverse geocode via Nominatim (free, no API key)
                    try {
                        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${newPostLocation.latitude}&lon=${newPostLocation.longitude}&format=json&addressdetails=1`
                        const geoResponse = await fetch(nominatimUrl, {
                            headers: { 'User-Agent': 'CatchApp/1.0' },
                        })
                        if (geoResponse.ok) {
                            const geoData = await geoResponse.json()
                            enrichmentUpdate.locationMeta = {
                                country: geoData.address?.country || null,
                                city:
                                    geoData.address?.city ||
                                    geoData.address?.town ||
                                    geoData.address?.village ||
                                    null,
                                neighborhood:
                                    geoData.address?.suburb ||
                                    geoData.address?.neighbourhood ||
                                    null,
                                street: geoData.address?.road || null,
                                formattedAddress: geoData.display_name || null,
                            }
                        }
                    } catch (e) {
                        functions.logger.warn(
                            `[onPostCreated] Nominatim geocoding failed for post ${postId}`,
                            e
                        )
                    }

                    // 2. Vision auto-tagging via Gemini Flash
                    try {
                        const photoPath = postData.photoURL
                        // Extract Storage path from download URL
                        const storagePathMatch =
                            photoPath?.match(/\/o\/(.+?)\?/)
                        if (storagePathMatch) {
                            const storagePath = decodeURIComponent(
                                storagePathMatch[1]
                            )
                            const bucket = admin.storage().bucket()
                            const [imageBuffer] = await Promise.race([
                                bucket.file(storagePath).download(),
                                new Promise<never>((_, reject) =>
                                    setTimeout(
                                        () =>
                                            reject(
                                                new Error(
                                                    'Image download timeout'
                                                )
                                            ),
                                        10000
                                    )
                                ),
                            ])
                            const imageBase64 = imageBuffer.toString('base64')

                            const model = getGenAI().getGenerativeModel({
                                model: 'gemini-2.0-flash',
                            })
                            const result = await Promise.race([
                                model.generateContent([
                                    {
                                        inlineData: {
                                            mimeType: 'image/jpeg',
                                            data: imageBase64,
                                        },
                                    },
                                    'Analyze this travel/location photo. Return ONLY valid JSON, no markdown:\n{\n  "tags": ["tag1", "tag2"],\n  "scene": "one-line scene description",\n  "landmark": "name or null",\n  "mood": "one-word mood"\n}',
                                ]),
                                new Promise<never>((_, reject) =>
                                    setTimeout(
                                        () =>
                                            reject(new Error('Gemini timeout')),
                                        15000
                                    )
                                ),
                            ])

                            const text = result.response.text()
                            // Strip markdown code fences if present
                            const jsonStr = text
                                .replace(/^```(?:json)?\n?/, '')
                                .replace(/\n?```$/, '')
                                .trim()
                            const visualMeta = JSON.parse(jsonStr)
                            enrichmentUpdate.visualMeta = {
                                tags: Array.isArray(visualMeta.tags)
                                    ? visualMeta.tags
                                    : [],
                                scene:
                                    typeof visualMeta.scene === 'string'
                                        ? visualMeta.scene
                                        : null,
                                landmark:
                                    typeof visualMeta.landmark === 'string'
                                        ? visualMeta.landmark
                                        : null,
                                mood:
                                    typeof visualMeta.mood === 'string'
                                        ? visualMeta.mood
                                        : null,
                            }
                        }
                    } catch (e) {
                        functions.logger.warn(
                            `[onPostCreated] Vision tagging failed for post ${postId}`,
                            e
                        )
                    }

                    // 3. Generate text embedding via Gemini
                    try {
                        const embeddingParts = [
                            postData.caption,
                            enrichmentUpdate.locationMeta?.formattedAddress,
                            enrichmentUpdate.locationMeta?.city,
                            enrichmentUpdate.visualMeta?.scene,
                            enrichmentUpdate.visualMeta?.tags?.join(', '),
                            enrichmentUpdate.visualMeta?.mood,
                            enrichmentUpdate.visualMeta?.landmark,
                        ].filter(Boolean)

                        if (embeddingParts.length > 0) {
                            const embeddingText = embeddingParts.join('. ')
                            const embModel = getGenAI().getGenerativeModel({
                                model: 'gemini-embedding-001',
                            })
                            const embResult = await embModel.embedContent({
                                content: {
                                    role: 'user',
                                    parts: [{ text: embeddingText }],
                                },
                                taskType: TaskType.RETRIEVAL_DOCUMENT,
                                outputDimensionality: 768,
                            } as any)
                            enrichmentUpdate.embedding =
                                admin.firestore.FieldValue.vector(
                                    embResult.embedding.values
                                )
                        }
                    } catch (e) {
                        functions.logger.warn(
                            `[onPostCreated] Embedding generation failed for post ${postId}`,
                            e
                        )
                    }

                    // Write all enrichment data in a single update
                    try {
                        if (Object.keys(enrichmentUpdate).length > 0) {
                            enrichmentUpdate.metadataVersion = 1
                            await locationDocRef.update(enrichmentUpdate)
                            functions.logger.info(
                                `[onPostCreated] Enriched post ${postId} with ${Object.keys(enrichmentUpdate).join(', ')}`
                            )
                        }
                    } catch (e) {
                        functions.logger.warn(
                            `[onPostCreated] Enrichment write failed for post ${postId}`,
                            e
                        )
                    }
                    // --- End AI Search enrichment ---

                    // Update coverage cells for original post
                    try {
                        const newPostGeohash = newPostLocation.geohash
                        await updateCoverageCells(db, newPostGeohash, authorId)
                        functions.logger.info(
                            `[onPostCreated] Updated coverage cells for original post ${postId}`
                        )
                    } catch (e) {
                        functions.logger.warn(
                            `[onPostCreated] Coverage cell update failed for post ${postId}`,
                            e
                        )
                    }
                }

                // Send notifications to followers
                const authorDoc = await userRef.get()
                if (authorDoc.exists) {
                    const authorData = authorDoc.data()
                    const authorUsername = authorData?.username || 'Someone'
                    const followers = authorData?.followers || []

                    for (const followerId of followers) {
                        try {
                            // Create in-app notification
                            await db
                                .collection('users')
                                .doc(followerId)
                                .collection('notifications')
                                .add({
                                    type: 'new_post',
                                    fromUserId: authorId,
                                    postId: postId,
                                    createdAt:
                                        admin.firestore.FieldValue.serverTimestamp(),
                                    read: false,
                                })

                            const followerDoc = await db
                                .collection('users')
                                .doc(followerId)
                                .get()
                            if (!followerDoc.exists) continue

                            const followerData = followerDoc.data()
                            const pushToken = followerData?.pushToken
                            if (!pushToken) continue

                            await sendPushNotification(
                                pushToken,
                                'New Post',
                                `@${authorUsername} just made a new post!`,
                                {
                                    userId: authorId,
                                    postId: postId,
                                    type: 'new_post',
                                }
                            )
                        } catch (error) {
                            functions.logger.error(
                                `Error sending notification to follower ${followerId}:`,
                                error
                            )
                        }
                    }
                }
            }
        } catch (error) {
            functions.logger.error('Error in onPostCreated trigger:', error)
        }
    })
