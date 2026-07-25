import UnifiedAuthLayout from '@/components/UnifiedAuthLayout'
import AppButton from '@/components/ui/AppButton'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import * as AppleAuthentication from 'expo-apple-authentication'
import React, { useEffect, useState } from 'react'
import { Platform, StyleSheet } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'

export default function LoginScreen() {
    const [loading, setLoading] = useState(false)
    const [appleAvailable, setAppleAvailable] = useState(false)
    const { loginWithGoogle, loginWithApple } = useAuth()
    const { showToast } = useToast()

    useEffect(() => {
        if (Platform.OS === 'ios') {
            AppleAuthentication.isAvailableAsync().then(setAppleAvailable)
        }
    }, [])

    const handleGoogleLogin = async () => {
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
        <UnifiedAuthLayout title="Catch" subtitle="Welcome!">
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
                <AppButton
                    title="Continue with Google"
                    onPress={handleGoogleLogin}
                    loading={loading}
                    variant="outline"
                    icon={
                        <Ionicons
                            name="logo-google"
                            size={18}
                            color={colors.textPrimary}
                            style={{ marginRight: 8 }}
                        />
                    }
                    accessibilityLabel="Continue with Google"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading }}
                />
            </Animated.View>

            {appleAvailable && (
                <Animated.View
                    style={styles.appleContainer}
                    entering={FadeInDown.delay(200).duration(500)}
                >
                    <AppleAuthentication.AppleAuthenticationButton
                        buttonType={
                            AppleAuthentication.AppleAuthenticationButtonType
                                .CONTINUE
                        }
                        buttonStyle={
                            AppleAuthentication.AppleAuthenticationButtonStyle
                                .WHITE_OUTLINE
                        }
                        cornerRadius={8}
                        style={styles.appleButton}
                        onPress={handleAppleLogin}
                    />
                </Animated.View>
            )}
        </UnifiedAuthLayout>
    )
}

const styles = StyleSheet.create({
    appleContainer: {
        marginTop: 12,
    },
    appleButton: {
        width: '100%',
        height: 50,
    },
})
