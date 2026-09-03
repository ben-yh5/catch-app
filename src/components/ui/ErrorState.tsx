/**
 * ErrorState - Inline error card with a retry action.
 *
 * Rendered in place of content when a fetch fails, so a failed request
 * is distinguishable from a genuinely empty result.
 */

import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import {
    StyleProp,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ViewStyle,
} from 'react-native'

interface ErrorStateProps {
    message?: string
    onRetry?: () => void
    style?: StyleProp<ViewStyle>
}

export default function ErrorState({
    message = "Couldn't load this right now",
    onRetry,
    style,
}: ErrorStateProps) {
    return (
        <View style={[styles.container, style]} accessibilityRole="alert">
            <Ionicons
                name="cloud-offline-outline"
                size={28}
                color={colors.textTertiary}
            />
            <Text style={styles.message}>{message}</Text>
            <Text style={styles.hint}>Check your connection and try again</Text>
            {onRetry && (
                <TouchableOpacity
                    style={styles.retryButton}
                    onPress={onRetry}
                    accessibilityLabel="Retry"
                    accessibilityRole="button"
                >
                    <Ionicons name="refresh" size={16} color={colors.primary} />
                    <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 6,
    },
    message: {
        color: colors.textPrimary,
        fontSize: 15,
        fontWeight: '600',
        textAlign: 'center',
    },
    hint: {
        color: colors.textTertiary,
        fontSize: 13,
        textAlign: 'center',
    },
    retryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginTop: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.primary,
    },
    retryText: {
        color: colors.primary,
        fontSize: 14,
        fontWeight: '600',
    },
})
