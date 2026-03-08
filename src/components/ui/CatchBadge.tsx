import { colors } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

interface CatchBadgeProps {
    count: number;
    containerStyle?: ViewStyle;
    variant?: 'dark' | 'elevated';
}

/**
 * CatchBadge - Shared UI atom for displaying a trophy and catch count
 */
export default function CatchBadge({ count, containerStyle, variant = 'elevated' }: CatchBadgeProps) {
    return (
        <View
            style={[
                styles.container,
                variant === 'dark' ? styles.variantDark : styles.variantElevated,
                containerStyle
            ]}
            accessibilityLabel={`${count} ${count === 1 ? 'catch' : 'catches'}`}
            accessibilityRole="text"
        >
            <Ionicons name="trophy" size={12} color={colors.secondary} />
            <Text style={styles.count}>{count}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    variantElevated: {
        backgroundColor: colors.cardElevated,
    },
    variantDark: {
        backgroundColor: colors.background,
    },
    count: {
        fontSize: 12,
        fontWeight: '700',
        color: colors.textPrimary,
    },
});
