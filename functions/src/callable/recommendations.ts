import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import {
    distanceBetween,
    geohashForLocation,
    geohashQueryBounds,
} from 'geofire-common'
import { GEOHASH_QUERY_LIMIT, MAX_INSTANCES } from '../lib/constants'

// ─── Recommendation System (Phase 1) ────────────────────────────────────────

/** Maximum active cities per user */
const MAX_ACTIVE_CITIES = 10

/** Cities within this distance are considered duplicates */
const CITY_DEDUP_RADIUS_KM = 50

/** How long a searched city stays active (days) */
const CITY_EXPIRY_DAYS = 30

/** Radius for city trending queries (meters) */
const CITY_TRENDING_RADIUS = 25000

/** Max following IDs per Firestore 'in' query */
const FOLLOWING_BATCH_SIZE = 30

/**
 * HTTPS Callable Function: Records a city search intent for recommendations
 *
 * When a user searches for a city on the explore page, this records it as an
 * "active city" so the recommendation feed can surface trending posts from there.
 *
 * @param data.cityName - Display name of the city (e.g. "Tokyo")
 * @param data.latitude - City center latitude
 * @param data.longitude - City center longitude
 */
export const recordCityIntent = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to record city intent'
            )
        }

        const { cityName, latitude, longitude } = data
        const userId = context.auth.uid

        // Validate inputs
        if (
            !cityName ||
            typeof cityName !== 'string' ||
            cityName.length > 100
        ) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'cityName must be a string (max 100 chars)'
            )
        }
        if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'latitude must be between -90 and 90'
            )
        }
        if (
            typeof longitude !== 'number' ||
            longitude < -180 ||
            longitude > 180
        ) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'longitude must be between -180 and 180'
            )
        }

        const db = admin.firestore()

        try {
            const geohash = geohashForLocation([latitude, longitude])
            const now = Date.now()
            const expiresAt = now + CITY_EXPIRY_DAYS * 24 * 60 * 60 * 1000

            const recRef = db.collection('user_recommendations').doc(userId)
            const recDoc = await recRef.get()
            let activeCities: any[] = recDoc.exists
                ? recDoc.data()?.activeCities || []
                : []

            // Prune expired cities
            activeCities = activeCities.filter((c: any) => c.expiresAt > now)

            // Check for duplicate (same city within dedup radius)
            const existingIndex = activeCities.findIndex((c: any) => {
                const dist = distanceBetween(
                    [latitude, longitude],
                    [c.latitude, c.longitude]
                )
                return dist <= CITY_DEDUP_RADIUS_KM
            })

            if (existingIndex >= 0) {
                // Refresh existing city
                activeCities[existingIndex] = {
                    ...activeCities[existingIndex],
                    name: cityName,
                    weight: 0.7,
                    expiresAt,
                }
            } else {
                // Add new city
                const newCity = {
                    name: cityName,
                    latitude,
                    longitude,
                    geohash,
                    source: 'search',
                    weight: 0.7,
                    createdAt: now,
                    expiresAt,
                }
                activeCities.push(newCity)

                // Cap at max cities (drop oldest by createdAt)
                if (activeCities.length > MAX_ACTIVE_CITIES) {
                    activeCities.sort(
                        (a: any, b: any) => b.createdAt - a.createdAt
                    )
                    activeCities = activeCities.slice(0, MAX_ACTIVE_CITIES)
                }
            }

            await recRef.set(
                {
                    activeCities,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
            )

            functions.logger.info(
                `[recordCityIntent] Recorded city "${cityName}" for user ${userId}`
            )
            return { success: true }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) throw error
            functions.logger.error('Error recording city intent:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to record city intent'
            )
        }
    })

/**
 * HTTPS Callable Function: Returns a paginated personalized feed
 *
 * Combines two candidate sources:
 * 1. Social feed — posts/catches from followed users
 * 2. City trending — popular posts in cities the user has searched for
 *
 * Each post includes a reason label explaining why it was recommended.
 *
 * @param data.cursor - Opaque pagination cursor from previous response
 * @param data.pageSize - Number of posts to return (default 20, max 50)
 * @returns { posts, nextCursor, hasMore }
 */
export const getRecommendedFeed = functions
    .runWith({ maxInstances: MAX_INSTANCES.EXPENSIVE })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to get recommendations'
            )
        }

        const userId = context.auth.uid
        const pageSize = Math.min(Math.max(data?.pageSize || 20, 1), 50)
        const cursor = data?.cursor ? JSON.parse(data.cursor) : null // { lastScore, lastPostId }

        const db = admin.firestore()

        try {
            // ── Step 1: Get user's following list ──
            const userDoc = await db.collection('users').doc(userId).get()
            if (!userDoc.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'User not found'
                )
            }
            const following: string[] = userDoc.data()?.following || []

            // ── Step 2: Social feed — posts from followed users ──
            const socialPosts: any[] = []

            if (following.length > 0) {
                const socialLimit = pageSize * 2 // Fetch extra for merging

                for (
                    let i = 0;
                    i < following.length;
                    i += FOLLOWING_BATCH_SIZE
                ) {
                    const batch = following.slice(i, i + FOLLOWING_BATCH_SIZE)
                    const q = db
                        .collection('posts')
                        .where('authorId', 'in', batch)
                        .orderBy('createdAt', 'desc')
                        .limit(socialLimit)
                    const snap = await q.get()

                    snap.docs.forEach((doc) => {
                        const postData = doc.data()
                        // Skip user's own posts
                        if (postData.authorId === userId) return

                        const isOriginal = postData.isOriginal ?? true
                        const reasonLabel = isOriginal
                            ? `Posted by @${postData.authorUsername}`
                            : `@${postData.authorUsername} caught this`

                        // Recency bonus: posts < 7 days get up to 50 extra score
                        const ageHours =
                            (Date.now() -
                                (postData.createdAt?.toMillis?.() || 0)) /
                            (1000 * 60 * 60)
                        const recencyBonus =
                            50 * Math.max(0, 1 - ageHours / 168)

                        socialPosts.push({
                            id: doc.id,
                            authorId: postData.authorId,
                            authorUsername: postData.authorUsername,
                            caption: postData.caption || '',
                            photoURL: postData.photoURL,
                            thumbnailURL: postData.thumbnailURL || null,
                            mediumURL: postData.mediumURL || null,
                            catchCount: postData.catchCount || 0,
                            createdAt: postData.createdAt?.toMillis?.() ?? null,
                            isOriginal,
                            isPioneer: postData.isPioneer || false,
                            hasLocation: postData.hasLocation ?? false,
                            parentPostId: postData.parentPostId || null,
                            rootPostId: postData.rootPostId || null,
                            reasonLabel,
                            reasonType: 'social',
                            score: 100 + recencyBonus,
                        })
                    })
                }
            }

            // ── Step 3: City trending — popular posts in active cities ──
            const cityPosts: any[] = []

            const recDoc = await db
                .collection('user_recommendations')
                .doc(userId)
                .get()
            let activeCities: any[] = recDoc.exists
                ? recDoc.data()?.activeCities || []
                : []

            // Filter expired, sort by weight, take top 5
            const now = Date.now()
            activeCities = activeCities
                .filter((c: any) => c.expiresAt > now)
                .sort((a: any, b: any) => b.weight - a.weight)
                .slice(0, 5)

            for (const city of activeCities) {
                const center: [number, number] = [city.latitude, city.longitude]
                const bounds = geohashQueryBounds(center, CITY_TRENDING_RADIUS)

                const locationPromises = bounds.map(([start, end]) =>
                    db
                        .collection('post_locations')
                        .where('geohash', '>=', start)
                        .where('geohash', '<=', end)
                        .limit(GEOHASH_QUERY_LIMIT)
                        .get()
                )
                const locationSnapshots = await Promise.all(locationPromises)

                // Collect post IDs within actual radius
                const cityPostIds: string[] = []
                locationSnapshots.forEach((snapshot) => {
                    snapshot.docs.forEach((doc) => {
                        const loc = doc.data()
                        const dist = distanceBetween(center, [
                            loc.latitude,
                            loc.longitude,
                        ])
                        if (dist <= CITY_TRENDING_RADIUS / 1000) {
                            // distanceBetween returns km
                            cityPostIds.push(loc.postId)
                        }
                    })
                })

                if (cityPostIds.length === 0) continue

                // Fetch post data in batches of 100
                const uniquePostIds = [...new Set(cityPostIds)].slice(0, 100)
                const postRefs = uniquePostIds.map((id) =>
                    db.collection('posts').doc(id)
                )

                for (let i = 0; i < postRefs.length; i += 100) {
                    const chunk = postRefs.slice(i, i + 100)
                    const postSnaps = await db.getAll(...chunk)

                    postSnaps.forEach((snap) => {
                        if (!snap.exists) return
                        const postData = snap.data()!
                        // Skip user's own posts and non-originals
                        if (postData.authorId === userId) return
                        if (!postData.isOriginal) return

                        const catchCount = postData.catchCount || 0
                        const score = 50 + catchCount * 2 + city.weight * 20

                        cityPosts.push({
                            id: snap.id,
                            authorId: postData.authorId,
                            authorUsername: postData.authorUsername,
                            caption: postData.caption || '',
                            photoURL: postData.photoURL,
                            thumbnailURL: postData.thumbnailURL || null,
                            mediumURL: postData.mediumURL || null,
                            catchCount,
                            createdAt: postData.createdAt?.toMillis?.() ?? null,
                            isOriginal: true,
                            isPioneer: postData.isPioneer || false,
                            hasLocation: postData.hasLocation ?? false,
                            parentPostId: postData.parentPostId || null,
                            rootPostId: postData.rootPostId || null,
                            reasonLabel: `Trending in ${city.name}`,
                            reasonType: 'city_trending',
                            score,
                        })
                    })
                }
            }

            // ── Step 4: Merge, deduplicate, sort, paginate ──
            const seenIds = new Set<string>()
            const allPosts: any[] = []

            // Social posts first (preferred reason when duplicated)
            for (const post of socialPosts) {
                if (!seenIds.has(post.id)) {
                    seenIds.add(post.id)
                    allPosts.push(post)
                }
            }
            for (const post of cityPosts) {
                if (!seenIds.has(post.id)) {
                    seenIds.add(post.id)
                    allPosts.push(post)
                }
            }

            // Sort by score descending, then by createdAt descending for ties
            allPosts.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score
                return (b.createdAt || 0) - (a.createdAt || 0)
            })

            // Apply cursor-based pagination
            let startIndex = 0
            if (cursor) {
                startIndex = allPosts.findIndex(
                    (p) =>
                        p.score < cursor.lastScore ||
                        (p.score === cursor.lastScore &&
                            p.id === cursor.lastPostId)
                )
                if (startIndex === -1) startIndex = allPosts.length
                // Skip past the cursor post itself
                if (
                    startIndex < allPosts.length &&
                    allPosts[startIndex].id === cursor.lastPostId
                ) {
                    startIndex++
                }
            }

            const pagePosts = allPosts.slice(startIndex, startIndex + pageSize)
            const hasMore = startIndex + pageSize < allPosts.length

            let nextCursor: string | null = null
            if (hasMore && pagePosts.length > 0) {
                const lastPost = pagePosts[pagePosts.length - 1]
                nextCursor = JSON.stringify({
                    lastScore: lastPost.score,
                    lastPostId: lastPost.id,
                })
            }

            functions.logger.info(
                `[getRecommendedFeed] User ${userId}: ${socialPosts.length} social, ` +
                    `${cityPosts.length} city trending, ${pagePosts.length} returned (page ${startIndex / pageSize})`
            )

            return { posts: pagePosts, nextCursor, hasMore }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) throw error
            functions.logger.error('Error getting recommended feed:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to get recommended feed'
            )
        }
    })
