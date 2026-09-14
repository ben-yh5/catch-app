/**
 * ListSheetContext — one app-level ListSelectionBottomSheet any surface can
 * summon (long-press on a card's bookmark, etc.) without mounting its own.
 *
 * ThreadModal keeps its own local sheet: it renders inside a native Modal,
 * which would sit above a root-mounted sheet.
 */

import ListSelectionBottomSheet from '@/components/ListSelectionBottomSheet'
import React, { createContext, useCallback, useContext, useState } from 'react'

const ListSheetContext = createContext<{
    openListSheet: (postId: string) => void
}>({
    openListSheet: () => {},
})

export function ListSheetProvider({
    children,
}: {
    children: React.ReactNode
}) {
    const [postId, setPostId] = useState<string | null>(null)
    const openListSheet = useCallback((id: string) => setPostId(id), [])

    return (
        <ListSheetContext.Provider value={{ openListSheet }}>
            {children}
            <ListSelectionBottomSheet
                visible={postId !== null}
                postId={postId ?? undefined}
                onClose={() => setPostId(null)}
            />
        </ListSheetContext.Provider>
    )
}

export function useListSheet() {
    return useContext(ListSheetContext)
}
