import CompactPostCard from '@/components/CompactPostCard'
import ThreadModal from '@/components/ThreadModal'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface Post {
    id: string
    authorId: string
    authorUsername: string
    photoURL: string
    caption: string
    hasLocation: boolean
    catchCount: number
    parentPostId: string | null
    rootPostId: string | null
    isOriginal: boolean
    createdAt: any
}

interface List {
    id: string
    name: string
    description: string
    creatorId: string
    creatorUsername: string
    postIds: string[]
    isPublic: boolean
    createdAt: any
    updatedAt: any
}

interface ListModalProps {
    visible: boolean
    onClose: () => void
    list: List | null
    posts: Post[]
    loading?: boolean
    onDeleteList?: () => void
    onRemovePost?: (postId: string) => void
    onRefresh?: () => void
    refreshing?: boolean
}

export default function ListModal({
    visible,
    onClose,
    list,
    posts,
    loading = false,
    onDeleteList,
    onRemovePost,
    onRefresh,
    refreshing = false,
}: ListModalProps) {
    const { user } = useAuth()
    const insets = useSafeAreaInsets()
    const router = useRouter()
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)

    const isOwner = user?.uid === list?.creatorId

    const handlePostPress = (post: Post) => {
        setSelectedPost(post)
        setModalVisible(true)
    }

    const renderPost = ({ item }: { item: Post }) => {
        return (
            <View style={styles.postContainer}>
                <CompactPostCard
                    post={item}
                    onPress={() => handlePostPress(item)}
                    highlighted={item.authorId === user?.uid}
                />
                {isOwner && onRemovePost && (
                    <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => onRemovePost(item.id)}
                    >
                        <Ionicons name="close-circle" size={24} color={colors.danger} />
                    </TouchableOpacity>
                )}
            </View>
        )
    }

    const renderEmptyState = () => (
        <View style={styles.emptyContainer}>
            <Ionicons name="images-outline" size={64} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No Shots Yet</Text>
            <Text style={styles.emptySubtext}>Add shots to this list from any thread</Text>
        </View>
    )

    if (!visible) return null

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={false} // Full screen modal
            presentationStyle="pageSheet" // Nice iOS effect
            onRequestClose={onClose}
        >
            <View style={[styles.container, { paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose} style={styles.backButton}>
                        <Ionicons name="close" size={28} color={colors.textPrimary} />
                    </TouchableOpacity>

                    {list && (
                        <View style={styles.headerContent}>
                            <Text style={styles.listName}>{list.name}</Text>
                            <Text style={styles.listMeta}>
                                {list.postIds.length} {list.postIds.length === 1 ? 'shot' : 'shots'} • @{list.creatorUsername}
                            </Text>
                        </View>
                    )}

                    {isOwner && list && (
                        <View style={styles.headerActions}>
                            <TouchableOpacity
                                onPress={() => router.push(`/create-list?listId=${list.id}` as any)}
                                style={styles.iconButton}
                            >
                                <Ionicons name="pencil" size={24} color={colors.primary} />
                            </TouchableOpacity>
                            {onDeleteList && (
                                <TouchableOpacity onPress={onDeleteList} style={styles.iconButton}>
                                    <Ionicons name="trash-outline" size={24} color={colors.danger} />
                                </TouchableOpacity>
                            )}
                        </View>
                    )}
                </View>

                {list?.description ? (
                    <View style={styles.descriptionContainer}>
                        <Text style={styles.listDescription}>{list.description}</Text>
                    </View>
                ) : null}

                {/* Content */}
                {loading || !list ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : (
                    <FlatList
                        data={posts}
                        renderItem={renderPost}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.listContent}
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        ListEmptyComponent={renderEmptyState}
                        showsVerticalScrollIndicator={false}
                    />
                )}

                {/* Thread Modal */}
                {selectedPost && (
                    <ThreadModal
                        visible={modalVisible}
                        onClose={() => setModalVisible(false)}
                        post={selectedPost}
                        initialPostId={selectedPost.id}
                    />
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
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    backButton: {
        padding: 4,
        marginRight: 12,
    },
    headerContent: {
        flex: 1,
    },
    listName: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    listDescription: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 20,
    },
    descriptionContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.card,
    },
    listMeta: {
        fontSize: 12,
        color: colors.textTertiary,
        marginTop: 2,
    },
    headerActions: {
        flexDirection: 'row',
        gap: 8,
    },
    iconButton: {
        padding: 8,
    },
    listContent: {
        paddingVertical: 8,
    },
    postContainer: {
        position: 'relative',
        marginBottom: 8,
    },
    removeButton: {
        position: 'absolute',
        top: 12,
        right: 18,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 12,
        zIndex: 10,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 100,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textSecondary,
        marginTop: 16,
    },
    emptySubtext: {
        fontSize: 14,
        color: colors.textTertiary,
        marginTop: 8,
        textAlign: 'center',
        paddingHorizontal: 40,
    },
})
