import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { usePostEvents } from '@/context/PostContext'
import { MapBounds } from '@/utils/geospatialQueries'
import {
    CoverageMode,
    clusterCellsToGeoJSON,
    coverageCellsToGeoJSON,
    getGlobalCoverage,
    getUserCoverage,
    invalidateGlobalCoverageCache,
    invalidateUserCoverageCache,
    userCoverageToGeoJSON,
} from '@/utils/coverageQueries'

export { CoverageMode } from '@/utils/coverageQueries'

/**
 * Below this zoom the map shows cluster bubbles, not pins. Zoom 11 ≈ a
 * city district — pins appear as soon as you're looking at a city, bubbles
 * only for regional/country views. (Was 13, which hid pins even at city
 * zoom and made the default camera show a single bubble.)
 */
export const PIN_MIN_ZOOM = 11

/**
 * Below this zoom nothing loads. Zoom 3 covers a continent — "country
 * level" (~3.5-4.5) must show bubbles or the map reads as empty/broken
 * from exactly the view people zoom out to first. Only a whole-world
 * sweep (zoom < 3) is skipped.
 */
const BUBBLE_MIN_ZOOM = 3

function getPrecisionForZoom(zoom: number): number | null {
    if (zoom < 9) return 5
    if (zoom < PIN_MIN_ZOOM) return 6
    return null // show pins instead
}

interface UseCoverageReturn {
    coverageGeoJSON: GeoJSON.FeatureCollection | null
    isLoading: boolean
    precision: number | null
}

const DEBOUNCE_MS = 600

export function useCoverage(
    bounds: MapBounds | null,
    zoomLevel: number,
    mode: CoverageMode
): UseCoverageReturn {
    const { user } = useAuth()
    const [coverageGeoJSON, setCoverageGeoJSON] =
        useState<GeoJSON.FeatureCollection | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const precision = getPrecisionForZoom(zoomLevel)

    const fetchCoverage = useCallback(async () => {
        if (mode === 'off' || !bounds || precision === null) {
            setCoverageGeoJSON(null)
            return
        }

        setIsLoading(true)
        try {
            if (mode === 'global') {
                const cells = await getGlobalCoverage(bounds, precision)
                setCoverageGeoJSON(coverageCellsToGeoJSON(cells))
            } else if (mode === 'personal' && user) {
                const coverage = await getUserCoverage(user.uid)
                setCoverageGeoJSON(
                    userCoverageToGeoJSON(coverage, precision, bounds)
                )
            }
        } catch (error) {
            console.error('Error fetching coverage:', error)
        } finally {
            setIsLoading(false)
        }
    }, [bounds, precision, mode, user])

    // Debounced fetch on viewport/mode change
    useEffect(() => {
        if (mode === 'off' || precision === null) {
            setCoverageGeoJSON(null)
            return
        }

        if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
        fetchTimeoutRef.current = setTimeout(fetchCoverage, DEBOUNCE_MS)

        return () => {
            if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
        }
    }, [fetchCoverage, mode, precision])

    // Invalidate user coverage cache on post creation
    usePostEvents(
        (event) => {
            if (event.action === 'create' && mode === 'personal') {
                invalidateUserCoverageCache()
                fetchCoverage()
            }
        },
        [mode, fetchCoverage]
    )

    return { coverageGeoJSON, isLoading, precision }
}

/**
 * Cluster bubbles for zooms below the pin threshold: count-per-cell points
 * derived from geohash_cells (originalCount), replacing the pin fetch that
 * used to run there. Always on — unlike the coverage overlay, this isn't a
 * mode the user toggles; it's how the map renders when zoomed out.
 *
 * Shares getGlobalCoverage's per-viewport cache with the coverage overlay.
 */
export function useClusterBubbles(
    bounds: MapBounds | null,
    zoomLevel: number
): { bubblesGeoJSON: GeoJSON.FeatureCollection | null } {
    const [bubblesGeoJSON, setBubblesGeoJSON] =
        useState<GeoJSON.FeatureCollection | null>(null)
    const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const precision =
        zoomLevel < BUBBLE_MIN_ZOOM ? null : getPrecisionForZoom(zoomLevel)

    const fetchBubbles = useCallback(async () => {
        if (!bounds || precision === null) {
            setBubblesGeoJSON(null)
            return
        }
        try {
            const cells = await getGlobalCoverage(bounds, precision)
            setBubblesGeoJSON(clusterCellsToGeoJSON(cells))
        } catch (error) {
            console.error('Error fetching cluster bubbles:', error)
        }
    }, [bounds, precision])

    useEffect(() => {
        if (precision === null) {
            setBubblesGeoJSON(null)
            return
        }
        if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
        fetchTimeoutRef.current = setTimeout(fetchBubbles, DEBOUNCE_MS)
        return () => {
            if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
        }
    }, [fetchBubbles, precision])

    // New/deleted posts change cell counts — drop the cache and refetch
    usePostEvents(
        (event) => {
            if (event.action !== 'create' && event.action !== 'delete') return
            invalidateGlobalCoverageCache()
            fetchBubbles()
        },
        [fetchBubbles]
    )

    return { bubblesGeoJSON }
}
