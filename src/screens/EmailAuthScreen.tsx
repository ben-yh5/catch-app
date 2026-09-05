import UnifiedAuthLayout from '@/components/UnifiedAuthLayout'
import AppButton from '@/components/ui/AppButton'
import AppInput from '@/components/ui/AppInput'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

type Mode = 'signin' | 'signup'

export default function EmailAuthScreen() {
    const [mode, setMode] = useState<Mode>('signin')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [resetting, setResetting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { loginWithEmail, signupWithEmail, resetPassword } = useAuth()
    const { showToast } = useToast()

    const isSignup = mode === 'signup'

    const handleSubmit = async () => {
        if (loading || resetting) return
        setError(null)

        if (!email.trim()) {
            setError('Enter your email address.')
            return
        }
        if (!password) {
            setError('Enter a password.')
            return
        }

        setLoading(true)
        try {
            if (isSignup) {
                await signupWithEmail(email, password)
                // New user has no Firestore doc — the root layout redirects
                // to /username-setup. Keep the spinner until then.
            } else {
                await loginWithEmail(email, password)
                // Root layout redirects to tabs on the auth state change.
            }
        } catch (err: any) {
            setError(err.message)
            setLoading(false)
        }
    }

    const handleForgotPassword = async () => {
        if (loading || resetting) return
        setError(null)

        if (!email.trim()) {
            setError('Enter your email above first, then tap Forgot password.')
            return
        }

        setResetting(true)
        try {
            await resetPassword(email)
            // Enumeration-safe phrasing: Firebase reports success even for
            // unknown emails when enumeration protection is on.
            showToast(
                'success',
                'Reset Link Sent',
                'If an account exists for this email, a password reset link is on its way.'
            )
        } catch (err: any) {
            setError(err.message)
        } finally {
            setResetting(false)
        }
    }

    const switchMode = (next: Mode) => {
        if (loading || resetting) return
        setMode(next)
        setError(null)
    }

    return (
        <UnifiedAuthLayout
            title={isSignup ? 'Sign Up' : 'Sign In'}
            subtitle={
                isSignup
                    ? 'Create an account with your email'
                    : 'Welcome back'
            }
        >
            <AppInput
                placeholder="Email"
                value={email}
                onChangeText={(text) => {
                    setEmail(text)
                    setError(null)
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                editable={!loading && !resetting}
                accessibilityLabel="Email"
            />

            <AppInput
                placeholder="Password"
                value={password}
                onChangeText={(text) => {
                    setPassword(text)
                    setError(null)
                }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType={isSignup ? 'newPassword' : 'password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                editable={!loading && !resetting}
                accessibilityLabel="Password"
                rightIcon={
                    <TouchableOpacity
                        onPress={() => setShowPassword((v) => !v)}
                        accessibilityRole="button"
                        accessibilityLabel={
                            showPassword ? 'Hide password' : 'Show password'
                        }
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons
                            name={showPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={colors.textTertiary}
                        />
                    </TouchableOpacity>
                }
            />

            {isSignup && (
                <Text style={styles.hintText}>At least 6 characters</Text>
            )}

            {error && <Text style={styles.errorText}>{error}</Text>}

            <AppButton
                title={isSignup ? 'Create Account' : 'Sign In'}
                onPress={handleSubmit}
                loading={loading}
                disabled={resetting}
                block
                style={styles.submitButton}
                accessibilityHint={
                    isSignup
                        ? 'Creates a new account with this email and password'
                        : 'Signs in with this email and password'
                }
            />

            {!isSignup && (
                <TouchableOpacity
                    style={styles.linkButton}
                    onPress={handleForgotPassword}
                    disabled={loading || resetting}
                    accessibilityRole="button"
                    accessibilityLabel="Forgot password"
                    accessibilityHint="Sends a password reset link to the email entered above"
                    accessibilityState={{ disabled: loading || resetting }}
                >
                    <Text style={styles.linkText}>
                        {resetting ? 'Sending reset link…' : 'Forgot password?'}
                    </Text>
                </TouchableOpacity>
            )}

            <View style={styles.switchRow}>
                <Text style={styles.switchPrompt}>
                    {isSignup
                        ? 'Already have an account?'
                        : "Don't have an account?"}
                </Text>
                <TouchableOpacity
                    onPress={() => switchMode(isSignup ? 'signin' : 'signup')}
                    disabled={loading || resetting}
                    accessibilityRole="button"
                    accessibilityLabel={
                        isSignup ? 'Switch to sign in' : 'Switch to sign up'
                    }
                    accessibilityState={{ disabled: loading || resetting }}
                >
                    <Text style={styles.switchAction}>
                        {isSignup ? 'Sign in' : 'Sign up'}
                    </Text>
                </TouchableOpacity>
            </View>
        </UnifiedAuthLayout>
    )
}

const styles = StyleSheet.create({
    hintText: {
        color: colors.textTertiary,
        fontSize: 13,
        marginBottom: 12,
        marginLeft: 4,
    },
    errorText: {
        color: colors.danger,
        fontSize: 14,
        marginBottom: 12,
        marginLeft: 4,
    },
    submitButton: {
        marginTop: 4,
    },
    linkButton: {
        alignItems: 'center',
        paddingVertical: 14,
    },
    linkText: {
        color: colors.textSecondary,
        fontSize: 14,
        textDecorationLine: 'underline',
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 16,
        gap: 6,
    },
    switchPrompt: {
        color: colors.textTertiary,
        fontSize: 14,
    },
    switchAction: {
        color: colors.primary,
        fontSize: 14,
        fontWeight: '600',
    },
})
