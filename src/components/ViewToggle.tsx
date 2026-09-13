import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface ViewToggleProps {
    /** The view currently showing — the FAB offers the OTHER one */
    activeMode: 'map' | 'list'
    onToggle: (mode: 'map' | 'list') => void
    bottomOffset?: number
}

/**
 * AllTrails-style floating view switch: a single pill naming the view
 * you'd switch to — "Map" floats over the list, "List" floats over the map.
 */
export default function ViewToggle({
    activeMode,
    onToggle,
    bottomOffset = 20,
}: ViewToggleProps) {
    const insets = useSafeAreaInsets()
    const target = activeMode === 'list' ? 'map' : 'list'

    return (
        <TouchableOpacity
            style={[styles.fab, { bottom: insets.bottom + bottomOffset }]}
            onPress={() => onToggle(target)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={target === 'map' ? 'Show map' : 'Show list'}
        >
            <Ionicons
                name={target === 'map' ? 'map' : 'list'}
                size={16}
                color={colors.inverseTextPrimary}
            />
            <Text style={styles.text}>
                {target === 'map' ? 'Map' : 'List'}
            </Text>
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    fab: {
        position: 'absolute',
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.primary,
        borderRadius: 24,
        paddingHorizontal: 20,
        paddingVertical: 12,
        zIndex: 100,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    text: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.inverseTextPrimary,
    },
})
