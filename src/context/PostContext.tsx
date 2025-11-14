import React, {
    createContext,
    useState,
    useContext,
    useCallback,
    useEffect,
} from 'react'

interface PostContextType {
    shouldRefresh: boolean
    triggerRefresh: () => void
    updateLastFetch: (screen: 'explore' | 'profile') => void
    getLastFetch: (screen: 'explore' | 'profile') => number
    isStale: (screen: 'explore' | 'profile') => boolean
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
    }>({
        explore: Date.now(),
        profile: Date.now(),
    })

    const triggerRefresh = useCallback(() => {
        setShouldRefresh(true)
    }, [])

    const updateLastFetch = useCallback(
        (screen: 'explore' | 'profile') => {
            setLastFetchTimes((prev) => ({
                ...prev,
                [screen]: Date.now(),
            }))
        },
        []
    )

    const getLastFetch = useCallback(
        (screen: 'explore' | 'profile') => {
            return lastFetchTimes[screen]
        },
        [lastFetchTimes]
    )

    const isStale = useCallback(
        (screen: 'explore' | 'profile') => {
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
