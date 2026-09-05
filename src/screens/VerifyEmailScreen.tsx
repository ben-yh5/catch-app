import UnifiedAuthLayout from '@/components/UnifiedAuthLayout'
import AppButton from '@/components/ui/AppButton'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import React, { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
} from 'react-native'

/** How often to silently re-check whether the link was clicked */
const POLL_INTERVAL_MS = 4000

export default function VerifyEmailScreen() {
    const [checking, setChecking] = useState(false)
    const [resending, setResending] = useState(false)
    const [signingOut, setSigningOut] = useState(false)
    const { user, logout, resendVerificationEmail, refreshEmailVerification } =
        useAuth()
    const { showToast } = useToast()

    // Poll in the background so most users never have to tap anything —
    // once verified, needsEmailVerification flips and the root layout
    // redirects onward. Errors here are swallowed: transient network
    // failures just mean the next tick retries.
    useEffect(() => {
        const interval = setInterval(() => {
            refreshEmailVerification().catch(() => {})
        }, POLL_INTERVAL_MS)
        return () => clearInterval(interval)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleCheck = async () => {
        if (checking || resending || signingOut) return
        setChecking(true)
        try {
            const verified = await refreshEmailVerification()
            if (!verified) {
                showToast(
                    'error',
                    'Not Verified Yet',
                    "We haven't seen the link clicked. Check your inbox (and spam folder)."
                )
            }
            // If verified, the root layout redirects — keep the spinner
            // until then rather than flashing an enabled button
            if (!verified) setChecking(false)
        } catch (error: any) {
            showToast('error', 'Check Failed', error.message)
            setChecking(false)
        }
    }

    const handleResend = async () => {
        if (checking || resending || signingOut) return
        setResending(true)
        try {
            await resendVerificationEmail()
            showToast(
                'success',
                'Email Sent',
                'A new verification link is on its way.'
            )
        } catch (error: any) {
            showToast('error', 'Resend Failed', error.message)
        } finally {
            setResending(false)
        }
    }

    /**
     * Escape hatch: auth state persists across app restarts, so an
     * unverified user always lands back here — without this they could
     * never return to the login screen or switch accounts.
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

    return (
        <UnifiedAuthLayout
            title="Verify Email"
            subtitle="One more step before you start catching"
        >
            <Text style={styles.body}>
                We sent a verification link to{' '}
                <Text style={styles.email}>{user?.email}</Text>. Tap the link
                in that email, then come back here.
            </Text>

            <AppButton
                title="I've Verified"
                onPress={handleCheck}
                loading={checking}
                disabled={resending || signingOut}
                block
                accessibilityHint="Checks whether your email has been verified"
            />

            <TouchableOpacity
                style={styles.linkButton}
                onPress={handleResend}
                disabled={checking || resending || signingOut}
                accessibilityRole="button"
                accessibilityLabel="Resend verification email"
                accessibilityState={{
                    disabled: checking || resending || signingOut,
                }}
            >
                {resending ? (
                    <ActivityIndicator
                        color={colors.textTertiary}
                        size="small"
                    />
                ) : (
                    <Text style={styles.linkText}>Resend email</Text>
                )}
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.signOutButton}
                onPress={handleSignOut}
                disabled={checking || resending || signingOut}
                accessibilityRole="button"
                accessibilityLabel="Use a different account"
                accessibilityHint="Signs out and returns to the login screen"
                accessibilityState={{
                    disabled: checking || resending || signingOut,
                }}
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
    body: {
        color: colors.textSecondary,
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center',
        marginBottom: 24,
    },
    email: {
        color: colors.textPrimary,
        fontWeight: '600',
    },
    linkButton: {
        alignItems: 'center',
        paddingVertical: 14,
        marginTop: 8,
    },
    linkText: {
        color: colors.textSecondary,
        fontSize: 14,
        textDecorationLine: 'underline',
    },
    signOutButton: {
        alignItems: 'center',
        paddingVertical: 12,
        marginTop: 8,
    },
    signOutText: {
        color: colors.textTertiary,
        fontSize: 14,
        textDecorationLine: 'underline',
    },
})
