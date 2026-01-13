import ExploreSection from '@/components/ExploreSection'
import ThreadModal from '@/components/ThreadModal'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { getPostsInRadius } from '@/utils/geospatialQueries'
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
import React, { useCallback, useEffect, useState } from 'react'
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
    creatorId: string
    creatorUsername?: string
    postIds: string[]
    isPublic: boolean
    createdAt: any
    updatedAt: any
    thumbnails?: string[]
}

const POSTS_LIMIT = 5  // Limit carousels to 5 posts each
const NEARBY_RADIUS_METERS = 10000 // 10km

export default function ExploreScreen() {
    const { user } = useAuth()
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
                // Don't set loadingNear to false here, let fetchNearPosts handle it
                // loadingNear is already true by default
            } else {
                // Permission denied
                setLoadingNear(false)
            }
        } catch (error) {
            console.error('Error getting location:', error)
            setLoadingNear(false)
        } finally {
            setIsLocating(false)
        }
    }

    // Get user location for "Near You" section
    useEffect(() => {
        requestLocationPermission()
    }, [])



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

                if (!listData.creatorId || !listData.postIds || !Array.isArray(listData.postIds) || listData.postIds.length === 0) {
                    continue
                }

                try {
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

            lists.sort((a, b) => b.postIds.length - a.postIds.length)
            setFeaturedLists(lists)
        } catch (error) {
            console.error('Error fetching featured lists:', error)
        } finally {
            setLoadingLists(false)
        }
    }

    const fetchTrendingPosts = async () => {
        try {
            setLoadingTrending(true)

            const postsQuery = query(
                collection(db, 'posts'),
                where('isOriginal', '==', true),
                orderBy('catchCount', 'desc'),
                limit(POSTS_LIMIT)
            )

            const querySnapshot = await getDocs(postsQuery)
            const posts: Post[] = querySnapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            } as Post))

            setTrendingPosts(posts)
        } catch (error) {
            console.error('Error fetching trending posts:', error)
        } finally {
            setLoadingTrending(false)
        }
    }

    const fetchNewPosts = async () => {
        try {
            setLoadingNew(true)

            const postsQuery = query(
                collection(db, 'posts'),
                where('isOriginal', '==', true),
                orderBy('createdAt', 'desc'),
                limit(POSTS_LIMIT)
            )

            const querySnapshot = await getDocs(postsQuery)
            const posts: Post[] = querySnapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            } as Post))

            setNewPosts(posts)
        } catch (error) {
            console.error('Error fetching new posts:', error)
        } finally {
            setLoadingNew(false)
        }
    }

    const fetchNearPosts = async () => {
        if (!userLocation) {
            setLoadingNear(false)
            return
        }

        try {
            setLoadingNear(true)

            // Use geohash query to get nearby posts
            const postLocations = await getPostsInRadius({
                centerLat: userLocation.latitude,
                centerLng: userLocation.longitude,
                radiusInMeters: NEARBY_RADIUS_METERS,
            })

            // Fetch full post data for nearby posts
            const postIds = postLocations.map((loc) => loc.postId).slice(0, POSTS_LIMIT)
            const postDocs = await Promise.all(
                postIds.map((id) => getDoc(doc(db, 'posts', id)))
            )

            const posts = postDocs
                .filter((docSnap) => docSnap.exists())
                .map((docSnap) => {
                    const postData = docSnap.data()
                    const location = postLocations.find((loc) => loc.postId === docSnap.id)
                    return {
                        id: docSnap.id,
                        ...postData,
                        distance: location ? calculateDistance(
                            userLocation.latitude,
                            userLocation.longitude,
                            location.latitude,
                            location.longitude
                        ) : 0,
                    } as Post & { distance: number }
                })

            // Sort by distance
            posts.sort((a, b) => a.distance - b.distance)

            setNearPosts(posts)
        } catch (error) {
            console.error('Error fetching near posts:', error)
        } finally {
            setLoadingNear(false)
        }
    }

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371e3
        const φ1 = (lat1 * Math.PI) / 180
        const φ2 = (lat2 * Math.PI) / 180
        const Δφ = ((lat2 - lat1) * Math.PI) / 180
        const Δλ = ((lon2 - lon1) * Math.PI) / 180

        const a =
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

        return R * c
    }

    // Initial data load
    useEffect(() => {
        fetchFeaturedLists()
        fetchTrendingPosts()
        fetchNewPosts()
    }, [])

    // Fetch near posts when user location is available
    useEffect(() => {
        if (userLocation) {
            fetchNearPosts()
        }
    }, [userLocation])

    const onRefresh = useCallback(async () => {
        setRefreshing(true)
        await Promise.all([
            fetchFeaturedLists(),
            fetchTrendingPosts(),
            fetchNewPosts(),
            userLocation ? fetchNearPosts() : Promise.resolve(),
        ])
        setRefreshing(false)
    }, [userLocation])

    const handlePostPress = (postId: string) => {
        // Find post in any section
        const post =
            trendingPosts.find((p) => p.id === postId) ||
            newPosts.find((p) => p.id === postId) ||
            nearPosts.find((p) => p.id === postId)

        if (post) {
            setSelectedPost(post)
            setModalVisible(true)
        }
    }

    const handleSeeAllTrending = () => {
        router.push({
            pathname: '/(tabs)/map',
            params: { filter: 'trending' },
        })
    }

    const handleSeeAllNew = () => {
        router.push({
            pathname: '/(tabs)/map',
            params: { filter: 'new' },
        })
    }

    const handleSeeAllNear = () => {
        router.push({
            pathname: '/(tabs)/map',
            params: { filter: 'near', panToUser: 'true' },
        })
    }

    const handleSeeAllLists = () => {
        router.push('/(tabs)/lists')
    }

    const handleListPress = (listId: string) => {
        router.push({
            pathname: '/(tabs)/map',
            params: { listId },
        })
    }

    const handlePostUpdate = (updatedPost: Post) => {
        setTrendingPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)))
        setNewPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)))
        setNearPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)))
    }

    const handlePostDelete = (postId: string) => {
        setTrendingPosts((prev) => prev.filter((p) => p.id !== postId))
        setNewPosts((prev) => prev.filter((p) => p.id !== postId))
        setNearPosts((prev) => prev.filter((p) => p.id !== postId))
    }

    const renderFeaturedListSection = () => {
        if (loadingLists || featuredLists.length === 0) return null

        return (
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <View style={styles.titleContainer}>
                        <Text style={styles.emoji}>📋</Text>
                        <Text style={styles.title}>Featured Lists</Text>
                    </View>
                    <Text style={styles.seeAll} onPress={handleSeeAllLists}>
                        See All →
                    </Text>
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.listContent}
                >
                    {featuredLists.map((list) => (
                        <View
                            key={list.id}
                            style={styles.listCard}
                            onTouchEnd={() => handleListPress(list.id)}
                        >
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
                                <Text style={styles.listName} numberOfLines={1}>
                                    {list.name}
                                </Text>
                                <Text style={styles.listAuthor} numberOfLines={1}>
                                    by @{list.creatorUsername}
                                </Text>
                                <Text style={styles.listMeta}>
                                    {list.postIds.length} {list.postIds.length === 1 ? 'shot' : 'shots'}
                                </Text>
                            </View>
                        </View>
                    ))}
                </ScrollView>
            </View>
        )
    }

    const isLoading = loadingLists && loadingTrending && loadingNew && loadingNear

    if (isLoading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Loading...</Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <Text style={styles.headerTitle}>Explore</Text>
            </View>

            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={colors.primary}
                    />
                }
            >
                {renderFeaturedListSection()}

                <ExploreSection
                    title="Trending"
                    emoji="🔥"
                    posts={trendingPosts}
                    onPostPress={handlePostPress}
                    onSeeAllPress={handleSeeAllTrending}
                    loading={loadingTrending}
                />

                <ExploreSection
                    title="New"
                    emoji="⚡"
                    posts={newPosts}
                    onPostPress={handlePostPress}
                    onSeeAllPress={handleSeeAllNew}
                    loading={loadingNew}
                />

                <ExploreSection
                    title="Near You"
                    emoji="📍"
                    posts={nearPosts}
                    onPostPress={handlePostPress}
                    onSeeAllPress={handleSeeAllNear}
                    loading={loadingNear || isLocating}
                />

                {!loadingNear && !isLocating && !userLocation && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={styles.titleContainer}>
                                <Text style={styles.emoji}>📍</Text>
                                <Text style={styles.title}>Near You</Text>
                            </View>
                        </View>
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>Enable location to see catches nearby</Text>
                            <TouchableOpacity onPress={requestLocationPermission}>
                                <Text style={styles.seeAll}>Enable Location</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {!loadingNear && !isLocating && userLocation && nearPosts.length === 0 && (
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={styles.titleContainer}>
                                <Text style={styles.emoji}>📍</Text>
                                <Text style={styles.title}>Near You</Text>
                            </View>
                        </View>
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>No catches found in your area yet.</Text>
                            <Text style={styles.seeAll} onPress={handleSeeAllNear}>View Map</Text>
                        </View>
                    </View>
                )}
            </ScrollView>

            <ThreadModal
                visible={modalVisible}
                post={selectedPost}
                onClose={() => {
                    setModalVisible(false)
                    setSelectedPost(null)
                }}
                onPostUpdate={handlePostUpdate}
                onPostDelete={handlePostDelete}
            />
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
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    scrollView: {
        flex: 1,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: colors.textSecondary,
    },
    section: {
        marginBottom: 24,
        marginTop: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    emoji: {
        fontSize: 20,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    seeAll: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary,
    },
    listContent: {
        paddingHorizontal: 16,
        gap: 12,
    },
    listCard: {
        width: 200,
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        marginRight: 12,
        borderWidth: 1,
        borderColor: colors.border,
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
        justifyContent: 'center',
        alignItems: 'center',
    },
    listThumbnailPlaceholder: {
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
        fontSize: 12,
        color: colors.textTertiary,
    },
    emptyContainer: {
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.card,
        marginHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 8,
    },
    emptyText: {
        color: colors.textSecondary,
        fontSize: 14,
        textAlign: 'center',
    },
})
