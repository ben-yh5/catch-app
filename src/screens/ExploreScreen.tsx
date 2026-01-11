import { useAuth } from '@/context/AuthContext'
import { usePost, usePostEvents, PostEvent } from '@/context/PostContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useNavigation } from 'expo-router'
import ThreadModal from '@/components/ThreadModal'
import ListSelectionBottomSheet from '@/components/ListSelectionBottomSheet'
import { useIsFocused } from '@react-navigation/native'
import { isPostSaved } from '@/utils/listUtils'
import * as Location from 'expo-location'
import {
    collection,
    deleteDoc,
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
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FeaturedListSkeleton } from '@/components/Skeleton'

interface Post {
    id: string
    authorId: string
    authorUsername: string
    photoURL: string
    title?: string
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
    creatorId: string  // Changed from userId to match Firestore schema
    creatorUsername?: string  // Changed from username to match Firestore schema
    postIds: string[]
    isPublic: boolean
    createdAt: any
    updatedAt: any
    thumbnails?: string[] // First 4 post photos
}

const POSTS_PER_PAGE = 20

type FilterType = 'near' | 'trending' | 'new'

export default function ExploreScreen() {
    const { user } = useAuth()
    const { updateLastFetch, isStale } = usePost()
    const router = useRouter()
    const navigation = useNavigation()
    const isFocused = useIsFocused()
    const insets = useSafeAreaInsets()
    const [posts, setPosts] = useState<Post[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const [lastDoc, setLastDoc] =
        useState<QueryDocumentSnapshot<DocumentData> | null>(null)
    const [savedPosts, setSavedPosts] = useState<Set<string>>(new Set())
    const [showOptionsMenu, setShowOptionsMenu] = useState<string | null>(null) // Store post ID of open menu
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)
    const [showStaleIndicator, setShowStaleIndicator] = useState(false)
    const [staleRefreshing, setStaleRefreshing] = useState(false)
    const [showListSheet, setShowListSheet] = useState(false)
    const [selectedPostForList, setSelectedPostForList] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeFilter, setActiveFilter] = useState<FilterType>('trending')
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null)
    const [featuredLists, setFeaturedLists] = useState<List[]>([])
    const [loadingLists, setLoadingLists] = useState(true)
    const flatListRef = React.useRef<FlatList>(null)
    const lastInteractionTimeRef = React.useRef<number>(Date.now())
    const interactionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    // Get user location for "Near" filter
    useEffect(() => {
        ;(async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync()
                if (status === 'granted') {
                    const location = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    })
                    setUserLocation({
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                    })
                }
            } catch (error) {
                console.error('Error getting location:', error)
            }
        })()
    }, [])

    // Track user interactions to hide/show stale indicator
    const recordInteraction = useCallback(() => {
        lastInteractionTimeRef.current = Date.now()
        setShowStaleIndicator(false)

        // Clear existing timer
        if (interactionTimerRef.current) {
            clearTimeout(interactionTimerRef.current)
        }

        // Set new timer to show stale indicator after 2 minutes of inactivity
        interactionTimerRef.current = setTimeout(() => {
            if (isStale('explore') && isFocused) {
                setShowStaleIndicator(true)
            }
        }, 2 * 60 * 1000) // 2 minutes
    }, [isStale, isFocused])

    const fetchSavedStatus = useCallback(async () => {
        if (!user || posts.length === 0) return
        try {
            // Check which posts are saved
            const postIds = posts.map(p => p.id)
            const savedStatuses = await Promise.all(
                postIds.map(async (postId) => ({
                    postId,
                    isSaved: await isPostSaved(user.uid, postId)
                }))
            )

            setSavedPosts(prev => {
                const newSet = new Set(prev)
                // Update status for posts in current view
                savedStatuses.forEach(({ postId, isSaved }) => {
                    if (isSaved) {
                        newSet.add(postId)
                    } else {
                        // Only remove if post exists in current posts list
                        // This prevents removing posts that were just saved but aren't in view
                        if (postIds.includes(postId)) {
                            newSet.delete(postId)
                        }
                    }
                })
                return newSet
            })
        } catch (error) {
            console.error('Error fetching saved status:', error)
        }
    }, [user, posts])

    const fetchFeaturedLists = async () => {
        try {
            setLoadingLists(true)
            console.log('Fetching featured lists...')

            // Simple query: just get public lists ordered by createdAt (no composite index needed)
            const listsQuery = query(
                collection(db, 'lists'),
                where('isPublic', '==', true),
                limit(20)
            )

            const querySnapshot = await getDocs(listsQuery)
            console.log(`Found ${querySnapshot.size} public lists`)
            const lists: List[] = []

            for (const docSnap of querySnapshot.docs) {
                const listData = docSnap.data()

                // Skip lists without creatorId or postIds
                if (!listData.creatorId || !listData.postIds || !Array.isArray(listData.postIds)) {
                    console.warn(`Skipping list ${docSnap.id} - missing creatorId or postIds`)
                    continue
                }

                // Skip empty lists
                if (listData.postIds.length === 0) {
                    continue
                }

                try {
                    // Use existing creatorUsername or fetch if missing
                    const username = listData.creatorUsername || 'Unknown'

                    // Fetch first 4 post thumbnails
                    const thumbnails: string[] = []
                    const postIdsToFetch = listData.postIds.slice(0, 4)

                    for (const postId of postIdsToFetch) {
                        try {
                            const postDoc = await getDoc(doc(db, 'posts', postId))
                            if (postDoc.exists()) {
                                thumbnails.push(postDoc.data().photoURL)
                            }
                        } catch (postError) {
                            console.warn(`Error fetching post ${postId}:`, postError)
                        }
                    }

                    // Only add list if it has at least one thumbnail
                    if (thumbnails.length > 0) {
                        lists.push({
                            id: docSnap.id,
                            ...listData,
                            creatorUsername: username,
                            thumbnails,
                        } as List)
                    }
                } catch (listError) {
                    console.warn(`Error processing list ${docSnap.id}:`, listError)
                }
            }

            console.log(`Successfully processed ${lists.length} lists with thumbnails`)
            // Sort by post count (most posts first) on client side
            lists.sort((a, b) => b.postIds.length - a.postIds.length)
            setFeaturedLists(lists.slice(0, 10))
        } catch (error) {
            console.error('Error fetching featured lists:', error)
        } finally {
            setLoadingLists(false)
        }
    }

    const fetchPosts = async (loadMore = false) => {
        if (loadMore && (!hasMore || loadingMore)) return

        try {
            if (loadMore) {
                setLoadingMore(true)
            }

            // Build query based on active filter
            let orderField = 'catchCount' // trending (default)
            let orderDirection: 'desc' | 'asc' = 'desc'

            if (activeFilter === 'new') {
                orderField = 'createdAt'
                orderDirection = 'desc'
            } else if (activeFilter === 'near') {
                // For "near" filter, we still use catchCount but will filter/sort by distance client-side
                orderField = 'catchCount'
                orderDirection = 'desc'
            }

            let postsQuery
            if (loadMore && lastDoc) {
                postsQuery = query(
                    collection(db, 'posts'),
                    where('isOriginal', '==', true),
                    orderBy(orderField, orderDirection),
                    startAfter(lastDoc),
                    limit(POSTS_PER_PAGE)
                )
            } else {
                postsQuery = query(
                    collection(db, 'posts'),
                    where('isOriginal', '==', true),
                    orderBy(orderField, orderDirection),
                    limit(POSTS_PER_PAGE)
                )
            }

            const querySnapshot = await getDocs(postsQuery)
            const fetchedPosts: Post[] = []

            querySnapshot.forEach((doc) => {
                fetchedPosts.push({
                    id: doc.id,
                    ...doc.data(),
                } as Post)
            })

            // Update last document for pagination
            const lastVisible =
                querySnapshot.docs[querySnapshot.docs.length - 1]
            setLastDoc(lastVisible || null)

            // Check if there are more posts
            setHasMore(fetchedPosts.length === POSTS_PER_PAGE)

            if (loadMore) {
                // Deduplicate posts when loading more
                setPosts((prev) => {
                    const existingIds = new Set(prev.map((p) => p.id))
                    const newPosts = fetchedPosts.filter(
                        (p) => !existingIds.has(p.id)
                    )
                    return [...prev, ...newPosts]
                })
            } else {
                setPosts(fetchedPosts)
                // Fetch saved status on initial load
                await fetchSavedStatus()
                // Update last fetch time
                updateLastFetch('explore')
                setShowStaleIndicator(false)
            }
        } catch (error) {
            console.error('Error fetching posts:', error)
        } finally {
            setLoading(false)
            setRefreshing(false)
            setLoadingMore(false)
        }
    }

    useEffect(() => {
        fetchPosts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Subscribe to post events for granular updates
    usePostEvents((event: PostEvent) => {
        if (event.action === 'create') {
            // New post created - refresh feed to show it
            setHasMore(true)
            setLastDoc(null)
            fetchPosts(false)
        } else if (event.action === 'delete' && event.postId) {
            // Remove deleted post from local state without re-fetching
            setPosts(prev => prev.filter(p => p.id !== event.postId))
        }
        // Note: 'catch' events don't affect explore feed since it only shows originals
    }, [])

    // Auto-refresh when screen becomes focused after being stale
    useEffect(() => {
        if (isFocused && isStale('explore')) {
            // Auto refresh if data is stale
            setHasMore(true)
            setLastDoc(null)
            fetchPosts(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFocused])

    // Start interaction timer on mount and when recordInteraction changes
    useEffect(() => {
        recordInteraction()
        return () => {
            if (interactionTimerRef.current) {
                clearTimeout(interactionTimerRef.current)
            }
        }
    }, [recordInteraction])

    // Tab press listener for scroll to top + refresh
    useEffect(() => {
        const unsubscribe = navigation.addListener('tabPress' as any, (e: any) => {
            if (isFocused) {
                // Already on this tab, scroll to top and refresh
                e.preventDefault()
                flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
                setHasMore(true)
                setLastDoc(null)
                fetchPosts(false)
            }
        })

        return unsubscribe
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigation, isFocused])

    // Refetch when filter changes
    useEffect(() => {
        setHasMore(true)
        setLastDoc(null)
        setPosts([])
        setLoading(true)
        fetchPosts(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFilter])

    // Fetch featured lists on mount
    useEffect(() => {
        fetchFeaturedLists()
    }, [])

    const onRefresh = useCallback(() => {
        setRefreshing(true)
        setHasMore(true)
        setLastDoc(null)
        recordInteraction()
        fetchPosts(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recordInteraction])

    const loadMorePosts = useCallback(() => {
        if (!loading && !loadingMore && hasMore) {
            fetchPosts(true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, loadingMore, hasMore, lastDoc])

    const handleToggleSave = async (postId: string) => {
        if (!user) return
        setSelectedPostForList(postId)
        setShowListSheet(true)
    }

    const handleShare = async (postId: string) => {
        setShowOptionsMenu(null)
        // TODO: Implement share functionality
        Alert.alert('Share', 'Share functionality coming soon!')
    }

    const handleDeletePost = async (postId: string) => {
        if (!user) return

        setShowOptionsMenu(null)

        const confirmDelete = await new Promise<boolean>((resolve) => {
            Alert.alert(
                'Delete Post',
                'Are you sure you want to delete this post?',
                [
                    {
                        text: 'Cancel',
                        onPress: () => resolve(false),
                        style: 'cancel',
                    },
                    {
                        text: 'Delete',
                        onPress: () => resolve(true),
                        style: 'destructive',
                    },
                ]
            )
        })

        if (!confirmDelete) return

        try {
            // Delete post from Firestore
            await deleteDoc(doc(db, 'posts', postId))

            // Update local state
            setPosts(posts.filter((post) => post.id !== postId))

            Alert.alert('Success', 'Post deleted successfully')
        } catch (error) {
            console.error('Error deleting post:', error)
            Alert.alert('Error', 'Error deleting post. Please try again.')
        }
    }

    const formatDate = (timestamp: any) => {
        if (!timestamp) return ''
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })
    }

    const renderFeaturedListItem = (item: List) => (
        <TouchableOpacity
            key={item.id}
            style={styles.listCard}
            onPress={() => {
                recordInteraction()
                router.push({
                    pathname: '/list-detail',
                    params: { listId: item.id },
                })
            }}
        >
            {/* Grid of 4 thumbnails */}
            <View style={styles.listThumbnailGrid}>
                {[0, 1, 2, 3].map((index) => (
                    <View key={index} style={styles.listThumbnailItem}>
                        {item.thumbnails && item.thumbnails[index] ? (
                            <Image
                                source={{ uri: item.thumbnails[index] }}
                                style={styles.listThumbnail}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                            />
                        ) : (
                            <View style={[styles.listThumbnail, styles.listThumbnailPlaceholder]}>
                                <Ionicons name="image-outline" size={24} color={colors.textTertiary} />
                            </View>
                        )}
                    </View>
                ))}
            </View>

            {/* List info */}
            <View style={styles.listInfo}>
                <Text style={styles.listName} numberOfLines={1}>
                    {item.name}
                </Text>
                <Text style={styles.listAuthor} numberOfLines={1}>
                    by @{item.creatorUsername}
                </Text>
                <View style={styles.listMeta}>
                    <Text style={styles.listMetaText}>
                        {item.postIds.length} {item.postIds.length === 1 ? 'shot' : 'shots'}
                    </Text>
                    {item.isPublic && (
                        <>
                            <Text style={styles.listMetaSeparator}> • </Text>
                            <Ionicons name="lock-open-outline" size={12} color={colors.textTertiary} />
                        </>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    )

    const renderListHeader = () => {
        // Show loading state with skeletons
        if (loadingLists) {
            return (
                <View style={styles.featuredListsSection}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>📋 Featured Lists</Text>
                    </View>
                    <View style={styles.listCarouselScrollView}>
                        <FeaturedListSkeleton />
                        <FeaturedListSkeleton />
                    </View>
                </View>
            )
        }

        // Don't show section if no lists
        if (featuredLists.length === 0) {
            return null
        }

        return (
            <View style={styles.featuredListsSection}>
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>📋 Featured Lists</Text>
                    <TouchableOpacity
                        onPress={() => {
                            recordInteraction()
                            router.push('/(tabs)/lists')
                        }}
                    >
                        <Text style={styles.sectionSeeAll}>See All</Text>
                    </TouchableOpacity>
                </View>
                {/* Use ScrollView instead of nested FlatList to avoid VirtualizedList warning */}
                <View style={styles.listCarouselScrollView}>
                    {featuredLists.map(renderFeaturedListItem)}
                </View>
            </View>
        )
    }

    const renderPost = ({ item }: { item: Post }) => {
        const isSaved = savedPosts.has(item.id)

        return (
            <Pressable
                style={styles.postCard}
                onPress={() => {
                    recordInteraction()
                    if (showOptionsMenu === item.id) {
                        setShowOptionsMenu(null)
                    }
                }}
            >
                <View style={styles.postHeader}>
                    <TouchableOpacity
                        onPress={() => {
                            recordInteraction()
                            setShowOptionsMenu(null)
                            router.push({
                                pathname: '/user-profile',
                                params: { userId: item.authorId },
                            })
                        }}
                    >
                        <Text style={styles.username}>
                            @{item.authorUsername}
                        </Text>
                    </TouchableOpacity>
                    <View style={styles.headerRight}>
                        <View style={styles.catchBadge}>
                            <Ionicons
                                name="trophy"
                                size={16}
                                color={colors.secondary}
                            />
                            <Text style={styles.catchCount}>
                                {item.catchCount}
                            </Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => {
                                recordInteraction()
                                handleToggleSave(item.id)
                            }}
                            style={styles.bookmarkButton}
                        >
                            <Ionicons
                                name={
                                    isSaved
                                        ? 'bookmark'
                                        : 'bookmark-outline'
                                }
                                size={22}
                                color={
                                    isSaved
                                        ? colors.iconActive
                                        : colors.iconInactive
                                }
                            />
                        </TouchableOpacity>
                        <View style={{ zIndex: 10 }}>
                            <TouchableOpacity
                                onPress={() => {
                                    recordInteraction()
                                    setShowOptionsMenu(
                                        showOptionsMenu === item.id
                                            ? null
                                            : item.id
                                    )
                                }}
                                style={styles.bookmarkButton}
                            >
                                <Ionicons
                                    name="ellipsis-horizontal"
                                    size={22}
                                    color={colors.textPrimary}
                                />
                            </TouchableOpacity>

                            {showOptionsMenu === item.id && (
                                <View style={styles.optionsMenu}>
                                    <TouchableOpacity
                                        style={styles.optionsMenuItem}
                                        onPress={() => handleShare(item.id)}
                                    >
                                        <Text style={styles.optionsMenuText}>
                                            Share
                                        </Text>
                                    </TouchableOpacity>
                                    {item.authorId === user?.uid && (
                                        <TouchableOpacity
                                            style={[
                                                styles.optionsMenuItem,
                                                styles.optionsMenuItemLast,
                                            ]}
                                            onPress={() =>
                                                handleDeletePost(item.id)
                                            }
                                        >
                                            <Text
                                                style={[
                                                    styles.optionsMenuText,
                                                    styles.optionsMenuTextDanger,
                                                ]}
                                            >
                                                Delete
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}
                        </View>
                    </View>
                </View>

                <TouchableOpacity
                    onPress={() => {
                        recordInteraction()
                        setShowOptionsMenu(null)
                        setSelectedPost(item)
                        setModalVisible(true)
                    }}
                    activeOpacity={0.9}
                >
                    <Image
                        source={{ uri: item.photoURL }}
                        style={styles.postImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={200}
                    />
                </TouchableOpacity>

                <View style={styles.postFooter}>
                    {item.title && (
                        <Text style={styles.postTitle} numberOfLines={1}>
                            {item.title}
                        </Text>
                    )}
                    {item.caption && (
                        <Text style={styles.caption} numberOfLines={2}>
                            {item.caption}
                        </Text>
                    )}
                    <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
                </View>
            </Pressable>
        )
    }

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Loading shots...</Text>
            </View>
        )
    }

    return (
        <TouchableWithoutFeedback
            onPress={() => {
                if (showOptionsMenu) setShowOptionsMenu(null)
                recordInteraction()
            }}
        >
            <View style={{ flex: 1 }}>
                {/* Header with Search and Filters */}
                <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                    {/* Search Bar */}
                    <View style={styles.searchContainer}>
                        <Ionicons name="search" size={20} color={colors.textTertiary} style={styles.searchIcon} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search locations..."
                            placeholderTextColor={colors.textTertiary}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                    </View>

                    {/* Filter Chips */}
                    <View style={styles.filterChipsContainer}>
                        <TouchableOpacity
                            style={[
                                styles.filterChip,
                                activeFilter === 'near' && styles.filterChipActive,
                                !userLocation && activeFilter !== 'near' && styles.filterChipDisabled,
                            ]}
                            onPress={() => {
                                if (userLocation) {
                                    setActiveFilter('near')
                                    recordInteraction()
                                }
                            }}
                            disabled={!userLocation && activeFilter !== 'near'}
                        >
                            <Ionicons
                                name="location"
                                size={16}
                                color={activeFilter === 'near' ? colors.textPrimary : colors.textSecondary}
                            />
                            <Text style={[
                                styles.filterChipText,
                                activeFilter === 'near' && styles.filterChipTextActive,
                            ]}>
                                Near
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.filterChip,
                                activeFilter === 'trending' && styles.filterChipActive,
                            ]}
                            onPress={() => {
                                setActiveFilter('trending')
                                recordInteraction()
                            }}
                        >
                            <Ionicons
                                name="flame"
                                size={16}
                                color={activeFilter === 'trending' ? colors.textPrimary : colors.textSecondary}
                            />
                            <Text style={[
                                styles.filterChipText,
                                activeFilter === 'trending' && styles.filterChipTextActive,
                            ]}>
                                Trending
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.filterChip,
                                activeFilter === 'new' && styles.filterChipActive,
                            ]}
                            onPress={() => {
                                setActiveFilter('new')
                                recordInteraction()
                            }}
                        >
                            <Ionicons
                                name="sparkles"
                                size={16}
                                color={activeFilter === 'new' ? colors.textPrimary : colors.textSecondary}
                            />
                            <Text style={[
                                styles.filterChipText,
                                activeFilter === 'new' && styles.filterChipTextActive,
                            ]}>
                                New
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Floating Map Button */}
                <TouchableOpacity
                    style={styles.floatingMapButton}
                    onPress={() => {
                        recordInteraction()
                        router.push('/(tabs)/map')
                    }}
                >
                    <Ionicons name="map" size={24} color={colors.textPrimary} />
                </TouchableOpacity>

                <FlatList
                    ref={flatListRef}
                    data={posts}
                    renderItem={renderPost}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    onScroll={recordInteraction}
                    scrollEventThrottle={2000}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.primary}
                        />
                    }
                    ListHeaderComponent={renderListHeader}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Ionicons
                                name="images-outline"
                                size={80}
                                color="#ccc"
                            />
                            <Text style={styles.emptyTitle}>No Shots Yet</Text>
                            <Text style={styles.emptySubtitle}>
                                Be the first to share a shot!
                            </Text>
                        </View>
                    }
                    onEndReached={loadMorePosts}
                    onEndReachedThreshold={0.5}
                    ListFooterComponent={
                        loadingMore ? (
                            <View style={styles.footerLoader}>
                                <ActivityIndicator
                                    size="small"
                                    color={colors.primary}
                                />
                                <Text style={styles.footerText}>
                                    Loading more posts...
                                </Text>
                            </View>
                        ) : !hasMore && posts.length > 0 ? (
                            <View style={styles.footerLoader}>
                                <Text style={styles.footerText}>
                                    No more posts
                                </Text>
                            </View>
                        ) : null
                    }
                />

                <ThreadModal
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

                {selectedPostForList && (
                    <ListSelectionBottomSheet
                        visible={showListSheet}
                        onClose={() => {
                            setShowListSheet(false)
                            setSelectedPostForList(null)
                        }}
                        postId={selectedPostForList}
                        onSaveStateChange={(isSaved) => {
                            // Update the saved state for this specific post
                            if (selectedPostForList) {
                                setSavedPosts(prev => {
                                    const newSet = new Set(prev)
                                    if (isSaved) {
                                        newSet.add(selectedPostForList)
                                    } else {
                                        newSet.delete(selectedPostForList)
                                    }
                                    return newSet
                                })
                            }
                        }}
                    />
                )}

                {showStaleIndicator && (
                    <View style={[styles.staleIndicatorContainer, { top: insets.top + 10 }]}>
                        <TouchableOpacity
                            style={styles.staleIndicator}
                            onPress={async () => {
                                recordInteraction()
                                setStaleRefreshing(true)
                                setHasMore(true)
                                setLastDoc(null)
                                await fetchPosts(false)
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
            </View>
        </TouchableWithoutFeedback>
    )
}

const styles = StyleSheet.create({
    header: {
        backgroundColor: colors.background,
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.card,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 12,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: colors.textPrimary,
    },
    filterChipsContainer: {
        flexDirection: 'row',
        gap: 8,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.card,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    filterChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    filterChipDisabled: {
        opacity: 0.5,
    },
    filterChipText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    filterChipTextActive: {
        color: colors.textPrimary,
    },
    floatingMapButton: {
        position: 'absolute',
        bottom: 20,
        right: 20,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
        zIndex: 100,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
        padding: 20,
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
        color: colors.textTertiary,
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
    featuredListsSection: {
        paddingVertical: 16,
        backgroundColor: colors.background,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    sectionSeeAll: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primary,
    },
    listCarousel: {
        paddingHorizontal: 16,
        gap: 12,
    },
    listCarouselScrollView: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        gap: 12,
    },
    listCard: {
        width: 200,
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        marginRight: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
    },
    listThumbnailGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        height: 200,
    },
    listThumbnailItem: {
        width: '50%',
        height: '50%',
    },
    listThumbnail: {
        width: '100%',
        height: '100%',
        backgroundColor: colors.imageBackground,
    },
    listThumbnailPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.cardElevated,
    },
    listInfo: {
        padding: 12,
    },
    listName: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
        marginBottom: 4,
    },
    listAuthor: {
        fontSize: 13,
        color: colors.textSecondary,
        marginBottom: 6,
    },
    listMeta: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    listMetaText: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    listMetaSeparator: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 100,
        paddingHorizontal: 20,
    },
    emptyTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginTop: 20,
        color: colors.textPrimary,
    },
    emptySubtitle: {
        fontSize: 16,
        color: colors.textTertiary,
        marginTop: 10,
        textAlign: 'center',
    },
    listContent: {
        padding: 10,
        backgroundColor: colors.background,
    },
    postCard: {
        backgroundColor: colors.card,
        borderRadius: 12,
        marginBottom: 15,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 3,
    },
    postHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
    },
    username: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    catchBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.cardElevated,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        gap: 5,
    },
    catchCount: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.secondary,
    },
    bookmarkButton: {
        padding: 4,
    },
    postImage: {
        width: '100%',
        aspectRatio: 1,
        backgroundColor: colors.imageBackground,
    },
    postFooter: {
        padding: 12,
        paddingTop: 10,
    },
    postTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
        lineHeight: 24,
        marginBottom: 4,
    },
    caption: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 18,
        marginBottom: 6,
    },
    dateText: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    optionsMenu: {
        position: 'absolute',
        top: 35,
        right: 0,
        backgroundColor: colors.cardElevated,
        borderRadius: 8,
        minWidth: 120,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 8,
        elevation: 5,
        overflow: 'hidden',
        zIndex: 1000,
    },
    optionsMenuItem: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    optionsMenuItemLast: {
        borderBottomWidth: 0,
    },
    optionsMenuText: {
        fontSize: 15,
        color: colors.textPrimary,
    },
    optionsMenuTextDanger: {
        color: '#ff4444',
    },
    footerLoader: {
        paddingVertical: 20,
        alignItems: 'center',
        gap: 8,
    },
    footerText: {
        fontSize: 14,
        color: colors.textTertiary,
    },
})
