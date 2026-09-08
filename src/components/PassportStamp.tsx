/**
 * PassportStamp - circular passport ink stamps.
 *
 * StampFace is the static face: one hairline ring, the city, a short
 * rule, the date — nothing else. PassportBook lays static faces onto
 * pages; the default export wraps a face in the slam animation (spring
 * scale-in with a heavy haptic thud) for the post/catch payoff screens
 * (PostStampModal, CatchRevealModal).
 *
 * Display-layer only: place/date lines are omitted when unknown — never
 * filled with a placeholder.
 */

import { useReducedMotion } from '@/hooks/useReducedMotion'
import { documentInk, documentType, HAIRLINE, INK_OPACITY } from '@/theme/document'
import * as Haptics from 'expo-haptics'
import React, { useEffect } from 'react'
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native'
import Animated, {
    ReduceMotion,
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
    posted: documentInk.posted,
    caught: documentInk.caught,
}

// Fallback center word when no place is known — the act is otherwise
// already told by ink color and the surrounding screen
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
    /** City name, already uppercased by the caller */
    city: string
    dateText?: string
    /** Diameter in px */
    size?: number
}

export function StampFace({ ink, city, dateText, size = 150 }: StampFaceProps) {
    const textMaxWidth = size - 32
    return (
        <View
            style={[
                styles.ring,
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderColor: ink,
                },
            ]}
            accessibilityLabel={`${city} stamp${dateText ? `, ${dateText}` : ''}`}
        >
            <Text
                style={[styles.city, { color: ink, maxWidth: textMaxWidth }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
            >
                {city}
            </Text>
            <View style={[styles.rule, { backgroundColor: ink }]} />
            {dateText && (
                <Text style={[styles.date, { color: ink }]}>{dateText}</Text>
            )}
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
    size = 140,
    style,
}: PassportStampProps) {
    const scale = useSharedValue(2.4)
    const opacity = useSharedValue(0)
    const reducedMotion = useReducedMotion()

    useEffect(() => {
        opacity.value = withDelay(
            delay,
            withTiming(INK_OPACITY, {
                duration: 140,
                reduceMotion: ReduceMotion.System,
            })
        )
        scale.value = withDelay(
            delay,
            withSpring(1, {
                damping: 15,
                stiffness: 320,
                mass: 0.7,
                reduceMotion: ReduceMotion.System,
            })
        )
        // Thud lands as the spring hits scale ≈ 1; with motion reduced
        // the stamp appears at once, so the thud fires with it
        const timer = setTimeout(
            () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(
                    () => {}
                )
            },
            reducedMotion ? delay : delay + 140
        )
        return () => clearTimeout(timer)
    }, [delay, opacity, scale, reducedMotion])

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ rotate: '-4deg' }, { scale: scale.value }],
    }))

    const city = (
        place?.city ??
        place?.country ??
        VARIANT_WORD[variant]
    ).toUpperCase()

    return (
        <Animated.View style={[animatedStyle, style]}>
            <StampFace
                ink={STAMP_INK[variant]}
                city={city}
                dateText={stampDate(date ?? new Date())}
                size={size}
            />
        </Animated.View>
    )
}

const styles = StyleSheet.create({
    ring: {
        borderWidth: HAIRLINE,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    city: documentType.stampCity,
    rule: {
        width: 18,
        height: 1,
        marginVertical: 6,
    },
    date: documentType.stampDate,
})
