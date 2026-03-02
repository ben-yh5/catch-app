import { FilterType } from '@/components/FilterPills'
import MapBottomSheet from '@/components/MapBottomSheet'
import MapHUD from '@/components/MapHUD'
import ThreadModal from '@/components/ThreadModal'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { db, functions } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Post, SearchPost } from '@/types'
import { getPostsInViewport as fetchViewportPosts, getPostLocations } from '@/utils/geospatialQueries'
import { getPostBountyStatus } from '@/utils/postClassification'
import { Ionicons } from '@expo/vector-icons'
import Mapbox, { Camera, CircleLayer, LocationPuck, MapView, ShapeSource, SymbolLayer } from '@rnmapbox/maps'
import * as Location from 'expo-location'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { arrayRemove, deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
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

// Map marker colors (using theme colors)
const MAP_COLORS = {
    userLocation: colors.white,         // White - user's location puck
    pin: colors.pinDefault,             // Blue - uncaught posts
    pinCaught: colors.pinCaught,        // Pink - caught by user
    selectedPin: colors.pinSelected,    // Light pink - currently selected
    pinBounty: colors.pinBounty,        // Gold - bounty posts
    pinTrending: colors.pinTrending,    // Silver - trending posts
    stroke: colors.white,
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
    const { cachePosts, caughtThreadIds } = usePost()
    const lastFetchRef = useRef<number>(0)
    const fetchTimeoutRef = useRef<any>(undefined)
    const FILTER_DEBOUNCE = 600 // reduced to 600ms for snappier feel

    // List Focus Mode State
    const { listId, postId, filter, panToUser, searchQuery } = useLocalSearchParams<{
        listId: string;
        postId: string;
        filter: string;
        panToUser: string;
        searchQuery: string;
    }>()
    const [activeList, setActiveList] = useState<any | null>(null)
    const [listPosts, setListPosts] = useState<Post[]>([])
    const [isListMode, setIsListMode] = useState(false)


    // Thread modal state
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [showThreadModal, setShowThreadModal] = useState(false)

    // Search mode state
    const [isSearchMode, setIsSearchMode] = useState(false)
    const isSearchModeRef = useRef(false)
    const [searchPostResults, setSearchPostResults] = useState<Post[]>([])
    const [searchLoading, setSearchLoading] = useState(false)
    const [activeSearchQuery, setActiveSearchQuery] = useState('')

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

    // Handle search query from Explore tab deep link
    useEffect(() => {
        if (searchQuery && searchQuery.trim().length > 0 && !locationLoading) {
            handleSearch(searchQuery)
        }
    }, [searchQuery, locationLoading])

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
            }
        } catch (error) {
            console.error('Error fetching list details:', error)
            Alert.alert('Error', 'Failed to load list details')
        } finally {
            setLoadingPosts(false)
        }
    }

    // Reload posts when exiting list mode
    useEffect(() => {
        if (!isListMode && !locationLoading) {
            loadVisiblePosts()
        }
    }, [isListMode, locationLoading])

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
    const loadVisiblePosts = useCallback(async () => {
        if (!mapRef.current || isListMode || isSearchModeRef.current) return

        // Debounce if called too frequently (unless forced)
        const now = Date.now()
        if (now - lastFetchRef.current < 1000) return
        lastFetchRef.current = now

        setLoadingPosts(true)

        try {
            const visibleBounds = await mapRef.current.getVisibleBounds()
            if (!visibleBounds || visibleBounds.length !== 2) {
                return
            }

            // visibleBounds is [[east, north], [west, south]] (NE, SW) in some versions
            // OR [[neLng, neLat], [swLng, swLat]]
            // We need to parse correctly.
            // Standard Mapbox: [ne, sw] arrays.

            // Assume [NE, SW] based on common RNMapbox usage
            const ne = visibleBounds[0] // [lng, lat]
            const sw = visibleBounds[1] // [lng, lat]

            console.log('Visible Bounds Raw:', visibleBounds)
            // Ensure we handle both potential formats [[ne], [sw]] or [[sw], [ne]]
            // We want North (max lat), South (min lat), East (max lng), West (min lng)

            const lat1 = ne[1]
            const lat2 = sw[1]
            const lng1 = ne[0]
            const lng2 = sw[0]

            const bounds = {
                north: Math.max(lat1, lat2),
                south: Math.min(lat1, lat2),
                east: Math.max(lng1, lng2),
                west: Math.min(lng1, lng2)
            }

            // Single enriched call: locations + summaries, pre-filtered to originals
            const enrichedLocations = await fetchViewportPosts(bounds, {
                includeSummary: true,
                filterOriginal: true,
            })

            // Convert enriched locations to Post objects for existing rendering code
            const posts: Post[] = enrichedLocations
                .filter(loc => loc.summary)
                .map(loc => ({
                    ...loc.summary!,
                    id: loc.postId,
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                    hasLocation: true,
                    parentPostId: null,
                    rootPostId: null,
                } as Post))

            // Cache posts so ThreadModal can use them without re-fetching
            cachePosts(posts)

            const sortedPosts = applySorting(posts, activeFilter)
            setVisiblePosts(sortedPosts)

        } catch (error) {
            console.error('Error fetching posts in viewport:', error)
            // Don't alert on auto-fetch error to avoid annoyance
        } finally {
            setLoadingPosts(false)
        }
    }, [activeFilter, applySorting, cachePosts, isListMode])

    // Handle map movement - Auto Fetch with Debounce
    const handleCameraChanged = useCallback((state: any) => {
        if (isSearchModeRef.current) return
        // Only fetch if idle (interaction ended)
        if (!state.gestures.isGestureActive) {
            // We use a timeout to debounce the fetch
            if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
            fetchTimeoutRef.current = setTimeout(() => {
                loadVisiblePosts()
            }, FILTER_DEBOUNCE)
        }
    }, [loadVisiblePosts])

    // Initial load when map is ready
    useEffect(() => {
        if (!locationLoading && mapRef.current && !listId) {
            // Small delay to ensure map is fully rendered
            console.log('Map ready, fetching posts...')
            setTimeout(() => {
                loadVisiblePosts()
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
        const posts = isSearchMode ? searchPostResults : sortedVisiblePosts
        const post = posts.find((p) => p.id === postId)
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
                    isOwn: post.authorId === user?.uid,
                    isCaught: caughtThreadIds.has(post.id),
                    isBounty: getPostBountyStatus(post) === 'bounty',
                    isTrending: getPostBountyStatus(post) === 'trending',
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
            setActiveList((prev: any) => ({
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

    // Search mode handlers
    const handleSearch = useCallback(async (queryText: string) => {
        isSearchModeRef.current = true
        setIsSearchMode(true)
        setSearchLoading(true)
        setActiveSearchQuery(queryText)
        setSearchPostResults([])

        try {
            const searchPostsFn = httpsCallable(functions, 'searchPosts')
            const result = await searchPostsFn({
                query: queryText,
                ...(userLocation ? {
                    location: { lat: userLocation.coords.latitude, lng: userLocation.coords.longitude },
                } : {}),
            })
            const { posts } = result.data as { posts: SearchPost[] }

            // Convert SearchPost[] → Post[] for map pins and bottom sheet
            const converted: Post[] = posts
                .filter(sp => sp.latitude && sp.longitude)
                .map(sp => ({
                    id: sp.postId,
                    authorId: sp.authorId,
                    authorUsername: sp.authorUsername,
                    photoURL: sp.photoURL,
                    caption: sp.caption,
                    hasLocation: true,
                    catchCount: sp.catchCount,
                    parentPostId: null,
                    rootPostId: null,
                    isOriginal: sp.isOriginal,
                    createdAt: sp.createdAt,
                    thumbnailURL: sp.thumbnailURL ?? undefined,
                    mediumURL: sp.mediumURL ?? undefined,
                    isPioneer: sp.isPioneer,
                    latitude: sp.latitude,
                    longitude: sp.longitude,
                } as Post))

            setSearchPostResults(converted)
            setVisiblePosts(converted)

            // Fit camera to show all result pins
            if (converted.length > 0 && cameraRef.current) {
                const lats = converted.map(p => p.latitude!)
                const lngs = converted.map(p => p.longitude!)

                if (converted.length === 1) {
                    cameraRef.current.setCamera({
                        centerCoordinate: [lngs[0], lats[0]],
                        zoomLevel: 14,
                        animationDuration: 1000,
                    })
                } else {
                    cameraRef.current.fitBounds(
                        [Math.max(...lngs), Math.max(...lats)], // NE
                        [Math.min(...lngs), Math.min(...lats)], // SW
                        [80, 40, 200, 40], // padding: top (HUD), right, bottom (sheet), left
                        1000,
                    )
                }
            }
        } catch (error) {
            console.error('Search error:', error)
        } finally {
            setSearchLoading(false)
        }
    }, [userLocation])

    const handleSearchClear = useCallback(() => {
        isSearchModeRef.current = false
        setIsSearchMode(false)
        setSearchPostResults([])
        setActiveSearchQuery('')
        router.setParams({ searchQuery: '' })
        // Resume normal map behavior
        loadVisiblePosts()
    }, [loadVisiblePosts, router])




    return (
        <View style={styles.container}>


            {/* Map HUD (Search + Filters) */}
            <MapHUD
                onSearch={handleSearch}
                onSearchClear={handleSearchClear}
                searchLoading={searchLoading}
                searchQuery={searchQuery || ''}
                isSearchMode={isSearchMode}
                activeFilter={activeFilter}
                onFilterChange={handleFilterChange}
            />

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
                    compassViewPosition={1} // 1 = Top Right
                    // Compass at top relative to map, BELOW HUD.
                    // HUD ~110px. Increasing spacing per user request.
                    compassViewMargins={{ x: 16, y: insets.top + 180 }}
                    onCameraChanged={handleCameraChanged}
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
                                    ['get', 'isCaught'],
                                    MAP_COLORS.pinCaught,
                                    ['get', 'isBounty'],
                                    MAP_COLORS.pinBounty,
                                    ['get', 'isTrending'],
                                    MAP_COLORS.pinTrending,
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

            {/* Center on location button - Below Compass */}
            {userLocation && (
                <TouchableOpacity
                    // Compass at ~180 + ~40 height = 220 + gap = 240
                    style={[styles.centerButton, { top: insets.top + 240 }]}
                    onPress={centerOnUserLocation}
                    activeOpacity={0.7}
                >
                    <Ionicons name="locate" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
            )}


            {/* Bottom Sheet */}
            {!locationLoading && (
                <MapBottomSheet
                    posts={isSearchMode ? searchPostResults : sortedVisiblePosts}
                    loading={isSearchMode ? searchLoading : loadingPosts}
                    onPostPress={handlePostPress}
                    onJumpToLocation={handleJumpToLocation}
                    selectedPostId={selectedPostId}
                    title={isSearchMode ? `"${activeSearchQuery}"` : activeList?.name}
                    subtitle={isSearchMode ? `${searchPostResults.length} result${searchPostResults.length !== 1 ? 's' : ''}` : undefined}
                    onClose={isSearchMode ? handleSearchClear : handleListClose}
                    isListMode={isListMode || isSearchMode}
                />
            )}

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
        top: 110, // Moved up
        left: 0,
        right: 0,
        zIndex: 10,
        backgroundColor: 'transparent',
    },
    searchButtonContainer: {
        position: 'absolute',
        top: 160, // Moved up
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
        zIndex: 15,
    },
})
