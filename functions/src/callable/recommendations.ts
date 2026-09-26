import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import {
    distanceBetween,
    geohashForLocation,
    geohashQueryBounds,
} from 'geofire-common'
import { GEOHASH_QUERY_LIMIT, MAX_INSTANCES } from '../lib/constants'

// ─── Recommendation System ──────────────────────────────────────────────────

/** Maximum active cities per user */
const MAX_ACTIVE_CITIES = 10

/** Cities within this distance are considered duplicates */
const CITY_DEDUP_RADIUS_KM = 50

/** How long a searched city stays active (days) */
const CITY_EXPIRY_DAYS = 30

/** Radius for the "Near you" source (meters) */
const NEARBY_RADIUS_METERS = 25000

/** Max following IDs per Firestore 'in' query */
const FOLLOWING_BATCH_SIZE = 30

/** Length of the For You list — finite on purpose, no pagination */
const FEED_SIZE = 50

/** Recent posts read per followed-users batch */
const SOCIAL_FETCH_LIMIT = 50

/** Recent saves scanned for the cities a user is planning */
const SAVES_SCAN_LIMIT = 50

/** Saved cities sourced per request (most recently saved first) */
const MAX_SAVED_CITIES = 3

/** Top places per saved city */
const CITY_FETCH_LIMIT = 20

/** Longest run of consecutive cards from one author */
const MAX_AUTHOR_RUN = 2

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

type ReasonType = 'social' | 'nearby' | 'saved_city'

interface Reason {
    reasonType: ReasonType
    reasonLabel: string
}

/**
 * HTTPS Callable Function: Returns the For You list
 *
 * Deliberately simple: gather candidate places from three sources, drop what
 * the user shouldn't see, sort everything by the root post's hotScore, and
 * return one finite list (no cursor — the list ends).
 *
 * Sources (a place found by several keeps the first reason, in this order):
 * 1. Social — recent posts by followed users. A friend's catch surfaces its
 *    thread root with "@jane caught this"; catches are never separate cards.
 * 2. Near you — roots within NEARBY_RADIUS_METERS of the optional location.
 * 3. Saved cities — top places in the cities of the user's recent saves.
 *
 * Excluded: the user's own posts, places they've already caught, and
 * authors they've blocked.
 *
 * @param data.latitude - Optional coarse user latitude (enables "Near you")
 * @param data.longitude - Optional coarse user longitude
 * @returns { posts } — up to FEED_SIZE root posts with reason labels
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
        const hasLocation =
            data?.latitude !== undefined || data?.longitude !== undefined
        if (hasLocation) {
            const { latitude, longitude } = data
            if (
                typeof latitude !== 'number' ||
                latitude < -90 ||
                latitude > 90 ||
                typeof longitude !== 'number' ||
                longitude < -180 ||
                longitude > 180
            ) {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'latitude/longitude must both be valid coordinates'
                )
            }
        }

        const db = admin.firestore()
        const postsCol = db.collection('posts')

        try {
            const userDoc = await db.collection('users').doc(userId).get()
            if (!userDoc.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'User not found'
                )
            }
            const following: string[] = userDoc.data()?.following || []
            const blocked = new Set<string>(
                userDoc.data()?.blockedUsers || []
            )

            // ── Candidate sources (run in parallel) ──

            const caughtRootsP = postsCol
                .where('authorId', '==', userId)
                .where('isOriginal', '==', false)
                .get()
                .then(
                    (snap) =>
                        new Set<string>(
                            snap.docs
                                .map((d) => d.data().rootPostId)
                                .filter(Boolean)
                        )
                )

            const socialP = (async () => {
                const reasons = new Map<string, Reason>()
                const batches: string[][] = []
                for (let i = 0; i < following.length; i += FOLLOWING_BATCH_SIZE) {
                    batches.push(following.slice(i, i + FOLLOWING_BATCH_SIZE))
                }
                const snaps = await Promise.all(
                    batches.map((batch) =>
                        postsCol
                            .where('authorId', 'in', batch)
                            .orderBy('createdAt', 'desc')
                            .limit(SOCIAL_FETCH_LIMIT)
                            .get()
                    )
                )
                const docs = snaps
                    .flatMap((snap) => snap.docs)
                    .sort(
                        (a, b) =>
                            b.createTime.toMillis() - a.createTime.toMillis()
                    )
                // Newest first, so a root keeps its most recent social reason
                for (const doc of docs) {
                    const post = doc.data()
                    const rootId = post.isOriginal ? doc.id : post.rootPostId
                    if (!rootId || reasons.has(rootId)) continue
                    reasons.set(rootId, {
                        reasonType: 'social',
                        reasonLabel: post.isOriginal
                            ? `Posted by @${post.authorUsername}`
                            : `@${post.authorUsername} caught this`,
                    })
                }
                return reasons
            })()

            const nearbyP = (async () => {
                const ids: string[] = []
                if (!hasLocation) return ids
                const center: [number, number] = [data.latitude, data.longitude]
                const snaps = await Promise.all(
                    geohashQueryBounds(center, NEARBY_RADIUS_METERS).map(
                        ([start, end]) =>
                            db
                                .collection('post_locations')
                                .where('geohash', '>=', start)
                                .where('geohash', '<=', end)
                                .limit(GEOHASH_QUERY_LIMIT)
                                .get()
                    )
                )
                for (const snap of snaps) {
                    for (const doc of snap.docs) {
                        const loc = doc.data()
                        // distanceBetween returns km
                        const km = distanceBetween(center, [
                            loc.latitude,
                            loc.longitude,
                        ])
                        if (km <= NEARBY_RADIUS_METERS / 1000) ids.push(loc.postId)
                    }
                }
                return ids
            })()

            const savedCityP = (async () => {
                const reasons = new Map<string, Reason>()
                const savesSnap = await db
                    .collection('users')
                    .doc(userId)
                    .collection('saves')
                    .orderBy('savedAt', 'desc')
                    .limit(SAVES_SCAN_LIMIT)
                    .get()
                if (savesSnap.empty) return reasons

                const savedPosts = await db.getAll(
                    ...savesSnap.docs.map((d) => postsCol.doc(d.id))
                )
                // Distinct cities in most-recently-saved order
                const cities: { country: string; city: string }[] = []
                const seen = new Set<string>()
                for (const snap of savedPosts) {
                    const post = snap.data()
                    if (!post?.city || !post?.country) continue
                    const key = `${post.country}|${post.city}`
                    if (seen.has(key)) continue
                    seen.add(key)
                    cities.push({ country: post.country, city: post.city })
                    if (cities.length >= MAX_SAVED_CITIES) break
                }

                const citySnaps = await Promise.all(
                    cities.map(({ country, city }) =>
                        postsCol
                            .where('isOriginal', '==', true)
                            .where('country', '==', country)
                            .where('city', '==', city)
                            .orderBy('hotScore', 'desc')
                            .limit(CITY_FETCH_LIMIT)
                            .get()
                    )
                )
                citySnaps.forEach((snap, i) => {
                    for (const doc of snap.docs) {
                        if (reasons.has(doc.id)) continue
                        reasons.set(doc.id, {
                            reasonType: 'saved_city',
                            reasonLabel: `Popular in ${cities[i].city}`,
                        })
                    }
                })
                return reasons
            })()

            const [caughtRoots, social, nearbyIds, savedCity] =
                await Promise.all([caughtRootsP, socialP, nearbyP, savedCityP])

            // ── Merge reasons (social > nearby > saved city) ──
            const reasons = new Map<string, Reason>(social)
            for (const id of nearbyIds) {
                if (!reasons.has(id)) {
                    reasons.set(id, {
                        reasonType: 'nearby',
                        reasonLabel: 'Near you',
                    })
                }
            }
            for (const [id, reason] of savedCity) {
                if (!reasons.has(id)) reasons.set(id, reason)
            }

            // ── Hydrate, filter, rank ──
            const ids = [...reasons.keys()].filter((id) => !caughtRoots.has(id))
            const snaps: admin.firestore.DocumentSnapshot[] = []
            for (let i = 0; i < ids.length; i += 100) {
                const chunk = ids.slice(i, i + 100).map((id) => postsCol.doc(id))
                snaps.push(...(await db.getAll(...chunk)))
            }

            const ranked = snaps
                .filter((snap) => {
                    const post = snap.data()
                    return (
                        post &&
                        post.isOriginal === true &&
                        post.authorId !== userId &&
                        !blocked.has(post.authorId)
                    )
                })
                .sort(
                    (a, b) => (b.get('hotScore') ?? 0) - (a.get('hotScore') ?? 0)
                )

            // Variety: no more than MAX_AUTHOR_RUN consecutive cards from one
            // author — overflow is deferred, not dropped
            const ordered: admin.firestore.DocumentSnapshot[] = []
            let deferred: admin.firestore.DocumentSnapshot[] = []
            const runLength = (authorId: string) => {
                let n = 0
                for (let i = ordered.length - 1; i >= 0; i--) {
                    if (ordered[i].get('authorId') !== authorId) break
                    n++
                }
                return n
            }
            for (const snap of ranked) {
                if (runLength(snap.get('authorId')) >= MAX_AUTHOR_RUN) {
                    deferred.push(snap)
                    continue
                }
                ordered.push(snap)
                // Give deferred cards the first slot their author is allowed
                deferred = deferred.filter((d) => {
                    if (runLength(d.get('authorId')) >= MAX_AUTHOR_RUN) return true
                    ordered.push(d)
                    return false
                })
            }
            ordered.push(...deferred)

            const posts = ordered.slice(0, FEED_SIZE).map((snap) => {
                const post = snap.data()!
                return {
                    id: snap.id,
                    authorId: post.authorId,
                    authorUsername: post.authorUsername,
                    caption: post.caption || '',
                    photoURL: post.photoURL,
                    thumbnailURL: post.thumbnailURL || null,
                    mediumURL: post.mediumURL || null,
                    catchCount: post.catchCount || 0,
                    createdAt: post.createdAt?.toMillis?.() ?? null,
                    lastCaughtAt: post.lastCaughtAt?.toMillis?.() ?? null,
                    isOriginal: true,
                    isPioneer: post.isPioneer || false,
                    hasLocation: post.hasLocation ?? false,
                    parentPostId: null,
                    rootPostId: null,
                    ...reasons.get(snap.id)!,
                }
            })

            functions.logger.info(
                `[getRecommendedFeed] User ${userId}: ${social.size} social, ` +
                    `${nearbyIds.length} nearby, ${savedCity.size} saved-city, ` +
                    `${posts.length} returned`
            )

            return { posts }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) throw error
            functions.logger.error('Error getting recommended feed:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to get recommended feed'
            )
        }
    })
