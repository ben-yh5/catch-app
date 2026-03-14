import UnifiedAuthLayout from '@/components/UnifiedAuthLayout'
import AppButton from '@/components/ui/AppButton'
import AppInput from '@/components/ui/AppInput'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import {
    isUsernameAvailable,
    validateUsernameFormat,
} from '@/utils/usernameValidation'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'

export default function SignupScreen() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [username, setUsername] = useState('')
    const [loading, setLoading] = useState(false)
    const { signup, loginWithGoogle } = useAuth()
    const { showToast } = useToast()
    const router = useRouter()

    const handleSignup = async () => {
        // Validation
        if (!email || !password || !confirmPassword || !username) {
            showToast('warning', 'Please fill in all fields')
            return
        }

        if (password !== confirmPassword) {
            showToast('warning', 'Passwords do not match')
            return
        }

        if (password.length < 6) {
            showToast('warning', 'Password must be at least 6 characters')
            return
        }

        // Validate username format
        const formatError = validateUsernameFormat(username)
        if (formatError) {
            showToast('warning', 'Invalid Username', formatError)
            return
        }

        setLoading(true)
        try {
            // Check if username is available
            const available = await isUsernameAvailable(username)
            if (!available) {
                showToast(
                    'warning',
                    'Username Taken',
                    'This username is already in use. Please choose another.'
                )
                setLoading(false)
                return
            }

            await signup(email, password, username)
            // Navigation will be handled automatically by auth state change
        } catch (error: any) {
            showToast('error', 'Signup Failed', error.message)
        } finally {
            setLoading(false)
        }
    }

    const handleGoogleSignup = async () => {
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

    const goToLogin = () => {
        router.back()
    }

    return (
        <UnifiedAuthLayout title="Catch" subtitle="Create your account">
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
                <AppInput
                    placeholder="Username"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    editable={!loading}
                    leftIcon={
                        <Ionicons
                            name="person-outline"
                            size={20}
                            color={colors.textTertiary}
                        />
                    }
                    accessibilityLabel="Username"
                    accessibilityHint="Enter your desired username"
                />

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

                <AppInput
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    editable={!loading}
                    leftIcon={
                        <Ionicons
                            name="lock-closed-outline"
                            size={20}
                            color={colors.textTertiary}
                        />
                    }
                    accessibilityLabel="Confirm Password"
                    accessibilityHint="Re-enter your password to confirm"
                />

                <AppButton
                    title="Sign Up"
                    onPress={handleSignup}
                    loading={loading}
                    variant="primary"
                    style={styles.marginTop}
                    accessibilityLabel="Sign Up"
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
                    onPress={handleGoogleSignup}
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
                style={styles.loginContainer}
                entering={FadeInDown.delay(400).duration(500)}
            >
                <Text style={styles.loginText}>Already have an account? </Text>
                <TouchableOpacity
                    onPress={goToLogin}
                    disabled={loading}
                    activeOpacity={0.7}
                    accessibilityLabel="Log In"
                    accessibilityRole="link"
                    accessibilityHint="Navigate to the login screen"
                    accessibilityState={{ disabled: loading }}
                >
                    <Text style={styles.loginLink}>Log In</Text>
                </TouchableOpacity>
            </Animated.View>
        </UnifiedAuthLayout>
    )
}

const styles = StyleSheet.create({
    marginTop: {
        marginTop: 10,
    },
    loginContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
    loginText: {
        color: colors.textTertiary,
        fontSize: 14,
    },
    loginLink: {
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
