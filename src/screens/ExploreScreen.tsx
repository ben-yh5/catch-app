import ExploreSection from '@/components/ExploreSection'
import NotificationInbox from '@/components/NotificationInbox'
import ThreadModal from '@/components/ThreadModal'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { List, Post } from '@/types'
import { calculateDistance, getPostsInRadius } from '@/utils/geospatialQueries'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import * as Location from 'expo-location'
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
import React, { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const POSTS_LIMIT = 5
const NEARBY_RADIUS_METERS = 10000 // 10km

export default function ExploreScreen() {
    const { user, contribution, unreadCount } = useAuth()
    const router = useRouter()
    const insets = useSafeAreaInsets()

    // State
    const [featuredLists, setFeaturedLists] = useState<List[]>([])
    const [trendingPosts, setTrendingPosts] = useState<Post[]>([])
    const [newPosts, setNewPosts] = useState<Post[]>([])
    const [nearPosts, setNearPosts] = useState<Post[]>([])
    const [loadingLists, setLoadingLists] = useState(true)
    const [loadingTrending, setLoadingTrending] = useState(true)
    const [loadingNew, setLoadingNew] = useState(true)
    const [loadingNear, setLoadingNear] = useState(true)
    const [isLocating, setIsLocating] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null)
    const [showNotifications, setShowNotifications] = useState(false)

    // Thread modal state
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [modalVisible, setModalVisible] = useState(false)

    const requestLocationPermission = async () => {
        setIsLocating(true)
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
            } else {
                setLoadingNear(false)
            }
        } catch (error) {
            console.error('Error getting location:', error)
            setLoadingNear(false)
        } finally {
            setIsLocating(false)
        }
    }

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
                        if (postDoc.exists()) thumbnails.push(postDoc.data().photoURL)
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

    const fetchNearPosts = async () => {
        if (!userLocation) return
        try {
            setLoadingNear(true)
            const postLocations = await getPostsInRadius({
                centerLat: userLocation.latitude,
                centerLng: userLocation.longitude,
                radiusInMeters: NEARBY_RADIUS_METERS,
            })
            const postIds = postLocations.map(l => l.postId).slice(0, POSTS_LIMIT)
            const postDocs = await Promise.all(postIds.map(id => getDoc(doc(db, 'posts', id))))

            const posts = postDocs.filter(d => d.exists()).map(d => {
                const data = d.data()
                const loc = postLocations.find(l => l.postId === d.id)
                return {
                    id: d.id,
                    ...data,
                    distance: loc ? calculateDistance(userLocation.latitude, userLocation.longitude, loc.latitude, loc.longitude) : 0
                } as Post & { distance: number }
            })
            posts.sort((a, b) => a.distance - b.distance)
            setNearPosts(posts)
        } catch (e) {
            console.error(e)
        } finally {
            setLoadingNear(false)
        }
    }

    useEffect(() => {
        requestLocationPermission()
        fetchFeaturedLists()
        fetchTrendingPosts()
        fetchNewPosts()
    }, [])

    useEffect(() => {
        if (userLocation) fetchNearPosts()
    }, [userLocation])

    const onRefresh = async () => {
        setRefreshing(true)
        await Promise.all([
            fetchFeaturedLists(),
            fetchTrendingPosts(),
            fetchNewPosts(),
            userLocation ? fetchNearPosts() : Promise.resolve()
        ])
        setRefreshing(false)
    }

    const handlePostPress = (postId: string) => {
        const post = trendingPosts.find(p => p.id === postId) || newPosts.find(p => p.id === postId) || nearPosts.find(p => p.id === postId)
        if (post) {
            setSelectedPost(post)
            setModalVisible(true)
        }
    }

    const handlePostUpdate = (updated: Post) => {
        const update = (prev: Post[]) => prev.map(p => p.id === updated.id ? updated : p)
        setTrendingPosts(update)
        setNewPosts(update)
        setNearPosts(update)
    }

    const handlePostDelete = (id: string) => {
        const del = (prev: Post[]) => prev.filter(p => p.id !== id)
        setTrendingPosts(del)
        setNewPosts(del)
        setNearPosts(del)
    }

    const renderFeaturedListSection = () => {
        if (loadingLists) return null; // Simplified loading for lists
        if (featuredLists.length === 0) return null;

        return (
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <View style={styles.titleContainer}>
                        <Text style={styles.emoji}>📋</Text>
                        <Text style={styles.title}>Featured Lists</Text>
                    </View>
                    <Text style={styles.seeAll} onPress={() => router.push('/(tabs)/lists')}>See All →</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.listContent}>
                    {featuredLists.map(list => (
                        <TouchableOpacity key={list.id} style={styles.listCard} onPress={() => router.push({ pathname: '/(tabs)/map', params: { listId: list.id } })}>
                            <View style={styles.listThumbnailGrid}>
                                {[0, 1, 2, 3].map((index) => (
                                    <View key={index} style={styles.listThumbnailItem}>
                                        {list.thumbnails && list.thumbnails[index] ? (
                                            <Image
                                                source={{ uri: list.thumbnails[index] }}
                                                style={styles.listThumbnail}
                                                contentFit="cover"
                                                transition={200}
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
    }

    const isLoading = loadingLists && loadingTrending && loadingNew && loadingNear

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
                <Text style={styles.headerTitle}>Explore</Text>
                <View style={styles.headerRight}>
                    <View style={styles.contributionBadge}>
                        <Text style={styles.contributionEmoji}>🏆</Text>
                        <Text style={styles.contributionText}>{contribution}</Text>
                    </View>
                    <TouchableOpacity style={styles.notificationButton} onPress={() => setShowNotifications(true)}>
                        <Ionicons name="notifications-outline" size={24} color={colors.textPrimary} />
                        {unreadCount > 0 && (
                            <View style={styles.unreadBadge}>
                                <Text style={styles.unreadText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            <NotificationInbox visible={showNotifications} onClose={() => setShowNotifications(false)} />

            <ScrollView
                style={styles.scrollView}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            >
                {renderFeaturedListSection()}

                <ExploreSection title="Trending" emoji="🔥" posts={trendingPosts} onPostPress={handlePostPress} onSeeAllPress={() => router.push({ pathname: '/(tabs)/map', params: { filter: 'trending' } })} loading={loadingTrending} />

                <ExploreSection title="New" emoji="⚡" posts={newPosts} onPostPress={handlePostPress} onSeeAllPress={() => router.push({ pathname: '/(tabs)/map', params: { filter: 'new' } })} loading={loadingNew} />

                <ExploreSection title="Near You" emoji="📍" posts={nearPosts} onPostPress={handlePostPress} onSeeAllPress={() => router.push({ pathname: '/(tabs)/map', params: { filter: 'near', panToUser: 'true' } })} loading={loadingNear || isLocating} />

                {!loadingNear && !isLocating && !userLocation && (
                    <View style={styles.section}>
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>Enable location to see catches nearby</Text>
                            <TouchableOpacity onPress={requestLocationPermission}><Text style={styles.seeAll}>Enable Location</Text></TouchableOpacity>
                        </View>
                    </View>
                )}
            </ScrollView>

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
    emoji: { fontSize: 20 },
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
})
