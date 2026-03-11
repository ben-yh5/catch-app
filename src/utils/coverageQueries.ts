import { geohashQueryBounds, distanceBetween } from 'geofire-common'
import { collection, getDocs, getDoc, doc, query, where } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { MapBounds } from './geospatialQueries'

// --- Types ---

export interface CoverageCell {
    geohash: string
    precision: number
    postCount: number
    bbox: [number, number, number, number] // [minLat, minLon, maxLat, maxLon]
}

export interface UserCoverage {
    cells4: string[]
    cells5: string[]
}

export type CoverageMode = 'off' | 'global' | 'personal'

// --- Geohash Decode ---

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

/**
 * Decode a geohash string into its bounding box.
 * Returns [minLat, minLon, maxLat, maxLon].
 */
export function decodeGeohashBBox(geohash: string): [number, number, number, number] {
    let isLon = true
    let latMin = -90, latMax = 90
    let lonMin = -180, lonMax = 180

    for (const char of geohash) {
        const idx = BASE32.indexOf(char)
        if (idx === -1) continue
        for (let bit = 4; bit >= 0; bit--) {
            const bitVal = (idx >> bit) & 1
            if (isLon) {
                const mid = (lonMin + lonMax) / 2
                if (bitVal) lonMin = mid
                else lonMax = mid
            } else {
                const mid = (latMin + latMax) / 2
                if (bitVal) latMin = mid
                else latMax = mid
            }
            isLon = !isLon
        }
    }

    return [latMin, lonMin, latMax, lonMax]
}

// --- Caching ---

const COVERAGE_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const coverageCache = new Map<string, { data: CoverageCell[]; timestamp: number }>()

function getCoverageCacheKey(bounds: MapBounds, precision: number): string {
    return `cov:${precision}:${bounds.north.toFixed(2)},${bounds.south.toFixed(2)},${bounds.east.toFixed(2)},${bounds.west.toFixed(2)}`
}

let userCoverageCache: { data: UserCoverage; userId: string } | null = null

// --- Global Coverage ---

/**
 * Fetch global coverage cells for a viewport at a given precision.
 * Queries geohash_cells collection directly (no Cloud Function).
 */
export async function getGlobalCoverage(
    bounds: MapBounds,
    precision: number
): Promise<CoverageCell[]> {
    const cacheKey = getCoverageCacheKey(bounds, precision)
    const cached = coverageCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < COVERAGE_CACHE_TTL) {
        return cached.data
    }

    const centerLat = (bounds.north + bounds.south) / 2
    const centerLng = (bounds.east + bounds.west) / 2

    // Calculate radius from center to corner in meters
    const radiusM = distanceBetween(
        [centerLat, centerLng],
        [bounds.north, bounds.east]
    ) * 1000

    // Get geohash bounds covering the viewport
    const ghBounds = geohashQueryBounds([centerLat, centerLng], radiusM)

    // Truncate to target precision and deduplicate ranges
    const seen = new Set<string>()
    const truncatedBounds: [string, string][] = []
    for (const [start, end] of ghBounds) {
        const tStart = start.substring(0, precision)
        const tEnd = end.substring(0, precision)
        const key = `${tStart}:${tEnd}`
        if (!seen.has(key)) {
            seen.add(key)
            truncatedBounds.push([tStart, tEnd])
        }
    }

    const cellsRef = collection(db, 'geohash_cells')
    const results: CoverageCell[] = []

    // Execute range queries in parallel
    const queryPromises = truncatedBounds.map(([start, end]) =>
        getDocs(query(
            cellsRef,
            where('precision', '==', precision),
            where('geohash', '>=', start),
            where('geohash', '<=', end)
        ))
    )
    const snapshots = await Promise.all(queryPromises)

    for (const snapshot of snapshots) {
        snapshot.forEach(docSnap => {
            const data = docSnap.data()
            if (data.postCount > 0) {
                const bbox = decodeGeohashBBox(data.geohash)
                // Filter to viewport bounds
                if (bbox[2] >= bounds.south && bbox[0] <= bounds.north &&
                    bbox[3] >= bounds.west && bbox[1] <= bounds.east) {
                    results.push({
                        geohash: data.geohash,
                        precision: data.precision,
                        postCount: data.postCount,
                        bbox,
                    })
                }
            }
        })
    }

    // Deduplicate (ranges can overlap)
    const uniqueResults = Array.from(
        new Map(results.map(c => [c.geohash, c])).values()
    )

    coverageCache.set(cacheKey, { data: uniqueResults, timestamp: Date.now() })

    // LRU eviction
    if (coverageCache.size > 30) {
        const entries = Array.from(coverageCache.entries())
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
        entries.slice(0, 15).forEach(([key]) => coverageCache.delete(key))
    }

    return uniqueResults
}

// --- User Coverage ---

/**
 * Fetch the current user's coverage data. Cached for session duration.
 */
export async function getUserCoverage(userId: string): Promise<UserCoverage> {
    if (userCoverageCache && userCoverageCache.userId === userId) {
        return userCoverageCache.data
    }

    const docSnap = await getDoc(doc(db, 'user_coverage', userId))
    const coverage: UserCoverage = docSnap.exists()
        ? { cells4: docSnap.data().cells4 || [], cells5: docSnap.data().cells5 || [] }
        : { cells4: [], cells5: [] }

    userCoverageCache = { data: coverage, userId }
    return coverage
}

export function invalidateUserCoverageCache(): void {
    userCoverageCache = null
}

// --- GeoJSON Conversion ---

function cellBBoxToPolygon(bbox: [number, number, number, number]): number[][][] {
    const [minLat, minLon, maxLat, maxLon] = bbox
    // GeoJSON coordinates are [lon, lat]
    return [[
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat], // close ring
    ]]
}

/**
 * Convert global coverage cells to GeoJSON FeatureCollection.
 */
export function coverageCellsToGeoJSON(cells: CoverageCell[]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: cells.map(cell => ({
            type: 'Feature' as const,
            properties: {
                geohash: cell.geohash,
                postCount: cell.postCount,
            },
            geometry: {
                type: 'Polygon' as const,
                coordinates: cellBBoxToPolygon(cell.bbox),
            },
        })),
    }
}

/**
 * Convert user coverage cells to GeoJSON FeatureCollection.
 * Filters to viewport bounds for rendering efficiency.
 */
export function userCoverageToGeoJSON(
    coverage: UserCoverage,
    precision: number,
    bounds?: MapBounds
): GeoJSON.FeatureCollection {
    const cells = precision === 4 ? coverage.cells4 : coverage.cells5

    const features = cells
        .map(geohash => {
            const bbox = decodeGeohashBBox(geohash)
            // Filter to viewport if provided
            if (bounds) {
                if (bbox[2] < bounds.south || bbox[0] > bounds.north ||
                    bbox[3] < bounds.west || bbox[1] > bounds.east) {
                    return null
                }
            }
            return {
                type: 'Feature' as const,
                properties: {
                    geohash,
                    postCount: 1,
                },
                geometry: {
                    type: 'Polygon' as const,
                    coordinates: cellBBoxToPolygon(bbox),
                },
            }
        })
        .filter(Boolean) as GeoJSON.Feature[]

    return {
        type: 'FeatureCollection',
        features,
    }
}
