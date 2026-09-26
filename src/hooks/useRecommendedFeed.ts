import { useAuth } from '@/context/AuthContext'
import { usePostEvents } from '@/context/PostContext'
import { functions } from '@/services/firebase'
import { RecommendedPost } from '@/types'
import * as Location from 'expo-location'
import { httpsCallable } from 'firebase/functions'
import { useCallback, useEffect, useMemo, useState } from 'react'

interface UseRecommendedFeedReturn {
    posts: RecommendedPost[]
    loading: boolean
    error: boolean
    refresh: () => Promise<void>
}

/**
 * Coarse (~1km) last-known position for the "Near you" source. Never
 * prompts — without an existing grant (or a cached fix) the feed simply
 * skips that source. Sent for ranking only; the server doesn't store it.
 */
async function getCoarseLocation(): Promise<
    { latitude: number; longitude: number } | undefined
> {
    const { granted } = await Location.getForegroundPermissionsAsync()
    if (!granted) return undefined
    const fix = await Location.getLastKnownPositionAsync()
    if (!fix) return undefined
    return {
        latitude: Math.round(fix.coords.latitude * 100) / 100,
        longitude: Math.round(fix.coords.longitude * 100) / 100,
    }
}

/**
 * The For You list: one finite, server-ranked list (getRecommendedFeed) —
 * no pagination, it ends.
 */
export function useRecommendedFeed(): UseRecommendedFeedReturn {
    const { user, blockedUserIds } = useAuth()
    const [posts, setPosts] = useState<RecommendedPost[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)

    const fetchFeed = useCallback(async () => {
        if (!user) {
            // No fetch without a user — don't leave the loading spinner up
            setLoading(false)
            return
        }
        setError(false)
        setLoading(true)

        try {
            const getRecommendedFeedFn = httpsCallable(
                functions,
                'getRecommendedFeed'
            )
            const location = await getCoarseLocation()
            const result = await getRecommendedFeedFn(location ?? {})
            setPosts((result.data as { posts: RecommendedPost[] }).posts)
        } catch (error) {
            console.error('Error fetching recommended feed:', error)
            setError(true)
        } finally {
            setLoading(false)
        }
    }, [user])

    // Initial fetch
    useEffect(() => {
        fetchFeed()
    }, [fetchFeed])

    // Remove deleted posts locally
    usePostEvents((event) => {
        if (event.action === 'delete' && event.postId) {
            setPosts((prev) => prev.filter((p) => p.id !== event.postId))
        }
    }, [])

    // Hide blocked users' posts — filtered reactively so a new block takes
    // effect immediately without a re-fetch
    const filteredPosts = useMemo(() => {
        if (blockedUserIds.length === 0) return posts
        const blocked = new Set(blockedUserIds)
        return posts.filter((p) => !blocked.has(p.authorId))
    }, [posts, blockedUserIds])

    return { posts: filteredPosts, loading, error, refresh: fetchFeed }
}
