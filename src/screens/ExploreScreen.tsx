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
import React, { useCallback, useEffect, useState, useRef } from 'react'
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
import PagerView from 'react-native-pager-view'

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
    // Separate state for each filter to prevent flash on swipe
    const [trendingPosts, setTrendingPosts] = useState<Post[]>([])
    const [newPosts, setNewPosts] = useState<Post[]>([])
    const [nearPosts, setNearPosts] = useState<Post[]>([])
    const [trendingState, setTrendingState] = useState({ loading: true, refreshing: false, loadingMore: false, hasMore: true, lastDoc: null as QueryDocumentSnapshot<DocumentData> | null })
    const [newState, setNewState] = useState({ loading: true, refreshing: false, loadingMore: false, hasMore: true, lastDoc: null as QueryDocumentSnapshot<DocumentData> | null })
    const [nearState, setNearState] = useState({ loading: true, refreshing: false, loadingMore: false, hasMore: true, lastDoc: null as QueryDocumentSnapshot<DocumentData> | null })
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
    const pagerRef = useRef<PagerView>(null)
    const lastInteractionTimeRef = React.useRef<number>(Date.now())
    const interactionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const [refreshEnabled, setRefreshEnabled] = useState(true)

    // Map filter to page index
    const getPageIndex = (filter: FilterType): number => {
        switch (filter) {
            case 'trending': return 0
            case 'new': return 1
            case 'near': return 2
            default: return 0
        }
    }

    const getFilterFromPage = (page: number): FilterType => {
        switch (page) {
            case 0: return 'trending'
            case 1: return 'new'
            case 2: return 'near'
            default: return 'trending'
        }
    }

    // Helper to get posts and state for a specific filter
    const getFilterData = (filter: FilterType) => {
        switch (filter) {
            case 'trending':
                return { posts: trendingPosts, setPosts: setTrendingPosts, state: trendingState, setState: setTrendingState }
            case 'new':
                return { posts: newPosts, setPosts: setNewPosts, state: newState, setState: setNewState }
            case 'near':
                return { posts: nearPosts, setPosts: setNearPosts, state: nearState, setState: setNearState }
        }
    }

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

    const fetchSavedStatus = useCallback(async (postsToCheck: Post[]) => {
        if (!user || postsToCheck.length === 0) return
        try {
            // Check which posts are saved
            const postIds = postsToCheck.map(p => p.id)
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
    }, [user])

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

    const fetchPosts = async (filter: FilterType, loadMore = false) => {
        const { posts, setPosts, state, setState } = getFilterData(filter)

        if (loadMore && (!state.hasMore || state.loadingMore)) return

        try {
            if (loadMore) {
                setState(prev => ({ ...prev, loadingMore: true }))
            } else {
                setState(prev => ({ ...prev, refreshing: true }))
            }

            // Build query based on filter
            let orderField = 'catchCount' // trending (default)
            let orderDirection: 'desc' | 'asc' = 'desc'

            if (filter === 'new') {
                orderField = 'createdAt'
                orderDirection = 'desc'
            } else if (filter === 'near') {
                // For "near" filter, we still use catchCount but will filter/sort by distance client-side
                orderField = 'catchCount'
                orderDirection = 'desc'
            }

            let postsQuery
            if (loadMore && state.lastDoc) {
                postsQuery = query(
                    collection(db, 'posts'),
                    where('isOriginal', '==', true),
                    orderBy(orderField, orderDirection),
                    startAfter(state.lastDoc),
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
            const lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1]

            // Check if there are more posts
            const hasMorePosts = fetchedPosts.length === POSTS_PER_PAGE

            if (loadMore) {
                // Deduplicate posts when loading more
                const existingIds = new Set(posts.map((p) => p.id))
                const newPosts = fetchedPosts.filter((p) => !existingIds.has(p.id))
                setPosts([...posts, ...newPosts])
                setState(prev => ({ ...prev, lastDoc: lastVisible || null, hasMore: hasMorePosts }))
            } else {
                setPosts(fetchedPosts)
                setState(prev => ({ ...prev, lastDoc: lastVisible || null, hasMore: hasMorePosts }))
                // Fetch saved status on initial load
                await fetchSavedStatus(fetchedPosts)
                // Update last fetch time
                updateLastFetch('explore')
                setShowStaleIndicator(false)
            }
        } catch (error) {
            console.error('Error fetching posts:', error)
        } finally {
            setState(prev => ({ ...prev, loading: false, refreshing: false, loadingMore: false }))
        }
    }

    // Initial load for trending
    useEffect(() => {
        fetchPosts('trending', false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Subscribe to post events for granular updates
    usePostEvents((event: PostEvent) => {
        if (event.action === 'create') {
            // New post created - refresh current filter
            fetchPosts(activeFilter, false)
        } else if (event.action === 'delete' && event.postId) {
            // Remove deleted post from all filters
            setTrendingPosts(prev => prev.filter(p => p.id !== event.postId))
            setNewPosts(prev => prev.filter(p => p.id !== event.postId))
            setNearPosts(prev => prev.filter(p => p.id !== event.postId))
        }
        // Note: 'catch' events don't affect explore feed since it only shows originals
    }, [activeFilter])

    // Auto-refresh when screen becomes focused after being stale
    useEffect(() => {
        if (isFocused && isStale('explore')) {
            // Auto refresh current filter if data is stale
            fetchPosts(activeFilter, false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFocused, activeFilter])

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
                fetchPosts(activeFilter, false)
            }
        })

        return unsubscribe
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigation, isFocused, activeFilter])

    // Lazy load other filters when user switches to them
    useEffect(() => {
        const { posts, state } = getFilterData(activeFilter)
        // If this filter hasn't been loaded yet, load it
        if (posts.length === 0 && !state.loading) {
            fetchPosts(activeFilter, false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFilter])

    // Handle page swipe
    const handlePageSelected = (e: any) => {
        const position = e.nativeEvent.position
        const newFilter = getFilterFromPage(position)

        console.log('Page selected:', position, 'Filter:', newFilter, 'Current:', activeFilter)

        // Don't allow swiping to "Near" if location not available
        if (newFilter === 'near' && !userLocation) {
            console.log('Blocked swipe to Near - no location')
            // Snap back to previous page
            const currentIndex = getPageIndex(activeFilter)
            setTimeout(() => pagerRef.current?.setPage(currentIndex), 0)
            return
        }

        if (newFilter !== activeFilter) {
            console.log('Changing filter from', activeFilter, 'to', newFilter)
            setActiveFilter(newFilter)
            recordInteraction()
        }
    }

    // Fetch featured lists on mount
    useEffect(() => {
        fetchFeaturedLists()
    }, [])

    const onRefresh = useCallback(() => {
        recordInteraction()
        fetchPosts(activeFilter, false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recordInteraction, activeFilter])

    const loadMorePosts = useCallback(() => {
        const { state } = getFilterData(activeFilter)
        if (!state.loading && !state.loadingMore && state.hasMore) {
            fetchPosts(activeFilter, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFilter])

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

            // Update local state in all filters
            setTrendingPosts(prev => prev.filter((post) => post.id !== postId))
            setNewPosts(prev => prev.filter((post) => post.id !== postId))
            setNearPosts(prev => prev.filter((post) => post.id !== postId))

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
        return (
            <>
                {/* Featured Lists Section */}
                {loadingLists ? (
                    <View style={styles.featuredListsSection}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>📋 Featured Lists</Text>
                        </View>
                        <View style={styles.listCarouselScrollView}>
                            <FeaturedListSkeleton />
                            <FeaturedListSkeleton />
                        </View>
                    </View>
                ) : featuredLists.length > 0 ? (
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
                        <View style={styles.listCarouselScrollView}>
                            {featuredLists.map(renderFeaturedListItem)}
                        </View>
                    </View>
                ) : null}

                {/* Filter Tabs - now below featured lists */}
                {renderFilterTabs()}
            </>
        )
    }

    const PostCard = React.memo(({ item }: { item: Post }) => {
        const isSaved = savedPosts.has(item.id)
        const showMenu = showOptionsMenu === item.id

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

                            {showMenu && (
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
    })

    const renderPost = ({ item }: { item: Post }) => <PostCard item={item} />

    // Show loading only if all filters are loading (initial load)
    const allLoading = trendingState.loading && newState.loading && nearState.loading
    if (allLoading && trendingPosts.length === 0) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Loading shots...</Text>
            </View>
        )
    }

    const renderFilterTabs = () => (
        <View style={styles.tabContainer}>
            <TouchableOpacity
                style={[styles.tab, activeFilter === 'trending' && styles.activeTab]}
                onPress={() => {
                    setActiveFilter('trending')
                    pagerRef.current?.setPage(0)
                    recordInteraction()
                }}
            >
                <Text style={[styles.tabText, activeFilter === 'trending' && styles.activeTabText]}>
                    Trending
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.tab, activeFilter === 'new' && styles.activeTab]}
                onPress={() => {
                    setActiveFilter('new')
                    pagerRef.current?.setPage(1)
                    recordInteraction()
                }}
            >
                <Text style={[styles.tabText, activeFilter === 'new' && styles.activeTabText]}>
                    New
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[
                    styles.tab,
                    activeFilter === 'near' && styles.activeTab,
                    !userLocation && styles.tabDisabled,
                ]}
                onPress={() => {
                    if (userLocation) {
                        setActiveFilter('near')
                        pagerRef.current?.setPage(2)
                        recordInteraction()
                    }
                }}
                disabled={!userLocation}
            >
                <Text style={[
                    styles.tabText,
                    activeFilter === 'near' && styles.activeTabText,
                    !userLocation && styles.tabTextDisabled,
                ]}>
                    Near
                </Text>
            </TouchableOpacity>
        </View>
    )

    return (
        <TouchableWithoutFeedback
            onPress={() => {
                if (showOptionsMenu) setShowOptionsMenu(null)
                recordInteraction()
            }}
        >
            <View style={{ flex: 1 }}>
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                    <Text style={styles.title}>Explore</Text>
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

                {/* Swipeable Pager */}
                <PagerView
                    ref={pagerRef}
                    style={styles.pagerView}
                    initialPage={0}
                    onPageSelected={handlePageSelected}
                    onPageScrollStateChanged={(e) => {
                        // Disable pull-to-refresh while swiping
                        if (e.nativeEvent.pageScrollState === 'dragging') {
                            setRefreshEnabled(false)
                        } else if (e.nativeEvent.pageScrollState === 'idle') {
                            setRefreshEnabled(true)
                        }
                    }}
                    scrollEnabled={true}
                >
                    {/* Page 0: Trending */}
                    <View key="0" style={styles.pageContainer}>
                        <FlatList
                            ref={activeFilter === 'trending' ? flatListRef : null}
                            data={trendingPosts}
                            renderItem={renderPost}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.listContent}
                            onScroll={recordInteraction}
                            scrollEventThrottle={2000}
                            nestedScrollEnabled
                            refreshControl={
                                refreshEnabled && activeFilter === 'trending' ? (
                                    <RefreshControl
                                        refreshing={trendingState.refreshing}
                                        onRefresh={onRefresh}
                                        tintColor={colors.primary}
                                    />
                                ) : undefined
                            }
                            ListHeaderComponent={renderListHeader}
                            ListEmptyComponent={
                                trendingState.loading ? null : (
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
                                )
                            }
                            onEndReached={activeFilter === 'trending' ? loadMorePosts : undefined}
                            onEndReachedThreshold={0.5}
                            ListFooterComponent={
                                activeFilter === 'trending' && trendingState.loadingMore ? (
                                    <View style={styles.footerLoader}>
                                        <ActivityIndicator
                                            size="small"
                                            color={colors.primary}
                                        />
                                        <Text style={styles.footerText}>
                                            Loading more posts...
                                        </Text>
                                    </View>
                                ) : activeFilter === 'trending' && !trendingState.hasMore && trendingPosts.length > 0 ? (
                                    <View style={styles.footerLoader}>
                                        <Text style={styles.footerText}>
                                            No more posts
                                        </Text>
                                    </View>
                                ) : null
                            }
                        />
                    </View>

                    {/* Page 1: New */}
                    <View key="1" style={styles.pageContainer}>
                        <FlatList
                            ref={activeFilter === 'new' ? flatListRef : null}
                            data={newPosts}
                            renderItem={renderPost}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.listContent}
                            onScroll={recordInteraction}
                            scrollEventThrottle={2000}
                            nestedScrollEnabled
                            refreshControl={
                                refreshEnabled && activeFilter === 'new' ? (
                                    <RefreshControl
                                        refreshing={newState.refreshing}
                                        onRefresh={onRefresh}
                                        tintColor={colors.primary}
                                    />
                                ) : undefined
                            }
                            ListHeaderComponent={renderListHeader}
                            ListEmptyComponent={
                                newState.loading ? null : (
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
                                )
                            }
                            onEndReached={activeFilter === 'new' ? loadMorePosts : undefined}
                            onEndReachedThreshold={0.5}
                            ListFooterComponent={
                                activeFilter === 'new' && newState.loadingMore ? (
                                    <View style={styles.footerLoader}>
                                        <ActivityIndicator
                                            size="small"
                                            color={colors.primary}
                                        />
                                        <Text style={styles.footerText}>
                                            Loading more posts...
                                        </Text>
                                    </View>
                                ) : activeFilter === 'new' && !newState.hasMore && newPosts.length > 0 ? (
                                    <View style={styles.footerLoader}>
                                        <Text style={styles.footerText}>
                                            No more posts
                                        </Text>
                                    </View>
                                ) : null
                            }
                        />
                    </View>

                    {/* Page 2: Near */}
                    <View key="2" style={styles.pageContainer}>
                        <FlatList
                            ref={activeFilter === 'near' ? flatListRef : null}
                            data={nearPosts}
                            renderItem={renderPost}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.listContent}
                            onScroll={recordInteraction}
                            scrollEventThrottle={2000}
                            nestedScrollEnabled
                            refreshControl={
                                refreshEnabled && activeFilter === 'near' ? (
                                    <RefreshControl
                                        refreshing={nearState.refreshing}
                                        onRefresh={onRefresh}
                                        tintColor={colors.primary}
                                    />
                                ) : undefined
                            }
                            ListHeaderComponent={renderListHeader}
                            ListEmptyComponent={
                                nearState.loading ? null : userLocation ? (
                                    <View style={styles.emptyContainer}>
                                        <Ionicons
                                            name="images-outline"
                                            size={80}
                                            color="#ccc"
                                        />
                                        <Text style={styles.emptyTitle}>No Nearby Shots</Text>
                                        <Text style={styles.emptySubtitle}>
                                            No posts found near your location
                                        </Text>
                                    </View>
                                ) : (
                                    <View style={styles.emptyContainer}>
                                        <Ionicons
                                            name="location-outline"
                                            size={80}
                                            color="#ccc"
                                        />
                                        <Text style={styles.emptyTitle}>Location Required</Text>
                                        <Text style={styles.emptySubtitle}>
                                            Enable location to see nearby posts
                                        </Text>
                                    </View>
                                )
                            }
                            onEndReached={activeFilter === 'near' ? loadMorePosts : undefined}
                            onEndReachedThreshold={0.5}
                            ListFooterComponent={
                                activeFilter === 'near' && nearState.loadingMore ? (
                                    <View style={styles.footerLoader}>
                                        <ActivityIndicator
                                            size="small"
                                            color={colors.primary}
                                        />
                                        <Text style={styles.footerText}>
                                            Loading more posts...
                                        </Text>
                                    </View>
                                ) : activeFilter === 'near' && !nearState.hasMore && nearPosts.length > 0 ? (
                                    <View style={styles.footerLoader}>
                                        <Text style={styles.footerText}>
                                            No more posts
                                        </Text>
                                    </View>
                                ) : null
                            }
                        />
                    </View>
                </PagerView>

                <ThreadModal
                    visible={modalVisible}
                    post={selectedPost}
                    onClose={() => {
                        setModalVisible(false)
                        setSelectedPost(null)
                    }}
                    onPostUpdate={(updatedPost) => {
                        // Update post in all filters
                        setTrendingPosts(prev => prev.map((p) => p.id === updatedPost.id ? updatedPost : p))
                        setNewPosts(prev => prev.map((p) => p.id === updatedPost.id ? updatedPost : p))
                        setNearPosts(prev => prev.map((p) => p.id === updatedPost.id ? updatedPost : p))
                    }}
                    onPostDelete={(postId) => {
                        // Remove from all filters
                        setTrendingPosts(prev => prev.filter((p) => p.id !== postId))
                        setNewPosts(prev => prev.filter((p) => p.id !== postId))
                        setNearPosts(prev => prev.filter((p) => p.id !== postId))
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
                                await fetchPosts(activeFilter, false)
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
        paddingTop: 12,
        paddingBottom: 12,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    tabContainer: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.background,
        paddingHorizontal: 16,
        marginHorizontal: -10, // Extend to edges of list content
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    activeTab: {
        borderBottomColor: colors.primary,
    },
    tabDisabled: {
        opacity: 0.5,
    },
    tabText: {
        fontSize: 16,
        color: colors.textTertiary,
    },
    activeTabText: {
        color: colors.primary,
        fontWeight: '600',
    },
    tabTextDisabled: {
        color: colors.textTertiary,
        opacity: 0.5,
    },
    pagerView: {
        flex: 1,
    },
    pageContainer: {
        flex: 1,
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
