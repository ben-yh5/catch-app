import ExploreSearchBar from '@/components/ExploreSearchBar'
import ExploreSection from '@/components/ExploreSection'
import ActivityFeed from '@/components/NotificationInbox'
import RecommendedPostCard from '@/components/RecommendedPostCard'
import ThreadModal from '@/components/ThreadModal'
import { useAuth } from '@/context/AuthContext'
import { useRecommendedFeed } from '@/hooks/useRecommendedFeed'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { List, Post, RecommendedPost } from '@/types'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    where,
} from 'firebase/firestore'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const POSTS_LIMIT = 5

export default function ExploreScreen() {
    const { user, contribution, unreadCount } = useAuth()
    const router = useRouter()
    const insets = useSafeAreaInsets()

    // State
    const [featuredLists, setFeaturedLists] = useState<List[]>([])
    const [trendingPosts, setTrendingPosts] = useState<Post[]>([])
    const [newPosts, setNewPosts] = useState<Post[]>([])
    const [loadingLists, setLoadingLists] = useState(true)
    const [loadingTrending, setLoadingTrending] = useState(true)
    const [loadingNew, setLoadingNew] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [showNotifications, setShowNotifications] = useState(false)

    // Thread modal state
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)

    // Recommended feed
    const recommendedFeed = useRecommendedFeed()

    const fetchFeaturedLists = async () => {
        try {
            setLoadingLists(true)
            const listsQuery = query(
                collection(db, 'lists'),
                where('isPublic', '==', true),
                limit(10)
            )
            const querySnapshot = await getDocs(listsQuery)
            const lists: List[] = []

            for (const docSnap of querySnapshot.docs) {
                const listData = docSnap.data()
                if (!listData.postIds || !Array.isArray(listData.postIds) || listData.postIds.length === 0) continue

                try {
                    const thumbnails: string[] = []
                    const postIdsToFetch = listData.postIds.slice(0, 4)
                    for (const postId of postIdsToFetch) {
                        const postDoc = await getDoc(doc(db, 'posts', postId))
                        if (postDoc.exists()) {
                            const data = postDoc.data()
                            thumbnails.push(data.thumbnailURL || data.photoURL)
                        }
                    }

                    if (thumbnails.length > 0) {
                        lists.push({
                            id: docSnap.id,
                            ...listData,
                            thumbnails,
                        } as List)
                    }
                } catch (e) {
                    console.warn('Error processing list', e)
                }
            }
            lists.sort((a, b) => (b.postIds?.length || 0) - (a.postIds?.length || 0))
            setFeaturedLists(lists)
        } catch (error) {
            console.error('Error fetching lists', error)
        } finally {
            setLoadingLists(false)
        }
    }

    const fetchTrendingPosts = async () => {
        try {
            setLoadingTrending(true)
            const q = query(collection(db, 'posts'), where('isOriginal', '==', true), orderBy('catchCount', 'desc'), limit(POSTS_LIMIT))
            const snap = await getDocs(q)
            setTrendingPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)))
        } catch (e) {
            console.error(e)
        } finally {
            setLoadingTrending(false)
        }
    }

    const fetchNewPosts = async () => {
        try {
            setLoadingNew(true)
            const q = query(collection(db, 'posts'), where('isOriginal', '==', true), orderBy('createdAt', 'desc'), limit(POSTS_LIMIT))
            const snap = await getDocs(q)
            setNewPosts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Post)))
        } catch (e) {
            console.error(e)
        } finally {
            setLoadingNew(false)
        }
    }

    useEffect(() => {
        fetchFeaturedLists()
        fetchTrendingPosts()
        fetchNewPosts()
    }, [])

    const onRefresh = async () => {
        setRefreshing(true)
        await Promise.all([
            fetchFeaturedLists(),
            fetchTrendingPosts(),
            fetchNewPosts(),
            recommendedFeed.refresh(),
        ])
        setRefreshing(false)
    }

    const handlePostPress = useCallback((postId: string) => {
        const post = trendingPosts.find(p => p.id === postId)
            || newPosts.find(p => p.id === postId)
            || recommendedFeed.posts.find(p => p.id === postId)
        if (post) {
            setSelectedPost(post)
            setModalVisible(true)
        }
    }, [trendingPosts, newPosts, recommendedFeed.posts])

    const handlePostUpdate = (updated: Post) => {
        const update = (prev: Post[]) => prev.map(p => p.id === updated.id ? updated : p)
        setTrendingPosts(update)
        setNewPosts(update)
    }

    const handlePostDelete = (id: string) => {
        const del = (prev: Post[]) => prev.filter(p => p.id !== id)
        setTrendingPosts(del)
        setNewPosts(del)
    }

    const handleSearch = useCallback((queryText: string) => {
        router.push({ pathname: '/(tabs)/map', params: { searchQuery: queryText } })
    }, [router])

    const renderRecommendedCard = useCallback(({ item }: { item: RecommendedPost }) => (
        <RecommendedPostCard
            post={item}
            onPress={() => handlePostPress(item.id)}
            isOwnPost={item.authorId === user?.uid}
        />
    ), [user?.uid, handlePostPress])

    const renderFeaturedListSection = useCallback(() => {
        if (loadingLists) return null; // Simplified loading for lists
        if (featuredLists.length === 0) return null;

        return (
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <View style={styles.titleContainer}>
                        <Text style={styles.title} accessibilityRole="header">Featured Lists</Text>
                    </View>
                    <Text style={styles.seeAll} onPress={() => router.push('/(tabs)/lists')} accessibilityRole="link" accessibilityHint="View all featured lists">See All →</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listContent}>
                    {featuredLists.map(list => (
                        <TouchableOpacity key={list.id} style={styles.listCard} onPress={() => router.push({ pathname: '/(tabs)/map', params: { listId: list.id } })} accessibilityLabel={`${list.name} by @${list.creatorUsername}, ${list.postIds?.length || 0} shots`} accessibilityRole="button" accessibilityHint="Open this list on the map">
                            <View style={styles.listThumbnailGrid}>
                                {[0, 1, 2, 3].map((index) => (
                                    <View key={index} style={styles.listThumbnailItem}>
                                        {list.thumbnails && list.thumbnails[index] ? (
                                            <Image
                                                source={{ uri: list.thumbnails[index] }}
                                                style={styles.listThumbnail}
                                                contentFit="cover"
                                                transition={200}
                                                accessibilityLabel={`${list.name} thumbnail ${index + 1}`}
                                            />
                                        ) : (
                                            <View style={[styles.listThumbnail, styles.listThumbnailPlaceholder]}>
                                                <Ionicons name="image-outline" size={24} color={colors.textTertiary} />
                                            </View>
                                        )}
                                    </View>
                                ))}
                            </View>
                            <View style={styles.listInfo}>
                                <Text style={styles.listName} numberOfLines={1}>{list.name}</Text>
                                <Text style={styles.listAuthor} numberOfLines={1}>by @{list.creatorUsername}</Text>
                                <Text style={styles.listMeta}>{list.postIds?.length || 0} shots</Text>
                            </View>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>
        )
    }, [loadingLists, featuredLists, router])

    const listHeaderComponent = useMemo(() => (
        <>
            <View style={styles.searchBarContainer}>
                <ExploreSearchBar
                    onSubmit={handleSearch}
                    onClear={() => {}}
                />
            </View>

            {renderFeaturedListSection()}

            <ExploreSection title="Trending" posts={trendingPosts} onPostPress={handlePostPress} onSeeAllPress={() => router.push({ pathname: '/(tabs)/map', params: { filter: 'trending' } })} loading={loadingTrending} />

            <ExploreSection title="New" posts={newPosts} onPostPress={handlePostPress} onSeeAllPress={() => router.push({ pathname: '/(tabs)/map', params: { filter: 'new' } })} loading={loadingNew} />

            {/* For You section header */}
            {recommendedFeed.loading ? (
                <View style={styles.forYouLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                </View>
            ) : recommendedFeed.posts.length > 0 ? (
                <View style={styles.forYouHeader}>
                    <Text style={styles.forYouTitle} accessibilityRole="header">For You</Text>
                    <Text style={styles.forYouSubtitle}>Based on who you follow and places you explore</Text>
                </View>
            ) : (
                <View style={styles.forYouEmpty}>
                    <Text style={styles.emptyText}>Follow users and search cities to get personalized recommendations</Text>
                </View>
            )}
        </>
    ), [
        handleSearch, renderFeaturedListSection,
        trendingPosts, loadingTrending, newPosts, loadingNew,
        handlePostPress, router,
        recommendedFeed.loading, recommendedFeed.posts.length,
    ])

    const isLoading = loadingLists && loadingTrending && loadingNew

    if (isLoading && !refreshing) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <Text style={styles.headerTitle} accessibilityRole="header">Explore</Text>
                <View style={styles.headerRight}>
                    <TouchableOpacity
                        style={styles.contributionBadge}
                        onPress={() => setShowNotifications(true)}
                        accessibilityLabel={`Contribution score: ${contribution}`}
                        accessibilityRole="button"
                        accessibilityHint="View your notifications"
                    >
                        <Text style={styles.contributionEmoji}>🏆</Text>
                        <Text style={styles.contributionText}>{contribution}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.notificationButton}
                        onPress={() => setShowNotifications(true)}
                        accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                        accessibilityRole="button"
                        accessibilityHint="Open notifications"
                    >
                        <Ionicons name="notifications-outline" size={24} color={colors.textPrimary} />
                        {unreadCount > 0 && (
                            <View style={styles.unreadBadge}>
                                <Text style={styles.unreadText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            <ActivityFeed visible={showNotifications} onClose={() => setShowNotifications(false)} />

            <FlatList
                data={recommendedFeed.posts}
                renderItem={renderRecommendedCard}
                keyExtractor={(item) => `rec-${item.id}`}
                ListHeaderComponent={listHeaderComponent}
                ListFooterComponent={
                    recommendedFeed.loadingMore ? (
                        <View style={styles.footerLoader}>
                            <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                    ) : null
                }
                onEndReached={() => {
                    if (recommendedFeed.hasMore && !recommendedFeed.loadingMore) {
                        recommendedFeed.loadMore()
                    }
                }}
                onEndReachedThreshold={0.3}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
                style={styles.scrollView}
            />

            <ThreadModal visible={modalVisible} post={selectedPost} onClose={() => { setModalVisible(false); setSelectedPost(null) }} onPostUpdate={handlePostUpdate} onPostDelete={handlePostDelete} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    contributionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#FFD700',
        gap: 4,
    },
    contributionEmoji: { fontSize: 14 },
    contributionText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    notificationButton: { padding: 4, position: 'relative' },
    unreadBadge: {
        position: 'absolute',
        top: 0,
        right: 0,
        backgroundColor: colors.error,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 2,
        borderWidth: 1.5,
        borderColor: colors.background,
    },
    unreadText: { fontSize: 10, fontWeight: 'bold', color: '#fff' },
    scrollView: { flex: 1 },
    centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    section: { marginBottom: 24, marginTop: 16 },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
    titleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
    seeAll: { fontSize: 15, fontWeight: '600', color: colors.primary },
    listContent: { paddingHorizontal: 16, gap: 12 },
    listCard: { width: 200, backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden', marginRight: 12, borderWidth: 1, borderColor: colors.border },
    listThumbnailGrid: { flexDirection: 'row', flexWrap: 'wrap', height: 200 },
    listThumbnailItem: { width: '50%', height: '50%' },
    listThumbnail: { width: '100%', height: '100%', backgroundColor: colors.imageBackground },
    listThumbnailPlaceholder: { backgroundColor: colors.cardElevated, justifyContent: 'center', alignItems: 'center' },
    listInfo: { padding: 12 },
    listName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: 4 },
    listAuthor: { fontSize: 13, color: colors.textSecondary, marginBottom: 6 },
    listMeta: { fontSize: 12, color: colors.textTertiary },
    emptyContainer: { padding: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, marginHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
    searchBarContainer: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, zIndex: 100 },
    forYouHeader: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 },
    forYouTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
    forYouSubtitle: { fontSize: 13, color: colors.textTertiary },
    forYouLoading: { paddingVertical: 32, alignItems: 'center' },
    forYouEmpty: { padding: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, marginHorizontal: 16, marginTop: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    footerLoader: { paddingVertical: 20, alignItems: 'center' },
})
