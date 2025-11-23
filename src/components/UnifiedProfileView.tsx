import ThreadModal from '@/components/ThreadModal'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { useNavigation, useRouter } from 'expo-router'
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
    Alert,
    Dimensions,
    FlatList,
    Modal,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
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

interface ProfileViewProps {
    userId: string
    isOwnProfile: boolean
}

const { width } = Dimensions.get('window')
const ITEM_SIZE = (width - 3) / 2 // 2 columns with 1px gap
const POSTS_PER_PAGE = 20

export default function UnifiedProfileView({ userId, isOwnProfile }: ProfileViewProps) {
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
    const [searchVisible, setSearchVisible] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<{ id: string; username: string }[]>([])
    const [searchLoading, setSearchLoading] = useState(false)
    const flatListRef = React.useRef<FlatList>(null)
    const searchInputRef = React.useRef<TextInput>(null)

    const fetchUserData = async () => {
        if (!userId) return

        try {
            // Fetch user document for username and totalCatches
            const userDoc = await getDoc(doc(db, 'users', userId))

            if (userDoc.exists()) {
                const userData = userDoc.data()
                setUsername(userData.username || 'Unknown')
                setTotalCatches(userData.totalCatches || 0)
            }

            // Fetch user's original posts (paginated)
            const postsQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', userId),
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
                where('authorId', '==', userId),
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

            // Update last fetch time only if it's own profile
            if (isOwnProfile) {
                updateLastFetch('profile')
                setShowStaleIndicator(false)
            }
        } catch (error) {
            console.error('Error fetching user data:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        setLoading(true)
        fetchUserData()
    }, [userId])

    useEffect(() => {
        // Refresh user data when a new post is created
        if (shouldRefresh && isOwnProfile) {
            setHasMorePosts(true)
            setHasMoreCatches(true)
            setLastPostDoc(null)
            setLastCatchDoc(null)
            fetchUserData()
        }
    }, [shouldRefresh, isOwnProfile])

    // Check for staleness and show indicator (only for own profile)
    useEffect(() => {
        if (!isOwnProfile) return

        const checkStale = setInterval(() => {
            if (isStale('profile') && isFocused) {
                setShowStaleIndicator(true)
            }
        }, 1000) // Check every 1 second for responsive updates

        return () => clearInterval(checkStale)
    }, [isStale, isFocused, isOwnProfile])

    // Tab press listener for scroll to top + refresh (only for own profile tab)
    useEffect(() => {
        if (!isOwnProfile) return

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
    }, [navigation, isFocused, isOwnProfile])

    const onRefresh = useCallback(async () => {
        setRefreshing(true)
        setHasMorePosts(true)
        setHasMoreCatches(true)
        setLastPostDoc(null)
        setLastCatchDoc(null)
        await fetchUserData()
        setRefreshing(false)
    }, [userId])

    const loadMorePosts = async () => {
        if (!userId || loadingMore || !hasMorePosts || !lastPostDoc) return

        setLoadingMore(true)

        try {
            const postsQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', userId),
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
        if (!userId || loadingMore || !hasMoreCatches || !lastCatchDoc) return

        setLoadingMore(true)

        try {
            const catchesQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', userId),
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

    const handleSearch = async (text: string) => {
        setSearchQuery(text)

        if (text.trim().length === 0) {
            setSearchResults([])
            return
        }

        setSearchLoading(true)
        try {
            // Search users by username prefix (case-sensitive for now)
            const searchLower = text.toLowerCase()
            const usersQuery = query(
                collection(db, 'users'),
                where('username', '>=', searchLower),
                where('username', '<=', searchLower + '\uf8ff'),
                limit(10)
            )

            const snapshot = await getDocs(usersQuery)
            const results: { id: string; username: string }[] = []

            snapshot.forEach((doc) => {
                results.push({
                    id: doc.id,
                    username: doc.data().username,
                })
            })

            setSearchResults(results)
        } catch (error) {
            console.error('Error searching users:', error)
        } finally {
            setSearchLoading(false)
        }
    }

    const handleUserSelect = (selectedUserId: string) => {
        setSearchVisible(false)
        setSearchQuery('')
        setSearchResults([])
        if (selectedUserId === user?.uid) {
            // Already on own profile, but if we are in "Other User" view and select self, we should probably navigate to main profile tab or just stay here?
            // The requirement says "Other User Profile" screen.
            // If we are in ProfileScreen (own), and select self, do nothing.
            // If we are in ProfileScreen (own), and select other, push /user-profile.
            if (isOwnProfile) {
                return
            } else {
                // If in other profile and select self, maybe go back? Or push new screen?
                // For now let's just push /user-profile?userId=...
                // But wait, if it's self, we should probably go to the main profile tab?
                // Let's stick to the existing behavior: push /user-profile
                // Actually, existing behavior was:
                // if (userId === user?.uid) return
                // router.push(...)
            }
        }

        if (selectedUserId === user?.uid) {
            if (!isOwnProfile) {
                // If we are viewing someone else, and click ourselves, maybe we should just go back to the main profile tab?
                // But we are in a stack.
                // Let's just do nothing for now if it's self, as per original code.
                return
            }
            return
        }

        router.push(`/user-profile?userId=${selectedUserId}` as any)
    }

    const handleReport = () => {
        Alert.alert('Report User', 'This feature is coming soon! (TODO)')
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
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
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
                    {isOwnProfile ? (
                        <TouchableOpacity
                            onPress={() => {
                                setSearchVisible(true)
                                setTimeout(() => searchInputRef.current?.focus(), 100)
                            }}
                            style={styles.searchButton}
                        >
                            <Ionicons
                                name="search"
                                size={24}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            onPress={() => router.back()}
                            style={styles.searchButton}
                        >
                            <Ionicons
                                name="chevron-back"
                                size={28}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                    )}

                    <Text style={styles.headerTitle}>Profile</Text>

                    {isOwnProfile ? (
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
                    ) : (
                        <TouchableOpacity
                            onPress={handleReport}
                            style={styles.settingsButton}
                        >
                            <Ionicons
                                name="flag-outline"
                                size={24}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                    )}
                </View>
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
                    setPosts(
                        posts.map((p) =>
                            p.id === updatedPost.id ? updatedPost : p
                        )
                    )
                    setCatches(
                        catches.map((p) =>
                            p.id === updatedPost.id ? updatedPost : p
                        )
                    )
                }}
                onPostDelete={(postId) => {
                    setPosts(posts.filter((p) => p.id !== postId))
                    setCatches(catches.filter((p) => p.id !== postId))
                }}
            />

            {showStaleIndicator && isOwnProfile && (
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

            <Modal
                visible={searchVisible}
                animationType="fade"
                transparent
                onRequestClose={() => {
                    setSearchVisible(false)
                    setSearchQuery('')
                    setSearchResults([])
                }}
            >
                <View style={[styles.searchModalOverlay, { paddingTop: insets.top }]}>
                    <View style={styles.searchHeader}>
                        <TouchableOpacity
                            onPress={() => {
                                setSearchVisible(false)
                                setSearchQuery('')
                                setSearchResults([])
                            }}
                            style={styles.searchCloseButton}
                        >
                            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
                        </TouchableOpacity>
                        <View style={styles.searchInputContainer}>
                            <Ionicons name="search" size={18} color={colors.textTertiary} />
                            <TextInput
                                ref={searchInputRef}
                                style={styles.searchInput}
                                placeholder="Search users..."
                                placeholderTextColor={colors.textTertiary}
                                value={searchQuery}
                                onChangeText={handleSearch}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => handleSearch('')}>
                                    <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    <View style={styles.searchResults}>
                        {searchLoading ? (
                            <View style={styles.searchLoadingContainer}>
                                <ActivityIndicator size="small" color={colors.primary} />
                            </View>
                        ) : searchResults.length > 0 ? (
                            searchResults.map((result) => (
                                <TouchableOpacity
                                    key={result.id}
                                    style={styles.searchResultItem}
                                    onPress={() => handleUserSelect(result.id)}
                                >
                                    <View style={styles.searchResultAvatar}>
                                        <Ionicons name="person" size={20} color={colors.textTertiary} />
                                    </View>
                                    <Text style={styles.searchResultUsername}>@{result.username}</Text>
                                    {result.id === user?.uid && (
                                        <Text style={styles.searchResultYou}>(you)</Text>
                                    )}
                                </TouchableOpacity>
                            ))
                        ) : searchQuery.length > 0 ? (
                            <Text style={styles.searchNoResults}>No users found</Text>
                        ) : (
                            <Text style={styles.searchHint}>Search for users by username</Text>
                        )}
                    </View>
                </View>
            </Modal>
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
    searchButton: {
        padding: 4,
    },
    searchModalOverlay: {
        flex: 1,
        backgroundColor: colors.background,
    },
    searchHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    searchCloseButton: {
        padding: 4,
    },
    searchInputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.card,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: colors.textPrimary,
    },
    searchResults: {
        flex: 1,
        paddingTop: 8,
    },
    searchLoadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    searchResultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    searchResultAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.card,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    searchResultUsername: {
        fontSize: 16,
        color: colors.textPrimary,
        flex: 1,
    },
    searchResultYou: {
        fontSize: 14,
        color: colors.textTertiary,
        fontStyle: 'italic',
    },
    searchNoResults: {
        textAlign: 'center',
        marginTop: 20,
        color: colors.textTertiary,
        fontSize: 16,
    },
    searchHint: {
        textAlign: 'center',
        marginTop: 20,
        color: colors.textTertiary,
        fontSize: 16,
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
        marginTop: 24,
        gap: 12,
    },
    toggleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 6,
    },
    toggleButtonActive: {
        borderColor: colors.primary,
        backgroundColor: colors.cardElevated,
    },
    toggleText: {
        fontSize: 14,
        color: colors.textTertiary,
        fontWeight: '500',
    },
    toggleTextActive: {
        color: colors.primary,
        fontWeight: '600',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 60,
    },
    emptyText: {
        marginTop: 16,
        fontSize: 16,
        color: colors.textTertiary,
        textAlign: 'center',
    },
    footerLoader: {
        paddingVertical: 20,
        alignItems: 'center',
    },
    row: {
        gap: 1,
    },
    postItem: {
        width: ITEM_SIZE,
        height: ITEM_SIZE,
        backgroundColor: colors.card,
    },
    postImage: {
        width: '100%',
        height: '100%',
    },
})
