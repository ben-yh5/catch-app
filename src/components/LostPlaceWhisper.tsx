/**
 * LostPlaceWhisper - A quiet one-line note that a lost place is nearby.
 *
 * Deliberately a whisper, not a radar: singular, unnumbered, auto-
 * dismissing, no badge, no urgency. It fires only while the map is open
 * with a foreground location fix (no background location, no new
 * permissions) — an invitation to notice, never a quest marker.
 */

import { colors } from '@/theme/colors'
import { radii, spacing, typography } from '@/theme/tokens'
import * as Haptics from 'expo-haptics'
import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'

const AUTO_DISMISS_MS = 6000

interface LostPlaceWhisperProps {
    /** e.g. "A lost place is near you — last photographed March 2024." */
    message: string
    /** Vertical offset from the top of the screen */
    top: number
    onPress: () => void
    onDismiss: () => void
}

export default function LostPlaceWhisper({
    message,
    top,
    onPress,
    onDismiss,
}: LostPlaceWhisperProps) {
    useEffect(() => {
        // One soft tap as it appears — haptics work on silent
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        const timer = setTimeout(onDismiss, AUTO_DISMISS_MS)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <Animated.View
            entering={FadeIn.duration(400)}
            exiting={FadeOut.duration(300)}
            style={[styles.container, { top }]}
        >
            <TouchableOpacity
                style={styles.pill}
                onPress={onPress}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={message}
                accessibilityHint="Shows the place on the map"
            >
                <Text style={styles.text} numberOfLines={2}>
                    {message}
                </Text>
            </TouchableOpacity>
        </Animated.View>
    )
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        zIndex: 99,
        alignItems: 'center',
    },
    pill: {
        backgroundColor: 'rgba(20, 20, 22, 0.88)',
        borderRadius: radii.pill,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm + 2,
    },
    text: {
        fontSize: typography.small,
        fontStyle: 'italic',
        color: colors.textSecondary,
        textAlign: 'center',
    },
})
