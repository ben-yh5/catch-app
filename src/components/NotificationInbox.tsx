import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Notification } from '@/types/Notification'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { doc, getDoc } from 'firebase/firestore'
import React, { useEffect, useState } from 'react'
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
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface NotificationInboxProps {
    visible: boolean
    onClose: () => void
}

export default function NotificationInbox({
    visible,
    onClose,
}: NotificationInboxProps) {
    const {
        notifications,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        clearAllNotifications,
    } = useAuth()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const [hydratedNotifications, setHydratedNotifications] = useState<Notification[]>([])
    const [loading, setLoading] = useState(false)

    // Hydrate notifications with user/post data
    useEffect(() => {
        if (visible && notifications.length > 0) {
            hydrateNotifications()
            markAllNotificationsAsRead()
        } else {
            setHydratedNotifications([])
        }
    }, [visible, notifications])

    const hydrateNotifications = async () => {
        console.log(`[NotificationInbox] Hydrating ${notifications.length} notifications`)
        setLoading(true)
        const hydrated = await Promise.all(
            notifications.map(async (n): Promise<Notification> => {
                const note = { ...n } as Notification

                // Fetch "From User" details
                if (note.fromUserId) {
                    try {
                        const userDoc = await getDoc(doc(db, 'users', note.fromUserId))
                        if (userDoc.exists()) {
                            const data = userDoc.data()
                            note.fromUsername = data.username || 'Someone'
                            note.fromUserPhoto = data.profilePicture // Assuming this field exists, otherwise default
                        }
                    } catch (e) {
                        console.warn('Error fetching user for notification:', e)
                        note.fromUsername = 'Unknown'
                    }
                }

                // Fetch Post Thumbnail if applicable
                if (note.postId) {
                    try {
                        const postDoc = await getDoc(doc(db, 'posts', note.postId))
                        if (postDoc.exists()) {
                            note.postThumbnail = postDoc.data().photoURL
                        }
                    } catch (e) {
                        console.warn('Error fetching post for notification:', e)
                    }
                }

                return note
            })
        )
        setHydratedNotifications(hydrated)
        console.log(`[NotificationInbox] Finished hydrating. Count: ${hydrated.length}`)
        setLoading(false)
    }

    const handleNotificationPress = (notification: Notification) => {
        onClose()
        if (notification.type === 'royalty' && notification.postId) {
            router.push(`/(tabs)/map?postId=${notification.postId}` as any)
        } else if (notification.type === 'follow' && notification.fromUserId) {
            router.push({
                pathname: '/user-profile',
                params: { userId: notification.fromUserId },
            })
        }
    }

    const formatDate = (timestamp: any) => {
        if (!timestamp) return ''
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
        const now = new Date()
        const diff = now.getTime() - date.getTime()

        // Less than 1 hour, show minutes
        if (diff < 3600000) {
            const mins = Math.floor(diff / 60000)
            return `${mins}m`
        }
        // Less than 24 hours, show hours
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000)
            return `${hours}h`
        }
        // Otherwise days
        const days = Math.floor(diff / 86400000)
        return `${days}d`
    }

    const handleClearAll = () => {
        Alert.alert(
            'Clear All Notifications',
            'Are you sure you want to delete all notifications?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await clearAllNotifications()
                        } catch (error) {
                            Alert.alert('Error', 'Failed to clear notifications')
                        }
                    }
                }
            ]
        )
    }

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Ionicons name="close" size={24} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Notifications</Text>
                    {hydratedNotifications.length > 0 && (
                        <TouchableOpacity onPress={handleClearAll} style={styles.clearButton}>
                            <Ionicons name="trash-outline" size={24} color={colors.textPrimary} />
                        </TouchableOpacity>
                    )}
                </View>



                {loading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={styles.content}>
                        {hydratedNotifications.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="notifications-off-outline" size={48} color={colors.textTertiary} />
                                <Text style={styles.emptyText}>No notifications yet</Text>
                            </View>
                        ) : (
                            hydratedNotifications.map((item) => (
                                <TouchableOpacity
                                    key={item.id}
                                    style={[styles.item, !item.read && styles.unreadItem]}
                                    onPress={() => handleNotificationPress(item)}
                                >
                                    <View style={styles.avatarContainer}>
                                        {item.fromUserPhoto ? (
                                            <Image
                                                source={{ uri: item.fromUserPhoto }}
                                                style={styles.avatarImage}
                                                contentFit="cover"
                                            />
                                        ) : (
                                            <View style={styles.avatarPlaceholder}>
                                                <Text style={styles.avatarInitial}>
                                                    {item.fromUsername ? item.fromUsername[0].toUpperCase() : '?'}
                                                </Text>
                                            </View>
                                        )}
                                    </View>

                                    <View style={styles.itemContent}>
                                        <Text style={styles.itemText}>
                                            <Text style={styles.username}>@{item.fromUsername} </Text>
                                            {item.type === 'follow' ? (
                                                'started following you'
                                            ) : item.type === 'new_post' ? (
                                                'posted a new photo'
                                            ) : (
                                                <>
                                                    caught your shot!
                                                    <Text style={styles.royaltyText}> +{item.amount} XP</Text>
                                                </>
                                            )}
                                        </Text>
                                        <Text style={styles.timeText}>{formatDate(item.createdAt)}</Text>
                                    </View>

                                    {item.type === 'royalty' && item.postThumbnail && (
                                        <Image
                                            source={{ uri: item.postThumbnail }}
                                            style={styles.postThumbnail}
                                            contentFit="cover"
                                        />
                                    )}
                                </TouchableOpacity>
                            ))
                        )}
                    </ScrollView>
                )}
            </View>
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
        paddingVertical: 8,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
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
        backgroundColor: colors.surface, // Slightly different color for unread?
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
        color: '#fff',
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
    royaltyText: {
        color: '#FFD700', // Gold
        fontWeight: 'bold',
    },
    timeText: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    postThumbnail: {
        width: 44,
        height: 44,
        borderRadius: 4,
        backgroundColor: colors.imageBackground,
    },
})
