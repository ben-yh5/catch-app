/**
 * SavesContext — one snapshot listener over `users/{uid}/saves` hydrates a
 * Set of saved post ids, so every surface renders bookmark state with an
 * O(1) lookup (this replaced the per-post `isPostSaved` query).
 *
 * Toggling writes straight to Firestore; latency compensation makes the
 * snapshot fire immediately from the local write, so the UI is optimistic
 * without a manual override layer.
 */

import { useAuth } from '@/context/AuthContext'
import { savePost, subscribeSaves, unsavePost } from '@/services/saves'
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from 'react'

interface SavesContextValue {
    savedIds: Set<string>
    /** False until the first snapshot arrives (or when signed out) */
    ready: boolean
    isSaved: (postId: string) => boolean
    toggleSave: (postId: string) => Promise<void>
}

const SavesContext = createContext<SavesContextValue>({
    savedIds: new Set(),
    ready: false,
    isSaved: () => false,
    toggleSave: async () => {},
})

export function SavesProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth()
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
    const [ready, setReady] = useState(false)
    // Ref mirror so toggleSave reads the live set, not a stale closure
    const savedIdsRef = useRef(savedIds)
    savedIdsRef.current = savedIds

    useEffect(() => {
        if (!user) {
            setSavedIds(new Set())
            setReady(false)
            return
        }

        const unsubscribe = subscribeSaves(user.uid, (ids) => {
            setSavedIds(ids)
            setReady(true)
        })

        return unsubscribe
    }, [user])

    const isSaved = useCallback(
        (postId: string) => savedIds.has(postId),
        [savedIds]
    )

    const toggleSave = useCallback(
        async (postId: string) => {
            if (!user) return
            if (savedIdsRef.current.has(postId)) {
                await unsavePost(user.uid, postId)
            } else {
                await savePost(user.uid, postId)
            }
        },
        [user]
    )

    return (
        <SavesContext.Provider value={{ savedIds, ready, isSaved, toggleSave }}>
            {children}
        </SavesContext.Provider>
    )
}

export function useSaves() {
    return useContext(SavesContext)
}
