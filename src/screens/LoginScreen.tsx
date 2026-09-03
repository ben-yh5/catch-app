import AppButton from '@/components/ui/AppButton'
import { useToast } from '@/components/ui/Toast'
import {
    PRIVACY_POLICY_URL,
    TERMS_OF_SERVICE_URL,
    openLegalUrl,
} from '@/constants/legal'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import * as AppleAuthentication from 'expo-apple-authentication'
import React, { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'

/**
 * Decorative pin constellation, loosely tracing the continents west to east.
 * Uses the app's real map-pin language: blue = uncaught, pink = caught,
 * gold = lost place (the larger focal pin). Coordinates are percentages of
 * the pin field, which fills the area above the content column.
 */
const PIN_COLORS = {
    uncaught: {
        dot: colors.pinDefault,
        halo: 'rgba(0, 122, 255, 0.16)',
    },
    caught: {
        dot: colors.pinCaught,
        halo: 'rgba(207, 44, 246, 0.18)',
    },
    lost: {
        dot: colors.pinLostPlace,
        halo: 'rgba(255, 215, 0, 0.20)',
    },
}

type PinKind = keyof typeof PIN_COLORS

const PINS: { x: number; y: number; size: number; kind: PinKind }[] = [
    // North America
    { x: 12, y: 18, size: 6, kind: 'uncaught' },
    { x: 19, y: 27, size: 5, kind: 'uncaught' },
    { x: 25, y: 21, size: 6, kind: 'caught' },
    { x: 15, y: 36, size: 5, kind: 'uncaught' },
    // South America
    { x: 27, y: 55, size: 5, kind: 'uncaught' },
    { x: 31, y: 68, size: 6, kind: 'lost' },
    { x: 23, y: 63, size: 5, kind: 'uncaught' },
    // Europe
    { x: 45, y: 16, size: 5, kind: 'uncaught' },
    { x: 51, y: 22, size: 6, kind: 'caught' },
    { x: 44, y: 27, size: 5, kind: 'uncaught' },
    // Africa
    { x: 49, y: 42, size: 6, kind: 'uncaught' },
    { x: 54, y: 55, size: 5, kind: 'uncaught' },
    { x: 47, y: 62, size: 5, kind: 'uncaught' },
    // Asia — the large gold pin is the focal point of the screen
    { x: 63, y: 18, size: 5, kind: 'uncaught' },
    { x: 71, y: 27, size: 11, kind: 'lost' },
    { x: 79, y: 20, size: 5, kind: 'uncaught' },
    { x: 66, y: 38, size: 6, kind: 'caught' },
    { x: 75, y: 44, size: 5, kind: 'uncaught' },
    // Oceania
    { x: 83, y: 62, size: 5, kind: 'uncaught' },
    { x: 89, y: 53, size: 5, kind: 'uncaught' },
]

export default function LoginScreen() {
    const [loading, setLoading] = useState(false)
    const [appleAvailable, setAppleAvailable] = useState(false)
    const { loginWithGoogle, loginWithApple } = useAuth()
    const { showToast } = useToast()
    const insets = useSafeAreaInsets()

    useEffect(() => {
        if (Platform.OS === 'ios') {
            AppleAuthentication.isAvailableAsync().then(setAppleAvailable)
        }
    }, [])

    const handleGoogleLogin = async () => {
        if (loading) return
        setLoading(true)
        try {
            await loginWithGoogle()
            // Navigation is handled automatically by the auth state change
        } catch (error: any) {
            showToast('error', 'Google Sign-In Failed', error.message)
        } finally {
            setLoading(false)
        }
    }

    const handleAppleLogin = async () => {
        if (loading) return
        setLoading(true)
        try {
            await loginWithApple()
            // Navigation is handled automatically by the auth state change
        } catch (error: any) {
            showToast('error', 'Apple Sign-In Failed', error.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <View style={styles.container}>
            <View
                style={styles.pinField}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            >
                {PINS.map((pin, i) => {
                    const { dot, halo } = PIN_COLORS[pin.kind]
                    const haloSize = pin.size * 3
                    return (
                        <Animated.View
                            key={i}
                            entering={FadeIn.delay(100 + i * 60).duration(800)}
                            style={[
                                styles.halo,
                                {
                                    left: `${pin.x}%`,
                                    top: `${pin.y}%`,
                                    width: haloSize,
                                    height: haloSize,
                                    borderRadius: haloSize / 2,
                                    backgroundColor: halo,
                                },
                            ]}
                        >
                            <View
                                style={{
                                    width: pin.size,
                                    height: pin.size,
                                    borderRadius: pin.size / 2,
                                    backgroundColor: dot,
                                }}
                            />
                        </Animated.View>
                    )
                })}
            </View>

            <View
                style={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 16) + 8 },
                ]}
            >
                <Animated.View
                    entering={FadeInDown.delay(500).duration(600)}
                    style={styles.branding}
                >
                    <Text style={styles.title} accessibilityRole="header">
                        Catch
                    </Text>
                    <Text style={styles.subtitle}>
                        Find spots other travelers shared. Stand where they
                        stood to catch them.
                    </Text>
                </Animated.View>

                <Animated.View
                    entering={FadeInDown.delay(650).duration(600)}
                    style={styles.buttons}
                >
                    <AppButton
                        title="Continue with Google"
                        onPress={handleGoogleLogin}
                        loading={loading}
                        variant="white"
                        block
                        icon={
                            <Ionicons
                                name="logo-google"
                                size={18}
                                color={colors.inverseTextPrimary}
                            />
                        }
                        accessibilityLabel="Continue with Google"
                        accessibilityRole="button"
                        accessibilityState={{ disabled: loading }}
                    />

                    {appleAvailable && (
                        <View
                            style={[
                                styles.appleContainer,
                                loading && styles.appleDisabled,
                            ]}
                            pointerEvents={loading ? 'none' : 'auto'}
                        >
                            <AppleAuthentication.AppleAuthenticationButton
                                buttonType={
                                    AppleAuthentication
                                        .AppleAuthenticationButtonType.CONTINUE
                                }
                                buttonStyle={
                                    AppleAuthentication
                                        .AppleAuthenticationButtonStyle.WHITE
                                }
                                cornerRadius={12}
                                style={styles.appleButton}
                                onPress={handleAppleLogin}
                            />
                        </View>
                    )}

                    <Text style={styles.legal}>
                        By continuing, you agree to our{' '}
                        <Text
                            style={styles.legalLink}
                            onPress={() => openLegalUrl(TERMS_OF_SERVICE_URL)}
                            accessibilityRole="link"
                        >
                            Terms of Service
                        </Text>{' '}
                        and{' '}
                        <Text
                            style={styles.legalLink}
                            onPress={() => openLegalUrl(PRIVACY_POLICY_URL)}
                            accessibilityRole="link"
                        >
                            Privacy Policy
                        </Text>
                        .
                    </Text>
                </Animated.View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    pinField: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '58%',
    },
    halo: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    branding: {
        alignItems: 'center',
        marginBottom: 36,
    },
    title: {
        fontSize: 52,
        fontWeight: 'bold',
        letterSpacing: -1,
        color: colors.textPrimary,
        marginBottom: 12,
    },
    subtitle: {
        fontSize: 17,
        lineHeight: 24,
        color: colors.textSecondary,
        textAlign: 'center',
        maxWidth: 300,
    },
    buttons: {
        width: '100%',
        maxWidth: 400,
    },
    appleContainer: {
        marginTop: 12,
    },
    appleDisabled: {
        opacity: 0.5,
    },
    appleButton: {
        width: '100%',
        height: 48,
    },
    legal: {
        fontSize: 12,
        lineHeight: 18,
        color: colors.textTertiary,
        textAlign: 'center',
        marginTop: 20,
    },
    legalLink: {
        color: colors.textSecondary,
        textDecorationLine: 'underline',
    },
})
