/**
 * DocumentButton - The document layer's ghost button: quiet system type
 * in a hairline square-cornered frame. Used on passport/postcard
 * surfaces where a solid filled button would compete with the stamp.
 * Everywhere else, keep using AppButton.
 */

import { colors } from '@/theme/colors'
import { HAIRLINE } from '@/theme/document'
import * as Haptics from 'expo-haptics'
import React from 'react'
import {
    StyleProp,
    StyleSheet,
    Text,
    TouchableOpacity,
    ViewStyle,
} from 'react-native'

interface DocumentButtonProps {
    title: string
    onPress: () => void
    style?: StyleProp<ViewStyle>
}

export default function DocumentButton({
    title,
    onPress,
    style,
}: DocumentButtonProps) {
    const handlePress = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        onPress()
    }

    return (
        <TouchableOpacity
            style={[styles.button, style]}
            onPress={handlePress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={title}
        >
            <Text style={styles.text}>{title}</Text>
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    button: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 30,
        borderWidth: HAIRLINE,
        borderColor: 'rgba(255, 255, 255, 0.35)',
        borderRadius: 2,
    },
    text: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textPrimary,
    },
})
