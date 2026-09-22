/**
 * CatchRecencyLine — the event line that replaced the CatchBadge count
 * chips (batch 5 minimal cut). A dot and a phrase: "caught yesterday" /
 * "not yet caught" / "last caught in June". The dot is caught-pink only on
 * a fresh catch — ink means the act, gray carries the quiet states. Never
 * renders a number.
 *
 * Two variants:
 * - 'line' (default): inline text row — thread header, detail surfaces;
 *   shows every state including "not yet caught".
 * - 'chip': dark scrim chip for overlaying on a card's photo; renders ONLY
 *   when a catch event actually happened (never-caught cards carry no chip
 *   at all — at current scale most shots are uncaught, and a chip saying so
 *   on every card is noise, not signal). Caller positions it absolutely
 *   over the image.
 */

import { colors } from '@/theme/colors'
import { Post } from '@/types'
import { getCatchRecency } from '@/utils/catchRecency'
import React from 'react'
import { StyleSheet, Text, View, ViewStyle } from 'react-native'

interface CatchRecencyLineProps {
    post: Pick<Post, 'isOriginal' | 'catchCount' | 'lastCaughtAt'>
    variant?: 'line' | 'chip'
    containerStyle?: ViewStyle
}

export default function CatchRecencyLine({
    post,
    variant = 'line',
    containerStyle,
}: CatchRecencyLineProps) {
    const recency = getCatchRecency(post)
    if (!recency) return null
    if (variant === 'chip' && recency.state === 'never') return null

    const dotColor = recency.caught ? colors.accent : '#8a8a90'

    return (
        <View
            style={[
                variant === 'chip' ? styles.chip : styles.row,
                containerStyle,
            ]}
            pointerEvents="none"
            accessibilityRole="text"
            accessibilityLabel={recency.text}
        >
            <View
                style={[
                    styles.dot,
                    {
                        backgroundColor:
                            variant === 'line' && !recency.caught
                                ? '#48484d'
                                : dotColor,
                    },
                ]}
            />
            <Text
                style={variant === 'chip' ? styles.chipText : styles.text}
                numberOfLines={1}
            >
                {recency.text}
            </Text>
        </View>
    )
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(10,10,10,0.62)',
        borderRadius: 2,
        paddingHorizontal: 8,
        paddingVertical: 5,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    text: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    chipText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#ffffff',
    },
})
