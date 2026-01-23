import FilterPills, { FilterType } from '@/components/FilterPills'
import ListCarousel from '@/components/ListCarousel'
import ListModal from '@/components/ListModal'
import LocationSearchBar from '@/components/LocationSearchBar'
import MapBottomSheet from '@/components/MapBottomSheet'
import ThreadModal from '@/components/ThreadModal'
import ViewToggle from '@/components/ViewToggle'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { getPostLocations, getPostsInRadius } from '@/utils/geospatialQueries'
import { Ionicons } from '@expo/vector-icons'
import Mapbox, { Camera, CircleLayer, LocationPuck, MapView, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import * as Location from 'expo-location'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { arrayRemove, deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    BackHandler,
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
    title?: string
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

    // List Focus Mode State
    const { listId, postId, filter, panToUser } = useLocalSearchParams<{
        listId: string;
        postId: string;
        filter: string;
        panToUser: string;
    }>()
    const [activeList, setActiveList] = useState<any | null>(null)
    const [listPosts, setListPosts] = useState<Post[]>([])
    const [isListMode, setIsListMode] = useState(false)
    const [showListModal, setShowListModal] = useState(false)

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

    // Handle Deep Links (Filter & Location)
    useEffect(() => {
        if (filter) {
            if (['trending', 'new'].includes(filter as string)) {
                setActiveFilter(filter as FilterType)
            }
        }

        if (panToUser === 'true' && userLocation) {
            // Small delay to allow map to load if needed, reuse centerOnUserLocation logic
            setTimeout(() => {
                centerOnUserLocation()
            }, 500)
        }
    }, [filter, panToUser, userLocation])

    // Handle List Focus Mode
    useEffect(() => {
        if (listId) {
            fetchListDetails(listId)
        } else if (postId) {
            fetchPostForLocate(postId)
        } else {
            setIsListMode(false)
            setActiveList(null)
            setListPosts([])
            setActiveList(null)
            setListPosts([])
            // setViewMode('map')
        }

        const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (isListMode) {
                handleListClose()
                return true
            }
            return false
        })

        return () => backHandler.remove()
    }, [listId, postId, isListMode])

    const fetchListDetails = async (id: string) => {
        try {
            setLoadingPosts(true)
            const listDoc = await getDoc(doc(db, 'lists', id))
            if (listDoc.exists()) {
                const listData = listDoc.data()
                setActiveList({ id: listDoc.id, ...listData })
                setIsListMode(true)

                // Fetch posts for the list
                if (listData.postIds && listData.postIds.length > 0) {
                    const postIds = listData.postIds

                    // Fetch post documents and locations in parallel
                    const [postDocs, locations] = await Promise.all([
                        Promise.all(postIds.map((postId: string) => getDoc(doc(db, 'posts', postId)))),
                        getPostLocations(postIds)
                    ])

                    const posts = postDocs
                        .filter((docSnap) => docSnap.exists())
                        .map((docSnap) => {
                            const data = docSnap.data()
                            const location = locations.find(loc => loc.postId === docSnap.id)

                            return {
                                id: docSnap.id,
                                ...data,
                                latitude: location?.latitude,
                                longitude: location?.longitude,
                            } as Post
                        })

                    console.log(`[ListMode] Loaded ${posts.length} posts for list ${listData.name}`)
                    const postsWithLocation = posts.filter(p => p.latitude && p.longitude)
                    console.log(`[ListMode] Posts with valid location: ${postsWithLocation.length}`)

                    setListPosts(posts)
                    setVisiblePosts(posts) // Show only list posts on map

                    // Fit bounds to show all posts
                    if (posts.length > 0 && mapRef.current && cameraRef.current) {
                        const coordinates = posts
                            .filter(p => p.longitude && p.latitude)
                            .map(p => [p.longitude!, p.latitude!])

                        if (coordinates.length > 0) {
                            // Calculate bounds manually or use fitBounds if available on camera
                            // For simplicity, we'll center on the first post for now, 
                            // but ideally we'd calculate the bbox
                            const firstPost = posts[0]
                            if (firstPost.latitude && firstPost.longitude) {
                                setTimeout(() => {
                                    cameraRef.current?.setCamera({
                                        centerCoordinate: [firstPost.longitude!, firstPost.latitude!],
                                        zoomLevel: 10,
                                        animationDuration: 1000,
                                    })
                                }, 500)
                            }
                        }
                    }
                }
                // setShowListModal(true) // Disable auto-open per user request
            }
        } catch (error) {
            console.error('Error fetching list details:', error)
            Alert.alert('Error', 'Failed to load list details')
        } finally {
            setLoadingPosts(false)
        }
    }

    const fetchPostForLocate = async (id: string) => {
        try {
            setLoadingPosts(true)
            // Fetch the post
            const postDoc = await getDoc(doc(db, 'posts', id))
            if (postDoc.exists()) {
                const postData = postDoc.data()

                // Fetch location via cloud function
                const locations = await getPostLocations([id])
                const location = locations.find(loc => loc.postId === id)

                const post = {
                    id: postDoc.id,
                    ...postData,
                    latitude: location?.latitude,
                    longitude: location?.longitude,
                } as Post

                // Set up "fake" list mode
                setActiveList({
                    id: 'single-post-view',
                    name: 'Post Location',
                    creatorId: 'system',
                    postIds: [id]
                })
                setIsListMode(true)
                setListPosts([post])
                setVisiblePosts([post])

                // Focus camera
                if (post.latitude && post.longitude && cameraRef.current) {
                    setTimeout(() => {
                        cameraRef.current?.setCamera({
                            centerCoordinate: [post.longitude!, post.latitude!],
                            zoomLevel: 16,
                            animationDuration: 1000,
                        })
                    }, 500)
                }
            }
        } catch (error) {
            console.error('Error fetching post for locate:', error)
            Alert.alert('Error', 'Failed to locate post')
        } finally {
            setLoadingPosts(false)
        }
    }


    const handleListClose = () => {
        router.setParams({ listId: '', postId: '' }) // Clear params
        setIsListMode(false)
        setActiveList(null)
        setListPosts([])
        setActiveList(null)
        setListPosts([])
        // setViewMode('map')
        fetchPostsInViewport() // Reload normal posts
    }

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
            default:
                return posts
        }
    }, [])

    // Fetch posts in current viewport
    const fetchPostsInViewport = useCallback(async () => {
        if (!mapRef.current || isListMode) return

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
        // Show search button when map is moved (only in normal mode)
        if (!isListMode) {
            setShowSearchButton(true)
        }
    }, [isListMode])

    // Initial load when map is ready
    useEffect(() => {
        if (!locationLoading && mapRef.current && !listId) {
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
            if (!isListMode) {
                setShowThreadModal(true)
            }
        }
    }

    const handleCarouselSnap = (post: Post) => {
        if (post.latitude && post.longitude && cameraRef.current) {
            setSelectedPostId(post.id)
            cameraRef.current.setCamera({
                centerCoordinate: [post.longitude, post.latitude],
                zoomLevel: 14,
                animationDuration: 500,
            })
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
                    isOwn: post.authorId === user?.uid,
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

    const handleRemovePostFromList = async (postId: string) => {
        if (!activeList) return

        try {
            await updateDoc(doc(db, 'lists', activeList.id), {
                postIds: arrayRemove(postId),
            })
            setListPosts((prev) => prev.filter((p) => p.id !== postId))
            // Also update the visible posts on the map if in list mode
            setVisiblePosts((prev) => prev.filter((p) => p.id !== postId))

            // Update active list state locally
            setActiveList(prev => ({
                ...prev,
                postIds: prev.postIds.filter((id: string) => id !== postId)
            }))

        } catch (error) {
            console.error('Error removing post from list:', error)
            Alert.alert('Error', 'Failed to remove post')
        }
    }

    const handleDeleteList = async () => {
        if (!activeList) return

        try {
            await deleteDoc(doc(db, 'lists', activeList.id))
            handleListClose()
        } catch (error) {
            console.error('Error deleting list:', error)
            Alert.alert('Error', 'Failed to delete list')
        }
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

    const handleLocationSelect = (location: any) => {
        if (!cameraRef.current) return

        if (location.bbox) {
            // Use fitBounds if bbox is available
            cameraRef.current.fitBounds(
                [location.bbox[2], location.bbox[3]], // NE: [maxX, maxY]
                [location.bbox[0], location.bbox[1]], // SW: [minX, minY]
                [50, 20, 50, 20], // padding [top, right, bottom, left]
                1000 // duration
            )
        } else {
            // Fallback to center implementation
            cameraRef.current.setCamera({
                centerCoordinate: location.center,
                zoomLevel: 12, // Default zoom if no bbox
                animationDuration: 1000,
            })
        }

        // Trigger search in this area after animation
        setTimeout(() => {
            fetchPostsInViewport()
        }, 1200)
    }




    return (
        <View style={styles.container}>
            {/* Compact Header */}
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>{isListMode ? activeList?.name || 'List' : 'Map'}</Text>
                </View>

                {isListMode && (
                    <TouchableOpacity
                        onPress={handleListClose}
                        style={{ position: 'absolute', left: 16, bottom: 12 + 8, zIndex: 10 }}
                    >
                        <Ionicons name="close" size={24} color={colors.textPrimary} />
                    </TouchableOpacity>
                )}

                {isListMode && activeList?.creatorId === user?.uid && (
                    <TouchableOpacity
                        onPress={() => router.push(`/create-list?listId=${activeList.id}` as any)}
                        style={{ position: 'absolute', right: 16, bottom: 12 + 8, zIndex: 10 }}
                    >
                        <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>Edit</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* View Toggle - Bottom Center */}
            {isListMode && (
                <ViewToggle
                    activeMode={showListModal ? 'list' : 'map'}
                    onToggle={(mode) => {
                        setShowListModal(mode === 'list')
                    }}
                    bottomOffset={12}
                />
            )}

            {/* Search Bar */}
            {!isListMode && (
                <LocationSearchBar
                    onLocationSelect={handleLocationSelect}
                    containerStyle={{ top: 110 }} // Position below header (approx safe area + header height)
                    userLocation={userLocation ? {
                        latitude: userLocation.coords.latitude,
                        longitude: userLocation.coords.longitude
                    } : null}
                />
            )}

            {/* Floating Filter Pills */}
            {!locationLoading && !isListMode && (
                <View style={styles.filterContainer} pointerEvents="box-none">
                    <FilterPills
                        activeFilter={activeFilter}
                        onFilterChange={handleFilterChange}
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
                                    ['get', 'isOwn'],
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


            {/* Bottom Sheet or List Carousel */}
            {!locationLoading && (
                isListMode ? (
                    <ListCarousel
                        posts={listPosts}
                        onPostSnap={handleCarouselSnap}
                        onPostPress={(post) => {
                            setSelectedPost(post)
                            setShowThreadModal(true)
                        }}
                        selectedPostId={selectedPostId}
                        bottomOffset={insets.bottom + 60}
                    />
                ) : (
                    <MapBottomSheet
                        posts={sortedVisiblePosts}
                        loading={loadingPosts}
                        onPostPress={handlePostPress}
                        onJumpToLocation={handleJumpToLocation}
                        selectedPostId={selectedPostId}
                    />
                )
            )}

            {/* Thread Modal */}
            <ThreadModal
                visible={showThreadModal}
                post={selectedPost}
                onClose={handleThreadModalClose}
                onPostUpdate={handlePostUpdate}
                onPostDelete={handlePostDelete}
            />

            {/* List Modal */}
            <ListModal
                visible={showListModal}
                onClose={() => setShowListModal(false)}
                list={activeList}
                posts={listPosts}
                loading={loadingPosts}
                onRemovePost={handleRemovePostFromList}
                onDeleteList={handleDeleteList}
                onRefresh={() => activeList?.id && fetchListDetails(activeList.id)}
                refreshing={loadingPosts}
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
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        zIndex: 20,
        paddingBottom: 12, // Ensure space below content
    },
    headerTitleContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 44, // Standard toolbar height
        marginTop: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    viewToggle: {
        flexDirection: 'row',
        backgroundColor: colors.card,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 4,
        position: 'absolute',
        alignSelf: 'center',
        zIndex: 30,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
    },
    toggleOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
    },
    toggleOptionActive: {
        backgroundColor: colors.primary,
    },
    toggleText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    toggleTextActive: {
        color: '#fff',
    },
    listViewContainer: {
        flex: 1,
        backgroundColor: colors.background,
    },
    filterContainer: {
        position: 'absolute',
        top: 170, // Moved down for SearchBar
        left: 0,
        right: 0,
        zIndex: 10,
        backgroundColor: 'transparent',
    },
    searchButtonContainer: {
        position: 'absolute',
        top: 220, // Moved down for SearchBar
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
