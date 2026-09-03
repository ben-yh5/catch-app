/**
 * BlockedUsersScreen - Manage blocked users
 *
 * Until now you could block a user but never see or undo the list without
 * revisiting their profile. This screen lists everyone you've blocked with
 * an Unblock action per row.
 */

import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { doc, getDoc } from 'firebase/firestore'
import React, { useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface BlockedUser {
    id: string
    username: string
}

export default function BlockedUsersScreen() {
    const { blockedUserIds, unblockUser } = useAuth()
    const { showToast } = useToast()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const [users, setUsers] = useState<BlockedUser[]>([])
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(false)
    const pendingRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            setLoading(true)
            setLoadError(false)
            try {
                const snapshots = await Promise.all(
                    blockedUserIds.map((id) => getDoc(doc(db, 'users', id)))
                )
                if (cancelled) return
                setUsers(
                    snapshots.map((snap) => ({
                        id: snap.id,
                        username: snap.exists()
                            ? snap.data().username || 'Unknown'
                            : 'Deleted user',
                    }))
                )
            } catch (e) {
                console.error('Error loading blocked users:', e)
                if (!cancelled) setLoadError(true)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => {
            cancelled = true
        }
    }, [blockedUserIds])

    const handleUnblock = (target: BlockedUser) => {
        if (pendingRef.current.has(target.id)) return
        Alert.alert('Unblock user', `Unblock @${target.username}?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Unblock',
                onPress: async () => {
                    pendingRef.current.add(target.id)
                    try {
                        await unblockUser(target.id)
                        showToast('success', `Unblocked @${target.username}`)
                    } catch {
                        showToast('error', 'Failed to unblock user')
                    } finally {
                        pendingRef.current.delete(target.id)
                    }
                },
            },
        ])
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
                    Blocked Users
                </Text>
                <View style={styles.placeholder} />
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : loadError ? (
                <View style={styles.center}>
                    <Text style={styles.emptyText}>
                        Couldn&apos;t load blocked users. Go back and try
                        again.
                    </Text>
                </View>
            ) : users.length === 0 ? (
                <View style={styles.center}>
                    <Ionicons
                        name="shield-checkmark-outline"
                        size={48}
                        color={colors.textTertiary}
                    />
                    <Text style={styles.emptyText}>
                        You haven&apos;t blocked anyone.
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={users}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <Text style={styles.username}>
                                @{item.username}
                            </Text>
                            <TouchableOpacity
                                style={styles.unblockButton}
                                onPress={() => handleUnblock(item)}
                                accessibilityRole="button"
                                accessibilityLabel={`Unblock ${item.username}`}
                            >
                                <Text style={styles.unblockText}>Unblock</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                />
            )}
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
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    placeholder: {
        width: 40,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 32,
    },
    emptyText: {
        fontSize: 15,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    listContent: {
        padding: 16,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.cardElevated,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        marginBottom: 8,
    },
    username: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.textPrimary,
    },
    unblockButton: {
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    unblockText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primary,
    },
})
