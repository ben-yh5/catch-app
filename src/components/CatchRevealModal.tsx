/**
 * CatchRevealModal - The payoff moment after a successful catch.
 *
 * Shows the original photo ("then") and the freshly taken catch ("now")
 * side by side on a passport-page card, then slams a CAUGHT stamp across
 * the pair: your photo just joined this place's timeline. This reveal IS
 * the reward for catching — there is no point economy.
 */

import PassportStamp, { StampPlace } from '@/components/PassportStamp'
import { colors } from '@/theme/colors'
import { Post } from '@/types'
import { Image } from 'expo-image'
import React from 'react'
import {
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
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

const monthYear = (value: any): string => {
    const date = value?.toDate
        ? value.toDate()
        : value instanceof Date
          ? value
          : value
            ? new Date(value)
            : new Date()
    return date.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
    })
}

export default function CatchRevealModal({
    visible,
    originalPost,
    catchPhotoUri,
    place,
    onClose,
}: CatchRevealModalProps) {
    const insets = useSafeAreaInsets()

    if (!originalPost || !catchPhotoUri) return null

    // original + previous catches + this new one
    const timelineCount = 2 + (originalPost.catchCount || 0)

    return (
        <Modal
            visible={visible}
            animationType="fade"
            presentationStyle="fullScreen"
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <ScrollView
                    contentContainerStyle={[
                        styles.content,
                        {
                            paddingTop: insets.top + 24,
                            paddingBottom: insets.bottom + 24,
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
                        style={styles.pageCard}
                    >
                        <View style={styles.photoRow}>
                            <Animated.View
                                entering={FadeIn.duration(400).delay(400)}
                                style={styles.photoCol}
                            >
                                <View style={styles.photoLabelRow}>
                                    <Text style={styles.photoLabel}>THEN</Text>
                                    <Text
                                        style={styles.photoDate}
                                        numberOfLines={1}
                                    >
                                        {monthYear(originalPost.createdAt)}
                                    </Text>
                                </View>
                                <Image
                                    source={{ uri: originalPost.photoURL }}
                                    style={styles.photo}
                                    contentFit="cover"
                                    accessibilityLabel={`Original photo by @${originalPost.authorUsername}`}
                                />
                            </Animated.View>

                            <Animated.View
                                entering={FadeIn.duration(400).delay(800)}
                                style={styles.photoCol}
                            >
                                <View style={styles.photoLabelRow}>
                                    <Text
                                        style={[
                                            styles.photoLabel,
                                            styles.nowLabel,
                                        ]}
                                    >
                                        NOW
                                    </Text>
                                    <Text
                                        style={styles.photoDate}
                                        numberOfLines={1}
                                    >
                                        {monthYear(new Date())}
                                    </Text>
                                </View>
                                <Image
                                    source={{ uri: catchPhotoUri }}
                                    style={styles.photo}
                                    contentFit="cover"
                                    accessibilityLabel="Your catch photo"
                                />
                            </Animated.View>
                        </View>

                        <View style={styles.stampWrap} pointerEvents="none">
                            <PassportStamp
                                variant="caught"
                                place={place}
                                delay={1300}
                                size={130}
                            />
                        </View>
                    </Animated.View>

                    <Animated.Text
                        entering={FadeIn.duration(400).delay(1800)}
                        style={styles.timelineNote}
                    >
                        This place&apos;s timeline now has {timelineCount}{' '}
                        photos.
                    </Animated.Text>

                    <Animated.View entering={FadeIn.duration(400).delay(1800)}>
                        <TouchableOpacity
                            style={styles.doneButton}
                            onPress={onClose}
                            accessibilityRole="button"
                            accessibilityLabel="Done"
                        >
                            <Text style={styles.doneButtonText}>Done</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </ScrollView>
            </View>
        </Modal>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    content: {
        paddingHorizontal: 24,
        alignItems: 'center',
    },
    title: {
        fontSize: 34,
        fontWeight: '800',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        color: colors.textSecondary,
        textAlign: 'center',
        marginTop: 6,
        marginBottom: 24,
    },
    pageCard: {
        width: '100%',
        backgroundColor: colors.cardElevated,
        borderRadius: 16,
        padding: 10,
        paddingBottom: 22,
    },
    photoRow: {
        flexDirection: 'row',
        gap: 8,
    },
    photoCol: {
        flex: 1,
    },
    photoLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingHorizontal: 2,
        paddingBottom: 6,
        gap: 4,
    },
    photoLabel: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 2,
        color: colors.textTertiary,
    },
    nowLabel: {
        color: colors.secondary,
    },
    photoDate: {
        fontSize: 11,
        color: colors.textTertiary,
        flexShrink: 1,
    },
    photo: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 10,
        backgroundColor: colors.imageBackground,
    },
    // Overlaps the bottom of the photo pair like ink over the page
    stampWrap: {
        alignSelf: 'center',
        marginTop: -88,
    },
    timelineNote: {
        fontSize: 14,
        color: colors.textSecondary,
        marginTop: 20,
        textAlign: 'center',
    },
    doneButton: {
        marginTop: 20,
        backgroundColor: colors.primary,
        paddingHorizontal: 48,
        paddingVertical: 14,
        borderRadius: 26,
    },
    doneButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
})
