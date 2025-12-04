import React, {
    createContext,
    useState,
    useContext,
    useCallback,
    useEffect,
    useRef,
} from 'react'

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
}

const PostContext = createContext<PostContextType | undefined>(undefined)

const STALE_THRESHOLD = 2 * 60 * 1000 // 2 min in milliseconds

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

    // Use ref to avoid re-renders when listeners change
    const eventListenersRef = useRef<Set<(event: PostEvent) => void>>(new Set())

    const triggerRefresh = useCallback(() => {
        setShouldRefresh(true)
    }, [])

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

    const subscribeToPostEvents = useCallback((callback: (event: PostEvent) => void) => {
        eventListenersRef.current.add(callback)

        // Return unsubscribe function
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
            }}
        >
            {children}
        </PostContext.Provider>
    )
}

export const usePost = () => {
    const context = useContext(PostContext)
    if (context === undefined) {
        throw new Error('usePost must be used within a PostProvider')
    }
    return context
}

/**
 * Hook to subscribe to specific post events without causing re-renders
 * @param callback Function to call when a post event occurs
 * @param deps Dependencies array for the callback
 */
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

// Export type for use in components
export type { PostEvent, PostAction }
