import { colors } from '@/theme/colors'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

export type FilterType = 'trending' | 'new'

interface FilterPillsProps {
    activeFilter: FilterType
    onFilterChange: (filter: FilterType) => void
}

export default function FilterPills({
    activeFilter,
    onFilterChange,
}: FilterPillsProps) {
    const filters: { type: FilterType; label: string }[] = [
        { type: 'trending', label: 'Trending' },
        { type: 'new', label: 'New' },
    ]

    return (
        <View style={styles.container}>
            {filters.map((filter) => {
                const isActive = activeFilter === filter.type

                return (
                    <TouchableOpacity
                        key={filter.type}
                        style={[styles.pill, isActive && styles.pillActive]}
                        onPress={() => onFilterChange(filter.type)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={filter.label}
                        accessibilityState={{ selected: isActive }}
                    >
                        <Text
                            style={[
                                styles.label,
                                isActive && styles.labelActive,
                            ]}
                        >
                            {filter.label}
                        </Text>
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        backgroundColor: colors.card,
        borderWidth: 1.5,
        borderColor: colors.border,
    },
    pillActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    pillDisabled: {
        opacity: 0.4,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    labelActive: {
        color: colors.inverseTextPrimary,
    },
})
