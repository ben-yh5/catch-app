import CompactPostCard from '@/components/CompactPostCard'
import ThreadModal from '@/components/ThreadModal'
import ViewToggle from '@/components/ViewToggle'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
    arrayRemove,
    collection,
    deleteDoc,
    doc,
    documentId,
    getDoc,
    getDocs,
    query,
    updateDoc,
    where,
} from 'firebase/firestore'
import React, { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    RefreshControl,
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

const { width } = Dimensions.get('window')

export default function ListDetailScreen() {
    const { user } = useAuth()
    const insets = useSafeAreaInsets()
    const router = useRouter()
    const params = useLocalSearchParams()
    const listId = params.listId as string

    const [list, setList] = useState<List | null>(null)
    const [posts, setPosts] = useState<Post[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)

    const fetchListAndPosts = async () => {
        if (!listId) return

        try {
            // Fetch list document
            const listDoc = await getDoc(doc(db, 'lists', listId))
            if (!listDoc.exists()) {
                Alert.alert('Error', 'List not found')
                router.back()
                return
            }

            const listData = {
                id: listDoc.id,
                ...listDoc.data(),
            } as List

            setList(listData)

            // Fetch posts in the list
            if (listData.postIds.length > 0) {
                const batchSize = 30
                const batches = []

                for (let i = 0; i < listData.postIds.length; i += batchSize) {
                    const batch = listData.postIds.slice(i, i + batchSize)
                    batches.push(batch)
                }

                const allPosts: Post[] = []

                for (const batch of batches) {
                    const postsQuery = query(
                        collection(db, 'posts'),
                        where(documentId(), 'in', batch)
                    )

                    const postsSnapshot = await getDocs(postsQuery)
                    postsSnapshot.forEach((doc) => {
                        allPosts.push({
                            id: doc.id,
                            ...doc.data(),
                        } as Post)
                    })
                }

                setPosts(allPosts)
            } else {
                setPosts([])
            }
        } catch (error) {
            console.error('Error fetching list:', error)
            Alert.alert('Error', 'Failed to load list')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchListAndPosts()
    }, [listId])

    const handleRefresh = async () => {
        setRefreshing(true)
        await fetchListAndPosts()
        setRefreshing(false)
    }

    const handleDeleteList = () => {
        if (!list) return

        Alert.alert('Delete List', `Are you sure you want to delete "${list.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteDoc(doc(db, 'lists', listId))
                        router.back()
                    } catch (error) {
                        console.error('Error deleting list:', error)
                        Alert.alert('Error', 'Failed to delete list')
                    }
                },
            },
        ])
    }

    const handleRemovePost = (postId: string) => {
        Alert.alert('Remove Post', 'Remove this post from the list?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await updateDoc(doc(db, 'lists', listId), {
                            postIds: arrayRemove(postId),
                        })
                        setPosts((prev) => prev.filter((post) => post.id !== postId))
                        setList((prev) =>
                            prev
                                ? {
                                    ...prev,
                                    postIds: prev.postIds.filter((id) => id !== postId),
                                }
                                : null
                        )
                    } catch (error) {
                        console.error('Error removing post:', error)
                        Alert.alert('Error', 'Failed to remove post')
                    }
                },
            },
        ])
    }

    const handlePostPress = (post: Post) => {
        setSelectedPost(post)
        setModalVisible(true)
    }

    const renderPost = ({ item }: { item: Post }) => {
        const isOwner = user?.uid === list?.creatorId

        return (
            <View style={styles.postContainer}>
                <CompactPostCard
                    post={item}
                    onPress={() => handlePostPress(item)}
                    highlighted={item.authorId === user?.uid}
                />
                {isOwner && (
                    <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => handleRemovePost(item.id)}
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

    const isOwner = user?.uid === list?.creatorId

    if (loading || !list) {
        return (
            <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        )
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
                <View style={styles.headerContent}>
                    <Text style={styles.listName}>{list.name}</Text>
                    {list.description ? (
                        <Text style={styles.listDescription}>{list.description}</Text>
                    ) : null}
                    <Text style={styles.listMeta}>
                        {list.postIds.length} {list.postIds.length === 1 ? 'shot' : 'shots'} •
                        @{list.creatorUsername}
                    </Text>
                </View>
                {isOwner && (
                    <View style={styles.headerActions}>
                        <TouchableOpacity
                            onPress={() => router.push(`/create-list?listId=${listId}` as any)}
                            style={styles.iconButton}
                        >
                            <Ionicons name="pencil" size={20} color={colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleDeleteList} style={styles.iconButton}>
                            <Ionicons name="trash-outline" size={20} color={colors.danger} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            {/* Posts List */}
            <FlatList
                data={posts}
                renderItem={renderPost}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
                ListEmptyComponent={renderEmptyState}
            />

            {/* Thread Modal */}
            {selectedPost && (
                <ThreadModal
                    visible={modalVisible}
                    onClose={() => setModalVisible(false)}
                    post={selectedPost}
                    initialPostId={selectedPost.id}
                />
            )}

            {/* View Toggle */}
            <ViewToggle
                activeMode="list"
                onToggle={(mode) => {
                    if (mode === 'map') {
                        // Navigate to MapScreen in list mode
                        router.push(`/(tabs)/map?listId=${listId}` as any)
                    }
                }}
            />
        </View>
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
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
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
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 4,
        color: colors.textPrimary,
    },
    listDescription: {
        fontSize: 14,
        color: colors.textSecondary,
        marginBottom: 4,
    },
    listMeta: {
        fontSize: 12,
        color: colors.textTertiary,
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
