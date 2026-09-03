/**
 * CatchRevealModal - The payoff moment after a successful catch.
 *
 * Shows the original photo ("then") and the freshly taken catch ("now")
 * stacked as a mini time-lapse: your photo just joined this place's timeline.
 * This reveal IS the reward for catching — there is no point economy.
 */

import { colors } from '@/theme/colors'
import { Post } from '@/types'
import { Ionicons } from '@expo/vector-icons'
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
                        style={styles.photoCard}
                    >
                        <View style={styles.photoLabelRow}>
                            <Text style={styles.photoLabel}>THEN</Text>
                            <Text style={styles.photoDate}>
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
                        entering={FadeIn.duration(300).delay(500)}
                        style={styles.connector}
                    >
                        <Ionicons
                            name="arrow-down"
                            size={20}
                            color={colors.textTertiary}
                        />
                    </Animated.View>

                    <Animated.View
                        entering={FadeInDown.duration(500).delay(700)}
                        style={styles.photoCard}
                    >
                        <View style={styles.photoLabelRow}>
                            <Text style={[styles.photoLabel, styles.nowLabel]}>
                                NOW
                            </Text>
                            <Text style={styles.photoDate}>
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

                    <Animated.Text
                        entering={FadeIn.duration(400).delay(1100)}
                        style={styles.timelineNote}
                    >
                        This place&apos;s timeline now has {timelineCount}{' '}
                        photos.
                    </Animated.Text>

                    <Animated.View entering={FadeIn.duration(400).delay(1100)}>
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
    photoCard: {
        width: '100%',
        backgroundColor: colors.cardElevated,
        borderRadius: 16,
        padding: 10,
    },
    photoLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingBottom: 8,
    },
    photoLabel: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 2,
        color: colors.textTertiary,
    },
    nowLabel: {
        color: colors.primary,
    },
    photoDate: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    photo: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 10,
        backgroundColor: colors.imageBackground,
    },
    connector: {
        paddingVertical: 8,
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
