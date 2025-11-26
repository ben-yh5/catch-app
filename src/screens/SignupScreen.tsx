import UnifiedAuthLayout from '@/components/UnifiedAuthLayout'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { isUsernameAvailable, validateUsernameFormat } from '@/utils/usernameValidation'

export default function SignupScreen() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [username, setUsername] = useState('')
    const [loading, setLoading] = useState(false)
    const { signup, loginWithGoogle } = useAuth()
    const router = useRouter()

    const handleSignup = async () => {
        // Validation
        if (!email || !password || !confirmPassword || !username) {
            Alert.alert('Error', 'Please fill in all fields')
            return
        }

        if (password !== confirmPassword) {
            Alert.alert('Error', 'Passwords do not match')
            return
        }

        if (password.length < 6) {
            Alert.alert('Error', 'Password must be at least 6 characters')
            return
        }

        // Validate username format
        const formatError = validateUsernameFormat(username)
        if (formatError) {
            Alert.alert('Invalid Username', formatError)
            return
        }

        setLoading(true)
        try {
            // Check if username is available
            const available = await isUsernameAvailable(username)
            if (!available) {
                Alert.alert('Username Taken', 'This username is already in use. Please choose another.')
                setLoading(false)
                return
            }

            await signup(email, password, username)
            // Navigation will be handled automatically by auth state change
        } catch (error: any) {
            Alert.alert('Signup Failed', error.message)
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
            Alert.alert('Google Sign-In Failed', error.message)
        } finally {
            setLoading(false)
        }
    }

    const goToLogin = () => {
        router.back()
    }

    return (
        <UnifiedAuthLayout title="Catch" subtitle="Create your account">
            <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor={colors.textTertiary}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                editable={!loading}
            />

            <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.textTertiary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!loading}
            />

            <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={colors.textTertiary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                editable={!loading}
            />

            <TextInput
                style={styles.input}
                placeholder="Confirm Password"
                placeholderTextColor={colors.textTertiary}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                editable={!loading}
            />

            <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSignup}
                disabled={loading}
            >
                {loading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.buttonText}>Sign Up</Text>
                )}
            </TouchableOpacity>

            <View style={styles.dividerContainer}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.divider} />
            </View>

            <TouchableOpacity
                style={[styles.googleButton, loading && styles.buttonDisabled]}
                onPress={handleGoogleSignup}
                disabled={loading}
            >
                <Text style={styles.googleButtonText}>Continue with Google</Text>
            </TouchableOpacity>

            <View style={styles.loginContainer}>
                <Text style={styles.loginText}>Already have an account? </Text>
                <TouchableOpacity onPress={goToLogin} disabled={loading}>
                    <Text style={styles.loginLink}>Log In</Text>
                </TouchableOpacity>
            </View>
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
        marginBottom: 15,
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.textPrimary,
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
    loginContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 20,
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
        marginVertical: 20,
    },
    divider: {
        flex: 1,
        height: 1,
        backgroundColor: colors.border,
    },
    dividerText: {
        color: colors.textTertiary,
        paddingHorizontal: 10,
        fontSize: 14,
    },
    googleButton: {
        backgroundColor: '#fff',
        paddingVertical: 15,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
    },
    googleButtonText: {
        color: '#000',
        fontSize: 16,
        fontWeight: '600',
    },
})
