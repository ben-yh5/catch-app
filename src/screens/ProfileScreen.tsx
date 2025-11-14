import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import PostDetailModal from '@/components/PostDetailModal'
import {
    collection,
    doc,
    DocumentData,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    QueryDocumentSnapshot,
    startAfter,
    where,
} from 'firebase/firestore'
import React, { useCallback, useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Dimensions,
    FlatList,
    Image,
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
    isOriginal: boolean
    createdAt: any
}

const { width } = Dimensions.get('window')
const ITEM_SIZE = (width - 3) / 2 // 2 columns with 1px gap
const POSTS_PER_PAGE = 20

export default function ProfileScreen() {
    const { user } = useAuth()
    const { shouldRefresh } = usePost()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const [username, setUsername] = useState<string>('')
    const [totalCatches, setTotalCatches] = useState<number>(0)
    const [posts, setPosts] = useState<Post[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMorePosts, setHasMorePosts] = useState(true)
    const [lastPostDoc, setLastPostDoc] =
        useState<QueryDocumentSnapshot<DocumentData> | null>(null)
    const [refreshing, setRefreshing] = useState(false)
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)

    const fetchUserData = async () => {
        if (!user) return

        try {
            // Fetch user document for username and totalCatches
            const userDoc = await getDoc(doc(db, 'users', user.uid))

            if (userDoc.exists()) {
                const userData = userDoc.data()
                setUsername(userData.username || 'Unknown')
                setTotalCatches(userData.totalCatches || 0)
            }

            // Fetch user's posts (paginated)
            const postsQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', user.uid),
                orderBy('createdAt', 'desc'),
                limit(POSTS_PER_PAGE)
            )

            const querySnapshot = await getDocs(postsQuery)
            const fetchedPosts: Post[] = []

            querySnapshot.forEach((doc) => {
                fetchedPosts.push({
                    id: doc.id,
                    ...doc.data(),
                } as Post)
            })

            setPosts(fetchedPosts)

            // Update pagination state for posts
            const lastVisible =
                querySnapshot.docs[querySnapshot.docs.length - 1]
            setLastPostDoc(lastVisible || null)
            setHasMorePosts(fetchedPosts.length === POSTS_PER_PAGE)
        } catch (error) {
            console.error('Error fetching user data:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchUserData()
    }, [])

    useEffect(() => {
        // Refresh user data when a new post is created
        if (shouldRefresh) {
            setHasMorePosts(true)
            setLastPostDoc(null)
            fetchUserData()
        }
    }, [shouldRefresh])

    const onRefresh = useCallback(async () => {
        setRefreshing(true)
        setHasMorePosts(true)
        setLastPostDoc(null)
        await fetchUserData()
        setRefreshing(false)
    }, [])

    const loadMorePosts = async () => {
        if (!user || loadingMore || !hasMorePosts || !lastPostDoc) return

        setLoadingMore(true)

        try {
            const postsQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', user.uid),
                orderBy('createdAt', 'desc'),
                startAfter(lastPostDoc),
                limit(POSTS_PER_PAGE)
            )

            const querySnapshot = await getDocs(postsQuery)
            const fetchedPosts: Post[] = []

            querySnapshot.forEach((doc) => {
                fetchedPosts.push({
                    id: doc.id,
                    ...doc.data(),
                } as Post)
            })

            // Deduplicate posts when loading more
            setPosts((prev) => {
                const existingIds = new Set(prev.map((p) => p.id))
                const newPosts = fetchedPosts.filter(
                    (p) => !existingIds.has(p.id)
                )
                return [...prev, ...newPosts]
            })

            // Update pagination state
            const lastVisible =
                querySnapshot.docs[querySnapshot.docs.length - 1]
            setLastPostDoc(lastVisible || null)
            setHasMorePosts(fetchedPosts.length === POSTS_PER_PAGE)
        } catch (error) {
            console.error('Error loading more posts:', error)
        } finally {
            setLoadingMore(false)
        }
    }

    const handleEndReached = () => {
        if (hasMorePosts) {
            loadMorePosts()
        }
    }

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
                source={{ uri: item.photoURL }}
                style={styles.postImage}
                resizeMode="cover"
            />
        </TouchableOpacity>
    )

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
                <FlatList
                    data={posts}
                    renderItem={renderPost}
                    keyExtractor={(item) => item.id}
                    numColumns={2}
                    contentContainerStyle={[
                        styles.listContent,
                        { paddingTop: insets.top + 56 },
                    ]}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.primary}
                            progressViewOffset={insets.top + 56}
                        />
                    }
                    ListHeaderComponent={
                        <View style={styles.profileInfo}>
                            <View style={styles.statsContainer}>
                                <Text style={styles.username}>@{username}</Text>
                                <View style={styles.statRow}>
                                    <View style={styles.statItem}>
                                        <Text style={styles.statNumber}>
                                            {posts.length}
                                        </Text>
                                        <Text style={styles.statLabel}>
                                            Posts
                                        </Text>
                                    </View>
                                    <View style={styles.statItem}>
                                        <Text style={styles.statNumber}>
                                            {totalCatches}
                                        </Text>
                                        <Text style={styles.statLabel}>
                                            Catches
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </View>
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Ionicons
                                name="images-outline"
                                size={80}
                                color={colors.textTertiary}
                            />
                            <Text style={styles.emptyText}>No posts yet</Text>
                        </View>
                    }
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={0.5}
                    ListFooterComponent={
                        loadingMore ? (
                            <View style={styles.footerLoader}>
                                <ActivityIndicator
                                    size="small"
                                    color={colors.primary}
                                />
                            </View>
                        ) : null
                    }
                    columnWrapperStyle={
                        posts.length > 0 ? styles.row : undefined
                    }
                />

                <View
                    style={[styles.profileHeader, { paddingTop: insets.top }]}
                >
                    <View style={styles.placeholder} />
                    <Text style={styles.headerTitle}>Profile</Text>
                    <TouchableOpacity
                        onPress={() => router.push('/settings' as any)}
                        style={styles.settingsButton}
                    >
                        <Ionicons
                            name="settings-outline"
                            size={24}
                            color={colors.textPrimary}
                        />
                    </TouchableOpacity>
                </View>
            </View>

            <PostDetailModal
                visible={modalVisible}
                post={selectedPost}
                onClose={() => {
                    setModalVisible(false)
                    setSelectedPost(null)
                }}
                onPostUpdate={(updatedPost) => {
                    setPosts(
                        posts.map((p) =>
                            p.id === updatedPost.id ? updatedPost : p
                        )
                    )
                }}
                onPostDelete={(postId) => {
                    setPosts(posts.filter((p) => p.id !== postId))
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
    profileHeader: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 16,
        zIndex: 10,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    settingsButton: {
        padding: 4,
    },
    placeholder: {
        width: 32,
    },
    listContent: {
        paddingBottom: 20,
    },
    profileInfo: {
        padding: 20,
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        marginBottom: 1,
    },
    statsContainer: {
        alignItems: 'center',
        marginBottom: 20,
    },
    username: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 16,
        color: colors.textPrimary,
    },
    statRow: {
        flexDirection: 'row',
        gap: 40,
    },
    statItem: {
        alignItems: 'center',
    },
    statNumber: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    statLabel: {
        fontSize: 14,
        color: colors.textTertiary,
        marginTop: 4,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 100,
    },
    emptyText: {
        fontSize: 16,
        color: colors.textTertiary,
        marginTop: 12,
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
    footerLoader: {
        paddingVertical: 20,
        alignItems: 'center',
    },
})
