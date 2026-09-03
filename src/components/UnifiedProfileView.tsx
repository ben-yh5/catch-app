import ActivityFeed from '@/components/NotificationInbox'
import ReportBottomSheet from '@/components/ReportBottomSheet'
import ThreadModal from '@/components/ThreadModal'
import AppButton from '@/components/ui/AppButton'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { PostEvent, usePost, usePostEvents } from '@/context/PostContext'
import { db, functions } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Post } from '@/types'
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
import { httpsCallable } from 'firebase/functions'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import CompactPostCard from './CompactPostCard'
import { CompactPostCardSkeleton, ProfileSkeleton } from './ui/Skeleton'

interface ProfileViewProps {
    userId: string
    isOwnProfile: boolean
}

const POSTS_PER_PAGE = 20

export default function UnifiedProfileView({
    userId,
    isOwnProfile,
}: ProfileViewProps) {
    const { user, updateStats, blockedUserIds, blockUser, unblockUser } =
        useAuth()
    const { showToast } = useToast()
    const { updateLastFetch, isStale } = usePost()
    const router = useRouter()
    const navigation = useNavigation()
    const isFocused = useIsFocused()
    const insets = useSafeAreaInsets()
    const [username, setUsername] = useState<string>('')
    const [totalCatches, setTotalCatches] = useState<number>(0)
    const [, setTotalPosts] = useState<number>(0)
    const [followerCount, setFollowerCount] = useState<number>(0)
    const [followingCount, setFollowingCount] = useState<number>(0)
    const [isFollowing, setIsFollowing] = useState<boolean>(false)
    const followActionPending = useRef(false)
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
    const [activeTab, setActiveTab] = useState<'posts' | 'catches'>('posts')
    const [refreshing, setRefreshing] = useState(false)
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)
    const [showActivityFeed, setShowActivityFeed] = useState(false)
    const [showStaleIndicator, setShowStaleIndicator] = useState(false)
    const [staleRefreshing, setStaleRefreshing] = useState(false)
    const [searchVisible, setSearchVisible] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<
        { id: string; username: string }[]
    >([])
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchError, setSearchError] = useState(false)
    const [followListVisible, setFollowListVisible] = useState(false)
    const [followListType, setFollowListType] = useState<
        'followers' | 'following'
    >('followers')
    const [followList, setFollowList] = useState<
        { id: string; username: string; isFollowing: boolean }[]
    >([])
    const [followListLoading, setFollowListLoading] = useState(false)
    const [reportVisible, setReportVisible] = useState(false)
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
                setTotalPosts(userData.totalPosts || 0)
                const followers = (userData.followers || []).filter(
                    (id: string) => id !== userId
                )
                const following = (userData.following || []).filter(
                    (id: string) => id !== userId
                )
                setFollowerCount(followers.length)
                setFollowingCount(following.length)

                // Sync stats to AuthContext so Explore page stays in sync
                if (isOwnProfile) {
                    updateStats({
                        totalPosts: userData.totalPosts || 0,
                        totalCatches: userData.totalCatches || 0,
                    })
                }

                // Check if current user is following this profile
                if (!isOwnProfile && user) {
                    setIsFollowing(
                        userData.followers?.includes(user.uid) || false
                    )
                }
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
            // Fail loud: without this, a failed load renders as an empty
            // profile — indistinguishable from a user with zero posts
            showToast(
                'error',
                "Couldn't load profile",
                'Check your connection and pull down to retry.'
            )
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        setLoading(true)
        fetchUserData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId])

    // Subscribe to post events for granular updates
    usePostEvents(
        (event: PostEvent) => {
            // Only handle events relevant to this profile
            if (event.action === 'create' && event.userId === userId) {
                // New post created by this user - add to top of posts list without full refetch
                if (isOwnProfile) {
                    setHasMorePosts(true)
                    setLastPostDoc(null)
                    fetchUserData()
                }
            } else if (event.action === 'catch' && event.userId === userId) {
                // User created a catch - update catches list
                if (isOwnProfile && activeTab === 'catches') {
                    setHasMoreCatches(true)
                    setLastCatchDoc(null)
                    fetchUserData()
                }
            } else if (event.action === 'delete' && event.postId) {
                // Remove deleted post from local state without re-fetching
                setPosts((prev) => prev.filter((p) => p.id !== event.postId))
                setCatches((prev) => prev.filter((p) => p.id !== event.postId))
            }
        },
        [userId, isOwnProfile, activeTab]
    )

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

        const unsubscribe = navigation.addListener(
            'tabPress' as any,
            (e: any) => {
                if (isFocused) {
                    // Already on this tab, scroll to top and refresh
                    e.preventDefault()
                    flatListRef.current?.scrollToOffset({
                        offset: 0,
                        animated: true,
                    })
                    setHasMorePosts(true)
                    setHasMoreCatches(true)
                    setLastPostDoc(null)
                    setLastCatchDoc(null)
                    fetchUserData()
                }
            }
        )

        return unsubscribe
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigation, isFocused, isOwnProfile])

    const onRefresh = useCallback(async () => {
        setRefreshing(true)
        setHasMorePosts(true)
        setHasMoreCatches(true)
        setLastPostDoc(null)
        setLastCatchDoc(null)
        await fetchUserData()
        setRefreshing(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (activeTab === 'posts' && hasMorePosts && !loadingMore) {
            loadMorePosts()
        }
        // Load more catches if catches are shown and there are more
        if (activeTab === 'catches' && hasMoreCatches && !loadingMore) {
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
        setSearchError(false)
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
            // Distinguish a failed search from "no users found"
            setSearchError(true)
        } finally {
            setSearchLoading(false)
        }
    }

    const handleUserSelect = (selectedUserId: string) => {
        setSearchVisible(false)
        setSearchQuery('')
        setSearchResults([])
        if (selectedUserId === user?.uid) return
        router.push({
            pathname: '/user-profile',
            params: { userId: selectedUserId },
        } as any)
    }

    const isBlocked = blockedUserIds.includes(userId)

    const handleBlockToggle = () => {
        if (isBlocked) {
            Alert.alert('Unblock user', `Unblock @${username}?`, [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Unblock',
                    onPress: async () => {
                        try {
                            await unblockUser(userId)
                            showToast('success', `Unblocked @${username}`)
                        } catch {
                            showToast('error', 'Failed to unblock user')
                        }
                    },
                },
            ])
        } else {
            Alert.alert(
                'Block user',
                `Block @${username}? You won't see their posts, and any follow relationship is removed.`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Block',
                        style: 'destructive',
                        onPress: async () => {
                            try {
                                await blockUser(userId)
                                showToast('success', `Blocked @${username}`)
                            } catch {
                                showToast('error', 'Failed to block user')
                            }
                        },
                    },
                ]
            )
        }
    }

    const handleReport = () => {
        Alert.alert(`@${username}`, undefined, [
            {
                text: 'Report user',
                onPress: () => setReportVisible(true),
            },
            {
                text: isBlocked ? 'Unblock user' : 'Block user',
                style: isBlocked ? 'default' : 'destructive',
                onPress: handleBlockToggle,
            },
            { text: 'Cancel', style: 'cancel' },
        ])
    }

    const handleShowFollowList = async (type: 'followers' | 'following') => {
        if (!userId) return

        setFollowListType(type)
        setFollowListVisible(true)
        setFollowListLoading(true)

        try {
            // Fetch the user's document to get followers or following IDs
            const userDoc = await getDoc(doc(db, 'users', userId))
            if (!userDoc.exists()) {
                setFollowListLoading(false)
                return
            }

            const userData = userDoc.data()
            const userIds = (
                type === 'followers'
                    ? userData.followers || []
                    : userData.following || []
            ).filter((id: string) => id !== userId)

            if (userIds.length === 0) {
                setFollowList([])
                setFollowListLoading(false)
                return
            }

            // Fetch user details for each ID
            const users: {
                id: string
                username: string
                isFollowing: boolean
            }[] = []

            for (const uid of userIds) {
                const userDocRef = doc(db, 'users', uid)
                const userSnapshot = await getDoc(userDocRef)

                if (userSnapshot.exists()) {
                    const data = userSnapshot.data()

                    // Check if current user is following this person
                    let isFollowingThisUser = false
                    if (user) {
                        const currentUserDoc = await getDoc(
                            doc(db, 'users', user.uid)
                        )
                        if (currentUserDoc.exists()) {
                            const currentUserData = currentUserDoc.data()
                            isFollowingThisUser = (
                                currentUserData.following || []
                            ).includes(uid)
                        }
                    }

                    users.push({
                        id: uid,
                        username: data.username || 'Unknown',
                        isFollowing: isFollowingThisUser,
                    })
                }
            }

            setFollowList(users)
        } catch (error) {
            console.error('Error fetching follow list:', error)
            showToast('error', 'Failed to load list')
        } finally {
            setFollowListLoading(false)
        }
    }

    const handleFollowFromList = async (targetUserId: string) => {
        if (!user || targetUserId === user.uid) return

        // Find the user in the list
        const userInList = followList.find((u) => u.id === targetUserId)
        if (!userInList) return

        // Optimistic update immediately
        setFollowList(
            followList.map((u) =>
                u.id === targetUserId
                    ? { ...u, isFollowing: !u.isFollowing }
                    : u
            )
        )

        try {
            if (userInList.isFollowing) {
                const unfollowUserFn = httpsCallable(functions, 'unfollowUser')
                await unfollowUserFn({ targetUserId })
            } else {
                const followUserFn = httpsCallable(functions, 'followUser')
                await followUserFn({ targetUserId })
            }
        } catch (error) {
            console.error('Error toggling follow:', error)
            // Revert optimistic update
            setFollowList((prev) =>
                prev.map((u) =>
                    u.id === targetUserId
                        ? { ...u, isFollowing: userInList.isFollowing }
                        : u
                )
            )
            showToast('error', 'Failed to update follow status')
        }
    }

    const handleFollowToggle = async () => {
        if (!user || !userId) return

        // Debounce with ref — non-blocking, just skips duplicate in-flight calls
        if (followActionPending.current) return
        followActionPending.current = true

        // Optimistic update
        const wasFollowing = isFollowing
        setIsFollowing(!wasFollowing)
        setFollowerCount((prev) =>
            wasFollowing ? Math.max(0, prev - 1) : prev + 1
        )

        try {
            if (wasFollowing) {
                const unfollowUserFn = httpsCallable(functions, 'unfollowUser')
                await unfollowUserFn({ targetUserId: userId })
            } else {
                const followUserFn = httpsCallable(functions, 'followUser')
                await followUserFn({ targetUserId: userId })
            }
        } catch (error) {
            console.error('Error toggling follow:', error)
            // Revert optimistic update on error
            setIsFollowing(wasFollowing)
            setFollowerCount((prev) =>
                wasFollowing ? prev + 1 : Math.max(0, prev - 1)
            )
            showToast('error', 'Failed to update follow status')
        } finally {
            followActionPending.current = false
        }
    }

    // Combine and sort posts based on what's toggled on
    const displayedPosts = React.useMemo(() => {
        return activeTab === 'posts' ? posts : catches
    }, [activeTab, posts, catches])

    const renderPost = ({ item }: { item: Post }) => (
        <View style={styles.postItemContainer}>
            <CompactPostCard
                post={item}
                onPress={() => handlePostPress(item)}
                highlighted={isOwnProfile}
            />
        </View>
    )

    // ... existing code

    return (
        <>
            <View style={styles.container}>
                <FlatList
                    ref={flatListRef}
                    data={displayedPosts}
                    renderItem={renderPost}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={[
                        styles.listContent,
                        { paddingTop: insets.top + 56 },
                    ]}
                    // ... rest of FlatList props
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.primary}
                            progressViewOffset={insets.top + 56}
                        />
                    }
                    ListHeaderComponent={
                        loading ? (
                            <ProfileSkeleton />
                        ) : (
                            <View style={styles.profileInfo}>
                                <View style={styles.statsContainer}>
                                    <Text
                                        style={styles.username}
                                        accessibilityRole="header"
                                    >
                                        @{username}
                                    </Text>
                                    <View style={styles.statRow}>
                                        <TouchableOpacity
                                            style={styles.statItem}
                                            // Activity feed is the viewer's
                                            // own — only offer it on your own
                                            // profile, never on someone
                                            // else's stat
                                            disabled={!isOwnProfile}
                                            onPress={() =>
                                                setShowActivityFeed(true)
                                            }
                                            accessibilityLabel={`${totalCatches} Catches`}
                                            accessibilityRole={
                                                isOwnProfile
                                                    ? 'button'
                                                    : 'text'
                                            }
                                            accessibilityHint={
                                                isOwnProfile
                                                    ? 'View activity feed'
                                                    : undefined
                                            }
                                        >
                                            <Text style={styles.statNumber}>
                                                {totalCatches}
                                            </Text>
                                            <Text style={styles.statLabel}>
                                                Catches
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.statItem}
                                            onPress={() =>
                                                handleShowFollowList(
                                                    'followers'
                                                )
                                            }
                                            accessibilityLabel={`${followerCount} Followers`}
                                            accessibilityRole="button"
                                            accessibilityHint="View followers list"
                                        >
                                            <Text style={styles.statNumber}>
                                                {followerCount}
                                            </Text>
                                            <Text style={styles.statLabel}>
                                                Followers
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.statItem}
                                            onPress={() =>
                                                handleShowFollowList(
                                                    'following'
                                                )
                                            }
                                            accessibilityLabel={`${followingCount} Following`}
                                            accessibilityRole="button"
                                            accessibilityHint="View following list"
                                        >
                                            <Text style={styles.statNumber}>
                                                {followingCount}
                                            </Text>
                                            <Text style={styles.statLabel}>
                                                Following
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                {!isOwnProfile && (
                                    <AppButton
                                        title={
                                            isFollowing ? 'Following' : 'Follow'
                                        }
                                        onPress={handleFollowToggle}
                                        variant={
                                            isFollowing ? 'outline' : 'primary'
                                        }
                                        style={{
                                            marginTop: 20,
                                            alignSelf: 'center',
                                            width: 140,
                                        }}
                                    />
                                )}

                                <View style={styles.tabContainer}>
                                    <TouchableOpacity
                                        style={[
                                            styles.tab,
                                            activeTab === 'posts' &&
                                                styles.tabActive,
                                        ]}
                                        onPress={() => {
                                            setActiveTab('posts')
                                        }}
                                        accessibilityLabel="Posts"
                                        accessibilityRole="button"
                                        accessibilityState={{
                                            selected: activeTab === 'posts',
                                        }}
                                    >
                                        <Text
                                            style={[
                                                styles.tabText,
                                                activeTab === 'posts' &&
                                                    styles.tabTextActive,
                                            ]}
                                        >
                                            Posts
                                        </Text>
                                        {activeTab === 'posts' && (
                                            <View
                                                style={styles.activeIndicator}
                                            />
                                        )}
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.tab,
                                            activeTab === 'catches' &&
                                                styles.tabActive,
                                        ]}
                                        onPress={() => {
                                            setActiveTab('catches')
                                        }}
                                        accessibilityLabel="Catches"
                                        accessibilityRole="button"
                                        accessibilityState={{
                                            selected: activeTab === 'catches',
                                        }}
                                    >
                                        <Text
                                            style={[
                                                styles.tabText,
                                                activeTab === 'catches' &&
                                                    styles.tabTextActive,
                                            ]}
                                        >
                                            Catches
                                        </Text>
                                        {activeTab === 'catches' && (
                                            <View
                                                style={styles.activeIndicator}
                                            />
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )
                    }
                    ListEmptyComponent={
                        loading ? (
                            <View>
                                <CompactPostCardSkeleton />
                                <CompactPostCardSkeleton />
                                <CompactPostCardSkeleton />
                            </View>
                        ) : (
                            <View style={styles.emptyContainer}>
                                <Ionicons
                                    name="images-outline"
                                    size={80}
                                    color={colors.textTertiary}
                                />
                                <Text style={styles.emptyText}>
                                    {activeTab === 'posts'
                                        ? 'No posts yet'
                                        : 'No catches yet'}
                                </Text>
                            </View>
                        )
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
                />

                <View
                    style={[styles.profileHeader, { paddingTop: insets.top }]}
                >
                    {isOwnProfile ? (
                        <TouchableOpacity
                            onPress={() => {
                                setSearchVisible(true)
                                requestAnimationFrame(() =>
                                    searchInputRef.current?.focus()
                                )
                            }}
                            style={styles.searchButton}
                            accessibilityLabel="Search users"
                            accessibilityRole="button"
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
                            accessibilityLabel="Go back"
                            accessibilityRole="button"
                        >
                            <Ionicons
                                name="chevron-back"
                                size={28}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                    )}

                    <Text style={styles.headerTitle} accessibilityRole="header">
                        Profile
                    </Text>

                    {isOwnProfile ? (
                        <TouchableOpacity
                            onPress={() => router.push('/settings' as any)}
                            style={styles.settingsButton}
                            accessibilityLabel="Settings"
                            accessibilityRole="button"
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
                            accessibilityLabel="User actions"
                            accessibilityRole="button"
                            accessibilityHint="Report or block this user"
                        >
                            <Ionicons
                                name="ellipsis-horizontal"
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
                <View
                    style={[
                        styles.staleIndicatorContainer,
                        { top: insets.top + 66 },
                    ]}
                >
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
                        accessibilityLabel={
                            staleRefreshing
                                ? 'Refreshing profile'
                                : 'Refresh profile'
                        }
                        accessibilityRole="button"
                        accessibilityState={{ disabled: staleRefreshing }}
                    >
                        {staleRefreshing ? (
                            <ActivityIndicator
                                size="small"
                                color={colors.primary}
                            />
                        ) : (
                            <Ionicons
                                name="refresh"
                                size={16}
                                color={colors.primary}
                            />
                        )}
                        <Text style={styles.staleIndicatorText}>
                            {staleRefreshing
                                ? 'Refreshing...'
                                : 'Tap to refresh'}
                        </Text>
                    </TouchableOpacity>
                </View>
            )}

            <ActivityFeed
                visible={showActivityFeed}
                onClose={() => setShowActivityFeed(false)}
            />

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
                <View
                    style={[
                        styles.searchModalOverlay,
                        { paddingTop: insets.top },
                    ]}
                >
                    <View style={styles.searchHeader}>
                        <TouchableOpacity
                            onPress={() => {
                                setSearchVisible(false)
                                setSearchQuery('')
                                setSearchResults([])
                            }}
                            style={styles.searchCloseButton}
                            accessibilityLabel="Close search"
                            accessibilityRole="button"
                        >
                            <Ionicons
                                name="arrow-back"
                                size={24}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                        <View style={styles.searchInputContainer}>
                            <Ionicons
                                name="search"
                                size={18}
                                color={colors.textTertiary}
                            />
                            <TextInput
                                ref={searchInputRef}
                                style={styles.searchInput}
                                placeholder="Search users..."
                                placeholderTextColor={colors.textTertiary}
                                value={searchQuery}
                                onChangeText={handleSearch}
                                autoCapitalize="none"
                                autoCorrect={false}
                                accessibilityLabel="Search users"
                                accessibilityHint="Type a username to search"
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity
                                    onPress={() => handleSearch('')}
                                    accessibilityLabel="Clear search"
                                    accessibilityRole="button"
                                >
                                    <Ionicons
                                        name="close-circle"
                                        size={18}
                                        color={colors.textTertiary}
                                    />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    <View style={styles.searchResults}>
                        {searchLoading ? (
                            <View style={styles.searchLoadingContainer}>
                                <ActivityIndicator
                                    size="small"
                                    color={colors.primary}
                                />
                            </View>
                        ) : searchResults.length > 0 ? (
                            searchResults.map((result) => (
                                <TouchableOpacity
                                    key={result.id}
                                    style={styles.searchResultItem}
                                    onPress={() => handleUserSelect(result.id)}
                                    accessibilityLabel={`@${result.username}${result.id === user?.uid ? ', you' : ''}`}
                                    accessibilityRole="button"
                                    accessibilityHint="View user profile"
                                >
                                    <View style={styles.searchResultAvatar}>
                                        <Ionicons
                                            name="person"
                                            size={20}
                                            color={colors.textTertiary}
                                        />
                                    </View>
                                    <Text style={styles.searchResultUsername}>
                                        @{result.username}
                                    </Text>
                                    {result.id === user?.uid && (
                                        <Text style={styles.searchResultYou}>
                                            (you)
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            ))
                        ) : searchError ? (
                            <Text style={styles.searchNoResults}>
                                Search failed — check your connection and try
                                again
                            </Text>
                        ) : searchQuery.length > 0 ? (
                            <Text style={styles.searchNoResults}>
                                No users found
                            </Text>
                        ) : (
                            <Text style={styles.searchHint}>
                                Search for users by username
                            </Text>
                        )}
                    </View>
                </View>
            </Modal>

            <Modal
                visible={followListVisible}
                animationType="slide"
                transparent
                onRequestClose={() => setFollowListVisible(false)}
            >
                <View
                    style={[
                        styles.searchModalOverlay,
                        { paddingTop: insets.top },
                    ]}
                >
                    <View style={styles.searchHeader}>
                        <TouchableOpacity
                            onPress={() => setFollowListVisible(false)}
                            style={styles.searchCloseButton}
                            accessibilityLabel="Close list"
                            accessibilityRole="button"
                        >
                            <Ionicons
                                name="arrow-back"
                                size={24}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                        <Text
                            style={styles.headerTitle}
                            accessibilityRole="header"
                        >
                            {followListType === 'followers'
                                ? 'Followers'
                                : 'Following'}
                        </Text>
                        <View style={{ width: 24 }} />
                    </View>

                    <View style={styles.searchResults}>
                        {followListLoading ? (
                            <View style={styles.searchLoadingContainer}>
                                <ActivityIndicator
                                    size="small"
                                    color={colors.primary}
                                />
                            </View>
                        ) : followList.length > 0 ? (
                            followList.map((userItem) => (
                                <View
                                    key={userItem.id}
                                    style={styles.searchResultItem}
                                >
                                    <TouchableOpacity
                                        style={styles.followListUserInfo}
                                        onPress={() => {
                                            setFollowListVisible(false)
                                            if (userItem.id === user?.uid)
                                                return
                                            router.push({
                                                pathname: '/user-profile',
                                                params: { userId: userItem.id },
                                            } as any)
                                        }}
                                        accessibilityLabel={`@${userItem.username}${userItem.id === user?.uid ? ', you' : ''}`}
                                        accessibilityRole="button"
                                        accessibilityHint="View user profile"
                                    >
                                        <View style={styles.searchResultAvatar}>
                                            <Ionicons
                                                name="person"
                                                size={20}
                                                color={colors.textTertiary}
                                            />
                                        </View>
                                        <Text
                                            style={styles.searchResultUsername}
                                        >
                                            @{userItem.username}
                                        </Text>
                                        {userItem.id === user?.uid && (
                                            <Text
                                                style={styles.searchResultYou}
                                            >
                                                (you)
                                            </Text>
                                        )}
                                    </TouchableOpacity>

                                    {userItem.id !== user?.uid && (
                                        <TouchableOpacity
                                            style={[
                                                styles.followListButton,
                                                userItem.isFollowing &&
                                                    styles.followListButtonFollowing,
                                            ]}
                                            onPress={() =>
                                                handleFollowFromList(
                                                    userItem.id
                                                )
                                            }
                                            accessibilityLabel={
                                                userItem.isFollowing
                                                    ? `Unfollow @${userItem.username}`
                                                    : `Follow @${userItem.username}`
                                            }
                                            accessibilityRole="button"
                                        >
                                            <Text
                                                style={[
                                                    styles.followListButtonText,
                                                    userItem.isFollowing &&
                                                        styles.followListButtonTextFollowing,
                                                ]}
                                            >
                                                {userItem.isFollowing
                                                    ? 'Following'
                                                    : 'Follow'}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            ))
                        ) : (
                            <Text style={styles.searchNoResults}>
                                No{' '}
                                {followListType === 'followers'
                                    ? 'followers'
                                    : 'following'}{' '}
                                yet
                            </Text>
                        )}
                    </View>
                </View>
            </Modal>

            <ReportBottomSheet
                visible={reportVisible}
                onClose={() => setReportVisible(false)}
                targetUserId={userId}
                targetUsername={username}
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
    followListUserInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    followListButton: {
        paddingVertical: 6,
        paddingHorizontal: 16,
        borderRadius: 6,
        backgroundColor: colors.primary,
        marginLeft: 12,
    },
    followListButtonFollowing: {
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
    },
    followListButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    followListButtonTextFollowing: {
        color: colors.textPrimary,
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
    followButton: {
        marginTop: 20,
        paddingVertical: 10,
        paddingHorizontal: 32,
        borderRadius: 8,
        backgroundColor: colors.primary,
        alignSelf: 'center',
    },
    followingButton: {
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
    },
    followButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    followingButtonText: {
        color: colors.textPrimary,
    },
    tabContainer: {
        flexDirection: 'row',
        marginTop: 24,
        width: '100%',
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 12,
        position: 'relative',
    },
    tabActive: {
        //
    },
    tabText: {
        fontSize: 16,
        color: colors.textTertiary,
        fontWeight: '500',
    },
    tabTextActive: {
        color: colors.textPrimary,
        fontWeight: '600',
    },
    activeIndicator: {
        position: 'absolute',
        bottom: -1,
        left: 0,
        right: 0,
        height: 2,
        backgroundColor: colors.primary,
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
    postItemContainer: {
        marginBottom: 0,
    },
})
