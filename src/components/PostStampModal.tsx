/**
 * PostStampModal - The payoff moment after sharing an original shot.
 *
 * Your photo sits mounted on a passport-page card and a blue POSTED
 * stamp slams onto it. Replaces the old success toast — same spirit as
 * CatchRevealModal: the moment itself is the reward, no point economy.
 * (No pioneer variant on purpose: being first is thread metadata, not a
 * celebrated status — the catch is the act this app celebrates.)
 */

import PassportStamp, { StampPlace } from '@/components/PassportStamp'
import { colors } from '@/theme/colors'
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

interface PostStampModalProps {
    visible: boolean
    /** Local URI of the photo that was just posted */
    photoUri: string | null
    /** Display-only reverse-geocoded place — stamp omits the line if null */
    place: StampPlace | null
    onClose: () => void
}

export default function PostStampModal({
    visible,
    photoUri,
    place,
    onClose,
}: PostStampModalProps) {
    const insets = useSafeAreaInsets()

    if (!photoUri) return null

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
                            Shared!
                        </Text>
                        <Text style={styles.subtitle}>
                            Your shot is on the map — an invitation to stand
                            here.
                        </Text>
                    </Animated.View>

                    <Animated.View
                        entering={FadeInDown.duration(500).delay(200)}
                        style={styles.pageCard}
                    >
                        <Image
                            source={{ uri: photoUri }}
                            style={styles.photo}
                            contentFit="cover"
                            accessibilityLabel="Your posted photo"
                        />
                        <View style={styles.stampWrap} pointerEvents="none">
                            <PassportStamp
                                variant="posted"
                                place={place}
                                delay={800}
                            />
                        </View>
                    </Animated.View>

                    <Animated.View entering={FadeIn.duration(400).delay(1300)}>
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
        paddingBottom: 16,
    },
    photo: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 10,
        backgroundColor: colors.imageBackground,
    },
    // Overlaps the bottom edge of the photo like ink over the page
    stampWrap: {
        alignSelf: 'center',
        marginTop: -104,
    },
    doneButton: {
        marginTop: 28,
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
