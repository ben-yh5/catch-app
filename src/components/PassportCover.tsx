/**
 * PassportCover - The closed passport: deep navy booklet, gold-embossed
 * border and emblem. Shown flat on the profile Passport tab and as the
 * opening face of PassportModal — both at the same size (passportSize),
 * so the tap-to-open transition reads as the same physical object.
 *
 * Gold here is decoration (cover embossing), not status ink.
 */

import { radii, spacing, typography } from '@/theme/tokens'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

export const COVER_BACKGROUND = '#12233c'
export const COVER_GOLD = '#d4af37'

/** width / height of a single page face (and the closed cover) */
export const PASSPORT_ASPECT = 0.72

/**
 * True-book sizing: the open spread (two page faces) fits the window
 * width, so the closed cover is one page — half a spread — like a real
 * passport.
 */
export function passportPageSize(windowWidth: number): {
    pageWidth: number
    pageHeight: number
} {
    const spreadWidth = Math.min(windowWidth - 32, 560)
    const pageWidth = Math.floor(spreadWidth / 2)
    return { pageWidth, pageHeight: Math.round(pageWidth / PASSPORT_ASPECT) }
}

interface PassportCoverProps {
    width: number
    height: number
}

export default function PassportCover({ width, height }: PassportCoverProps) {
    return (
        <View style={[styles.cover, { width, height }]}>
            <View style={styles.coverBorder}>
                <Ionicons name="earth" size={40} color={COVER_GOLD} />
                <Text style={styles.coverTitle}>PASSPORT</Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    cover: {
        backgroundColor: COVER_BACKGROUND,
        borderRadius: radii.lg,
        padding: spacing.md,
    },
    coverBorder: {
        flex: 1,
        borderWidth: 1.5,
        borderColor: COVER_GOLD,
        borderRadius: radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.lg,
    },
    coverTitle: {
        fontSize: typography.bodyLarge,
        fontWeight: '800',
        letterSpacing: 4,
        color: COVER_GOLD,
    },
})
