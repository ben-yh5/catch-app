import UnifiedAuthLayout from '@/components/UnifiedAuthLayout'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { isUsernameAvailable, validateUsernameFormat } from '@/utils/usernameValidation'
import { useRouter } from 'expo-router'
import React, { useState, useEffect } from 'react'
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase'

export default function UsernameSetupScreen() {
    const [username, setUsername] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { user } = useAuth()
    const router = useRouter()

    const handleSubmit = async () => {
        if (!user) return

        // Clear previous error
        setError(null)

        // Validate format
        const formatError = validateUsernameFormat(username)
        if (formatError) {
            setError(formatError)
            return
        }

        setLoading(true)
        try {
            // Check if username is available
            const available = await isUsernameAvailable(username)
            if (!available) {
                setError('Username is already taken')
                setLoading(false)
                return
            }

            // Create user document in Firestore
            await setDoc(doc(db, 'users', user.uid), {
                username: username,
                email: user.email || '',
                totalCatches: 0,
                bookmarkedPosts: [],
                createdAt: new Date(),
            })

            console.log('✅ User document created, redirecting to tabs...')

            // Navigate directly to tabs
            router.replace('/(tabs)')
        } catch (error: any) {
            Alert.alert('Error', error.message)
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
            />

            {error && (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            <View style={styles.hintContainer}>
                <Text style={styles.hintText}>
                    • 3-20 characters{'\n'}
                    • Letters, numbers, underscores, and hyphens only
                </Text>
            </View>

            <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={loading}
            >
                {loading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.buttonText}>Continue</Text>
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
})
