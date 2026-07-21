import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { distanceBetween } from 'geofire-common'
import { TaskType } from '@google/generative-ai'
import { getGenAI } from '../lib/gemini'

/**
 * Semantic search across posts using vector similarity.
 * Embeds the user's query and finds nearest matches in post_locations.
 */
export const searchPosts = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be logged in'
        )
    }
    const { query, location } = data
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Query is required'
        )
    }
    if (query.length > 200) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Query too long'
        )
    }

    const hasLocation =
        location &&
        typeof location.lat === 'number' &&
        typeof location.lng === 'number'
    const db = admin.firestore()

    try {
        const rawQuery = query.trim()
        const isShortQuery = rawQuery.split(/\s+/).length <= 4

        // 1. Run query expansion and base embedding in parallel
        // For short queries, expansion feeds a second embedding call.
        // For long queries, we only need the single embedding.
        const embModel = getGenAI().getGenerativeModel({
            model: 'gemini-embedding-001',
        })

        let queryVector: number[]

        if (isShortQuery) {
            // Run expansion + base embedding concurrently
            const flashModel = getGenAI().getGenerativeModel({
                model: 'gemini-2.0-flash',
            })
            const [expansionResult, baseEmbResult] = await Promise.all([
                flashModel
                    .generateContent(
                        `You are a search query expander for a travel photo app. Given the short search query below, output a single comma-separated list of 5-8 related phrases that someone might use to describe travel photos matching this query. Include synonyms, related visual descriptions, and broader concepts. Output ONLY the comma-separated list, nothing else.\n\nQuery: "${rawQuery}"`
                    )
                    .catch((e: any) => {
                        functions.logger.warn(
                            '[searchPosts] Query expansion failed, using raw query',
                            e
                        )
                        return null
                    }),
                embModel.embedContent({
                    content: {
                        role: 'user',
                        parts: [{ text: rawQuery }],
                    },
                    taskType: TaskType.RETRIEVAL_QUERY,
                    outputDimensionality: 768,
                } as any),
            ])

            // If expansion succeeded, embed the expanded text; otherwise use base embedding
            const expanded = expansionResult?.response?.text()?.trim()
            if (expanded && expanded.length > 0 && expanded.length < 500) {
                const searchText = `${rawQuery}, ${expanded}`
                functions.logger.info(
                    `[searchPosts] Expanded query: "${rawQuery}" → "${searchText}"`
                )
                const expandedEmb = await embModel.embedContent({
                    content: {
                        role: 'user',
                        parts: [{ text: searchText }],
                    },
                    taskType: TaskType.RETRIEVAL_QUERY,
                    outputDimensionality: 768,
                } as any)
                queryVector = expandedEmb.embedding.values
            } else {
                queryVector = baseEmbResult.embedding.values
            }
        } else {
            // Long query — embed directly, no expansion needed
            const embResult = await embModel.embedContent({
                content: {
                    role: 'user',
                    parts: [{ text: rawQuery }],
                },
                taskType: TaskType.RETRIEVAL_QUERY,
                outputDimensionality: 768,
            } as any)
            queryVector = embResult.embedding.values
        }

        // 3. Vector similarity search via Firestore findNearest
        const vectorQuery = db.collection('post_locations').findNearest({
            vectorField: 'embedding',
            queryVector,
            limit: 50,
            distanceMeasure: 'COSINE',
            distanceResultField: 'vectorDistance',
        })
        const snapshot = await vectorQuery.get()

        // 4. Compute geo distance + re-rank if user location available
        let locationResults = snapshot.docs.map((doc) => {
            const d = doc.data()
            let distanceKm: number | null = null
            if (hasLocation) {
                distanceKm = distanceBetween(
                    [location.lat, location.lng],
                    [d.latitude, d.longitude]
                )
            }
            return { id: doc.id, ...d, distanceKm }
        })

        if (hasLocation) {
            // Re-rank: boost nearby results using log-scaled distance penalty
            // 1km → 1.09x, 10km → 1.31x, 100km → 1.60x, 1000km → 1.90x
            locationResults.sort((a: any, b: any) => {
                const aScore =
                    (a.vectorDistance || 0) *
                    (1 + Math.log10(1 + (a.distanceKm || 0)) * 0.3)
                const bScore =
                    (b.vectorDistance || 0) *
                    (1 + Math.log10(1 + (b.distanceKm || 0)) * 0.3)
                return aScore - bScore
            })
        }

        // Log vectorDistance distribution for debugging relevance
        const distances = locationResults.map((r: any) =>
            (r.vectorDistance || 0).toFixed(3)
        )
        functions.logger.info(
            `[searchPosts] vectorDistances for "${query}": [${distances.join(', ')}]`
        )

        // Filter by relevance: cosine distance > 0.50 means weak/unrelated match
        // Empirical: closely matching posts ~0.2-0.3, loosely related ~0.4-0.5
        const beforeCount = locationResults.length
        locationResults = locationResults.filter(
            (r: any) => (r.vectorDistance || 0) < 0.5
        )
        functions.logger.info(
            `[searchPosts] Relevance filter: ${beforeCount} → ${locationResults.length} (cutoff 0.50)`
        )

        // Take top 50 after re-ranking
        locationResults = locationResults.slice(0, 50)

        if (locationResults.length === 0) {
            return { posts: [] }
        }

        // 4. Batch fetch post documents for summaries
        const postIds = locationResults.map((r: any) => r.postId)
        const postMap: Record<string, any> = {}

        for (let i = 0; i < postIds.length; i += 100) {
            const batch = postIds.slice(i, i + 100)
            const refs = batch.map((id: string) =>
                db.collection('posts').doc(id)
            )
            const docs = await db.getAll(...refs)
            for (const doc of docs) {
                if (doc.exists) {
                    postMap[doc.id] = doc.data()
                }
            }
        }

        // 5. Return merged results
        const posts = locationResults
            .filter((r: any) => postMap[r.postId])
            .map((r: any) => {
                const post = postMap[r.postId]
                return {
                    postId: r.postId,
                    authorId: post.authorId,
                    authorUsername: post.authorUsername,
                    caption: post.caption,
                    photoURL: post.photoURL,
                    thumbnailURL: post.thumbnailURL || null,
                    mediumURL: post.mediumURL || null,
                    catchCount: post.catchCount || 0,
                    isPioneer: post.isPioneer || false,
                    isOriginal: post.isOriginal,
                    createdAt: post.createdAt,
                    city: r.locationMeta?.city || null,
                    country: r.locationMeta?.country || null,
                    tags: r.visualMeta?.tags || [],
                    scene: r.visualMeta?.scene || null,
                    distanceKm:
                        r.distanceKm !== null
                            ? Math.round(r.distanceKm * 10) / 10
                            : null,
                    latitude: r.latitude,
                    longitude: r.longitude,
                    vectorDistance: r.vectorDistance || 0,
                }
            })

        functions.logger.info(
            `[searchPosts] Query "${query}" returned ${posts.length} results`
        )
        return { posts }
    } catch (error: any) {
        const msg = error?.message || String(error)
        functions.logger.error('Error in searchPosts:', msg, error)
        throw new functions.https.HttpsError(
            'internal',
            `Search failed: ${msg}`
        )
    }
})

// ============================================================================
// BACKFILL EMBEDDINGS
// One-time admin function to enrich existing post_locations with
// locationMeta, visualMeta, and vector embeddings for search.
// ============================================================================
export const backfillEmbeddings = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be authenticated'
            )
        }

        const force = data?.force === true // Re-generate embeddings even if they exist
        const embeddingsOnly = data?.embeddingsOnly === true // Skip geocoding/vision, only redo embeddings

        const db = admin.firestore()
        const snapshot = await db.collection('post_locations').get()

        let processed = 0
        let skipped = 0
        let errors = 0

        for (const doc of snapshot.docs) {
            const locData = doc.data()

            // Skip docs that already have an embedding (unless force mode)
            if (locData.embedding && !force) {
                skipped++
                continue
            }

            try {
                const enrichmentUpdate: Record<string, any> = {}

                // 1. Reverse geocode if missing locationMeta
                if (
                    !embeddingsOnly &&
                    !locData.locationMeta &&
                    locData.latitude &&
                    locData.longitude
                ) {
                    try {
                        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${locData.latitude}&lon=${locData.longitude}&format=json&addressdetails=1`
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
                        // Nominatim rate limit: 1 req/sec
                        await new Promise((resolve) =>
                            setTimeout(resolve, 1100)
                        )
                    } catch (e) {
                        functions.logger.warn(
                            `[backfill] Geocoding failed for ${doc.id}`,
                            e
                        )
                    }
                }

                // 2. Vision tagging if missing visualMeta
                if (!embeddingsOnly && !locData.visualMeta && locData.postId) {
                    try {
                        const postDoc = await db
                            .collection('posts')
                            .doc(locData.postId)
                            .get()
                        const postData = postDoc.data()
                        const photoPath = postData?.photoURL
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
                            `[backfill] Vision tagging failed for ${doc.id}`,
                            e
                        )
                    }
                }

                // 3. Generate embedding from all available text
                try {
                    const meta =
                        enrichmentUpdate.locationMeta ||
                        locData.locationMeta ||
                        {}
                    const visual =
                        enrichmentUpdate.visualMeta || locData.visualMeta || {}

                    // Fetch caption from posts collection
                    let caption = ''
                    if (locData.postId) {
                        const postDoc = await db
                            .collection('posts')
                            .doc(locData.postId)
                            .get()
                        caption = postDoc.data()?.caption || ''
                    }

                    const embeddingParts = [
                        caption,
                        meta.formattedAddress,
                        meta.city,
                        visual.scene,
                        visual.tags?.join(', '),
                        visual.mood,
                        visual.landmark,
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
                        `[backfill] Embedding failed for ${doc.id}`,
                        e
                    )
                }

                // 4. Write updates
                if (Object.keys(enrichmentUpdate).length > 0) {
                    enrichmentUpdate.metadataVersion = 1
                    await doc.ref.update(enrichmentUpdate)
                    processed++
                    functions.logger.info(
                        `[backfill] Enriched ${doc.id} (${processed}/${snapshot.docs.length - skipped})`
                    )
                }
            } catch (e) {
                errors++
                functions.logger.warn(`[backfill] Failed for ${doc.id}`, e)
            }
        }

        const summary = {
            processed,
            skipped,
            errors,
            total: snapshot.docs.length,
        }
        functions.logger.info(`[backfill] Complete:`, summary)
        return summary
    })
