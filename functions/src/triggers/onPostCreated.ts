import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { distanceBetween, geohashQueryBounds } from 'geofire-common'
import { TaskType } from '@google/generative-ai'
import { getGenAI } from '../lib/gemini'
import { updateCoverageCells } from '../lib/coverage'
import { CONTRIBUTION } from '../lib/constants'
import { sendPushNotification } from '../lib/notifications'

/**
 * Firestore Trigger: Handles post creation events
 *
 * Performs:
 * 1. Contribution points for original posts (Pioneer vs Nearby check)
 * 2. Contribution points for catches + royalties to original poster
 * 3. Increments user's totalCatches/totalPosts counters
 * 4. Sends push notifications to followers for original posts
 */
export const onPostCreated = functions.firestore
    .document('posts/{postId}')
    .onCreate(async (snap, context) => {
        const db = admin.firestore()

        // Deduplicate: Firestore triggers have at-least-once delivery semantics
        const eventRef = db.collection('processed_events').doc(context.eventId)
        const existing = await eventRef.get()
        if (existing.exists) {
            functions.logger.info(
                `[onPostCreated] Duplicate event ${context.eventId}, skipping`
            )
            return
        }
        await eventRef.set({
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

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

        try {
            const userRef = db.collection('users').doc(authorId)
            const postRef = snap.ref

            // Handle CATCH posts
            if (postData.parentPostId && !postData.isOriginal) {
                // Determine bounty/trending status of root post for catch multiplier
                let catchPoints = CONTRIBUTION.CATCH
                let catchMultiplier = 1
                const rootPostId = postData.rootPostId

                if (rootPostId) {
                    const rootPostDoc = await db
                        .collection('posts')
                        .doc(rootPostId)
                        .get()
                    if (rootPostDoc.exists) {
                        const rootData = rootPostDoc.data()!
                        const rootCatchCount = rootData.catchCount ?? 0
                        const lastCaughtAt =
                            rootData.lastCaughtAt?.toMillis?.() ?? 0
                        const thirtyDaysAgo =
                            Date.now() -
                            CONTRIBUTION.BOUNTY_INACTIVITY_DAYS *
                                24 *
                                60 *
                                60 *
                                1000

                        const isBountyPost =
                            rootCatchCount === 0 ||
                            (lastCaughtAt > 0 && lastCaughtAt < thirtyDaysAgo)
                        const isTrendingPost =
                            !isBountyPost &&
                            rootCatchCount >= CONTRIBUTION.TRENDING_THRESHOLD

                        if (isBountyPost) {
                            catchMultiplier = CONTRIBUTION.BOUNTY_MULTIPLIER
                        } else if (isTrendingPost) {
                            catchMultiplier = CONTRIBUTION.TRENDING_MULTIPLIER
                        }
                        catchPoints = Math.round(
                            CONTRIBUTION.CATCH * catchMultiplier
                        )
                        functions.logger.info(
                            `Catch multiplier: ${catchMultiplier}x (bounty=${isBountyPost}, trending=${isTrendingPost}), points=${catchPoints}`
                        )

                        // Award royalty to original poster (unmultiplied)
                        const rootAuthorId = rootData.authorId
                        const isPioneer = rootData.isPioneer ?? true
                        const royalty = isPioneer
                            ? CONTRIBUTION.ROYALTY_PIONEER
                            : CONTRIBUTION.ROYALTY_NEARBY

                        if (rootAuthorId && rootAuthorId !== authorId) {
                            await db
                                .collection('users')
                                .doc(rootAuthorId)
                                .update({
                                    contribution:
                                        admin.firestore.FieldValue.increment(
                                            royalty
                                        ),
                                })
                            functions.logger.info(
                                `Awarded ${royalty} royalty to original poster ${rootAuthorId}`
                            )

                            try {
                                await db
                                    .collection('users')
                                    .doc(rootAuthorId)
                                    .collection('notifications')
                                    .add({
                                        type: 'royalty',
                                        amount: royalty,
                                        fromUserId: authorId,
                                        postId: rootPostId,
                                        createdAt:
                                            admin.firestore.FieldValue.serverTimestamp(),
                                        read: false,
                                    })
                                functions.logger.info(
                                    `[onPostCreated] Created royalty notification for ${rootAuthorId}`
                                )
                            } catch (e) {
                                functions.logger.error(
                                    `[onPostCreated] Failed to create royalty notification for ${rootAuthorId}`,
                                    e
                                )
                            }
                        }

                        // Update root post: increment contributionEarned, catchCount, and set lastCaughtAt
                        await rootPostDoc.ref.update({
                            contributionEarned:
                                admin.firestore.FieldValue.increment(royalty),
                            catchCount: admin.firestore.FieldValue.increment(1),
                            lastCaughtAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                        })
                    }
                }

                // Award catch contribution to catcher (with multiplier)
                await userRef.update({
                    totalCatches: admin.firestore.FieldValue.increment(1),
                    contribution:
                        admin.firestore.FieldValue.increment(catchPoints),
                })
                functions.logger.info(
                    `Awarded ${catchPoints} contribution to catcher ${authorId}`
                )

                // Store actual catch points earned on the catch post
                await postRef.update({
                    contributionEarned: catchPoints,
                })

                // Log xp_catch to catcher's activity feed
                try {
                    await db
                        .collection('users')
                        .doc(authorId)
                        .collection('notifications')
                        .add({
                            type: 'xp_catch',
                            amount: catchPoints,
                            postId: rootPostId || postData.parentPostId,
                            createdAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                            read: true,
                        })
                } catch (e) {
                    functions.logger.error(
                        `[onPostCreated] Failed to create xp_catch notification`,
                        e
                    )
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
                // Check if Pioneer (no posts within threshold distance)
                const locationQuery = await db
                    .collection('post_locations')
                    .where('postId', '==', postId)
                    .limit(1)
                    .get()

                let isPioneer = true
                let contributionAmount = CONTRIBUTION.PIONEER_POST

                if (!locationQuery.empty) {
                    const newPostLocation = locationQuery.docs[0].data()
                    const center: [number, number] = [
                        newPostLocation.latitude,
                        newPostLocation.longitude,
                    ]

                    // Query nearby posts using geohash
                    const bounds = geohashQueryBounds(
                        center,
                        CONTRIBUTION.NEARBY_THRESHOLD_METERS
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

                            if (
                                distance <= CONTRIBUTION.NEARBY_THRESHOLD_METERS
                            ) {
                                isPioneer = false
                                contributionAmount = CONTRIBUTION.NEARBY_POST
                                break
                            }
                        }
                        if (!isPioneer) break
                    }

                    // --- AI Search: Enrich post with metadata + embedding ---
                    // Runs async after Pioneer classification. Each step is independent
                    // and wrapped in try/catch so failures don't block post creation.
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

                    // 3. Generate text embedding via OpenAI
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
                    if (Object.keys(enrichmentUpdate).length > 0) {
                        enrichmentUpdate.metadataVersion = 1
                        await locationDocRef.update(enrichmentUpdate)
                        functions.logger.info(
                            `[onPostCreated] Enriched post ${postId} with ${Object.keys(enrichmentUpdate).join(', ')}`
                        )
                    }
                    // --- End AI Search enrichment ---
                }

                // Update post with isPioneer flag and initial contributionEarned
                await postRef.update({
                    isPioneer,
                    contributionEarned: contributionAmount,
                })

                // Award contribution to author
                await userRef.update({
                    totalPosts: admin.firestore.FieldValue.increment(1),
                    contribution:
                        admin.firestore.FieldValue.increment(
                            contributionAmount
                        ),
                })

                functions.logger.info(
                    `Post ${postId} isPioneer=${isPioneer}, awarded ${contributionAmount} contribution to ${authorId}`
                )

                // Log xp_post to author's activity feed
                try {
                    await db
                        .collection('users')
                        .doc(authorId)
                        .collection('notifications')
                        .add({
                            type: 'xp_post',
                            amount: contributionAmount,
                            isPioneer,
                            postId,
                            createdAt:
                                admin.firestore.FieldValue.serverTimestamp(),
                            read: true,
                        })
                } catch (e) {
                    functions.logger.error(
                        `[onPostCreated] Failed to create xp_post notification`,
                        e
                    )
                }

                // Update coverage cells for original post
                if (!locationQuery.empty) {
                    try {
                        const newPostGeohash =
                            locationQuery.docs[0].data().geohash
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
                            functions.logger.info(
                                `[onPostCreated] Creating new_post notification for follower ${followerId}`
                            )
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
                            functions.logger.info(
                                `[onPostCreated] Successfully created notification for ${followerId}`
                            )

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
