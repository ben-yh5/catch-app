/**
 * PassportStamp - circular passport ink stamps.
 *
 * StampFace is the static face: double ring, top place line, ★ dividers,
 * a big word, date, optional bottom line. PassportBook lays static faces
 * onto pages; the default export wraps a face in the slam animation
 * (spring scale-in with a heavy haptic thud) for the post/catch payoff
 * screens (PostStampModal, CatchRevealModal).
 *
 * Display-layer only: place/date lines are omitted when unknown — never
 * filled with a placeholder.
 */

import { colors } from '@/theme/colors'
import * as Haptics from 'expo-haptics'
import React, { useEffect } from 'react'
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native'
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from 'react-native-reanimated'

// Catching is the verified act — pink is the prestige ink. Posting is
// the invitation — blue. (Pioneer status is deliberately NOT a stamp
// variant: being first is circumstance, not an act; it stays thread
// metadata only.)
export type StampVariant = 'posted' | 'caught'

export interface StampPlace {
    city?: string
    country?: string
}

export const STAMP_INK: Record<StampVariant, string> = {
    posted: colors.primary,
    caught: colors.secondary,
}

const VARIANT_WORD: Record<StampVariant, string> = {
    posted: 'POSTED',
    caught: 'CAUGHT',
}

const MONTHS = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
]

export const stampDate = (date: Date): string =>
    `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`

export interface StampFaceProps {
    ink: string
    /** Big center word (act on payoff stamps, city name in the book) */
    word: string
    topLine?: string
    bottomLine?: string
    dateText?: string
    /** Diameter in px */
    size?: number
}

export function StampFace({
    ink,
    word,
    topLine,
    bottomLine,
    dateText,
    size = 150,
}: StampFaceProps) {
    const textMaxWidth = size - 44
    return (
        <View
            style={[
                styles.outer,
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderColor: ink,
                },
            ]}
            accessibilityLabel={`${word} stamp${topLine ? `, ${[topLine, bottomLine].filter(Boolean).join(', ')}` : ''}`}
        >
            <View style={[styles.inner, { borderColor: ink }]}>
                {topLine && (
                    <Text
                        style={[
                            styles.placeLine,
                            { color: ink, maxWidth: textMaxWidth },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                    >
                        {topLine}
                    </Text>
                )}
                <Text style={[styles.divider, { color: ink }]}>★ ★ ★</Text>
                <Text
                    style={[
                        styles.word,
                        { color: ink, maxWidth: textMaxWidth },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                >
                    {word}
                </Text>
                {dateText && (
                    <Text style={[styles.date, { color: ink }]}>
                        {dateText}
                    </Text>
                )}
                <Text style={[styles.divider, { color: ink }]}>★ ★ ★</Text>
                {bottomLine && (
                    <Text
                        style={[
                            styles.placeLine,
                            { color: ink, maxWidth: textMaxWidth },
                        ]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                    >
                        {bottomLine}
                    </Text>
                )}
            </View>
        </View>
    )
}

interface PassportStampProps {
    variant: StampVariant
    place?: StampPlace | null
    date?: Date
    /** ms before the stamp slams down (sync with surrounding animations) */
    delay?: number
    /** Diameter in px */
    size?: number
    style?: StyleProp<ViewStyle>
}

export default function PassportStamp({
    variant,
    place,
    date,
    delay = 0,
    size = 150,
    style,
}: PassportStampProps) {
    const scale = useSharedValue(2.4)
    const opacity = useSharedValue(0)

    useEffect(() => {
        opacity.value = withDelay(delay, withTiming(0.94, { duration: 140 }))
        scale.value = withDelay(
            delay,
            withSpring(1, { damping: 15, stiffness: 320, mass: 0.7 })
        )
        // Thud lands as the spring hits scale ≈ 1
        const timer = setTimeout(() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(
                () => {}
            )
        }, delay + 140)
        return () => clearTimeout(timer)
    }, [delay, opacity, scale])

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ rotate: '-8deg' }, { scale: scale.value }],
    }))

    // City rides the top position, country the bottom; with only one
    // known, it takes the top and the bottom line is omitted
    const topLine = (place?.city ?? place?.country)?.toUpperCase()
    const bottomLine = place?.city ? place?.country?.toUpperCase() : undefined

    return (
        <Animated.View style={[animatedStyle, style]}>
            <StampFace
                ink={STAMP_INK[variant]}
                word={VARIANT_WORD[variant]}
                topLine={topLine}
                bottomLine={bottomLine}
                dateText={stampDate(date ?? new Date())}
                size={size}
            />
        </Animated.View>
    )
}

const styles = StyleSheet.create({
    outer: {
        borderWidth: 2.5,
        padding: 3,
        backgroundColor: 'transparent',
    },
    inner: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    placeLine: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
    divider: {
        fontSize: 7,
        letterSpacing: 3,
        marginVertical: 2,
    },
    word: {
        fontSize: 20,
        fontWeight: '900',
        letterSpacing: 3,
    },
    date: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 2,
        marginTop: 1,
    },
})
