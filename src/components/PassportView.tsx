/**
 * PassportView - Travel summary for any user
 *
 * Rendered as the Passport tab in UnifiedProfileView (own and other
 * profiles). Plain View content — the parent provides scrolling.
 *
 * Stat tiles (Countries / Cities / Catches) plus the passport itself
 * (PassportBooklet), inline: closed cover, tap to swing open, swipe or
 * tap inside the spread to turn pages. Gesture arbitration with the
 * profile pager happens by responder claim — touches starting inside
 * the spread belong to the book; swipes outside it switch tabs.
 *
 * Pioneer counts are deliberately not surfaced — status flows through
 * catches, not through being first.
 */

import PassportBooklet from '@/components/PassportBooklet'
import { usePassportData } from '@/hooks/usePassportData'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { radii, spacing, typography } from '@/theme/tokens'
import { Ionicons } from '@expo/vector-icons'
import { doc, getDoc } from 'firebase/firestore'
import React, { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'

interface PassportViewProps {
    userId: string
    isOwnProfile: boolean
}

export default function PassportView({
    userId,
    isOwnProfile,
}: PassportViewProps) {
    const { passport, loading, loadError, isPrivate, reload } =
        usePassportData(userId, isOwnProfile)
    const [totalCatches, setTotalCatches] = useState<number>(0)

    useEffect(() => {
        if (!userId) return
        getDoc(doc(db, 'users', userId))
            .then((snap) => {
                if (snap.exists()) {
                    setTotalCatches(snap.data().totalCatches || 0)
                }
            })
            .catch((e) => console.error('Error loading user stats:', e))
    }, [userId])

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        )
    }

    if (isPrivate) {
        return (
            <View style={styles.center}>
                <Ionicons
                    name="lock-closed-outline"
                    size={48}
                    color={colors.textTertiary}
                />
                <Text style={styles.emptyTitle}>
                    This passport is private
                </Text>
            </View>
        )
    }

    if (loadError) {
        return (
            <View style={styles.center}>
                <Text style={styles.emptyText}>
                    Couldn&apos;t load {isOwnProfile ? 'your' : 'this'}{' '}
                    passport.
                </Text>
                <TouchableOpacity
                    style={styles.retryButton}
                    onPress={reload}
                    accessibilityRole="button"
                    accessibilityLabel="Retry"
                >
                    <Text style={styles.retryText}>Try Again</Text>
                </TouchableOpacity>
            </View>
        )
    }

    if (passport !== null && passport.cities.length === 0) {
        return (
            <View style={styles.center}>
                <Ionicons
                    name="earth-outline"
                    size={48}
                    color={colors.textTertiary}
                />
                <Text style={styles.emptyTitle}>No cities yet</Text>
                <Text style={styles.emptyText}>
                    {isOwnProfile
                        ? 'Your passport fills up as you share spots and catch shots around the world.'
                        : 'This passport fills up as they share spots and catch shots.'}
                </Text>
            </View>
        )
    }

    return (
        <View style={styles.content}>
            <View style={styles.statsRow}>
                <View style={styles.statTile}>
                    <Text style={styles.statNumber}>
                        {passport?.countryCount ?? 0}
                    </Text>
                    <Text style={styles.statLabel}>Countries</Text>
                </View>
                <View style={styles.statTile}>
                    <Text style={styles.statNumber}>
                        {passport?.cityCount ?? 0}
                    </Text>
                    <Text style={styles.statLabel}>Cities</Text>
                </View>
                <View style={styles.statTile}>
                    <Text style={[styles.statNumber, styles.statNumberCatches]}>
                        {totalCatches}
                    </Text>
                    <Text style={styles.statLabel}>Catches</Text>
                </View>
            </View>

            {passport && <PassportBooklet cities={passport.cities} />}
        </View>
    )
}

const styles = StyleSheet.create({
    // minHeight instead of flex:1 — this renders inside a FlatList's
    // ListEmptyComponent on the profile, where flex has no height to fill
    center: {
        minHeight: 260,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        padding: spacing.xxl,
    },
    emptyTitle: {
        fontSize: typography.bodyLarge,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    emptyText: {
        fontSize: typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    retryButton: {
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: radii.pill,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.sm,
    },
    retryText: {
        fontSize: typography.body,
        fontWeight: '600',
        color: colors.primary,
    },
    content: {
        padding: spacing.lg,
    },
    statsRow: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.xl,
    },
    statTile: {
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: radii.md,
        paddingVertical: spacing.md,
        alignItems: 'center',
    },
    statNumber: {
        fontSize: typography.title,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    statNumberCatches: {
        color: colors.secondary,
    },
    statLabel: {
        fontSize: typography.caption,
        color: colors.textTertiary,
        marginTop: 2,
    },
})
