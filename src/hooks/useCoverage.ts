import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { usePostEvents } from '@/context/PostContext'
import { MapBounds } from '@/utils/geospatialQueries'
import {
    CoverageMode,
    coverageCellsToGeoJSON,
    getGlobalCoverage,
    getUserCoverage,
    invalidateUserCoverageCache,
    userCoverageToGeoJSON,
} from '@/utils/coverageQueries'

export { CoverageMode } from '@/utils/coverageQueries'

function getPrecisionForZoom(zoom: number): number | null {
    if (zoom < 10) return 5
    if (zoom < 13) return 6
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
