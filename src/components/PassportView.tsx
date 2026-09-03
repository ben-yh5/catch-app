/**
 * PassportView - Travel summary for any user
 *
 * Rendered as the Passport tab in UnifiedProfileView (own and other
 * profiles) and by the standalone /passport route. Plain View content —
 * the parent provides scrolling (profile FlatList / screen ScrollView).
 *
 * Stat tiles plus the list of cities the user has posted or caught in,
 * ordered by activity (most caught+posted first — sorted in
 * passportQueries). Pioneer counts appear per city and in the stat row.
 *
 * Data paths differ by ownership: your own passport reads user_coverage
 * directly; other users' go through the getPassport callable, which strips
 * the fine-grained geohash cells and honors their passportPublic setting.
 */

import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { radii, spacing, typography } from '@/theme/tokens'
import {
    CityStamp,
    getPassportData,
    getPublicPassportData,
    PassportData,
} from '@/utils/passportQueries'
import { Ionicons } from '@expo/vector-icons'
import { doc, getDoc } from 'firebase/firestore'
import React, { useCallback, useEffect, useState } from 'react'
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
    const [passport, setPassport] = useState<PassportData | null>(null)
    const [totalCatches, setTotalCatches] = useState<number>(0)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(false)
    const [isPrivate, setIsPrivate] = useState(false)

    const load = useCallback(async () => {
        if (!userId) return
        setLoading(true)
        setLoadError(false)
        setIsPrivate(false)
        try {
            const [passportData, userSnap] = await Promise.all([
                isOwnProfile
                    ? getPassportData(userId)
                    : getPublicPassportData(userId),
                getDoc(doc(db, 'users', userId)),
            ])
            setPassport(passportData)
            if (userSnap.exists()) {
                setTotalCatches(userSnap.data().totalCatches || 0)
            }
        } catch (e: any) {
            if (e?.code === 'functions/permission-denied') {
                setIsPrivate(true)
            } else {
                console.error('Error loading passport:', e)
                setLoadError(true)
            }
        } finally {
            setLoading(false)
        }
    }, [userId, isOwnProfile])

    useEffect(() => {
        load()
    }, [load])

    const renderCityRow = (city: CityStamp) => {
        const parts: string[] = []
        if (city.caught > 0) {
            parts.push(
                `${city.caught} ${city.caught === 1 ? 'catch' : 'catches'}`
            )
        }
        if (city.posted > 0) {
            parts.push(`${city.posted} posted`)
        }
        return (
            <View key={city.key} style={styles.cityRow}>
                <View style={styles.cityInfo}>
                    <Text style={styles.cityName} numberOfLines={1}>
                        {city.city}
                    </Text>
                    <Text style={styles.cityCountry} numberOfLines={1}>
                        {city.country}
                    </Text>
                </View>
                <View style={styles.cityCounts}>
                    <Text style={styles.cityCountsText}>
                        {parts.join(' · ')}
                    </Text>
                    {city.pioneers > 0 && (
                        <View style={styles.pioneerChip}>
                            <Ionicons
                                name="flag"
                                size={11}
                                color={colors.pinLostPlace}
                            />
                            <Text style={styles.pioneerChipText}>
                                {city.pioneers}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        )
    }

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
                    onPress={load}
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
                    <Text style={[styles.statNumber, styles.statNumberPioneer]}>
                        {passport?.pioneerCount ?? 0}
                    </Text>
                    <Text style={styles.statLabel}>Pioneers</Text>
                </View>
                <View style={styles.statTile}>
                    <Text style={[styles.statNumber, styles.statNumberCatches]}>
                        {totalCatches}
                    </Text>
                    <Text style={styles.statLabel}>Catches</Text>
                </View>
            </View>

            <Text style={styles.sectionTitle}>CITIES</Text>
            {passport?.cities.map(renderCityRow)}
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
    statNumberPioneer: {
        color: colors.pinLostPlace,
    },
    statNumberCatches: {
        color: colors.secondary,
    },
    statLabel: {
        fontSize: typography.caption,
        color: colors.textTertiary,
        marginTop: 2,
    },
    sectionTitle: {
        fontSize: typography.small,
        fontWeight: '600',
        letterSpacing: 1,
        color: colors.textTertiary,
        marginBottom: spacing.md,
    },
    cityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        backgroundColor: colors.card,
        borderRadius: radii.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        marginBottom: spacing.sm,
    },
    cityInfo: {
        flex: 1,
        minWidth: 0,
    },
    cityName: {
        fontSize: typography.bodyLarge,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    cityCountry: {
        fontSize: typography.small,
        color: colors.textTertiary,
        marginTop: 1,
    },
    cityCounts: {
        alignItems: 'flex-end',
        gap: 2,
    },
    cityCountsText: {
        fontSize: typography.small,
        color: colors.textSecondary,
    },
    pioneerChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    pioneerChipText: {
        fontSize: typography.small,
        fontWeight: '600',
        color: colors.pinLostPlace,
    },
})
