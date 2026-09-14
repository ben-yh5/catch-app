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
    const { ready, isSaved, toggleSave } = useSaves()
    const { openListSheet } = useListSheet()
    if (!ready) return null

    const saved = isSaved(postId)
    return (
        <TouchableOpacity
            onPress={() =>
                toggleSave(postId).catch((error) =>
                    console.error('Error toggling save:', error)
                )
            }
            // Shortcut: hold to file straight into a list without opening
            // the post (adding to a list implies saving)
            onLongPress={() => openListSheet(postId)}
            style={[
                variant === 'overlay' ? styles.overlay : styles.inline,
                containerStyle,
            ]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Unsave shot' : 'Save shot'}
            accessibilityHint="Long press to add to a list"
        >
            <Ionicons
                name={saved ? 'bookmark' : 'bookmark-outline'}
                size={size}
                color={
                    saved
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
