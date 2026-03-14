import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface ViewToggleProps {
    activeMode: 'map' | 'list'
    onToggle: (mode: 'map' | 'list') => void
    bottomOffset?: number
}

export default function ViewToggle({
    activeMode,
    onToggle,
    bottomOffset = 20,
}: ViewToggleProps) {
    const insets = useSafeAreaInsets()

    return (
        <View
            style={[styles.container, { bottom: insets.bottom + bottomOffset }]}
        >
            <TouchableOpacity
                style={[
                    styles.option,
                    activeMode === 'map' && styles.optionActive,
                ]}
                onPress={() => onToggle('map')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Map view"
                accessibilityState={{ selected: activeMode === 'map' }}
            >
                <Ionicons
                    name="map"
                    size={16}
                    color={activeMode === 'map' ? '#fff' : colors.textSecondary}
                />
                <Text
                    style={[
                        styles.text,
                        activeMode === 'map' && styles.textActive,
                    ]}
                >
                    Map
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[
                    styles.option,
                    activeMode === 'list' && styles.optionActive,
                ]}
                onPress={() => onToggle('list')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="List view"
                accessibilityState={{ selected: activeMode === 'list' }}
            >
                <Ionicons
                    name="list"
                    size={16}
                    color={
                        activeMode === 'list' ? '#fff' : colors.textSecondary
                    }
                />
                <Text
                    style={[
                        styles.text,
                        activeMode === 'list' && styles.textActive,
                    ]}
                >
                    List
                </Text>
            </TouchableOpacity>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.card,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 4,
        position: 'absolute',
        alignSelf: 'center',
        zIndex: 100,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
    },
    optionActive: {
        backgroundColor: colors.primary,
    },
    text: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    textActive: {
        color: '#fff',
    },
})
