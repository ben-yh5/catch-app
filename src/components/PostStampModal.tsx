/**
 * PostStampModal - The payoff moment after sharing an original shot.
 *
 * Your photo sits mounted on a passport-page card and a blue POSTED
 * stamp slams onto it. Replaces the old success toast — same spirit as
 * CatchRevealModal: the moment itself is the reward, no point economy.
 * (No pioneer variant on purpose: being first is thread metadata, not a
 * celebrated status — the catch is the act this app celebrates.)
 */

import PassportPageCard from '@/components/PassportPageCard'
import { StampPlace } from '@/components/PassportStamp'
import DocumentButton from '@/components/ui/DocumentButton'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/tokens'
import { Image } from 'expo-image'
import React from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
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
                            paddingTop: insets.top + spacing.xl,
                            paddingBottom: insets.bottom + spacing.xl,
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
                        style={styles.cardWrap}
                    >
                        <PassportPageCard
                            variant="posted"
                            place={place}
                            stampDelay={800}
                            stampSize={140}
                            overlap={96}
                        >
                            <Image
                                source={{ uri: photoUri }}
                                style={styles.photo}
                                contentFit="cover"
                                accessibilityLabel="Your posted photo"
                            />
                        </PassportPageCard>
                    </Animated.View>

                    <Animated.View entering={FadeIn.duration(400).delay(1300)}>
                        <DocumentButton
                            title="Done"
                            onPress={onClose}
                            style={styles.doneButton}
                        />
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
    photo: {
        width: '100%',
        aspectRatio: 1,
        backgroundColor: colors.imageBackground,
    },
    doneButton: {
        marginTop: spacing.xl + 4,
        paddingHorizontal: 48,
    },
})
