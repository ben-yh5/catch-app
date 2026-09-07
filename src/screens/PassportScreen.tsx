/**
 * PassportScreen - Deep-link shell for the passport (/passport route).
 *
 * The passport primarily lives inline on the profile's Passport tab.
 * This route exists for deep links and direct navigation: it loads the
 * same data (pass ?userId= for someone else's passport) and renders the
 * same inline booklet centered on a plain screen.
 */

import PassportBooklet from '@/components/PassportBooklet'
import { useAuth } from '@/context/AuthContext'
import { usePassportData } from '@/hooks/usePassportData'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/tokens'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React from 'react'
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function PassportScreen() {
    const { user } = useAuth()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const params = useLocalSearchParams<{ userId?: string }>()

    const targetUserId =
        (typeof params.userId === 'string' && params.userId) || user?.uid
    const isOwnProfile = targetUserId === user?.uid

    const { passport, loading, loadError, isPrivate, reload } =
        usePassportData(targetUserId, isOwnProfile)

    if (passport !== null && passport.cities.length > 0) {
        return (
            <View style={styles.container}>
                <View style={[styles.header, { paddingTop: insets.top }]}>
                    <TouchableOpacity
                        onPress={() => router.back()}
                        style={styles.backButton}
                        accessibilityLabel="Go back"
                        accessibilityRole="button"
                    >
                        <Ionicons
                            name="arrow-back"
                            size={24}
                            color={colors.textPrimary}
                        />
                    </TouchableOpacity>
                    <Text
                        style={styles.headerTitle}
                        accessibilityRole="header"
                    >
                        Passport
                    </Text>
                </View>
                <View style={styles.center}>
                    <PassportBooklet cities={passport.cities} />
                </View>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                    accessibilityLabel="Go back"
                    accessibilityRole="button"
                >
                    <Ionicons
                        name="arrow-back"
                        size={24}
                        color={colors.textPrimary}
                    />
                </TouchableOpacity>
                <Text style={styles.headerTitle} accessibilityRole="header">
                    Passport
                </Text>
            </View>

            <View style={styles.center}>
                {loading && (
                    <ActivityIndicator size="large" color={colors.primary} />
                )}
                {isPrivate && (
                    <>
                        <Ionicons
                            name="lock-closed-outline"
                            size={48}
                            color={colors.textTertiary}
                        />
                        <Text style={styles.stateTitle}>
                            This passport is private
                        </Text>
                    </>
                )}
                {loadError && (
                    <>
                        <Text style={styles.stateText}>
                            Couldn&apos;t load{' '}
                            {isOwnProfile ? 'your' : 'this'} passport.
                        </Text>
                        <TouchableOpacity
                            style={styles.retryButton}
                            onPress={reload}
                            accessibilityRole="button"
                            accessibilityLabel="Retry"
                        >
                            <Text style={styles.retryText}>Try Again</Text>
                        </TouchableOpacity>
                    </>
                )}
                {passport !== null && passport.cities.length === 0 && (
                    <>
                        <Ionicons
                            name="earth-outline"
                            size={48}
                            color={colors.textTertiary}
                        />
                        <Text style={styles.stateTitle}>No cities yet</Text>
                        <Text style={styles.stateText}>
                            {isOwnProfile
                                ? 'Your passport fills up as you share spots and catch shots around the world.'
                                : 'This passport fills up as they share spots and catch shots.'}
                        </Text>
                    </>
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
    },
    backButton: {
        padding: spacing.sm,
        marginRight: spacing.sm,
    },
    headerTitle: {
        flex: 1,
        fontSize: typography.heading,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        padding: spacing.xxl,
    },
    stateTitle: {
        fontSize: typography.bodyLarge,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    stateText: {
        fontSize: typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    retryButton: {
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: 24,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.sm,
    },
    retryText: {
        fontSize: typography.body,
        fontWeight: '600',
        color: colors.primary,
    },
})
