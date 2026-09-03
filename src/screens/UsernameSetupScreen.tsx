import UnifiedAuthLayout from '@/components/UnifiedAuthLayout'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { validateUsernameFormat } from '@/utils/usernameValidation'
import { registerForPushNotificationsAsync } from '@/utils/registerForPushNotificationsAsync'
import React, { useState } from 'react'
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { doc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/services/firebase'

export default function UsernameSetupScreen() {
    const [username, setUsername] = useState('')
    const [loading, setLoading] = useState(false)
    const [signingOut, setSigningOut] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { user, logout } = useAuth()
    const { showToast } = useToast()

    /**
     * Escape hatch: auth state persists across app restarts, so a signed-in
     * user without a user doc always lands back here — without this they
     * could never return to the login screen or switch accounts.
     */
    const handleSignOut = async () => {
        setSigningOut(true)
        try {
            await logout()
            // Root layout redirects to /login on the auth state change
        } catch (error: any) {
            setSigningOut(false)
            showToast('error', 'Sign Out Failed', error.message)
        }
    }

    const handleSubmit = async () => {
        if (!user) return

        // Clear previous error
        setError(null)

        // Validate format client-side (server also validates)
        const formatError = validateUsernameFormat(username)
        if (formatError) {
            setError(formatError)
            return
        }

        setLoading(true)
        try {
            // Atomically check username uniqueness + create user doc via Cloud Function
            const setupUsernameFn = httpsCallable(functions, 'setupUsername')
            await setupUsernameFn({ username })

            // The user doc now exists, so save the push token — AuthContext
            // only registers it when the doc already exists at sign-in time,
            // which is never the case for a brand-new account. Fire and
            // forget: pushToken is a self-updatable field per security rules.
            const uid = user.uid
            registerForPushNotificationsAsync().then((token) => {
                if (token) {
                    updateDoc(doc(db, 'users', uid), {
                        pushToken: token,
                    }).catch((err) =>
                        console.error('Error saving push token:', err)
                    )
                }
            })

            // Don't navigate here — the root layout redirects to tabs once
            // its user-doc snapshot arrives. Navigating now races that
            // listener and bounces back to this screen (where a retry would
            // fail with "already-exists"). Keep the spinner until redirect.
        } catch (error: any) {
            const message = error?.message || 'Something went wrong'
            if (
                message.includes('already taken') ||
                message.includes('already-exists')
            ) {
                setError('Username is already taken')
            } else {
                showToast('error', 'Setup Failed', message)
            }
            setLoading(false)
        }
    }

    return (
        <UnifiedAuthLayout title="Welcome" subtitle="Choose your username">
            <TextInput
                style={[styles.input, error && styles.inputError]}
                placeholder="Username"
                placeholderTextColor={colors.textTertiary}
                value={username}
                onChangeText={(text) => {
                    setUsername(text)
                    setError(null) // Clear error when user types
                }}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                maxLength={20}
                accessibilityLabel="Username"
                accessibilityHint="Choose a username, 3 to 20 characters"
            />

            {error && (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            <View style={styles.hintContainer}>
                <Text style={styles.hintText}>
                    • 3-20 characters{'\n'}• Letters, numbers, underscores, and
                    hyphens only
                </Text>
            </View>

            <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={loading}
                accessibilityLabel="Continue"
                accessibilityRole="button"
                accessibilityHint="Submit your chosen username"
                accessibilityState={{ disabled: loading }}
            >
                {loading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.buttonText}>Continue</Text>
                )}
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.signOutButton}
                onPress={handleSignOut}
                disabled={loading || signingOut}
                accessibilityLabel="Use a different account"
                accessibilityRole="button"
                accessibilityHint="Signs out and returns to the login screen"
                accessibilityState={{ disabled: loading || signingOut }}
            >
                {signingOut ? (
                    <ActivityIndicator
                        color={colors.textTertiary}
                        size="small"
                    />
                ) : (
                    <Text style={styles.signOutText}>
                        Use a different account
                    </Text>
                )}
            </TouchableOpacity>
        </UnifiedAuthLayout>
    )
}

const styles = StyleSheet.create({
    input: {
        backgroundColor: colors.card,
        paddingHorizontal: 15,
        paddingVertical: 12,
        borderRadius: 10,
        fontSize: 16,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.textPrimary,
    },
    inputError: {
        borderColor: '#ff4444',
    },
    errorContainer: {
        marginBottom: 10,
    },
    errorText: {
        color: '#ff4444',
        fontSize: 14,
    },
    hintContainer: {
        marginBottom: 20,
    },
    hintText: {
        color: colors.textTertiary,
        fontSize: 13,
        lineHeight: 18,
    },
    button: {
        backgroundColor: colors.primary,
        paddingVertical: 15,
        borderRadius: 10,
        alignItems: 'center',
        marginTop: 10,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    buttonText: {
        color: colors.textPrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    signOutButton: {
        alignItems: 'center',
        paddingVertical: 12,
        marginTop: 16,
    },
    signOutText: {
        color: colors.textTertiary,
        fontSize: 14,
        textDecorationLine: 'underline',
    },
})
