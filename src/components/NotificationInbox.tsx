import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Notification } from '@/types/Notification'
import { Post } from '@/types'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { doc, getDoc } from 'firebase/firestore'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import CatchPostcardModal from './CatchPostcardModal'
import ThreadModal from './ThreadModal'

type FilterType = 'all' | 'catches' | 'social'

interface ActivityFeedProps {
    visible: boolean
    onClose: () => void
}

export default function ActivityFeed({ visible, onClose }: ActivityFeedProps) {
    const {
        notifications,
        markAllNotificationsAsRead,
        clearAllNotifications,
        totalPosts,
        totalCatches,
    } = useAuth()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const [hydratedNotifications, setHydratedNotifications] = useState<
        Notification[]
    >([])
    const [loading, setLoading] = useState(false)
    const [activeFilter, setActiveFilter] = useState<FilterType>('all')
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [threadModalVisible, setThreadModalVisible] = useState(false)
    const [postcardNotification, setPostcardNotification] =
        useState<Notification | null>(null)

    // Hydrate notifications with user/post data
    // Mark-all-read happens on CLOSE, not open — so unread styling stays
    // visible while the user is actually looking at what's new
    const wasOpenRef = useRef(false)
    useEffect(() => {
        if (visible) {
            wasOpenRef.current = true
            if (notifications.length > 0) {
                hydrateNotifications()
            }
        } else {
            if (wasOpenRef.current) {
                wasOpenRef.current = false
                markAllNotificationsAsRead()
            }
            setHydratedNotifications([])
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, notifications])

    const hydrateNotifications = async () => {
        setLoading(true)
        // Allowlist of renderable types: legacy 'royalty' maps to 'caught';
        // anything unknown (incl. retired xp_* points-era entries) is dropped
        // rather than rendered with wrong copy.
        const renderable = notifications
            .filter((n) =>
                ['caught', 'royalty', 'follow', 'new_post'].includes(
                    n.type as string
                )
            )
            .map((n) =>
                (n.type as string) === 'royalty'
                    ? { ...n, type: 'caught' as const }
                    : n
            )

        // Hydrate each unique user/post ONCE instead of one fetch per
        // notification (the same follower or post appears many times)
        const userIds = [
            ...new Set(
                renderable
                    .map((n) => n.fromUserId)
                    .filter((id): id is string => Boolean(id))
            ),
        ]
        // catchPostIds ride the same batch: the catcher's photo turns a
        // caught row into a postcard (older docs without one fall back to
        // the plain thread path)
        const postIds = [
            ...new Set(
                renderable
                    .flatMap((n) => [n.postId, n.catchPostId])
                    .filter((id): id is string => Boolean(id))
            ),
        ]

        const fetchDocs = async (collectionName: string, ids: string[]) =>
            new Map(
                await Promise.all(
                    ids.map(async (id) => {
                        try {
                            const snap = await getDoc(
                                doc(db, collectionName, id)
                            )
                            return [
                                id,
                                snap.exists() ? snap.data() : null,
                            ] as const
                        } catch (e) {
                            console.warn(
                                `Error hydrating ${collectionName}/${id}:`,
                                e
                            )
                            return [id, null] as const
                        }
                    })
                )
            )

        const [users, posts] = await Promise.all([
            fetchDocs('users', userIds),
            fetchDocs('posts', postIds),
        ])

        const hydrated = renderable.map((n): Notification => {
            const note = { ...n } as Notification
            if (note.fromUserId) {
                const userData = users.get(note.fromUserId)
                note.fromUsername = userData?.username || 'Unknown'
                note.fromUserPhoto = userData?.profilePicture
            }
            if (note.postId) {
                note.postThumbnail = posts.get(note.postId)?.photoURL
            }
            if (note.catchPostId) {
                const catchPost = posts.get(note.catchPostId)
                note.catchPhotoURL = catchPost?.photoURL
                note.catchCreatedAt = catchPost?.createdAt
                // The catcher's shot is the thing that happened — show it
                // in the row rather than the root's photo
                if (catchPost?.photoURL) {
                    note.postThumbnail = catchPost.photoURL
                }
            }
            return note
        })
        setHydratedNotifications(hydrated)
        setLoading(false)
    }

    const filteredNotifications = useMemo(() => {
        if (activeFilter === 'all') return hydratedNotifications
        if (activeFilter === 'catches') {
            return hydratedNotifications.filter((n) => n.type === 'caught')
        }
        // social
        return hydratedNotifications.filter((n) =>
            ['follow', 'new_post'].includes(n.type)
        )
    }, [hydratedNotifications, activeFilter])

    const handleNotificationPress = (notification: Notification) => {
        if (notification.type === 'follow' && notification.fromUserId) {
            onClose()
            router.push({
                pathname: '/user-profile',
                params: { userId: notification.fromUserId },
            })
            return
        }

        // A hydrated caught notification opens as a postcard — the
        // catcher's photo, postmarked. Old docs (no catchPostId) and
        // deleted catch posts (no hydrated photo) take the thread path.
        if (
            notification.type === 'caught' &&
            notification.catchPostId &&
            notification.catchPhotoURL
        ) {
            setPostcardNotification(notification)
            return
        }

        // Post-related notifications: open the ThreadModal the same frame
        // with a bare {id} stub — ThreadModal shows its skeleton and fetches
        // the thread itself (and toasts + closes if the shot was deleted).
        // Fetching here first left the row feeling dead on slow connections.
        if (notification.postId) {
            setSelectedPost({ id: notification.postId } as Post)
            setThreadModalVisible(true)
        }
    }

    const formatDate = (timestamp: any) => {
        if (!timestamp) return ''
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
        const now = new Date()
        const diff = now.getTime() - date.getTime()

        if (diff < 3600000) {
            const mins = Math.floor(diff / 60000)
            return `${mins}m`
        }
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000)
            return `${hours}h`
        }
        const days = Math.floor(diff / 86400000)
        if (days < 7) return `${days}d`
        if (days < 30) return `${Math.floor(days / 7)}w`
        if (days < 365) return `${Math.floor(days / 30)}mo`
        return `${Math.floor(days / 365)}y`
    }

    const handleClearAll = () => {
        Alert.alert(
            'Clear All Activity',
            'All activity history will be permanently deleted. This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await clearAllNotifications()
                        } catch {
                            Alert.alert('Error', 'Failed to clear activity')
                        }
                    },
                },
            ]
        )
    }

    const renderNotificationIcon = (item: Notification) => {
        // Show the avatar of whoever the notification is from
        if (item.fromUserPhoto) {
            return (
                <Image
                    source={{ uri: item.fromUserPhoto }}
                    style={styles.avatarImage}
                    contentFit="cover"
                />
            )
        }
        return (
            <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                    {item.fromUsername
                        ? item.fromUsername[0].toUpperCase()
                        : '?'}
                </Text>
            </View>
        )
    }

    const renderNotificationText = (item: Notification) => {
        if (item.type === 'follow') {
            return (
                <Text style={styles.itemText}>
                    <Text style={styles.username}>@{item.fromUsername} </Text>
                    started following you
                </Text>
            )
        }
        if (item.type === 'new_post') {
            return (
                <Text style={styles.itemText}>
                    <Text style={styles.username}>@{item.fromUsername} </Text>
                    posted a new photo
                </Text>
            )
        }
        // caught — someone stood where you stood and re-took your photo
        return (
            <Text style={styles.itemText}>
                <Text style={styles.username}>@{item.fromUsername} </Text>
                caught your shot!
            </Text>
        )
    }

    const showThumbnail = (item: Notification) =>
        ['caught', 'new_post'].includes(item.type) && item.postThumbnail

    const filters: { key: FilterType; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: 'catches', label: 'Catches' },
        { key: 'social', label: 'Social' },
    ]

    return (
        <Modal
            visible={visible}
            animationType="none"
            transparent
            onRequestClose={onClose}
        >
            {/* RN Modal's built-in slide waits on the native presentation
                (~300ms with the full inbox mounted behind it); animate the
                content ourselves so opening feels immediate — same pattern
                as ThreadModal */}
            <Animated.View
                entering={FadeIn.duration(150)}
                style={styles.container}
            >
                <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
                    <TouchableOpacity
                        onPress={onClose}
                        style={styles.closeButton}
                        accessibilityLabel="Close"
                        accessibilityRole="button"
                    >
                        <Ionicons
                            name="close"
                            size={24}
                            color={colors.textPrimary}
                        />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle} accessibilityRole="header">
                        Activity
                    </Text>
                    {hydratedNotifications.length > 0 && (
                        <TouchableOpacity
                            onPress={handleClearAll}
                            style={styles.clearButton}
                            accessibilityLabel="Clear all activity"
                            accessibilityRole="button"
                        >
                            <Ionicons
                                name="trash-outline"
                                size={24}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                    )}
                </View>

                {loading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator
                            size="large"
                            color={colors.primary}
                        />
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={styles.content}>
                        {/* Passport Summary */}
                        <View style={styles.summaryContainer}>
                            <View style={styles.summaryStats}>
                                <View style={styles.summaryStatItem}>
                                    <Text style={styles.summaryStatNumber}>
                                        {totalPosts}
                                    </Text>
                                    <Text style={styles.summaryStatLabel}>
                                        Posts
                                    </Text>
                                </View>
                                <View style={styles.summaryDivider} />
                                <View style={styles.summaryStatItem}>
                                    <Text style={styles.summaryStatNumber}>
                                        {totalCatches}
                                    </Text>
                                    <Text style={styles.summaryStatLabel}>
                                        Catches
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Filter Tabs */}
                        <View style={styles.filterRow}>
                            {filters.map((f) => (
                                <TouchableOpacity
                                    key={f.key}
                                    style={[
                                        styles.filterTab,
                                        activeFilter === f.key &&
                                            styles.filterTabActive,
                                    ]}
                                    onPress={() => setActiveFilter(f.key)}
                                    accessibilityRole="button"
                                    accessibilityLabel={f.label}
                                    accessibilityState={{
                                        selected: activeFilter === f.key,
                                    }}
                                >
                                    <Text
                                        style={[
                                            styles.filterTabText,
                                            activeFilter === f.key &&
                                                styles.filterTabTextActive,
                                        ]}
                                    >
                                        {f.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* Activity List */}
                        <View style={styles.activitySection}>
                            {filteredNotifications.length === 0 ? (
                                <View style={styles.emptyState}>
                                    <Ionicons
                                        name="pulse-outline"
                                        size={48}
                                        color={colors.textTertiary}
                                    />
                                    <Text style={styles.emptyText}>
                                        No activity yet
                                    </Text>
                                </View>
                            ) : (
                                filteredNotifications.map((item) => (
                                    <TouchableOpacity
                                        key={item.id}
                                        style={[
                                            styles.item,
                                            !item.read && styles.unreadItem,
                                        ]}
                                        onPress={() =>
                                            handleNotificationPress(item)
                                        }
                                        accessibilityRole="button"
                                        accessibilityHint="View details"
                                    >
                                        <View style={styles.avatarContainer}>
                                            {renderNotificationIcon(item)}
                                        </View>

                                        <View style={styles.itemContent}>
                                            {renderNotificationText(item)}
                                            <Text style={styles.timeText}>
                                                {formatDate(item.createdAt)}
                                            </Text>
                                        </View>

                                        {showThumbnail(item) && (
                                            <Image
                                                source={{
                                                    uri: item.postThumbnail,
                                                }}
                                                style={styles.postThumbnail}
                                                contentFit="cover"
                                            />
                                        )}
                                    </TouchableOpacity>
                                ))
                            )}
                        </View>
                    </ScrollView>
                )}
            </Animated.View>

            <CatchPostcardModal
                visible={postcardNotification !== null}
                notification={postcardNotification}
                onOpenThread={(catchPostId) => {
                    // The bare stub lands the thread pager on the catch
                    // frame — ThreadModal follows the root pointer itself
                    setPostcardNotification(null)
                    setSelectedPost({ id: catchPostId } as Post)
                    setThreadModalVisible(true)
                }}
                onClose={() => setPostcardNotification(null)}
            />

            <ThreadModal
                visible={threadModalVisible}
                post={selectedPost}
                initialPostId={selectedPost?.id}
                onClose={() => {
                    setThreadModalVisible(false)
                    setSelectedPost(null)
                }}
            />
        </Modal>
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
        justifyContent: 'center',
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        position: 'relative',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    closeButton: {
        position: 'absolute',
        left: 16,
        padding: 8,
        zIndex: 1,
        bottom: 8,
    },
    clearButton: {
        position: 'absolute',
        right: 16,
        padding: 8,
        zIndex: 1,
        bottom: 8,
    },
    content: {
        paddingBottom: 40,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Passport Summary
    summaryContainer: {
        alignItems: 'center',
        paddingVertical: 24,
        paddingHorizontal: 24,
    },
    summaryStats: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.cardElevated,
        borderRadius: 12,
        paddingVertical: 14,
        width: '100%',
        maxWidth: 280,
    },
    summaryStatItem: {
        flex: 1,
        alignItems: 'center',
    },
    summaryStatNumber: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    summaryStatLabel: {
        fontSize: 12,
        color: colors.textTertiary,
        marginTop: 2,
    },
    summaryDivider: {
        width: 1,
        height: 28,
        backgroundColor: colors.border,
    },

    // Filter Tabs
    filterRow: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    filterTab: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: colors.cardElevated,
    },
    filterTabActive: {
        backgroundColor: colors.primary,
    },
    filterTabText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textTertiary,
    },
    filterTabTextActive: {
        color: colors.inverseTextPrimary,
    },

    // Activity List
    activitySection: {},
    emptyState: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    emptyText: {
        color: colors.textSecondary,
        fontSize: 16,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    unreadItem: {
        backgroundColor: colors.surface,
    },
    avatarContainer: {
        marginRight: 12,
    },
    avatarImage: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.surface,
    },
    avatarPlaceholder: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarInitial: {
        color: colors.inverseTextPrimary,
        fontSize: 18,
        fontWeight: 'bold',
    },
    itemContent: {
        flex: 1,
        marginRight: 12,
    },
    itemText: {
        fontSize: 14,
        color: colors.textPrimary,
        lineHeight: 20,
        marginBottom: 4,
    },
    username: {
        fontWeight: 'bold',
    },
    timeText: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    postThumbnail: {
        width: 44,
        height: 44,
        borderRadius: 2,
        backgroundColor: colors.imageBackground,
    },
})
