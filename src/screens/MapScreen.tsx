import FilterPills, { FilterType } from '@/components/FilterPills'
import MapBottomSheet from '@/components/MapBottomSheet'
import ThreadModal from '@/components/ThreadModal'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { getPostsInRadius } from '@/utils/geospatialQueries'
import { Ionicons } from '@expo/vector-icons'
import Mapbox, { Camera, CircleLayer, LocationPuck, MapView, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { doc, getDoc } from 'firebase/firestore'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

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
    latitude?: number
    longitude?: number
}

// Map marker colors
const MAP_COLORS = {
    userLocation: '#34C759',
    pin: '#007AFF',
    selectedPin: '#CF2CF6',
    stroke: '#FFFFFF',
}

// Calculate distance between two points
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

export default function MapScreen() {
    const { user } = useAuth()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const mapRef = useRef<MapView>(null)
    const cameraRef = useRef<Camera>(null)
    const shapeSourceRef = useRef<ShapeSource>(null)
    const colorScheme = useColorScheme()

    // State
    const [visiblePosts, setVisiblePosts] = useState<Post[]>([])
    const [loadingPosts, setLoadingPosts] = useState(false)
    const [activeFilter, setActiveFilter] = useState<FilterType>('trending')
    const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null)
    const [locationLoading, setLocationLoading] = useState(true)
    const [initialLocation, setInitialLocation] = useState<Location.LocationObject | null>(null)
    const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
    const [showSearchButton, setShowSearchButton] = useState(false)

    // Thread modal state
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [showThreadModal, setShowThreadModal] = useState(false)

    // Get user's current location
    useEffect(() => {
        ; (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync()
                if (status !== 'granted') {
                    Alert.alert(
                        'Location Required',
                        'Location permission is required to use the map. Please enable location in your device settings.'
                    )
                    setLocationLoading(false)
                    return
                }

                // Use last known location first for speed
                const lastKnown = await Location.getLastKnownPositionAsync({})
                if (lastKnown) {
                    setUserLocation(lastKnown)
                    setInitialLocation(lastKnown)
                    setLocationLoading(false)
                }

                // Get current position in background for accuracy
                const location = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                })
                setUserLocation(location)
                if (!lastKnown) {
                    setInitialLocation(location)
                    setLocationLoading(false)
                }
            } catch (error) {
                console.error('Error getting location:', error)
                setLocationLoading(false)
            }
        })()
    }, [])

    // Apply sorting based on active filter
    const applySorting = useCallback((posts: Post[], filter: FilterType): Post[] => {
        switch (filter) {
            case 'trending':
                return [...posts].sort((a, b) => b.catchCount - a.catchCount)
            case 'new':
                return [...posts].sort((a, b) => {
                    const aTime = a.createdAt?.toMillis?.() || 0
                    const bTime = b.createdAt?.toMillis?.() || 0
                    return bTime - aTime
                })
            case 'near':
                if (!userLocation) return posts
                return [...posts].sort((a, b) => {
                    const distA = calculateDistance(
                        userLocation.coords.latitude,
                        userLocation.coords.longitude,
                        a.latitude || 0,
                        a.longitude || 0
                    )
                    const distB = calculateDistance(
                        userLocation.coords.latitude,
                        userLocation.coords.longitude,
                        b.latitude || 0,
                        b.longitude || 0
                    )
                    return distA - distB
                })
            default:
                return posts
        }
    }, [userLocation])

    // Fetch posts in current viewport
    const fetchPostsInViewport = useCallback(async () => {
        if (!mapRef.current) return

        setLoadingPosts(true)
        setShowSearchButton(false)

        try {
            // Get camera center for radius query instead of viewport bounds
            const center = await mapRef.current.getCenter()
            console.log('Map center:', center)

            if (!center || center.length !== 2) {
                console.error('Invalid map center:', center)
                return
            }

            // Use a large radius to cover the viewport (25km should cover most views)
            const postLocations = await getPostsInRadius({
                centerLat: center[1], // latitude
                centerLng: center[0], // longitude
                radiusInMeters: 25000, // 25km
            })
            console.log(`Found ${postLocations.length} post locations in radius`)

            // Fetch full post data
            const postIds = postLocations.map((loc) => loc.postId)
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
                        latitude: location?.latitude,
                        longitude: location?.longitude,
                    } as Post
                })
                .filter((post) => post.isOriginal === true) // Only show original posts

            console.log(`Filtered to ${posts.length} original posts`)

            // Apply filter sorting
            const sortedPosts = applySorting(posts, activeFilter)

            console.log(`Setting ${sortedPosts.length} visible posts on map`)
            setVisiblePosts(sortedPosts)
        } catch (error) {
            console.error('Error fetching posts in viewport:', error)
            Alert.alert('Error', 'Failed to load posts in this area')
        } finally {
            setLoadingPosts(false)
        }
    }, [activeFilter, applySorting])

    // Handle map movement
    const handleMapMove = useCallback(() => {
        // Show search button when map is moved
        setShowSearchButton(true)
    }, [])

    // Initial load when map is ready
    useEffect(() => {
        if (!locationLoading && mapRef.current) {
            // Small delay to ensure map is fully rendered
            console.log('Map ready, fetching posts...')
            setTimeout(() => {
                fetchPostsInViewport()
            }, 1500)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locationLoading]) // Only run once when location is ready

    // Memoize sorted posts to avoid infinite render loop
    const sortedVisiblePosts = React.useMemo(() => {
        return applySorting(visiblePosts, activeFilter)
    }, [visiblePosts, activeFilter, applySorting])

    // Handle filter change
    const handleFilterChange = (filter: FilterType) => {
        setActiveFilter(filter)
    }

    // Handle jump to location from bottom sheet
    const handleJumpToLocation = (latitude: number, longitude: number) => {
        if (cameraRef.current) {
            cameraRef.current.setCamera({
                centerCoordinate: [longitude, latitude],
                zoomLevel: 16,
                animationDuration: 800,
            })
        }
    }

    // Handle post press from bottom sheet
    const handlePostPress = (postId: string) => {
        const post = sortedVisiblePosts.find((p) => p.id === postId)
        if (post) {
            setSelectedPost(post)
            setShowThreadModal(true)
        }
    }

    // Convert posts to GeoJSON for Mapbox
    const getGeoJSONData = () => {
        const features = sortedVisiblePosts
            .filter((post) => post.latitude && post.longitude)
            .map((post) => ({
                type: 'Feature' as const,
                id: post.id,
                properties: {
                    postId: post.id,
                    isSelected: post.id === selectedPostId,
                },
                geometry: {
                    type: 'Point' as const,
                    coordinates: [post.longitude!, post.latitude!],
                },
            }))

        return {
            type: 'FeatureCollection' as const,
            features,
        }
    }

    const handleMarkerPress = (event: any) => {
        const feature = event.features?.[0]
        if (!feature) return

        const postId = feature.properties?.postId
        if (!postId) return

        setSelectedPostId(postId)
        handlePostPress(postId)
    }

    const handleThreadModalClose = () => {
        setShowThreadModal(false)
        setTimeout(() => {
            setSelectedPost(null)
            setSelectedPostId(null)
        }, 300)
    }

    const handlePostUpdate = (updatedPost: Post) => {
        setVisiblePosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)))
    }

    const handlePostDelete = (postId: string) => {
        setVisiblePosts((prev) => prev.filter((p) => p.id !== postId))
        setShowThreadModal(false)
        setSelectedPost(null)
        setSelectedPostId(null)
    }

    const mapStyle =
        colorScheme === 'dark'
            ? 'mapbox://styles/mapbox/dark-v11'
            : 'mapbox://styles/mapbox/streets-v12'

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
            {/* Compact Header */}
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <Text style={styles.headerTitle}>Map</Text>
            </View>

            {/* Floating Filter Pills */}
            {!locationLoading && (
                <View style={styles.filterContainer} pointerEvents="box-none">
                    <FilterPills
                        activeFilter={activeFilter}
                        onFilterChange={handleFilterChange}
                        nearDisabled={!userLocation}
                    />
                </View>
            )}



            {/* Search This Area Button */}
            {showSearchButton && !loadingPosts && (
                <View style={styles.searchButtonContainer}>
                    <TouchableOpacity
                        style={styles.searchButton}
                        onPress={fetchPostsInViewport}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.searchButtonText}>Search this area</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Map */}
            {locationLoading ? (
                <View style={styles.map}>
                    <View style={styles.locationLoadingOverlay}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={styles.loadingText}>Getting your location...</Text>
                    </View>
                </View>
            ) : (
                <MapView
                    ref={mapRef}
                    style={styles.map}
                    styleURL={mapStyle}
                    logoEnabled={false}
                    scaleBarEnabled={false}
                    compassEnabled={true}
                    compassViewPosition={1}
                    compassViewMargins={{ x: 16, y: 158 }}
                    onCameraChanged={(state) => {
                        if (state.gestures.isGestureActive) {
                            setShowSearchButton(true)
                        }
                    }}

                    onMapIdle={() => {
                        // Optional: Ensure button shows if we missed the gesture end
                        // But rely on onCameraChanged for interaction detection
                    }}
                >
                    <Camera
                        ref={cameraRef}
                        zoomLevel={12}
                        centerCoordinate={
                            initialLocation
                                ? [initialLocation.coords.longitude, initialLocation.coords.latitude]
                                : [-122.4324, 37.78825]
                        }
                        animationMode="none"
                    />

                    <LocationPuck
                        pulsing={{
                            isEnabled: true,
                            color: MAP_COLORS.userLocation,
                            radius: 30,
                        }}
                        puckBearingEnabled
                        puckBearing="heading"
                    />

                    <ShapeSource
                        id="posts-source"
                        ref={shapeSourceRef}
                        shape={getGeoJSONData()}
                        onPress={async (event) => {
                            const feature = event.features?.[0]
                            if (!feature) return

                            const isCluster = feature.properties?.cluster
                            if (isCluster) {
                                const expansionZoom = await shapeSourceRef.current?.getClusterExpansionZoom(
                                    feature
                                )

                                if (expansionZoom && cameraRef.current) {
                                    cameraRef.current.setCamera({
                                        centerCoordinate: (feature.geometry as any).coordinates,
                                        zoomLevel: expansionZoom,
                                        animationDuration: 500,
                                    })
                                }
                            } else {
                                handleMarkerPress(event)
                            }
                        }}
                        cluster
                        clusterRadius={50}
                        clusterMaxZoomLevel={14}
                    >
                        <SymbolLayer
                            id="point-count"
                            style={{
                                textField: ['get', 'point_count'],
                                textSize: 12,
                                textColor: '#ffffff',
                                textPitchAlignment: 'map',
                            }}
                        />

                        <CircleLayer
                            id="clusters"
                            belowLayerID="point-count"
                            filter={['has', 'point_count']}
                            style={{
                                circlePitchAlignment: 'map',
                                circleColor: MAP_COLORS.pin,
                                circleRadius: 20,
                                circleOpacity: 0.7,
                                circleStrokeWidth: 2,
                                circleStrokeColor: 'white',
                            }}
                        />

                        <CircleLayer
                            id="posts-layer"
                            filter={['!', ['has', 'point_count']]}
                            style={{
                                circleColor: [
                                    'case',
                                    ['get', 'isSelected'],
                                    MAP_COLORS.selectedPin,
                                    MAP_COLORS.pin,
                                ],
                                circleRadius: ['case', ['get', 'isSelected'], 12, 10],
                                circleStrokeWidth: 3,
                                circleStrokeColor: MAP_COLORS.stroke,
                            }}
                        />
                    </ShapeSource>
                </MapView>
            )
            }

            {/* Center on location button */}
            {
                userLocation && (
                    <TouchableOpacity
                        style={styles.centerButton}
                        onPress={centerOnUserLocation}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="locate" size={24} color={colors.textPrimary} />
                    </TouchableOpacity>
                )
            }

            {/* Bottom Sheet */}
            {
                !locationLoading && (
                    <MapBottomSheet
                        posts={sortedVisiblePosts}
                        loading={loadingPosts}
                        onPostPress={handlePostPress}
                        onJumpToLocation={handleJumpToLocation}
                        selectedPostId={selectedPostId}
                    />
                )
            }

            {/* Thread Modal */}
            <ThreadModal
                visible={showThreadModal}
                post={selectedPost}
                onClose={handleThreadModalClose}
                onPostUpdate={handlePostUpdate}
                onPostDelete={handlePostDelete}
            />
        </View >
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
        zIndex: 20, // Ensure header is above everything
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    filterContainer: {
        position: 'absolute',
        top: 110, // Move down below header
        left: 0,
        right: 0,
        zIndex: 10,
        backgroundColor: 'transparent',
    },
    searchButtonContainer: {
        position: 'absolute',
        top: 160, // Move down below filters
        left: 0,
        right: 0,
        zIndex: 10,
        alignItems: 'center',
    },
    searchButton: {
        backgroundColor: colors.cardBackground,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
        borderWidth: 1,
        borderColor: colors.border,
    },
    searchButtonText: {
        color: colors.primary,
        fontWeight: '600',
        fontSize: 14,
    },
    map: {
        flex: 1,
    },
    locationLoadingOverlay: {
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
    centerButton: {
        position: 'absolute',
        top: 110, // Align with filters
        right: 16, // Move to right
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
        zIndex: 15, // Ensure it's above filter container (10)
    },
})
