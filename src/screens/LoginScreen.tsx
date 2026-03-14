import UnifiedAuthLayout from '@/components/UnifiedAuthLayout'
import AppButton from '@/components/ui/AppButton'
import AppInput from '@/components/ui/AppInput'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'

export default function LoginScreen() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const { login, loginWithGoogle } = useAuth()
    const { showToast } = useToast()
    const router = useRouter()

    const handleLogin = async () => {
        if (!email || !password) {
            showToast('warning', 'Please fill in all fields')
            return
        }

        setLoading(true)
        try {
            await login(email, password)
            // Navigation will be handled automatically by auth state change
        } catch (error: any) {
            showToast('error', 'Login Failed', error.message)
        } finally {
            setLoading(false)
        }
    }

    const handleGoogleLogin = async () => {
        setLoading(true)
        try {
            await loginWithGoogle()
            // Navigation will be handled automatically by auth state change
        } catch (error: any) {
            showToast('error', 'Google Sign-In Failed', error.message)
        } finally {
            setLoading(false)
        }
    }

    const goToSignup = () => {
        router.push('/signup')
    }

    return (
        <UnifiedAuthLayout title="Catch" subtitle="Welcome back!">
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
                <AppInput
                    placeholder="Email"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    editable={!loading}
                    leftIcon={
                        <Ionicons
                            name="mail-outline"
                            size={20}
                            color={colors.textTertiary}
                        />
                    }
                    accessibilityLabel="Email"
                    accessibilityHint="Enter your email address"
                />

                <AppInput
                    placeholder="Password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    editable={!loading}
                    leftIcon={
                        <Ionicons
                            name="lock-closed-outline"
                            size={20}
                            color={colors.textTertiary}
                        />
                    }
                    accessibilityLabel="Password"
                    accessibilityHint="Enter your password"
                />

                <AppButton
                    title="Log In"
                    onPress={handleLogin}
                    loading={loading}
                    variant="primary"
                    style={styles.marginTop}
                    accessibilityLabel="Log In"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: loading }}
                />
            </Animated.View>

            <Animated.View
                style={styles.dividerContainer}
                entering={FadeInDown.delay(200).duration(500)}
            >
                <View style={styles.divider} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.divider} />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(300).duration(500)}>
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

            <Animated.View
                style={styles.signupContainer}
                entering={FadeInDown.delay(400).duration(500)}
            >
                <Text style={styles.signupText}>
                    Don&apos;t have an account?{' '}
                </Text>
                <TouchableOpacity
                    onPress={goToSignup}
                    disabled={loading}
                    activeOpacity={0.7}
                    accessibilityLabel="Sign Up"
                    accessibilityRole="link"
                    accessibilityHint="Navigate to the sign up screen"
                    accessibilityState={{ disabled: loading }}
                >
                    <Text style={styles.signupLink}>Sign Up</Text>
                </TouchableOpacity>
            </Animated.View>
        </UnifiedAuthLayout>
    )
}

const styles = StyleSheet.create({
    marginTop: {
        marginTop: 10,
    },
    signupContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
    signupText: {
        color: colors.textTertiary,
        fontSize: 14,
    },
    signupLink: {
        color: colors.primary,
        fontSize: 14,
        fontWeight: '600',
    },
    dividerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 24,
    },
    divider: {
        flex: 1,
        height: 1,
        backgroundColor: colors.border,
    },
    dividerText: {
        color: colors.textTertiary,
        paddingHorizontal: 12,
        fontSize: 14,
    },
})
