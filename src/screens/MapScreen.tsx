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
    useColorScheme,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { collection, getDocs, getDoc, doc, query, where, orderBy } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { httpsCallable } from 'firebase/functions'
import ThreadModal from '@/components/ThreadModal'
import Mapbox, { Camera, MapView, ShapeSource, SymbolLayer, CircleLayer } from '@rnmapbox/maps'

// Set Mapbox access token
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '')

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

export default function MapScreen() {
    const { user } = useAuth()
    const insets = useSafeAreaInsets()
    const mapRef = useRef<MapView>(null)
    const cameraRef = useRef<Camera>(null)
    const colorScheme = useColorScheme()

    // State
    const [posts, setPosts] = useState<Post[]>([])
    const [postLocations, setPostLocations] = useState<PostLocation[]>([])
    const [loading, setLoading] = useState(true)
    const [viewMode, setViewMode] = useState<ViewMode>('explore')
    const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null)

    // Thread modal state
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [showThreadModal, setShowThreadModal] = useState(false)

    // Get user's current location
    useEffect(() => {
        ;(async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync()
                if (status !== 'granted') {
                    Alert.alert(
                        'Location Required',
                        'Location permission is required to use the map and discover nearby shots. Please enable location in your device settings.'
                    )
                    return
                }

                const location = await Location.getCurrentPositionAsync({})
                setUserLocation(location)

                // Animate to user's location
                if (cameraRef.current) {
                    cameraRef.current.setCamera({
                        centerCoordinate: [location.coords.longitude, location.coords.latitude],
                        zoomLevel: 12,
                        animationDuration: 1000,
                    })
                }
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
                // Show trending original shots (created or caught in last 14 days)
                const fourteenDaysAgo = new Date()
                fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

                postsQuery = query(
                    collection(db, 'posts'),
                    where('hasLocation', '==', true),
                    where('isOriginal', '==', true),
                    where('createdAt', '>=', fourteenDaysAgo),
                    orderBy('createdAt', 'desc')
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
                    try {
                        const rootPostDoc = await getDoc(doc(db, 'posts', rootId))
                        if (rootPostDoc.exists()) {
                            const rootPost = {
                                id: rootPostDoc.id,
                                ...rootPostDoc.data(),
                            } as Post
                            // Only include if it has location
                            if (rootPost.hasLocation) {
                                caughtPosts.push(rootPost)
                            }
                        }
                    } catch (error) {
                        console.error(`Error fetching root post ${rootId}:`, error)
                        // Skip this post if it doesn't exist or there's an error
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

    // Filter posts based on view mode
    const getFilteredPosts = (): Post[] => {
        let filtered = [...posts]

        if (viewMode === 'explore') {
            // Explore mode: Show popular nearby trending shots

            // 1. Filter to nearby (within 25km of user)
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
                    return distance <= 25000 // 25km radius
                })
            }

            // 2. Sort by popularity (catch count) and recency
            filtered.sort((a, b) => {
                // Prioritize shots with catches
                if (a.catchCount !== b.catchCount) {
                    return b.catchCount - a.catchCount
                }
                // Then by recency
                const aTime = a.createdAt?.toMillis?.() || 0
                const bTime = b.createdAt?.toMillis?.() || 0
                return bTime - aTime
            })

            // 3. Limit to max 30 markers to prevent clutter
            return filtered.slice(0, 30)
        }

        // My Catches mode: Show all user's posts and catches
        return filtered
    }

    const filteredPosts = getFilteredPosts()

    // Convert posts to GeoJSON for Mapbox
    const getGeoJSONData = () => {
        const features = filteredPosts
            .map((post) => {
                const location = postLocations.find((loc) => loc.postId === post.id)
                if (!location) return null

                return {
                    type: 'Feature' as const,
                    id: post.id,
                    properties: {
                        postId: post.id,
                        authorId: post.authorId,
                        authorUsername: post.authorUsername,
                        photoURL: post.photoURL,
                        caption: post.caption,
                        catchCount: post.catchCount,
                    },
                    geometry: {
                        type: 'Point' as const,
                        coordinates: [location.longitude, location.latitude],
                    },
                }
            })
            .filter((f): f is NonNullable<typeof f> => f !== null)

        return {
            type: 'FeatureCollection' as const,
            features,
        }
    }

    const handleMarkerPress = async (event: any) => {
        const feature = event.features?.[0]
        if (!feature) return

        const postId = feature.properties?.postId
        if (!postId) return

        const post = filteredPosts.find((p) => p.id === postId)
        if (!post) return

        setSelectedPost(post)
        setShowThreadModal(true)
    }

    const handleThreadModalClose = () => {
        setShowThreadModal(false)
        // Small delay to ensure modal is fully closed before clearing state
        setTimeout(() => {
            setSelectedPost(null)
        }, 300)
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

    // Mapbox style URL - use dark mode if color scheme is dark
    const mapStyle = colorScheme === 'dark'
        ? 'mapbox://styles/mapbox/dark-v11'
        : 'mapbox://styles/mapbox/streets-v12'

    // Center map on user's location
    const centerOnUserLocation = () => {
        if (userLocation && cameraRef.current) {
            cameraRef.current.setCamera({
                centerCoordinate: [userLocation.coords.longitude, userLocation.coords.latitude],
                zoomLevel: 14,
                animationDuration: 1000,
            })
        }
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

            {/* Mapbox Map */}
            <MapView
                ref={mapRef}
                style={styles.map}
                styleURL={mapStyle}
                logoEnabled={false}
                scaleBarEnabled={false}
                compassEnabled={true}
                compassViewPosition={3}
                compassViewMargins={{ x: 16, y: 100 }}
            >
                <Camera
                    ref={cameraRef}
                    zoomLevel={12}
                    centerCoordinate={
                        userLocation
                            ? [userLocation.coords.longitude, userLocation.coords.latitude]
                            : [-122.4324, 37.78825]
                    }
                />

                {/* User location */}
                {userLocation && (
                    <ShapeSource
                        id="user-location-source"
                        shape={{
                            type: 'Feature',
                            properties: {},
                            geometry: {
                                type: 'Point',
                                coordinates: [
                                    userLocation.coords.longitude,
                                    userLocation.coords.latitude,
                                ],
                            },
                        }}
                    >
                        <CircleLayer
                            id="user-location-circle"
                            style={{
                                circleRadius: 8,
                                circleColor: '#007AFF',
                                circleStrokeWidth: 3,
                                circleStrokeColor: '#FFFFFF',
                            }}
                        />
                    </ShapeSource>
                )}

                {/* Post markers with clustering */}
                <ShapeSource
                    id="posts-source"
                    shape={getGeoJSONData()}
                    cluster={true}
                    clusterRadius={50}
                    clusterMaxZoomLevel={14}
                    onPress={handleMarkerPress}
                >
                    {/* Clustered points */}
                    <CircleLayer
                        id="clusters"
                        filter={['has', 'point_count']}
                        style={{
                            circleColor: colors.primary,
                            circleRadius: [
                                'step',
                                ['get', 'point_count'],
                                20,
                                5,
                                25,
                                10,
                                30,
                            ],
                            circleOpacity: 0.9,
                            circleStrokeWidth: 3,
                            circleStrokeColor: '#FFFFFF',
                        }}
                    />

                    <SymbolLayer
                        id="cluster-count"
                        filter={['has', 'point_count']}
                        style={{
                            textField: '{point_count_abbreviated}',
                            textSize: 14,
                            textColor: '#FFFFFF',
                            textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
                        }}
                    />

                    {/* Individual unclustered points */}
                    <CircleLayer
                        id="unclustered-point"
                        filter={['!', ['has', 'point_count']]}
                        style={{
                            circleColor: colors.primary,
                            circleRadius: 10,
                            circleStrokeWidth: 3,
                            circleStrokeColor: '#FFFFFF',
                        }}
                    />
                </ShapeSource>
            </MapView>

            {/* Loading overlay */}
            {loading && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.loadingText}>Loading shots...</Text>
                </View>
            )}

            {/* Post count indicator */}
            {!loading && (
                <View style={styles.postCountContainer}>
                    <Text style={styles.postCountText}>
                        {filteredPosts.length} {filteredPosts.length === 1 ? 'shot' : 'shots'}
                    </Text>
                </View>
            )}

            {/* Center on location button */}
            {userLocation && (
                <TouchableOpacity
                    style={styles.centerButton}
                    onPress={centerOnUserLocation}
                    activeOpacity={0.7}
                >
                    <Ionicons name="locate" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
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
    map: {
        flex: 1,
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: colors.textSecondary,
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
    centerButton: {
        position: 'absolute',
        bottom: 80,
        right: 16,
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.cardBackground,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
})
