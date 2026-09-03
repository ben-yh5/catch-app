import { useAuth } from '@/context/AuthContext'
import { usePostEvents } from '@/context/PostContext'
import { functions } from '@/services/firebase'
import { RecommendedPost } from '@/types'
import { httpsCallable } from 'firebase/functions'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const PAGE_SIZE = 20

interface UseRecommendedFeedReturn {
    posts: RecommendedPost[]
    loading: boolean
    loadingMore: boolean
    hasMore: boolean
    error: boolean
    refresh: () => Promise<void>
    loadMore: () => Promise<void>
}

export function useRecommendedFeed(): UseRecommendedFeedReturn {
    const { user, blockedUserIds } = useAuth()
    const [posts, setPosts] = useState<RecommendedPost[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const [error, setError] = useState(false)
    const cursorRef = useRef<string | null>(null)
    const fetchingRef = useRef(false)

    const fetchFeed = useCallback(
        async (isRefresh: boolean) => {
            if (!user) {
                // No fetch without a user — don't leave the loading spinner up
                setLoading(false)
                return
            }
            if (fetchingRef.current) return
            fetchingRef.current = true
            setError(false)

            if (isRefresh) {
                setLoading(true)
                cursorRef.current = null
            } else {
                setLoadingMore(true)
            }

            try {
                const getRecommendedFeedFn = httpsCallable(
                    functions,
                    'getRecommendedFeed'
                )
                const result = await getRecommendedFeedFn({
                    cursor: isRefresh ? undefined : cursorRef.current,
                    pageSize: PAGE_SIZE,
                })

                const {
                    posts: newPosts,
                    nextCursor,
                    hasMore: more,
                } = result.data as {
                    posts: RecommendedPost[]
                    nextCursor: string | null
                    hasMore: boolean
                }

                if (isRefresh) {
                    setPosts(newPosts)
                } else {
                    setPosts((prev) => {
                        const existingIds = new Set(prev.map((p) => p.id))
                        const uniqueNew = newPosts.filter(
                            (p) => !existingIds.has(p.id)
                        )
                        return [...prev, ...uniqueNew]
                    })
                }

                cursorRef.current = nextCursor
                setHasMore(more)
            } catch (error) {
                console.error('Error fetching recommended feed:', error)
                setError(true)
            } finally {
                setLoading(false)
                setLoadingMore(false)
                fetchingRef.current = false
            }
        },
        [user]
    )

    // Initial fetch
    useEffect(() => {
        fetchFeed(true)
    }, [fetchFeed])

    // Remove deleted posts locally
    usePostEvents((event) => {
        if (event.action === 'delete' && event.postId) {
            setPosts((prev) => prev.filter((p) => p.id !== event.postId))
        }
    }, [])

    const refresh = useCallback(() => fetchFeed(true), [fetchFeed])
    const loadMore = useCallback(() => {
        if (hasMore && !loadingMore && !loading) {
            return fetchFeed(false)
        }
        return Promise.resolve()
    }, [fetchFeed, hasMore, loadingMore, loading])

    // Hide blocked users' posts — filtered reactively so a new block takes
    // effect immediately without a re-fetch
    const filteredPosts = useMemo(() => {
        if (blockedUserIds.length === 0) return posts
        const blocked = new Set(blockedUserIds)
        return posts.filter((p) => !blocked.has(p.authorId))
    }, [posts, blockedUserIds])

    return { posts: filteredPosts, loading, loadingMore, hasMore, error, refresh, loadMore }
}
