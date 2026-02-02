/**
 * PostContext - Event-based post state management
 *
 * Provides a lightweight event system for coordinating post updates across screens
 * without causing unnecessary re-renders. Uses ref-based event listeners to avoid
 * triggering context consumers when events are emitted.
 *
 * Key Features:
 * - Event-based notifications (create, delete, update, catch)
 * - Ref-based listeners to prevent re-renders
 * - Per-screen staleness tracking
 * - Backward compatible refresh flag
 *
 * Migration: Prefer notifyPostEvent() over triggerRefresh() for new code
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState
} from 'react'

import { Post } from '@/types'

type PostAction = 'create' | 'delete' | 'update' | 'catch'
type PostEvent = {
    action: PostAction
    postId?: string
    userId?: string
    timestamp: number
}

interface PostContextType {
    shouldRefresh: boolean
    triggerRefresh: () => void
    notifyPostEvent: (action: PostAction, postId?: string, userId?: string) => void
    subscribeToPostEvents: (callback: (event: PostEvent) => void) => () => void
    updateLastFetch: (screen: 'explore' | 'profile' | 'saved') => void
    getLastFetch: (screen: 'explore' | 'profile' | 'saved') => number
    isStale: (screen: 'explore' | 'profile' | 'saved') => boolean
    // Data Caching
    getCachedPosts: (ids: string[]) => { found: Post[], missing: string[] }
    cachePosts: (posts: Post[]) => void
}

const PostContext = createContext<PostContextType | undefined>(undefined)

/** Time threshold for considering cached data stale (2 minutes) */
const STALE_THRESHOLD = 2 * 60 * 1000

export const PostProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [shouldRefresh, setShouldRefresh] = useState(false)
    const [lastFetchTimes, setLastFetchTimes] = useState<{
        explore: number
        profile: number
        saved: number
    }>({
        explore: Date.now(),
        profile: Date.now(),
        saved: Date.now(),
    })



    // In-memory post cache
    const postCacheRef = useRef<Map<string, { data: Post, timestamp: number }>>(new Map())
    const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

    // Use ref to avoid re-renders when listeners change
    const eventListenersRef = useRef<Set<(event: PostEvent) => void>>(new Set())

    /**
     * Legacy refresh trigger - prefer notifyPostEvent() for new code
     */
    const triggerRefresh = useCallback(() => {
        setShouldRefresh(true)
    }, [])

    /**
     * Emit a post event to all subscribers without causing re-renders
     * This is the preferred way to notify screens of post changes
     */
    const notifyPostEvent = useCallback((action: PostAction, postId?: string, userId?: string) => {
        const event: PostEvent = {
            action,
            postId,
            userId,
            timestamp: Date.now(),
        }

        // Notify all listeners without causing re-renders
        eventListenersRef.current.forEach(listener => {
            try {
                listener(event)
            } catch (error) {
                console.error('Error in post event listener:', error)
            }
        })
    }, [])

    /**
     * Subscribe to post events
     * Returns unsubscribe function for cleanup
     */
    const subscribeToPostEvents = useCallback((callback: (event: PostEvent) => void) => {
        eventListenersRef.current.add(callback)

        return () => {
            eventListenersRef.current.delete(callback)
        }
    }, [])

    const updateLastFetch = useCallback(
        (screen: 'explore' | 'profile' | 'saved') => {
            setLastFetchTimes((prev) => ({
                ...prev,
                [screen]: Date.now(),
            }))
        },
        []
    )

    const getLastFetch = useCallback(
        (screen: 'explore' | 'profile' | 'saved') => {
            return lastFetchTimes[screen]
        },
        [lastFetchTimes]
    )

    const isStale = useCallback(
        (screen: 'explore' | 'profile' | 'saved') => {
            const lastFetch = lastFetchTimes[screen]
            return Date.now() - lastFetch > STALE_THRESHOLD
        },
        [lastFetchTimes]

    )

    /**
     * Retrieve posts from cache, filtering out stale items
     */
    const getCachedPosts = useCallback((ids: string[]) => {
        const found: Post[] = []
        const missing: string[] = []
        const now = Date.now()

        ids.forEach(id => {
            const cached = postCacheRef.current.get(id)
            if (cached && (now - cached.timestamp < CACHE_TTL)) {
                found.push(cached.data)
            } else {
                missing.push(id)
            }
        })

        return { found, missing }
    }, [])

    /**
     * Add or update posts in the cache
     */
    const cachePosts = useCallback((posts: Post[]) => {
        const now = Date.now()
        posts.forEach(post => {
            postCacheRef.current.set(post.id, {
                data: post,
                timestamp: now
            })
        })
    }, [])

    // Auto-clear the refresh flag after a short delay to allow all screens to process it
    useEffect(() => {
        if (shouldRefresh) {
            const timeout = setTimeout(() => {
                setShouldRefresh(false)
            }, 500)
            return () => clearTimeout(timeout)
        }
    }, [shouldRefresh])

    return (
        <PostContext.Provider
            value={{
                shouldRefresh,
                triggerRefresh,
                notifyPostEvent,
                subscribeToPostEvents,
                updateLastFetch,
                getLastFetch,
                isStale,
                getCachedPosts,
                cachePosts,
            }}
        >
            {children}
        </PostContext.Provider>
    )
}


/**
 * Hook to subscribe to post events without causing re-renders
 *
 * Example usage:
 * ```
 * usePostEvents((event) => {
 *   if (event.action === 'delete') {
 *     setPosts(prev => prev.filter(p => p.id !== event.postId))
 *   }
 * }, [])
 * ```
 *
 * @param callback Function to call when a post event occurs
 * @param deps Dependencies array for the callback
 */
/**
 * Hook to access post context
 * Must be used within a PostProvider
 */
export const usePost = () => {
    const context = useContext(PostContext)
    if (context === undefined) {
        throw new Error('usePost must be used within a PostProvider')
    }
    return context
}

export const usePostEvents = (
    callback: (event: PostEvent) => void,
    deps: React.DependencyList = []
) => {
    const { subscribeToPostEvents } = usePost()

    useEffect(() => {
        const unsubscribe = subscribeToPostEvents(callback)
        return unsubscribe
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subscribeToPostEvents, ...deps])
}

export type { PostAction, PostEvent }

