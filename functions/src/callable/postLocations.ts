import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { distanceBetween, geohashQueryBounds } from 'geofire-common'
import {
    GEOHASH_QUERY_LIMIT,
    MAX_AREA_RESULTS,
    MAX_INSTANCES,
} from '../lib/constants'

/**
 * HTTPS Callable Function: Retrieves coordinates for a single post
 *
 * Used for map pins and providing directions. Unlike validateCatch, this function
 * returns the actual coordinates since they're needed for display.
 *
 * @param data.postId - The ID of the post
 * @returns Object with postId, latitude, and longitude
 */
export const getPostLocation = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to get post location'
            )
        }

        const { postId } = data

        if (!postId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Missing required field: postId'
            )
        }

        try {
            const postRef = admin.firestore().collection('posts').doc(postId)
            const postDoc = await postRef.get()

            if (!postDoc.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'Post not found'
                )
            }

            const postData = postDoc.data()

            if (!postData?.hasLocation) {
                throw new functions.https.HttpsError(
                    'failed-precondition',
                    'Post has no location data'
                )
            }

            const locationQuery = await admin
                .firestore()
                .collection('post_locations')
                .where('postId', '==', postId)
                .limit(1)
                .get()

            if (locationQuery.empty) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'Location data not found'
                )
            }

            const locationData = locationQuery.docs[0].data()
            const { latitude, longitude } = locationData

            return {
                postId,
                latitude,
                longitude,
                heading: locationData.heading, // Optional
                pitch: locationData.pitch, // Optional
            }
        } catch (error: any) {
            functions.logger.error('Error getting post location:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to get post location'
            )
        }
    })

/**
 * HTTPS Callable Function: Retrieves coordinates for multiple posts at once
 *
 * Optimized for map views where multiple post locations need to be displayed.
 * Uses batched Firestore queries to work around the 'in' operator's 10-item limit.
 *
 * @param data.postIds - Array of post IDs (max 500)
 * @returns Object containing array of locations with postId, latitude, longitude
 */
export const getPostLocations = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to get post locations'
            )
        }

        const { postIds } = data

        if (!postIds || !Array.isArray(postIds)) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'postIds must be an array'
            )
        }

        if (postIds.length === 0) {
            return { locations: [] }
        }

        if (postIds.length > 500) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Cannot fetch more than 500 post locations at once'
            )
        }

        try {
            const locations: {
                postId: string
                latitude: number
                longitude: number
                heading?: number
                pitch?: number
            }[] = []

            // Firestore 'in' queries are limited to 10 items, so batch the requests
            const batchSize = 10
            for (let i = 0; i < postIds.length; i += batchSize) {
                const batch = postIds.slice(i, i + batchSize)

                const locationQuery = await admin
                    .firestore()
                    .collection('post_locations')
                    .where('postId', 'in', batch)
                    .get()

                locationQuery.docs.forEach((doc) => {
                    const locationData = doc.data()
                    locations.push({
                        postId: locationData.postId,
                        latitude: locationData.latitude,
                        longitude: locationData.longitude,
                        heading: locationData.heading, // Optional
                        pitch: locationData.pitch, // Optional
                    })
                })
            }

            return { locations }
        } catch (error: any) {
            functions.logger.error('Error getting post locations:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to get post locations'
            )
        }
    })

// backfillGeohashes: REMOVED — one-time migration completed, unauthenticated HTTP endpoint was a security risk

/**
 * HTTPS Callable Function: Get posts within a map viewport or circular radius
 *
 * Supports two query modes:
 * 1. Bounding box (map viewport): north, south, east, west
 * 2. Circular radius: centerLat, centerLng, radiusInMeters
 *
 * @param data.north - Northern latitude (if using bounds)
 * @param data.south - Southern latitude (if using bounds)
 * @param data.east - Eastern longitude (if using bounds)
 * @param data.west - Western longitude (if using bounds)
 * @param data.centerLat - Center latitude (if using radius)
 * @param data.centerLng - Center longitude (if using radius)
 * @param data.radiusInMeters - Radius in meters (if using radius)
 * @returns Object with posts array and count
 */
export const getPostsInArea = functions
    .runWith({ maxInstances: MAX_INSTANCES.EXPENSIVE })
    .https.onCall(async (data, context) => {
        // Authentication check
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'User must be authenticated to fetch post locations'
            )
        }

        const db = admin.firestore()

        try {
            let postLocations: any[] = []

            // OPTION A: Query by radius (circular area)
            if (data.centerLat && data.centerLng && data.radiusInMeters) {
                const center: [number, number] = [
                    data.centerLat,
                    data.centerLng,
                ]

                // Validate and cap radius to prevent massive geohash fan-out
                if (data.radiusInMeters <= 0) {
                    throw new functions.https.HttpsError(
                        'invalid-argument',
                        'Radius must be greater than 0'
                    )
                }
                const radiusInM = Math.min(data.radiusInMeters, 100000)

                // Validate coordinate ranges
                if (
                    data.centerLat < -90 ||
                    data.centerLat > 90 ||
                    data.centerLng < -180 ||
                    data.centerLng > 180
                ) {
                    throw new functions.https.HttpsError(
                        'invalid-argument',
                        'Coordinates out of valid range'
                    )
                }

                // Get geohash ranges that cover this circular area
                const bounds = geohashQueryBounds(center, radiusInM)

                functions.logger.info(
                    `Querying ${bounds.length} geohash ranges for radius ${radiusInM}m`
                )

                // Execute queries in parallel (with per-query limit to prevent abuse)
                const promises = bounds.map(([start, end]) => {
                    return db
                        .collection('post_locations')
                        .where('geohash', '>=', start)
                        .where('geohash', '<=', end)
                        .limit(GEOHASH_QUERY_LIMIT)
                        .get()
                })

                const snapshots = await Promise.all(promises)

                // Combine all results
                const allResults: any[] = []
                snapshots.forEach((snapshot) => {
                    snapshot.docs.forEach((doc) => {
                        const locationData = doc.data()
                        allResults.push({
                            postId: locationData.postId,
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            geohash: locationData.geohash,
                            heading: locationData.heading, // Optional
                            pitch: locationData.pitch, // Optional
                        })
                    })
                })

                // Filter to exact distance (geohash gives us a rectangle, we want a circle)
                postLocations = allResults.filter((location) => {
                    const distance = distanceBetween(center, [
                        location.latitude,
                        location.longitude,
                    ])
                    return distance <= radiusInM
                })

                // Cap total results
                if (postLocations.length > MAX_AREA_RESULTS) {
                    postLocations = postLocations.slice(0, MAX_AREA_RESULTS)
                }

                functions.logger.info(
                    `Found ${allResults.length} posts in geohash bounds, ${postLocations.length} returned (max ${MAX_AREA_RESULTS})`
                )
            }

            // OPTION B: Query by bounding box (map viewport)
            else if (
                data.north !== undefined &&
                data.south !== undefined &&
                data.east !== undefined &&
                data.west !== undefined
            ) {
                // Validate viewport bounds
                if (data.north < data.south) {
                    throw new functions.https.HttpsError(
                        'invalid-argument',
                        'North must be greater than south'
                    )
                }
                if (
                    data.north < -90 ||
                    data.north > 90 ||
                    data.south < -90 ||
                    data.south > 90 ||
                    data.east < -180 ||
                    data.east > 180 ||
                    data.west < -180 ||
                    data.west > 180
                ) {
                    throw new functions.https.HttpsError(
                        'invalid-argument',
                        'Coordinates out of valid range'
                    )
                }

                // Calculate center point and approximate radius from bounds
                const centerLat = (data.north + data.south) / 2
                const centerLng = (data.east + data.west) / 2

                // Calculate diagonal distance as radius (ensures we cover entire viewport)
                const rawRadiusInM =
                    distanceBetween(
                        [data.south, data.west],
                        [data.north, data.east]
                    ) / 2

                // Cap at 100km to prevent massive geohash fan-out at low zoom levels
                const radiusInM = Math.min(rawRadiusInM, 100000)

                functions.logger.info(
                    `Viewport center: ${centerLat}, ${centerLng}, radius: ${radiusInM}m${rawRadiusInM > 100000 ? ` (capped from ${Math.round(rawRadiusInM)}m)` : ''}`
                )

                // Use same geohash query approach
                const center: [number, number] = [centerLat, centerLng]
                const bounds = geohashQueryBounds(center, radiusInM)

                const promises = bounds.map(([start, end]) => {
                    return db
                        .collection('post_locations')
                        .where('geohash', '>=', start)
                        .where('geohash', '<=', end)
                        .limit(GEOHASH_QUERY_LIMIT)
                        .get()
                })

                const snapshots = await Promise.all(promises)

                const allResults: any[] = []
                snapshots.forEach((snapshot) => {
                    snapshot.docs.forEach((doc) => {
                        const locationData = doc.data()
                        allResults.push({
                            postId: locationData.postId,
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            geohash: locationData.geohash,
                        })
                    })
                })

                // Filter to exact bounding box
                postLocations = allResults.filter((location) => {
                    return (
                        location.latitude >= data.south &&
                        location.latitude <= data.north &&
                        location.longitude >= data.west &&
                        location.longitude <= data.east
                    )
                })

                // Cap total results
                if (postLocations.length > MAX_AREA_RESULTS) {
                    postLocations = postLocations.slice(0, MAX_AREA_RESULTS)
                }

                functions.logger.info(
                    `Found ${allResults.length} posts in geohash bounds, ${postLocations.length} returned (max ${MAX_AREA_RESULTS})`
                )
            } else {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'Must provide either (centerLat, centerLng, radiusInMeters) or (north, south, east, west)'
                )
            }

            // Optional: enrich locations with post summary data
            // filterOriginal implies includeSummary (need post data to filter)
            const shouldEnrich = data.includeSummary || data.filterOriginal

            if (shouldEnrich && postLocations.length > 0) {
                const postIds = postLocations.map((loc: any) => loc.postId)
                const postRefs = postIds.map((id: string) =>
                    db.collection('posts').doc(id)
                )

                // Batch fetch post documents using admin SDK getAll (chunks of 100, parallel)
                const ENRICH_BATCH_SIZE = 100
                const postDataMap = new Map<string, any>()

                const chunks: FirebaseFirestore.DocumentReference[][] = []
                for (let i = 0; i < postRefs.length; i += ENRICH_BATCH_SIZE) {
                    chunks.push(postRefs.slice(i, i + ENRICH_BATCH_SIZE))
                }
                const batchResults = await Promise.all(
                    chunks.map((chunk) => db.getAll(...chunk))
                )
                for (const snapshots of batchResults) {
                    snapshots.forEach((snap) => {
                        if (snap.exists) {
                            postDataMap.set(snap.id, snap.data())
                        }
                    })
                }

                // Attach summaries to location data
                postLocations = postLocations
                    .map((loc: any) => {
                        const postData = postDataMap.get(loc.postId)
                        if (!postData) return null // Post deleted between queries

                        return {
                            ...loc,
                            summary: {
                                id: loc.postId,
                                authorId: postData.authorId,
                                authorUsername: postData.authorUsername,
                                caption: postData.caption || '',
                                photoURL: postData.photoURL,
                                thumbnailURL: postData.thumbnailURL || null,
                                catchCount: postData.catchCount || 0,
                                createdAt:
                                    postData.createdAt?.toMillis?.() ?? null,
                                isOriginal: postData.isOriginal ?? true,
                                isPioneer: postData.isPioneer || false,
                                lastCaughtAt:
                                    postData.lastCaughtAt?.toMillis?.() ?? null,
                            },
                        }
                    })
                    .filter((loc: any) => loc !== null)

                // Server-side isOriginal filter
                if (data.filterOriginal) {
                    postLocations = postLocations.filter(
                        (loc: any) => loc.summary?.isOriginal === true
                    )
                }

                functions.logger.info(
                    `Enriched ${postLocations.length} posts with summaries`
                )
            }

            return {
                posts: postLocations,
                count: postLocations.length,
            }
        } catch (error: any) {
            functions.logger.error('Error querying posts in area:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Error querying posts in area'
            )
        }
    })
