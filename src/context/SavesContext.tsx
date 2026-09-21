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

/**
 * 'pile'  — bookmarked, in the unfiled Saved pile (bookmark renders filled)
 * 'filed' — save doc exists but every copy lives in lists (bookmark empty;
 *           managed through the list sheet, not the bookmark toggle)
 * 'none'  — not saved anywhere
 */
export type SaveState = 'none' | 'pile' | 'filed'

interface SavesContextValue {
    savedIds: Set<string>
    /** Saves with no list tags — the unfiled "Saved" pile (inbox model) */
    unfiledIds: Set<string>
    /** False until the first snapshot arrives (or when signed out) */
    ready: boolean
    /** True for any save, filed or not (map glyphs, "is this mine") */
    isSaved: (postId: string) => boolean
    saveState: (postId: string) => SaveState
    toggleSave: (postId: string) => Promise<void>
}

const SavesContext = createContext<SavesContextValue>({
    savedIds: new Set(),
    unfiledIds: new Set(),
    ready: false,
    isSaved: () => false,
    saveState: () => 'none',
    toggleSave: async () => {},
})

export function SavesProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth()
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
    const [unfiledIds, setUnfiledIds] = useState<Set<string>>(new Set())
    const [ready, setReady] = useState(false)
    // Ref mirrors so toggleSave reads the live sets, not stale closures
    const savedIdsRef = useRef(savedIds)
    savedIdsRef.current = savedIds
    const unfiledIdsRef = useRef(unfiledIds)
    unfiledIdsRef.current = unfiledIds

    useEffect(() => {
        if (!user) {
            setSavedIds(new Set())
            setUnfiledIds(new Set())
            setReady(false)
            return
        }

        const unsubscribe = subscribeSaves(user.uid, (ids, unfiled) => {
            setSavedIds(ids)
            setUnfiledIds(unfiled)
            setReady(true)
        })

        return unsubscribe
    }, [user])

    const isSaved = useCallback(
        (postId: string) => savedIds.has(postId),
        [savedIds]
    )

    const saveState = useCallback(
        (postId: string): SaveState => {
            if (unfiledIds.has(postId)) return 'pile'
            if (savedIds.has(postId)) return 'filed'
            return 'none'
        },
        [savedIds, unfiledIds]
    )

    const toggleSave = useCallback(
        async (postId: string) => {
            if (!user) return
            const saved = savedIdsRef.current.has(postId)
            // A filed save is managed through the list sheet. Toggling it
            // here would either delete the doc (orphaning the list-tag
            // mirror) or overwrite listIds — callers route filed taps to
            // the sheet instead.
            if (saved && !unfiledIdsRef.current.has(postId)) {
                console.warn('[saves] toggleSave ignored for filed save')
                return
            }
            if (saved) {
                await unsavePost(user.uid, postId)
            } else {
                await savePost(user.uid, postId)
            }
        },
        [user]
    )

    return (
        <SavesContext.Provider
            value={{
                savedIds,
                unfiledIds,
                ready,
                isSaved,
                saveState,
                toggleSave,
            }}
        >
            {children}
        </SavesContext.Provider>
    )
}

export function useSaves() {
    return useContext(SavesContext)
}
