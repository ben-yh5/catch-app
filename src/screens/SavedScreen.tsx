import { useAuth } from '@/context/AuthContext'
import { usePost, usePostEvents, PostEvent } from '@/context/PostContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import ThreadModal from '@/components/ThreadModal'
import {
    collection,
    doc,
    documentId,
    getDoc,
    getDocs,
    query,
    where,
} from 'firebase/firestore'
import React, { useCallback, useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Dimensions,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { Image } from 'expo-image'
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

const { width } = Dimensions.get('window')
const ITEM_SIZE = (width - 3) / 2 // 2 columns with 1px gap
const THUMBNAIL_SIZE = 400 // Target thumbnail resolution for grid items

export default function SavedScreen() {
    const { user } = useAuth()
    const { updateLastFetch } = usePost()
    const insets = useSafeAreaInsets()
    const [bookmarkedPosts, setBookmarkedPosts] = useState<Post[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)

    const fetchBookmarkedPosts = async () => {
        if (!user) return

        try {
            // Fetch user's bookmarked post IDs
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            let bookmarkedPostIds: string[] = []

            if (userDoc.exists()) {
                const userData = userDoc.data()
                bookmarkedPostIds = userData.bookmarkedPosts || []
            }

            // Fetch bookmarked posts
            if (bookmarkedPostIds.length > 0) {
                // Firestore 'in' operator supports max 30 items, so we need to batch if more
                const batchSize = 30
                const batches = []

                for (let i = 0; i < bookmarkedPostIds.length; i += batchSize) {
                    const batch = bookmarkedPostIds.slice(i, i + batchSize)
                    batches.push(batch)
                }

                const allBookmarkedPosts: Post[] = []

                for (const batch of batches) {
                    const bookmarksQuery = query(
                        collection(db, 'posts'),
                        where(documentId(), 'in', batch)
                    )

                    const bookmarksSnapshot = await getDocs(bookmarksQuery)
                    bookmarksSnapshot.forEach((doc) => {
                        allBookmarkedPosts.push({
                            id: doc.id,
                            ...doc.data(),
                        } as Post)
                    })
                }

                setBookmarkedPosts(allBookmarkedPosts)
            } else {
                setBookmarkedPosts([])
            }

            // Update last fetch time
            updateLastFetch('saved')
        } catch (error) {
            console.error('Error fetching bookmarked posts:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchBookmarkedPosts()
    }, [])

    // Subscribe to post events for granular updates
    usePostEvents((event: PostEvent) => {
        if (event.action === 'delete' && event.postId) {
            // Remove deleted post from local state without re-fetching
            setBookmarkedPosts(prev => prev.filter(p => p.id !== event.postId))
        } else if (event.action === 'create' || event.action === 'catch') {
            // Only refresh if the user might have bookmarked posts
            // For now, we'll skip auto-refresh on create/catch since saved is user-specific
        }
    }, [])

    const onRefresh = useCallback(async () => {
        setRefreshing(true)
        await fetchBookmarkedPosts()
        setRefreshing(false)
    }, [])

    const handlePostPress = (post: Post) => {
        setSelectedPost(post)
        setModalVisible(true)
    }

    const renderPost = ({ item }: { item: Post }) => (
        <TouchableOpacity
            style={styles.postItem}
            onPress={() => handlePostPress(item)}
            activeOpacity={0.8}
        >
            <Image
                source={{
                    uri: item.photoURL,
                    width: THUMBNAIL_SIZE,
                    height: THUMBNAIL_SIZE,
                }}
                style={styles.postImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
                placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
                placeholderContentFit="cover"
                recyclingKey={item.id}
                priority="low"
            />
        </TouchableOpacity>
    )

    const getItemLayout = (_data: any, index: number) => ({
        length: ITEM_SIZE,
        offset: ITEM_SIZE * Math.floor(index / 2), // 2 columns
        index,
    })

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        )
    }

    return (
        <>
            <View style={styles.container}>
                <View style={[styles.header, { paddingTop: insets.top }]}>
                    <Text style={styles.headerTitle}>Saved</Text>
                </View>

                <FlatList
                    data={bookmarkedPosts}
                    renderItem={renderPost}
                    keyExtractor={(item) => item.id}
                    numColumns={2}
                    getItemLayout={getItemLayout}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.primary}
                            progressViewOffset={insets.top + 56}
                        />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Ionicons
                                name="bookmark-outline"
                                size={80}
                                color={colors.textTertiary}
                            />
                            <Text style={styles.emptyText}>
                                No bookmarked posts
                            </Text>
                            <Text style={styles.emptySubtext}>
                                Tap the bookmark icon on posts to save them here
                            </Text>
                        </View>
                    }
                    columnWrapperStyle={
                        bookmarkedPosts.length > 0 ? styles.row : undefined
                    }
                />
            </View>

            <ThreadModal
                visible={modalVisible}
                post={selectedPost}
                initialPostId={selectedPost?.id}
                onClose={() => {
                    setModalVisible(false)
                    setSelectedPost(null)
                }}
                onPostUpdate={(updatedPost) => {
                    setBookmarkedPosts(
                        bookmarkedPosts.map((p) =>
                            p.id === updatedPost.id ? updatedPost : p
                        )
                    )
                }}
                onPostDelete={(postId) => {
                    setBookmarkedPosts(
                        bookmarkedPosts.filter((p) => p.id !== postId)
                    )
                }}
            />
        </>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    listContent: {
        paddingBottom: 20,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 100,
        paddingHorizontal: 40,
    },
    emptyText: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.textPrimary,
        marginTop: 20,
    },
    emptySubtext: {
        fontSize: 16,
        color: colors.textTertiary,
        marginTop: 8,
        textAlign: 'center',
    },
    row: {
        gap: 1,
    },
    postItem: {
        width: ITEM_SIZE,
        height: ITEM_SIZE,
        backgroundColor: colors.imageBackground,
    },
    postImage: {
        width: '100%',
        height: '100%',
    },
})
