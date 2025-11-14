import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useNavigation } from 'expo-router'
import PostDetailModal from '@/components/PostDetailModal'
import { useIsFocused } from '@react-navigation/native'
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
    const { shouldRefresh, updateLastFetch, isStale } = usePost()
    const router = useRouter()
    const navigation = useNavigation()
    const isFocused = useIsFocused()
    const insets = useSafeAreaInsets()
    const [username, setUsername] = useState<string>('')
    const [totalCatches, setTotalCatches] = useState<number>(0)
    const [posts, setPosts] = useState<Post[]>([])
    const [catches, setCatches] = useState<Post[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMorePosts, setHasMorePosts] = useState(true)
    const [hasMoreCatches, setHasMoreCatches] = useState(true)
    const [lastPostDoc, setLastPostDoc] =
        useState<QueryDocumentSnapshot<DocumentData> | null>(null)
    const [lastCatchDoc, setLastCatchDoc] =
        useState<QueryDocumentSnapshot<DocumentData> | null>(null)
    const [showPosts, setShowPosts] = useState(true)
    const [showCatches, setShowCatches] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)
    const [showStaleIndicator, setShowStaleIndicator] = useState(false)
    const [staleRefreshing, setStaleRefreshing] = useState(false)
    const flatListRef = React.useRef<FlatList>(null)

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

            // Fetch user's original posts (paginated)
            const postsQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', user.uid),
                where('isOriginal', '==', true),
                orderBy('createdAt', 'desc'),
                limit(POSTS_PER_PAGE)
            )

            const postsSnapshot = await getDocs(postsQuery)
            const fetchedPosts: Post[] = []

            postsSnapshot.forEach((doc) => {
                fetchedPosts.push({
                    id: doc.id,
                    ...doc.data(),
                } as Post)
            })

            setPosts(fetchedPosts)

            // Update pagination state for posts
            const lastPostVisible =
                postsSnapshot.docs[postsSnapshot.docs.length - 1]
            setLastPostDoc(lastPostVisible || null)
            setHasMorePosts(fetchedPosts.length === POSTS_PER_PAGE)

            // Fetch user's catches (paginated)
            const catchesQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', user.uid),
                where('isOriginal', '==', false),
                orderBy('createdAt', 'desc'),
                limit(POSTS_PER_PAGE)
            )

            const catchesSnapshot = await getDocs(catchesQuery)
            const fetchedCatches: Post[] = []

            catchesSnapshot.forEach((doc) => {
                fetchedCatches.push({
                    id: doc.id,
                    ...doc.data(),
                } as Post)
            })

            setCatches(fetchedCatches)

            // Update pagination state for catches
            const lastCatchVisible =
                catchesSnapshot.docs[catchesSnapshot.docs.length - 1]
            setLastCatchDoc(lastCatchVisible || null)
            setHasMoreCatches(fetchedCatches.length === POSTS_PER_PAGE)

            // Update last fetch time
            updateLastFetch('profile')
            setShowStaleIndicator(false)
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
            setHasMoreCatches(true)
            setLastPostDoc(null)
            setLastCatchDoc(null)
            fetchUserData()
        }
    }, [shouldRefresh])

    // Check for staleness and show indicator
    useEffect(() => {
        const checkStale = setInterval(() => {
            if (isStale('profile') && isFocused) {
                setShowStaleIndicator(true)
            }
        }, 1000) // Check every 1 second for responsive updates

        return () => clearInterval(checkStale)
    }, [isStale, isFocused])

    // Tab press listener for scroll to top + refresh
    useEffect(() => {
        const unsubscribe = navigation.addListener('tabPress' as any, (e: any) => {
            if (isFocused) {
                // Already on this tab, scroll to top and refresh
                e.preventDefault()
                flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
                setHasMorePosts(true)
                setHasMoreCatches(true)
                setLastPostDoc(null)
                setLastCatchDoc(null)
                fetchUserData()
            }
        })

        return unsubscribe
    }, [navigation, isFocused])

    const onRefresh = useCallback(async () => {
        setRefreshing(true)
        setHasMorePosts(true)
        setHasMoreCatches(true)
        setLastPostDoc(null)
        setLastCatchDoc(null)
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
                where('isOriginal', '==', true),
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

    const loadMoreCatches = async () => {
        if (!user || loadingMore || !hasMoreCatches || !lastCatchDoc) return

        setLoadingMore(true)

        try {
            const catchesQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', user.uid),
                where('isOriginal', '==', false),
                orderBy('createdAt', 'desc'),
                startAfter(lastCatchDoc),
                limit(POSTS_PER_PAGE)
            )

            const querySnapshot = await getDocs(catchesQuery)
            const fetchedCatches: Post[] = []

            querySnapshot.forEach((doc) => {
                fetchedCatches.push({
                    id: doc.id,
                    ...doc.data(),
                } as Post)
            })

            // Deduplicate catches when loading more
            setCatches((prev) => {
                const existingIds = new Set(prev.map((p) => p.id))
                const newCatches = fetchedCatches.filter(
                    (p) => !existingIds.has(p.id)
                )
                return [...prev, ...newCatches]
            })

            // Update pagination state
            const lastVisible =
                querySnapshot.docs[querySnapshot.docs.length - 1]
            setLastCatchDoc(lastVisible || null)
            setHasMoreCatches(fetchedCatches.length === POSTS_PER_PAGE)
        } catch (error) {
            console.error('Error loading more catches:', error)
        } finally {
            setLoadingMore(false)
        }
    }

    const handleEndReached = () => {
        // Load more posts if posts are shown and there are more
        if (showPosts && hasMorePosts && !loadingMore) {
            loadMorePosts()
        }
        // Load more catches if catches are shown and there are more
        if (showCatches && hasMoreCatches && !loadingMore) {
            loadMoreCatches()
        }
    }

    const handlePostPress = (post: Post) => {
        setSelectedPost(post)
        setModalVisible(true)
    }

    // Combine and sort posts based on what's toggled on
    const displayedPosts = React.useMemo(() => {
        const combined: Post[] = []
        if (showPosts) combined.push(...posts)
        if (showCatches) combined.push(...catches)

        // Sort by createdAt descending
        return combined.sort((a, b) => {
            const aTime = a.createdAt?.seconds || 0
            const bTime = b.createdAt?.seconds || 0
            return bTime - aTime
        })
    }, [showPosts, showCatches, posts, catches])

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
                    ref={flatListRef}
                    data={displayedPosts}
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

                            <View style={styles.toggleContainer}>
                                <TouchableOpacity
                                    style={[
                                        styles.toggleButton,
                                        showPosts && styles.toggleButtonActive,
                                    ]}
                                    onPress={() => setShowPosts(!showPosts)}
                                >
                                    <Ionicons
                                        name={showPosts ? 'checkbox' : 'square-outline'}
                                        size={20}
                                        color={
                                            showPosts
                                                ? colors.primary
                                                : colors.textTertiary
                                        }
                                    />
                                    <Text
                                        style={[
                                            styles.toggleText,
                                            showPosts &&
                                                styles.toggleTextActive,
                                        ]}
                                    >
                                        Posts
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.toggleButton,
                                        showCatches && styles.toggleButtonActive,
                                    ]}
                                    onPress={() => setShowCatches(!showCatches)}
                                >
                                    <Ionicons
                                        name={showCatches ? 'checkbox' : 'square-outline'}
                                        size={20}
                                        color={
                                            showCatches
                                                ? colors.primary
                                                : colors.textTertiary
                                        }
                                    />
                                    <Text
                                        style={[
                                            styles.toggleText,
                                            showCatches &&
                                                styles.toggleTextActive,
                                        ]}
                                    >
                                        Catches
                                    </Text>
                                </TouchableOpacity>
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
                            <Text style={styles.emptyText}>
                                {!showPosts && !showCatches
                                    ? 'Select posts or catches to view'
                                    : showPosts && showCatches
                                    ? 'No posts or catches yet'
                                    : showPosts
                                    ? 'No posts yet'
                                    : 'No catches yet'}
                            </Text>
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
                        displayedPosts.length > 0 ? styles.row : undefined
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

            {showStaleIndicator && (
                <View style={[styles.staleIndicatorContainer, { top: insets.top + 66 }]}>
                    <TouchableOpacity
                        style={styles.staleIndicator}
                        onPress={async () => {
                            setStaleRefreshing(true)
                            setHasMorePosts(true)
                            setHasMoreCatches(true)
                            setLastPostDoc(null)
                            setLastCatchDoc(null)
                            await fetchUserData()
                            setStaleRefreshing(false)
                        }}
                        disabled={staleRefreshing}
                    >
                        {staleRefreshing ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                            <Ionicons
                                name="refresh"
                                size={16}
                                color={colors.primary}
                            />
                        )}
                        <Text style={styles.staleIndicatorText}>
                            {staleRefreshing ? 'Refreshing...' : 'Tap to refresh'}
                        </Text>
                    </TouchableOpacity>
                </View>
            )}
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
    staleIndicatorContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 1000,
        pointerEvents: 'box-none',
    },
    staleIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.cardElevated,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 24,
        gap: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 5,
        pointerEvents: 'auto',
    },
    staleIndicatorText: {
        fontSize: 14,
        color: colors.primary,
        fontWeight: '600',
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
    toggleContainer: {
        flexDirection: 'row',
        width: '100%',
        marginTop: 20,
        gap: 8,
    },
    toggleButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 10,
        backgroundColor: colors.card,
        gap: 8,
    },
    toggleButtonActive: {
        backgroundColor: colors.cardElevated,
    },
    toggleText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textTertiary,
    },
    toggleTextActive: {
        color: colors.primary,
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
