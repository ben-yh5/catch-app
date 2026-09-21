import { useToast } from '@/components/ui/Toast'
import { useListSheet } from '@/context/ListSheetContext'
import { useSaves } from '@/context/SavesContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, TouchableOpacity, ViewStyle } from 'react-native'

interface SaveBookmarkProps {
    postId: string
    size?: number
    /** 'overlay' = dark circle for use on top of photos; 'inline' = bare icon */
    variant?: 'overlay' | 'inline'
    containerStyle?: ViewStyle
}

/**
 * One-tap save bookmark, state driven by SavesContext (O(1) lookup, live
 * across every surface). Renders nothing until the saves snapshot is ready
 * (e.g. signed out, or under test without a provider).
 */
export default function SaveBookmark({
    postId,
    size = 18,
    variant = 'overlay',
    containerStyle,
}: SaveBookmarkProps) {
    const { ready, saveState, toggleSave } = useSaves()
    const { openListSheet } = useListSheet()
    const { showToast } = useToast()
    if (!ready) return null

    // Filled = in the unfiled Saved pile. A shot filed into a list shows
    // an empty bookmark — the list is where it lives now, and tapping
    // routes to the sheet instead of double-tracking it in the pile.
    const state = saveState(postId)
    const inPile = state === 'pile'
    const handleTap = async () => {
        if (state === 'filed') {
            showToast('info', 'Saved in a list', undefined, undefined, {
                label: 'Manage',
                onPress: () => openListSheet(postId),
            })
            return
        }
        try {
            await toggleSave(postId)
            // Organize later, optionally: the list picker hides behind a
            // long-press, so a fresh save offers the route in explicitly
            if (state === 'none') {
                showToast('success', 'Saved', undefined, undefined, {
                    label: 'Add to list',
                    onPress: () => openListSheet(postId),
                })
            }
        } catch (error) {
            console.error('Error toggling save:', error)
            showToast('error', "Couldn't save", 'Check your connection.')
        }
    }
    return (
        <TouchableOpacity
            onPress={handleTap}
            // Shortcut: hold to file straight into a list without opening
            // the post
            onLongPress={() => openListSheet(postId)}
            style={[
                variant === 'overlay' ? styles.overlay : styles.inline,
                containerStyle,
            ]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={
                inPile
                    ? 'Unsave shot'
                    : state === 'filed'
                      ? 'Saved in a list'
                      : 'Save shot'
            }
            accessibilityHint="Long press to add to a list"
        >
            <Ionicons
                name={inPile ? 'bookmark' : 'bookmark-outline'}
                size={size}
                color={
                    inPile
                        ? colors.iconActive
                        : variant === 'overlay'
                          ? colors.white
                          : colors.iconInactive
                }
            />
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    overlay: {
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        borderRadius: 16,
        padding: 6,
    },
    inline: {
        padding: 2,
    },
})
