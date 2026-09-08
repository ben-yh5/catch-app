/**
 * CatchRevealModal - The payoff moment after a successful catch.
 *
 * One square frame holds both photos: the original ("then") underneath
 * and the freshly taken catch ("now") revealed by a draggable time-wipe.
 * The wipe auto-plays once to NOW, then the CAUGHT stamp slams onto the
 * passport-page card — your photo just joined this place's timeline.
 * This reveal IS the reward for catching — there is no point economy.
 *
 * The NOW image sits inside an animated-width mask (inner image at the
 * frame's fixed width, so dragging reveals rather than squishes) — no
 * SVG dependency.
 */

import PassportPageCard from '@/components/PassportPageCard'
import { StampPlace } from '@/components/PassportStamp'
import DocumentButton from '@/components/ui/DocumentButton'
import { colors } from '@/theme/colors'
import { documentType } from '@/theme/document'
import { spacing, typography } from '@/theme/tokens'
import { Post } from '@/types'
import { monthYear } from '@/utils/dateUtils'
import { Image } from 'expo-image'
import React, { useEffect, useRef, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
} from 'react-native-gesture-handler'
import Animated, {
    cancelAnimation,
    Easing,
    FadeIn,
    FadeInDown,
    interpolate,
    ReduceMotion,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface CatchRevealModalProps {
    visible: boolean
    /** The root post that was caught */
    originalPost: Post | null
    /** Local URI (or URL) of the photo the user just took */
    catchPhotoUri: string | null
    /** Display-only reverse-geocoded place — stamp omits the line if null */
    place?: StampPlace | null
    onClose: () => void
}

// Longest we wait for the THEN image before auto-wiping anyway
const WIPE_LOAD_CAP_MS = 1500
const WIPE_DELAY_MS = 500
const WIPE_MS = 900

export default function CatchRevealModal({
    visible,
    originalPost,
    catchPhotoUri,
    place,
    onClose,
}: CatchRevealModalProps) {
    const insets = useSafeAreaInsets()

    const [frameW, setFrameW] = useState(0)
    const sliderX = useSharedValue(0)
    const dragStartX = useSharedValue(0)
    // Once the user touches the slider, the auto-wipe stops interfering
    const interactedRef = useRef(false)
    const wipeStartedRef = useRef(false)
    const thenLoadedRef = useRef(false)

    const frameWRef = useRef(0)
    frameWRef.current = frameW

    const startAutoWipe = (instant: boolean) => {
        if (wipeStartedRef.current || interactedRef.current) return
        const w = frameWRef.current
        if (w <= 0) return
        wipeStartedRef.current = true
        sliderX.value = instant
            ? w
            : withDelay(
                  WIPE_DELAY_MS,
                  withTiming(w, {
                      duration: WIPE_MS,
                      easing: Easing.inOut(Easing.cubic),
                      reduceMotion: ReduceMotion.System,
                  })
              )
    }

    // If THEN loaded before the frame measured, start as soon as we can;
    // otherwise the cap timer wipes even if THEN never finishes loading
    useEffect(() => {
        if (!visible || frameW <= 0) return
        if (thenLoadedRef.current) {
            startAutoWipe(false)
            return
        }
        const timer = setTimeout(() => startAutoWipe(false), WIPE_LOAD_CAP_MS)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, frameW])

    const pan = Gesture.Pan()
        .hitSlop({ left: 24, right: 24 })
        .activeOffsetX([-5, 5])
        .failOffsetY([-10, 10])
        .onBegin(() => {
            cancelAnimation(sliderX)
            dragStartX.value = sliderX.value
        })
        .onUpdate((e) => {
            const w = frameW
            const next = dragStartX.value + e.translationX
            sliderX.value = Math.min(Math.max(next, 0), w)
        })

    const markInteracted = () => {
        interactedRef.current = true
    }

    const maskStyle = useAnimatedStyle(() => ({
        width: sliderX.value,
    }))
    const dividerStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: sliderX.value }],
    }))
    const thenChipStyle = useAnimatedStyle(() => ({
        opacity:
            frameW > 0
                ? interpolate(sliderX.value, [0, frameW], [1, 0.45])
                : 1,
    }))
    const nowChipStyle = useAnimatedStyle(() => ({
        opacity:
            frameW > 0
                ? interpolate(sliderX.value, [0, frameW], [0.45, 1])
                : 0.45,
    }))

    if (!originalPost || !catchPhotoUri) return null

    return (
        <Modal
            visible={visible}
            animationType="fade"
            presentationStyle="fullScreen"
            onRequestClose={onClose}
        >
            {/* RN Modal hosts a separate native root — gesture-handler
                needs its own root view inside it (same as PostCard) */}
            <GestureHandlerRootView style={styles.container}>
                <ScrollView
                    contentContainerStyle={[
                        styles.content,
                        {
                            paddingTop: insets.top + spacing.xl,
                            paddingBottom: insets.bottom + spacing.xl,
                        },
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    <Animated.View entering={FadeIn.duration(400)}>
                        <Text style={styles.title} accessibilityRole="header">
                            Caught!
                        </Text>
                        <Text style={styles.subtitle}>
                            You stood where @{originalPost.authorUsername}{' '}
                            stood.
                        </Text>
                    </Animated.View>

                    <Animated.View
                        entering={FadeInDown.duration(500).delay(200)}
                        style={styles.cardWrap}
                    >
                        <PassportPageCard
                            variant="caught"
                            place={place}
                            stampDelay={1300}
                            stampSize={130}
                            overlap={88}
                        >
                            <View
                                style={styles.wipeFrame}
                                onLayout={(e) =>
                                    setFrameW(e.nativeEvent.layout.width)
                                }
                            >
                                <Image
                                    source={{ uri: originalPost.photoURL }}
                                    style={StyleSheet.absoluteFill}
                                    contentFit="cover"
                                    accessibilityLabel={`Original photo by @${originalPost.authorUsername}`}
                                    onLoad={() => {
                                        thenLoadedRef.current = true
                                        startAutoWipe(false)
                                    }}
                                    onError={() => startAutoWipe(true)}
                                />
                                {/* NOW reveals from the left; fixed inner
                                    width so the drag uncovers, never scales */}
                                <Animated.View
                                    style={[styles.nowMask, maskStyle]}
                                >
                                    {frameW > 0 && (
                                        <Image
                                            source={{ uri: catchPhotoUri }}
                                            style={{
                                                width: frameW,
                                                height: '100%',
                                            }}
                                            contentFit="cover"
                                            accessibilityLabel="Your catch photo"
                                        />
                                    )}
                                </Animated.View>

                                <Animated.View
                                    style={[styles.chip, styles.thenChip, thenChipStyle]}
                                    pointerEvents="none"
                                >
                                    <Text style={styles.chipLabel}>THEN</Text>
                                    <Text style={styles.chipDate}>
                                        {monthYear(originalPost.createdAt)}
                                    </Text>
                                </Animated.View>
                                <Animated.View
                                    style={[styles.chip, styles.nowChip, nowChipStyle]}
                                    pointerEvents="none"
                                >
                                    <Text
                                        style={[
                                            styles.chipLabel,
                                            styles.nowLabel,
                                        ]}
                                    >
                                        NOW
                                    </Text>
                                    <Text style={styles.chipDate}>
                                        {monthYear(new Date())}
                                    </Text>
                                </Animated.View>

                                <Animated.View
                                    style={[styles.divider, dividerStyle]}
                                    pointerEvents="none"
                                />
                                <GestureDetector gesture={pan}>
                                    <Animated.View
                                        style={[styles.dragHandle, dividerStyle]}
                                        onTouchStart={markInteracted}
                                        accessibilityRole="adjustable"
                                        accessibilityLabel="Time wipe between then and now"
                                        accessibilityActions={[
                                            { name: 'increment' },
                                            { name: 'decrement' },
                                        ]}
                                        onAccessibilityAction={(e) => {
                                            markInteracted()
                                            const step = frameW / 4
                                            const next =
                                                e.nativeEvent.actionName ===
                                                'increment'
                                                    ? sliderX.value + step
                                                    : sliderX.value - step
                                            sliderX.value = Math.min(
                                                Math.max(next, 0),
                                                frameW
                                            )
                                        }}
                                    >
                                        <View style={styles.grabber} />
                                    </Animated.View>
                                </GestureDetector>
                            </View>
                        </PassportPageCard>
                    </Animated.View>

                    <Animated.Text
                        entering={FadeIn.duration(400).delay(1800)}
                        style={styles.timelineNote}
                    >
                        Your photo just joined this place&apos;s timeline.
                    </Animated.Text>

                    <Animated.View entering={FadeIn.duration(400).delay(1800)}>
                        <DocumentButton
                            title="Done"
                            onPress={onClose}
                            style={styles.doneButton}
                        />
                    </Animated.View>
                </ScrollView>
            </GestureHandlerRootView>
        </Modal>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    content: {
        paddingHorizontal: spacing.xl,
        alignItems: 'center',
    },
    title: {
        fontSize: typography.hero,
        fontWeight: '800',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        marginTop: 6,
        marginBottom: spacing.xl,
    },
    cardWrap: {
        width: '100%',
    },
    // Square corners — it's a print on the mount, not an app image
    wipeFrame: {
        width: '100%',
        aspectRatio: 1,
        overflow: 'hidden',
        backgroundColor: colors.imageBackground,
    },
    nowMask: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        overflow: 'hidden',
    },
    chip: {
        position: 'absolute',
        top: spacing.sm,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    thenChip: {
        left: spacing.sm,
    },
    nowChip: {
        right: spacing.sm,
    },
    chipLabel: {
        ...documentType.label,
        color: colors.textPrimary,
    },
    nowLabel: {
        color: colors.secondary,
    },
    chipDate: {
        fontSize: typography.caption,
        color: colors.textSecondary,
    },
    divider: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -1,
        width: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
    },
    // Wide invisible touch target riding the divider
    dragHandle: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -24,
        width: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    grabber: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderWidth: 2,
        borderColor: 'rgba(0, 0, 0, 0.25)',
    },
    timelineNote: {
        fontSize: typography.small,
        color: colors.textSecondary,
        marginTop: spacing.lg + 4,
        textAlign: 'center',
    },
    doneButton: {
        marginTop: spacing.lg + 4,
        paddingHorizontal: 48,
    },
})
