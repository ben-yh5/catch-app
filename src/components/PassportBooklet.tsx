/**
 * PassportBooklet - The physical passport, inline: closed cover ⇄ open
 * book. Lives directly on the profile's Passport tab and the /passport
 * screen — NOT a modal.
 *
 * Closed, the cover sits centered; tapping swings it open around the
 * spine while the whole booklet slides so the spread ends up centered
 * (opening a real book doubles its width). A back-turn on the first
 * spread swings the cover shut again.
 *
 * Gesture arbitration with the profile pager: the book's PanResponder
 * claims touches at touch-down, so a swipe that STARTS inside the
 * spread turns pages and never reaches the pager; swipes outside the
 * passport still switch profile tabs. No 3D transform at rest — RN
 * hit-testing is unreliable under perspective transforms.
 */

import PassportBook from '@/components/PassportBook'
import PassportCover, { passportPageSize } from '@/components/PassportCover'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/tokens'
import { CityStamp } from '@/utils/passportQueries'
import React, { useEffect, useRef, useState } from 'react'
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native'
import Animated, {
    Easing,
    Extrapolation,
    interpolate,
    ReduceMotion,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated'

const OPEN_DURATION_MS = 650
const CLOSE_DURATION_MS = 450

interface PassportBookletProps {
    cities: CityStamp[]
}

export default function PassportBooklet({ cities }: PassportBookletProps) {
    const { width: windowWidth } = useWindowDimensions()
    const { pageWidth, pageHeight } = passportPageSize(windowWidth)
    const spreadWidth = pageWidth * 2

    // The passport rests closed and opens only when the cover is tapped.
    // The book mounts as the swing starts; the cover unmounts once fully
    // open so the pages get touches.
    const [bookMounted, setBookMounted] = useState(false)
    const [coverOpened, setCoverOpened] = useState(false)
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const openingRef = useRef(false)
    const closingRef = useRef(false)
    const coverAngle = useSharedValue(0)

    // Clear pending timers on unmount only
    useEffect(
        () => () => {
            if (openTimer.current) clearTimeout(openTimer.current)
            if (closeTimer.current) clearTimeout(closeTimer.current)
        },
        []
    )

    const openCover = () => {
        if (openingRef.current || closingRef.current) return
        openingRef.current = true
        setBookMounted(true)
        coverAngle.value = withTiming(-180, {
            duration: OPEN_DURATION_MS,
            easing: Easing.inOut(Easing.cubic),
            reduceMotion: ReduceMotion.System,
        })
        openTimer.current = setTimeout(
            () => setCoverOpened(true),
            OPEN_DURATION_MS
        )
    }

    // Back-turn past the first spread: the cover swings closed
    const closeBook = () => {
        if (closingRef.current || !openingRef.current) return
        if (openTimer.current) clearTimeout(openTimer.current)
        closingRef.current = true
        setCoverOpened(false) // remount the cover over the book
        coverAngle.value = withTiming(0, {
            duration: CLOSE_DURATION_MS,
            easing: Easing.inOut(Easing.cubic),
            reduceMotion: ReduceMotion.System,
        })
        closeTimer.current = setTimeout(() => {
            closingRef.current = false
            openingRef.current = false
            setBookMounted(false)
        }, CLOSE_DURATION_MS + 50)
    }

    // Closed, the cover sits centered; opening slides the whole booklet
    // left so the spread ends up centered instead. Plain 2D translate —
    // safe for hit-testing.
    const bookShiftStyle = useAnimatedStyle(() => ({
        transform: [
            {
                translateX: interpolate(
                    coverAngle.value,
                    [-180, 0],
                    [0, -pageWidth / 2],
                    Extrapolation.CLAMP
                ),
            },
        ],
    }))

    // Swing around the left edge — the spine. No transform at rest;
    // past edge-on the cover fades out rather than relying on
    // backfaceVisibility.
    const coverStyle = useAnimatedStyle(() => {
        const angle = coverAngle.value
        if (angle > -0.5) {
            return { opacity: 1, transform: [] }
        }
        return {
            opacity: interpolate(
                angle,
                [-100, -85],
                [0, 1],
                Extrapolation.CLAMP
            ),
            transform: [
                { perspective: 1600 },
                { translateX: -pageWidth / 2 },
                { rotateY: `${angle}deg` },
                { translateX: pageWidth / 2 },
            ],
        }
    })

    return (
        <View style={styles.root}>
            <Animated.View
                style={[
                    { width: spreadWidth, minHeight: pageHeight },
                    bookShiftStyle,
                ]}
            >
                {bookMounted && (
                    <PassportBook
                        cities={cities}
                        pageWidth={pageWidth}
                        pageHeight={pageHeight}
                        onCloseBook={closeBook}
                    />
                )}
                {!coverOpened && (
                    <Animated.View
                        style={[
                            styles.coverWrap,
                            {
                                left: pageWidth,
                                width: pageWidth,
                                height: pageHeight,
                            },
                            coverStyle,
                        ]}
                    >
                        <TouchableOpacity
                            onPress={openCover}
                            activeOpacity={0.9}
                            accessibilityRole="button"
                            accessibilityLabel="Open passport cover"
                        >
                            <PassportCover
                                width={pageWidth}
                                height={pageHeight}
                            />
                        </TouchableOpacity>
                    </Animated.View>
                )}
            </Animated.View>
            {!coverOpened && !bookMounted && (
                <Text style={styles.hint}>Tap to open</Text>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    root: {
        alignItems: 'center',
    },
    coverWrap: {
        position: 'absolute',
        top: 0,
    },
    hint: {
        marginTop: spacing.md,
        fontSize: typography.caption,
        letterSpacing: 1,
        color: colors.textTertiary,
    },
})
