/**
 * OnboardingModal - First-run intro explaining the core catch mechanic.
 *
 * Shown once per install (AsyncStorage flag), mounted in the tab layout so
 * it appears over whichever tab a new user lands on. The app's premise —
 * re-taking someone else's photo at the same real-world spot — is not
 * discoverable on its own, so this is the one place it gets explained.
 */

import { CATCH_RADIUS_METERS } from '@/utils/catchValidation'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { useEffect, useState } from 'react'
import {
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'

const ONBOARDING_SEEN_KEY = '@catch_onboarding_seen'

const STEPS: {
    icon: keyof typeof Ionicons.glyphMap
    title: string
    body: string
}[] = [
    {
        icon: 'map',
        title: 'A map of photo-worthy spots',
        body: 'Every pin on the map is a real shot someone took at that exact spot. Explore to see what’s worth finding near you.',
    },
    {
        icon: 'camera',
        title: 'Catch shots by re-taking them',
        body: `Visit a pin, stand where the photographer stood, and match their view with your own photo. Get within ${CATCH_RADIUS_METERS} m, line it up, and you’ve caught the shot.`,
    },
    {
        icon: 'earth',
        title: 'Build your travel passport',
        body: 'Share new spots to put them on the map — every shot is an invitation. When someone catches yours, you’ll know they stood right where you stood.',
    },
]

export default function OnboardingModal() {
    const [visible, setVisible] = useState(false)
    const [step, setStep] = useState(0)

    useEffect(() => {
        AsyncStorage.getItem(ONBOARDING_SEEN_KEY)
            .then((seen) => {
                if (!seen) setVisible(true)
            })
            .catch(() => {})
    }, [])

    const dismiss = () => {
        setVisible(false)
        AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true').catch(() => {})
    }

    const isLastStep = step === STEPS.length - 1
    const current = STEPS[step]

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={dismiss}
        >
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <TouchableOpacity
                        style={styles.skipButton}
                        onPress={dismiss}
                        accessibilityLabel="Skip intro"
                        accessibilityRole="button"
                    >
                        <Text style={styles.skipText}>Skip</Text>
                    </TouchableOpacity>

                    <View style={styles.iconCircle}>
                        <Ionicons
                            name={current.icon}
                            size={44}
                            color={colors.primary}
                        />
                    </View>

                    <Text style={styles.title} accessibilityRole="header">
                        {current.title}
                    </Text>
                    <Text style={styles.body}>{current.body}</Text>

                    <View style={styles.dots}>
                        {STEPS.map((_, index) => (
                            <View
                                key={index}
                                style={[
                                    styles.dot,
                                    index === step && styles.dotActive,
                                ]}
                            />
                        ))}
                    </View>

                    <TouchableOpacity
                        style={styles.nextButton}
                        onPress={() =>
                            isLastStep ? dismiss() : setStep(step + 1)
                        }
                        accessibilityLabel={
                            isLastStep ? 'Start exploring' : 'Next'
                        }
                        accessibilityRole="button"
                    >
                        <Text style={styles.nextButtonText}>
                            {isLastStep ? 'Start Exploring' : 'Next'}
                        </Text>
                        {!isLastStep && (
                            <Ionicons
                                name="arrow-forward"
                                size={18}
                                color={colors.inverseTextPrimary}
                            />
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    )
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    card: {
        width: '100%',
        maxWidth: 400,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 24,
        paddingTop: 32,
        alignItems: 'center',
    },
    skipButton: {
        position: 'absolute',
        top: 12,
        right: 12,
        padding: 8,
    },
    skipText: {
        fontSize: 14,
        color: colors.textTertiary,
        fontWeight: '600',
    },
    iconCircle: {
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: colors.cardElevated,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.textPrimary,
        textAlign: 'center',
        marginBottom: 10,
    },
    body: {
        fontSize: 15,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 24,
        minHeight: 88,
    },
    dots: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 20,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.cardElevated,
    },
    dotActive: {
        backgroundColor: colors.primary,
    },
    nextButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: colors.primary,
        borderRadius: 12,
        paddingVertical: 14,
        alignSelf: 'stretch',
    },
    nextButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.inverseTextPrimary,
    },
})
