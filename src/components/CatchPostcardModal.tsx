/**
 * CatchPostcardModal - A caught notification opened as a postcard.
 *
 * Front: the catcher's photo full-bleed with a circular ink postmark
 * (city + date). Tap to flip it over; the back reads "@user stood where
 * you stood" with a route into the place's timeline. The reward is
 * knowing someone stood where you stood — no counts anywhere.
 *
 * Flip: rotateY on two stacked faces with an opacity swap at edge-on
 * (the PassportBook leaf pattern — no backfaceVisibility, no Android
 * quirks). Perspective exists ONLY mid-animation; at rest the visible
 * face renders with no transform, because RN hit-testing is unreliable
 * under resting perspective transforms.
 */

import { StampFace } from '@/components/PassportStamp'
import DocumentButton from '@/components/ui/DocumentButton'
import { colors } from '@/theme/colors'
import { documentType, paper } from '@/theme/document'
import { radii, spacing, typography } from '@/theme/tokens'
import { Notification } from '@/types/Notification'
import { monthYear } from '@/utils/dateUtils'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, { useEffect, useRef } from 'react'
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native'
import Animated, {
    Easing,
    FadeIn,
    ReduceMotion,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const FLIP_MS = 450
const POSTMARK_INK = 'rgba(255, 255, 255, 0.92)'

interface CatchPostcardModalProps {
    visible: boolean
    /** A hydrated caught notification with catchPostId + catchPhotoURL */
    notification: Notification | null
    onOpenThread: (catchPostId: string) => void
    onClose: () => void
}

export default function CatchPostcardModal({
    visible,
    notification,
    onOpenThread,
    onClose,
}: CatchPostcardModalProps) {
    const insets = useSafeAreaInsets()
    const { width: windowWidth } = useWindowDimensions()

    // 0 = front (photo), 1 = back (message)
    const flip = useSharedValue(0)
    const animatingRef = useRef(false)

    // Fresh postcards always open on the front
    useEffect(() => {
        if (visible) {
            flip.value = 0
            animatingRef.current = false
        }
    }, [visible, flip])

    const settleFlip = () => {
        animatingRef.current = false
    }

    const toggleFlip = () => {
        if (animatingRef.current) return
        animatingRef.current = true
        flip.value = withTiming(
            flip.value < 0.5 ? 1 : 0,
            {
                duration: FLIP_MS,
                easing: Easing.inOut(Easing.cubic),
                reduceMotion: ReduceMotion.System,
            },
            () => {
                runOnJS(settleFlip)()
            }
        )
    }

    // Faces swap at edge-on via opacity — and carry NO transform at rest
    const frontStyle = useAnimatedStyle(() => {
        const p = flip.value
        if (p <= 0.001) return { opacity: 1, zIndex: 2, transform: [] }
        if (p >= 0.999) return { opacity: 0, zIndex: 1, transform: [] }
        return {
            opacity: p < 0.5 ? 1 : 0,
            zIndex: p < 0.5 ? 2 : 1,
            transform: [{ perspective: 1200 }, { rotateY: `${p * 180}deg` }],
        }
    })
    const backStyle = useAnimatedStyle(() => {
        const p = flip.value
        if (p <= 0.001) return { opacity: 0, zIndex: 1, transform: [] }
        if (p >= 0.999) return { opacity: 1, zIndex: 2, transform: [] }
        return {
            opacity: p >= 0.5 ? 1 : 0,
            zIndex: p >= 0.5 ? 2 : 1,
            transform: [
                { perspective: 1200 },
                { rotateY: `${180 + p * 180}deg` },
            ],
        }
    })

    if (!notification?.catchPhotoURL || !notification.catchPostId) return null

    const cardWidth = Math.min(windowWidth - spacing.xl * 2, 400)
    const cardHeight = Math.round(cardWidth * 1.25)
    const catchPostId = notification.catchPostId
    const dateLine = monthYear(
        notification.catchCreatedAt ?? notification.createdAt
    )

    return (
        <Modal
            visible={visible}
            animationType="none"
            transparent
            onRequestClose={onClose}
        >
            <Animated.View
                entering={FadeIn.duration(150)}
                style={styles.container}
            >
                <TouchableOpacity
                    onPress={onClose}
                    style={[styles.closeButton, { top: insets.top + 8 }]}
                    accessibilityLabel="Close postcard"
                    accessibilityRole="button"
                >
                    <Ionicons
                        name="close"
                        size={24}
                        color={colors.textPrimary}
                    />
                </TouchableOpacity>

                <View style={styles.center}>
                    <View style={{ width: cardWidth, height: cardHeight }}>
                        {/* Front — the catcher's photo, postmarked */}
                        <Animated.View
                            style={[styles.face, frontStyle]}
                        >
                            <Pressable
                                style={styles.faceFill}
                                onPress={toggleFlip}
                                accessibilityRole="button"
                                accessibilityLabel={`Postcard from @${notification.fromUsername}. Tap to turn over`}
                            >
                                <Image
                                    source={{
                                        uri: notification.catchPhotoURL,
                                    }}
                                    style={styles.photo}
                                    contentFit="cover"
                                    accessibilityLabel={`Photo by @${notification.fromUsername}`}
                                />
                                <View
                                    style={styles.postmark}
                                    pointerEvents="none"
                                >
                                    <StampFace
                                        ink={POSTMARK_INK}
                                        city={(
                                            notification.city ?? 'CAUGHT'
                                        ).toUpperCase()}
                                        dateText={dateLine}
                                        size={104}
                                    />
                                </View>
                            </Pressable>
                        </Animated.View>

                        {/* Back — the message side */}
                        <Animated.View style={[styles.face, backStyle]}>
                            <Pressable
                                style={[styles.faceFill, styles.backFace]}
                                onPress={toggleFlip}
                                accessibilityRole="button"
                                accessibilityLabel="Postcard message. Tap to turn over"
                            >
                                <View style={styles.backRule} />
                                <Text style={styles.backMessage}>
                                    @{notification.fromUsername} stood where
                                    you stood.
                                </Text>
                                <Text style={styles.backDate}>{dateLine}</Text>
                                <DocumentButton
                                    title="See this place's timeline"
                                    onPress={() => onOpenThread(catchPostId)}
                                    style={styles.timelineButton}
                                />
                            </Pressable>
                        </Animated.View>
                    </View>
                    <Text style={styles.hint}>Tap the card to turn it over</Text>
                </View>
            </Animated.View>
        </Modal>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    closeButton: {
        position: 'absolute',
        left: spacing.lg,
        padding: spacing.sm,
        zIndex: 10,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
    },
    face: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: radii.lg,
        overflow: 'hidden',
    },
    faceFill: {
        flex: 1,
    },
    photo: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.imageBackground,
    },
    postmark: {
        position: 'absolute',
        top: spacing.md,
        right: spacing.md,
        transform: [{ rotate: '6deg' }],
        opacity: 0.9,
    },
    backFace: {
        backgroundColor: paper.surface,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.md,
    },
    backRule: {
        width: 24,
        height: 1,
        backgroundColor: colors.textTertiary,
    },
    backMessage: {
        ...documentType.label,
        fontSize: typography.body,
        lineHeight: 24,
        color: colors.textPrimary,
        textAlign: 'center',
    },
    backDate: {
        ...documentType.stampDate,
        fontSize: typography.caption,
        color: colors.textTertiary,
    },
    timelineButton: {
        marginTop: spacing.lg,
    },
    hint: {
        marginTop: spacing.lg,
        fontSize: typography.caption,
        letterSpacing: 1,
        color: colors.textTertiary,
    },
})
