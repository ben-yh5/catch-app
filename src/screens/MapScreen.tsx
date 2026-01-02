import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { functions } from '@/services/firebase'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import React, { useEffect, useState, useRef } from 'react'
import {
    StyleSheet,
    Text,
    View,
    Alert,
    Platform,
    ActivityIndicator,
    TouchableOpacity,
    ScrollView,
    useColorScheme,
} from 'react-native'
import MapView, { Marker, Region, PROVIDER_GOOGLE } from 'react-native-maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { httpsCallable } from 'firebase/functions'
import ThreadModal from '@/components/ThreadModal'

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

interface PostLocation {
    postId: string
    latitude: number
    longitude: number
}

type ViewMode = 'explore' | 'myCatches'
type FilterMode = 'all' | 'popular' | 'trending' | 'nearby'

// Dark mode map style (Google Maps dark theme)
const darkMapStyle = [
    { elementType: 'geometry', stylers: [{ color: '#212121' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
    {
        featureType: 'administrative',
        elementType: 'geometry',
        stylers: [{ color: '#757575' }],
    },
    {
        featureType: 'administrative.country',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#9e9e9e' }],
    },
    {
        featureType: 'administrative.land_parcel',
        stylers: [{ visibility: 'off' }],
    },
    {
        featureType: 'administrative.locality',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#bdbdbd' }],
    },
    {
        featureType: 'poi',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#757575' }],
    },
    {
        featureType: 'poi.park',
        elementType: 'geometry',
        stylers: [{ color: '#181818' }],
    },
    {
        featureType: 'poi.park',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#616161' }],
    },
    {
        featureType: 'poi.park',
        elementType: 'labels.text.stroke',
        stylers: [{ color: '#1b1b1b' }],
    },
    {
        featureType: 'road',
        elementType: 'geometry.fill',
        stylers: [{ color: '#2c2c2c' }],
    },
    {
        featureType: 'road',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#8a8a8a' }],
    },
    {
        featureType: 'road.arterial',
        elementType: 'geometry',
        stylers: [{ color: '#373737' }],
    },
    {
        featureType: 'road.highway',
        elementType: 'geometry',
        stylers: [{ color: '#3c3c3c' }],
    },
    {
        featureType: 'road.highway.controlled_access',
        elementType: 'geometry',
        stylers: [{ color: '#4e4e4e' }],
    },
    {
        featureType: 'road.local',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#616161' }],
    },
    {
        featureType: 'transit',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#757575' }],
    },
    {
        featureType: 'water',
        elementType: 'geometry',
        stylers: [{ color: '#000000' }],
    },
    {
        featureType: 'water',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#3d3d3d' }],
    },
]

export default function MapScreen() {
    const { user } = useAuth()
    const insets = useSafeAreaInsets()
    const mapRef = useRef<MapView>(null)
    const colorScheme = useColorScheme()

    // State
    const [posts, setPosts] = useState<Post[]>([])
    const [postLocations, setPostLocations] = useState<PostLocation[]>([])
    const [loading, setLoading] = useState(true)
    const [viewMode, setViewMode] = useState<ViewMode>('explore')
    const [filterMode, setFilterMode] = useState<FilterMode>('all')
    const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null)

    // Thread modal state
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [showThreadModal, setShowThreadModal] = useState(false)

    // Initial map region (centered on San Francisco as default)
    const [region, setRegion] = useState<Region>({
        latitude: 37.78825,
        longitude: -122.4324,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
    })

    // Get user's current location
    useEffect(() => {
        ;(async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync()
                if (status !== 'granted') {
                    Alert.alert(
                        'Location Permission',
                        'Location permission is needed to show your position on the map'
                    )
                    return
                }

                const location = await Location.getCurrentPositionAsync({})
                setUserLocation(location)

                // Center map on user's location
                setRegion({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    latitudeDelta: 0.0922,
                    longitudeDelta: 0.0421,
                })
            } catch (error) {
                console.error('Error getting location:', error)
            }
        })()
    }, [])

    // Load posts
    useEffect(() => {
        loadPosts()
    }, [viewMode])

    const loadPosts = async () => {
        if (!user) return

        setLoading(true)
        try {
            let postsQuery

            if (viewMode === 'explore') {
                // Show all original posts with locations
                postsQuery = query(
                    collection(db, 'posts'),
                    where('hasLocation', '==', true),
                    where('isOriginal', '==', true),
                    orderBy('catchCount', 'desc')
                )
            } else {
                // Show posts where user is author OR posts where user has a catch
                // First get user's own posts
                const userPostsQuery = query(
                    collection(db, 'posts'),
                    where('authorId', '==', user.uid),
                    where('hasLocation', '==', true)
                )
                const userPostsSnapshot = await getDocs(userPostsQuery)
                const userPosts = userPostsSnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                })) as Post[]

                // Get root post IDs where user has catches
                const userCatchesQuery = query(
                    collection(db, 'posts'),
                    where('authorId', '==', user.uid),
                    where('isOriginal', '==', false)
                )
                const userCatchesSnapshot = await getDocs(userCatchesQuery)
                const caughtRootIds = new Set(
                    userCatchesSnapshot.docs
                        .map((doc) => doc.data().rootPostId)
                        .filter((id) => id !== null)
                )

                // Fetch those root posts
                const caughtPosts: Post[] = []
                for (const rootId of caughtRootIds) {
                    const rootPostQuery = query(
                        collection(db, 'posts'),
                        where('id', '==', rootId),
                        where('hasLocation', '==', true)
                    )
                    const rootPostSnapshot = await getDocs(rootPostQuery)
                    if (!rootPostSnapshot.empty) {
                        const rootPost = {
                            id: rootPostSnapshot.docs[0].id,
                            ...rootPostSnapshot.docs[0].data(),
                        } as Post
                        caughtPosts.push(rootPost)
                    }
                }

                // Combine and deduplicate
                const combinedPosts = [...userPosts, ...caughtPosts]
                const uniquePosts = Array.from(
                    new Map(combinedPosts.map((post) => [post.id, post])).values()
                )

                setPosts(uniquePosts)
                await fetchPostLocations(uniquePosts)
                setLoading(false)
                return
            }

            const snapshot = await getDocs(postsQuery)
            const fetchedPosts = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Post[]

            setPosts(fetchedPosts)
            await fetchPostLocations(fetchedPosts)
        } catch (error) {
            console.error('Error loading posts:', error)
            Alert.alert('Error', 'Failed to load posts')
        } finally {
            setLoading(false)
        }
    }

    const fetchPostLocations = async (postsToFetch: Post[]) => {
        if (postsToFetch.length === 0) {
            setPostLocations([])
            return
        }

        try {
            const postIds = postsToFetch.map((p) => p.id)
            const getPostLocationsFunction = httpsCallable(functions, 'getPostLocations')
            const result = await getPostLocationsFunction({ postIds })
            const data = result.data as { locations: PostLocation[] }
            setPostLocations(data.locations)
        } catch (error) {
            console.error('Error fetching post locations:', error)
            Alert.alert('Error', 'Failed to fetch post locations')
        }
    }

    // Calculate distance between two points (Haversine formula)
    const getDistanceInMeters = (
        lat1: number,
        lon1: number,
        lat2: number,
        lon2: number
    ): number => {
        const R = 6371e3 // Earth's radius in meters
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

    // Filter posts based on selected filter
    const getFilteredPosts = (): Post[] => {
        let filtered = [...posts]

        switch (filterMode) {
            case 'popular':
                filtered = filtered.filter((post) => post.catchCount >= 5)
                break
            case 'trending':
                // Posts created in the last 7 days
                const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
                filtered = filtered.filter((post) => {
                    const postDate = post.createdAt?.toMillis?.() || 0
                    return postDate >= sevenDaysAgo
                })
                break
            case 'nearby':
                // Posts within 10km of user's location
                if (userLocation) {
                    filtered = filtered.filter((post) => {
                        const location = postLocations.find((loc) => loc.postId === post.id)
                        if (!location) return false

                        const distance = getDistanceInMeters(
                            userLocation.coords.latitude,
                            userLocation.coords.longitude,
                            location.latitude,
                            location.longitude
                        )
                        return distance <= 10000 // 10km
                    })
                }
                break
            default:
                break
        }

        return filtered
    }

    const filteredPosts = getFilteredPosts()

    // Get markers to display
    const markers = postLocations
        .filter((loc) => filteredPosts.find((post) => post.id === loc.postId))
        .map((loc) => {
            const post = posts.find((p) => p.id === loc.postId)
            return { ...loc, post }
        })
        .filter((marker) => marker.post !== undefined)

    const handleMarkerPress = (post: Post) => {
        setSelectedPost(post)
        setShowThreadModal(true)
    }

    const handleThreadModalClose = () => {
        setShowThreadModal(false)
        setSelectedPost(null)
    }

    const handlePostUpdate = (updatedPost: Post) => {
        setPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)))
    }

    const handlePostDelete = (postId: string) => {
        setPosts((prev) => prev.filter((p) => p.id !== postId))
        setPostLocations((prev) => prev.filter((loc) => loc.postId !== postId))
        setShowThreadModal(false)
        setSelectedPost(null)
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <Text style={styles.headerTitle}>Map</Text>
            </View>

            {/* View Mode Toggle */}
            <View style={styles.toggleContainer}>
                <TouchableOpacity
                    style={[
                        styles.toggleButton,
                        viewMode === 'explore' && styles.toggleButtonActive,
                    ]}
                    onPress={() => setViewMode('explore')}
                >
                    <Text
                        style={[
                            styles.toggleText,
                            viewMode === 'explore' && styles.toggleTextActive,
                        ]}
                    >
                        Explore
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.toggleButton,
                        viewMode === 'myCatches' && styles.toggleButtonActive,
                    ]}
                    onPress={() => setViewMode('myCatches')}
                >
                    <Text
                        style={[
                            styles.toggleText,
                            viewMode === 'myCatches' && styles.toggleTextActive,
                        ]}
                    >
                        My Catches
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Filter Buttons */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterContainer}
                contentContainerStyle={styles.filterContent}
            >
                {(['all', 'popular', 'trending', 'nearby'] as FilterMode[]).map((filter) => (
                    <TouchableOpacity
                        key={filter}
                        style={[
                            styles.filterButton,
                            filterMode === filter && styles.filterButtonActive,
                        ]}
                        onPress={() => setFilterMode(filter)}
                    >
                        <Text
                            style={[
                                styles.filterText,
                                filterMode === filter && styles.filterTextActive,
                            ]}
                        >
                            {filter.charAt(0).toUpperCase() + filter.slice(1)}
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {/* Map */}
            {loading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.loadingText}>Loading posts...</Text>
                </View>
            ) : (
                <MapView
                    ref={mapRef}
                    style={styles.map}
                    provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                    initialRegion={region}
                    showsUserLocation
                    showsMyLocationButton
                    customMapStyle={colorScheme === 'dark' ? darkMapStyle : []}
                >
                    {markers.map((marker) => (
                        <Marker
                            key={marker.postId}
                            coordinate={{
                                latitude: marker.latitude,
                                longitude: marker.longitude,
                            }}
                            onPress={() => handleMarkerPress(marker.post!)}
                        >
                            <View style={styles.customMarker}>
                                <Ionicons name="location" size={32} color={colors.primary} />
                                {marker.post!.catchCount > 0 && (
                                    <View style={styles.markerBadge}>
                                        <Text style={styles.markerBadgeText}>
                                            {marker.post!.catchCount}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </Marker>
                    ))}
                </MapView>
            )}

            {/* Post count indicator */}
            {!loading && (
                <View style={styles.postCountContainer}>
                    <Text style={styles.postCountText}>
                        {filteredPosts.length} {filteredPosts.length === 1 ? 'post' : 'posts'}
                    </Text>
                </View>
            )}

            {/* Thread Modal */}
            <ThreadModal
                visible={showThreadModal}
                post={selectedPost}
                onClose={handleThreadModalClose}
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
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    toggleContainer: {
        flexDirection: 'row',
        padding: 12,
        gap: 8,
        backgroundColor: colors.background,
    },
    toggleButton: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: colors.cardBackground,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
    },
    toggleButtonActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    toggleText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    toggleTextActive: {
        color: colors.white,
    },
    filterContainer: {
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    filterContent: {
        paddingHorizontal: 12,
        paddingBottom: 12,
        gap: 8,
    },
    filterButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: colors.cardBackground,
        borderWidth: 1,
        borderColor: colors.border,
    },
    filterButtonActive: {
        backgroundColor: colors.primary + '20',
        borderColor: colors.primary,
    },
    filterText: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    filterTextActive: {
        color: colors.primary,
        fontWeight: '600',
    },
    map: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: colors.textSecondary,
    },
    customMarker: {
        position: 'relative',
    },
    markerBadge: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: colors.danger,
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: colors.white,
    },
    markerBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: colors.white,
    },
    postCountContainer: {
        position: 'absolute',
        bottom: 20,
        alignSelf: 'center',
        backgroundColor: colors.cardBackground,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    postCountText: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textPrimary,
    },
})
