import { FilterType } from '@/components/FilterPills'
import MapBottomSheet from '@/components/MapBottomSheet'
import MapHUD from '@/components/MapHUD'
import ThreadModal from '@/components/ThreadModal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { usePost, usePostEvents } from '@/context/PostContext'
import { db, functions } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { documentInk } from '@/theme/document'
import { Post, SearchPost } from '@/types'
import {
    calculateDistance,
    getPostsInViewport as fetchViewportPosts,
    getPostLocations,
    invalidateAreaCache,
    MapBounds,
} from '@/utils/geospatialQueries'
import { decodeGeohashBBox } from '@/utils/coverageQueries'
import { monthYear } from '@/utils/dateUtils'
import {
    isLostPlace,
    LOST_PLACE_INACTIVITY_DAYS,
} from '@/utils/postClassification'
import LostPlaceWhisper from '@/components/LostPlaceWhisper'
import {
    useCoverage,
    useClusterBubbles,
    CoverageMode,
    PIN_MIN_ZOOM,
} from '@/hooks/useCoverage'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { distanceBetween } from 'geofire-common'
import Mapbox, {
    Camera,
    CircleLayer,
    FillLayer,
    LocationPuck,
    MapState,
    MapView,
    ShapeSource,
    SymbolLayer,
} from '@rnmapbox/maps'
import * as Location from 'expo-location'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
    BackHandler,
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Set Mapbox access token. Fail fast: an empty token doesn't error here —
// it surfaces later as a silently blank map (tile requests 401).
const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
if (!MAPBOX_ACCESS_TOKEN) {
    throw new Error(
        'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is not set — the map cannot load. Check your .env.'
    )
}
Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN)

// Map marker colors. Resting pins wear the muted document inks so the
// map reads calm; selection/own keep the full-saturation pink — transient
// feedback should pop. (Muted gold for lost places, if ever revived:
// #C9A94F.)
const MAP_COLORS = {
    userLocation: colors.white, // White - user's location puck
    pin: documentInk.posted, // Muted blue - uncaught posts
    pinCaught: documentInk.caught, // Muted pink - caught by user
    selectedPin: colors.pinSelected, // Full pink - currently selected
    pinLostPlace: colors.pinLostPlace, // Gold - lost places (record has a gap)
    stroke: 'rgba(255, 255, 255, 0.8)',
}

// Last session's camera, persisted on every settle. Lets the map mount
// where the user left it on frame one instead of blocking behind the
// location fix. Display-layer only — safe to lose or ignore.
const STORED_CAMERA_KEY = '@map_last_camera'
// If the user's actual position is further than this from the stored
// camera (they traveled since last session), correct to where they are
const STORED_CAMERA_STALE_KM = 100

type StoredCamera = { lng: number; lat: number; zoom: number }

export default function MapScreen() {
    const { user, blockedUserIds } = useAuth()
    const { showToast } = useToast()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const mapRef = useRef<MapView>(null)
    const cameraRef = useRef<Camera>(null)
    const shapeSourceRef = useRef<ShapeSource>(null)
    const bubblesSourceRef = useRef<ShapeSource>(null)

    // State
    const [visiblePosts, setVisiblePosts] = useState<Post[]>([])
    // Starts true so the sheet says "Loading..." instead of claiming
    // "0 shots" before the first camera-driven fetch resolves
    const [loadingPosts, setLoadingPosts] = useState(true)
    const [zoomedTooFarOut, setZoomedTooFarOut] = useState(false)
    const [activeFilter, setActiveFilter] = useState<FilterType>('trending')
    const [userLocation, setUserLocation] =
        useState<Location.LocationObject | null>(null)
    const [locationLoading, setLocationLoading] = useState(true)
    const [locationDenied, setLocationDenied] = useState(false)
    const [browseWithoutLocation, setBrowseWithoutLocation] = useState(false)
    const [viewportError, setViewportError] = useState(false)
    // undefined = still reading AsyncStorage (a few ms), null = nothing stored
    const [storedCamera, setStoredCamera] = useState<
        StoredCamera | null | undefined
    >(undefined)
    const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
    const { cachePosts, caughtThreadIds } = usePost()
    const lastFetchRef = useRef<number>(0)
    const lastFetchBoundsRef = useRef<MapBounds | null>(null)
    const throttleRetryRef = useRef<any>(undefined)
    const loadVisiblePostsRef = useRef<() => void>(() => {})
    const hasLoadedOnceRef = useRef(false)
    const isMapReadyRef = useRef(false)
    const initialFetchDoneRef = useRef(false)
    const pendingCameraActionRef = useRef<(() => void) | null>(null)

    // List Focus Mode State
    const { listId, postId, filter, panToUser, searchQuery } =
        useLocalSearchParams<{
            listId: string
            postId: string
            filter: string
            panToUser: string
            searchQuery: string
        }>()
    const [activeList, setActiveList] = useState<any | null>(null)
    const [, setListPosts] = useState<Post[]>([])

    // Native-tabs quirk: the tab bar dispatches a params-less JUMP_TO on
    // every focus change — including the programmatic one right after
    // router.push('/(tabs)/map?listId=…') — and TabRouter REPLACES route
    // params on JUMP_TO, wiping listId/postId moments after they arrive.
    // That flipped the map back to normal mode ("Zoom in to see shots")
    // over a just-opened list. Latch the ids so only an explicit close
    // (which clears the latch) exits list mode. Render-phase state
    // adjustment is React's sanctioned derived-state pattern.
    const [stickyListId, setStickyListId] = useState('')
    const [stickyPostId, setStickyPostId] = useState('')
    if (listId && listId !== stickyListId) setStickyListId(listId)
    if (postId && postId !== stickyPostId) setStickyPostId(postId)
    const effectiveListId = listId || stickyListId
    const effectivePostId = postId || stickyPostId

    // List mode is DERIVED from the (latched) route params, never tracked
    // as separate state — async state kept desyncing and let normal-mode
    // logic take over the sheet while a list was open.
    const isListMode = Boolean(effectiveListId) || Boolean(effectivePostId)

    // Thread modal state
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [showThreadModal, setShowThreadModal] = useState(false)

    // Search mode state
    const [isSearchMode, setIsSearchMode] = useState(false)
    const isSearchModeRef = useRef(false)
    // Render-phase mirror of the derived isListMode: loadVisiblePosts runs
    // from debounced timers whose closures can be stale, so it reads this
    // ref at execution time instead
    const isListModeRef = useRef(false)
    isListModeRef.current = isListMode
    const [searchPostResults, setSearchPostResults] = useState<Post[]>([])
    const [searchLoading, setSearchLoading] = useState(false)
    const [activeSearchQuery, setActiveSearchQuery] = useState('')

    // Coverage/heatmap state
    const [coverageMode, setCoverageMode] = useState<CoverageMode>('off')
    const [currentZoom, setCurrentZoom] = useState(12)
    const [currentBounds, setCurrentBounds] = useState<MapBounds | null>(null)
    const { bubblesGeoJSON } = useClusterBubbles(currentBounds, currentZoom)
    const { coverageGeoJSON, precision: coveragePrecision } = useCoverage(
        currentBounds,
        currentZoom,
        coverageMode
    )
    const showCoverage =
        coverageMode !== 'off' && coverageGeoJSON && coveragePrecision !== null

    // The single exit path from list mode: clears the params AND the latch
    // they're mirrored into, then refetches the viewport so the list's pins
    // don't linger. Used by the Close button, hardware back, and the fetch
    // failure paths below.
    const handleListClose = useCallback(() => {
        router.setParams({ listId: '', postId: '' })
        setStickyListId('')
        setStickyPostId('')
        // Flip the ref now so the refetch below isn't skipped (the state
        // changes haven't committed yet; the render mirror re-asserts it)
        isListModeRef.current = false
        setActiveList(null)
        setListPosts([])
        // Resetting the throttle/bounds cache guarantees a real refetch (or
        // the zoomed-out state if the list fit left the camera far out)
        lastFetchRef.current = 0
        lastFetchBoundsRef.current = null
        loadVisiblePostsRef.current?.()
    }, [router])

    // Wrap fetchListDetails in useCallback
    const fetchListDetails = useCallback(
        async (id: string) => {
            try {
                // List mode itself is already active — it's derived from the
                // listId param — so the sheet shows the list header (with a
                // loading state) for the whole fetch
                setLoadingPosts(true)
                setVisiblePosts([])
                const listDoc = await getDoc(doc(db, 'lists', id))
                if (!listDoc.exists()) {
                    throw new Error('List not found')
                }
                const listData = listDoc.data()
                setActiveList({ id: listDoc.id, ...listData })

                // Fetch posts for the list
                if (listData.postIds && listData.postIds.length > 0) {
                    const postIds = listData.postIds

                    // Fetch post documents and locations in parallel
                    const [postDocs, locations] = await Promise.all([
                        Promise.all(
                            postIds.map((postId: string) =>
                                getDoc(doc(db, 'posts', postId))
                            )
                        ),
                        getPostLocations(postIds),
                    ])

                    const posts = postDocs
                        .filter((docSnap) => docSnap.exists())
                        .map((docSnap) => {
                            const data = docSnap.data()
                            const location = locations.find(
                                (loc) => loc.postId === docSnap.id
                            )

                            return {
                                id: docSnap.id,
                                ...data,
                                latitude: location?.latitude,
                                longitude: location?.longitude,
                            } as Post
                        })

                    console.log(
                        `[ListMode] Loaded ${posts.length} posts for list ${listData.name}`
                    )
                    const postsWithLocation = posts.filter(
                        (p) => p.latitude && p.longitude
                    )
                    console.log(
                        `[ListMode] Posts with valid location: ${postsWithLocation.length}`
                    )

                    setListPosts(posts)
                    setVisiblePosts(posts) // Show only list posts on map

                    // Fit the camera to every post in the list — a real
                    // bounds fit, not a fixed zoom centered on the first
                    // post, which left far-apart lists mostly off-screen
                    const coordinates = posts
                        .filter((p) => p.longitude && p.latitude)
                        .map(
                            (p) =>
                                [p.longitude!, p.latitude!] as [
                                    number,
                                    number,
                                ]
                        )

                    if (coordinates.length > 0) {
                        const fitToList = () => {
                            if (coordinates.length === 1) {
                                cameraRef.current?.setCamera({
                                    centerCoordinate: coordinates[0],
                                    zoomLevel: 14,
                                    animationDuration: 1000,
                                })
                                return
                            }
                            const lngs = coordinates.map((c) => c[0])
                            const lats = coordinates.map((c) => c[1])
                            cameraRef.current?.fitBounds(
                                [Math.max(...lngs), Math.max(...lats)],
                                [Math.min(...lngs), Math.min(...lats)],
                                // [top, right, bottom, left] — extra
                                // bottom keeps pins clear of the
                                // half-open bottom sheet
                                [100, 60, 320, 60],
                                1000
                            )
                        }
                        if (isMapReadyRef.current) {
                            fitToList()
                        } else {
                            pendingCameraActionRef.current = fitToList
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching list details:', error)
                showToast('error', 'Failed to load list details')
                handleListClose()
            } finally {
                setLoadingPosts(false)
            }
        },
        [showToast, handleListClose]
    )

    // Wrap fetchPostForLocate in useCallback
    const fetchPostForLocate = useCallback(
        async (id: string) => {
            try {
                setLoadingPosts(true)
                setVisiblePosts([])
                // Fetch the post
                const postDoc = await getDoc(doc(db, 'posts', id))
                if (!postDoc.exists()) {
                    throw new Error('Post not found')
                }
                const postData = postDoc.data()

                // Fetch location via cloud function
                const locations = await getPostLocations([id])
                const location = locations.find((loc) => loc.postId === id)

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
                    postIds: [id],
                })
                setListPosts([post])
                setVisiblePosts([post])

                // Focus camera
                if (post.latitude && post.longitude) {
                    const panToPost = () => {
                        cameraRef.current?.setCamera({
                            centerCoordinate: [
                                post.longitude!,
                                post.latitude!,
                            ],
                            zoomLevel: 16,
                            animationDuration: 1000,
                        })
                    }
                    if (isMapReadyRef.current) {
                        panToPost()
                    } else {
                        pendingCameraActionRef.current = panToPost
                    }
                }
            } catch (error) {
                console.error('Error fetching post for locate:', error)
                showToast('error', 'Failed to locate shot')
                handleListClose()
            } finally {
                setLoadingPosts(false)
            }
        },
        [showToast, handleListClose]
    )

    const centerOnUserLocation = useCallback(() => {
        if (userLocation && cameraRef.current) {
            cameraRef.current.setCamera({
                centerCoordinate: [
                    userLocation.coords.longitude,
                    userLocation.coords.latitude,
                ],
                zoomLevel: 14,
                animationDuration: 1000,
            })
        }
    }, [userLocation])

    // Search mode handlers
    const handleSearch = useCallback(
        async (queryText: string) => {
            isSearchModeRef.current = true
            setIsSearchMode(true)
            setSearchLoading(true)
            setActiveSearchQuery(queryText)
            setSearchPostResults([])

            try {
                const searchPostsFn = httpsCallable(functions, 'searchPosts')
                const result = await searchPostsFn({
                    query: queryText,
                    ...(userLocation
                        ? {
                              location: {
                                  lat: userLocation.coords.latitude,
                                  lng: userLocation.coords.longitude,
                              },
                          }
                        : {}),
                })
                const { posts } = result.data as { posts: SearchPost[] }

                // Convert SearchPost[] → Post[] for map pins and bottom sheet
                const converted: Post[] = posts
                    .filter((sp) => sp.latitude && sp.longitude)
                    .map(
                        (sp) =>
                            ({
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
                            }) as Post
                    )

                setSearchPostResults(converted)
                setVisiblePosts(converted)

                // Fit camera to show all result pins
                if (converted.length > 0 && cameraRef.current) {
                    const lats = converted.map((p) => p.latitude!)
                    const lngs = converted.map((p) => p.longitude!)

                    if (converted.length === 1) {
                        cameraRef.current.setCamera({
                            centerCoordinate: [lngs[0], lats[0]],
                            zoomLevel: 14,
                            animationDuration: 1000,
                        })
                    } else {
                        // Fit bounds for multiple pins
                        const padding = 100
                        cameraRef.current.fitBounds(
                            [Math.min(...lngs), Math.min(...lats)],
                            [Math.max(...lngs), Math.max(...lats)],
                            padding,
                            1000
                        )
                    }
                }

                isSearchModeRef.current = true
            } catch (error) {
                console.error('Error searching posts:', error)
                showToast(
                    'error',
                    'Search failed',
                    'Check your connection and try again.'
                )
                isSearchModeRef.current = false
            } finally {
                setSearchLoading(false)
            }
        },
        [userLocation, showToast]
    )

    // Get user's current location. Also the retry path after the user
    // grants permission in Settings — re-requesting resolves silently
    // once access is granted.
    const requestLocation = useCallback(async () => {
        try {
            setLocationLoading(true)
            const { status } =
                await Location.requestForegroundPermissionsAsync()
            if (status !== 'granted') {
                setLocationDenied(true)
                setLocationLoading(false)
                return
            }
            setLocationDenied(false)

            // Use last known location first for speed
            const lastKnown = await Location.getLastKnownPositionAsync({})
            if (lastKnown) {
                setUserLocation(lastKnown)
                setLocationLoading(false)
            }

            // Get current position in background for accuracy
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            })
            setUserLocation(location)
            if (!lastKnown) {
                setLocationLoading(false)
            }
        } catch (error) {
            console.error('Error getting location:', error)
            setLocationLoading(false)
        }
    }, [])

    useEffect(() => {
        requestLocation()
    }, [requestLocation])

    // Load last session's camera. The map mounts as soon as this resolves
    // (milliseconds) — it does NOT wait for the location fix above.
    useEffect(() => {
        let cancelled = false
        AsyncStorage.getItem(STORED_CAMERA_KEY)
            .then((raw) => {
                if (cancelled) return
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw)
                        if (
                            Number.isFinite(parsed?.lng) &&
                            Number.isFinite(parsed?.lat) &&
                            Number.isFinite(parsed?.zoom)
                        ) {
                            setStoredCamera(parsed as StoredCamera)
                            return
                        }
                    } catch {
                        // Corrupt entry — fall through to the world view
                    }
                }
                setStoredCamera(null)
            })
            .catch(() => {
                if (!cancelled) setStoredCamera(null)
            })
        return () => {
            cancelled = true
        }
    }, [])

    // One-time camera correction once the user's real position is known:
    // no stored camera (first run) → fly in from the world view; stored
    // camera far from the user (traveled since last session) → correct to
    // where they are now. Deep-linked list/post focus owns the camera, so
    // skip entirely in those modes.
    const cameraCorrectedRef = useRef(false)
    useEffect(() => {
        if (cameraCorrectedRef.current) return
        if (storedCamera === undefined || !userLocation) return
        if (effectiveListId || effectivePostId) return

        cameraCorrectedRef.current = true

        const { latitude, longitude } = userLocation.coords
        if (
            storedCamera &&
            distanceBetween(
                [storedCamera.lat, storedCamera.lng],
                [latitude, longitude]
            ) <= STORED_CAMERA_STALE_KM
        ) {
            return
        }

        const flyToUser = () =>
            cameraRef.current?.setCamera({
                centerCoordinate: [longitude, latitude],
                zoomLevel: 12,
                animationDuration: 1000,
            })
        if (isMapReadyRef.current) {
            flyToUser()
        } else if (!pendingCameraActionRef.current) {
            // Don't clobber a queued list/post camera fit — those win
            pendingCameraActionRef.current = flyToUser
        }
    }, [storedCamera, userLocation, effectiveListId, effectivePostId])

    // Handle Deep Links (Filter & Location)
    useEffect(() => {
        if (filter) {
            if (['trending', 'new'].includes(filter as string)) {
                setActiveFilter(filter as FilterType)
            }
        }

        if (panToUser === 'true' && userLocation) {
            if (isMapReadyRef.current) {
                centerOnUserLocation()
            } else {
                pendingCameraActionRef.current = () => centerOnUserLocation()
            }
        }
    }, [filter, panToUser, userLocation, centerOnUserLocation])

    // Handle search query from Explore tab deep link
    useEffect(() => {
        if (searchQuery && searchQuery.trim().length > 0 && !locationLoading) {
            handleSearch(searchQuery)
        }
    }, [searchQuery, locationLoading, handleSearch])

    // Handle List Focus Mode. isListMode itself is derived from these
    // (latched) ids — this effect only loads/clears the list DATA.
    useEffect(() => {
        if (effectiveListId) {
            fetchListDetails(effectiveListId)
        } else if (effectivePostId) {
            fetchPostForLocate(effectivePostId)
        } else {
            setActiveList(null)
            setListPosts([])
        }
    }, [effectiveListId, effectivePostId, fetchListDetails, fetchPostForLocate])

    // Hardware back exits list mode (reads the ref so this effect never
    // needs to re-register)
    useEffect(() => {
        const backHandler = BackHandler.addEventListener(
            'hardwareBackPress',
            () => {
                if (isListModeRef.current) {
                    handleListClose()
                    return true
                }
                return false
            }
        )

        return () => backHandler.remove()
    }, [
        handleListClose,
    ])

    // Apply sorting based on active filter
    const applySorting = useCallback(
        (posts: Post[], filter: FilterType): Post[] => {
            switch (filter) {
                case 'trending':
                    return [...posts].sort(
                        (a, b) => b.catchCount - a.catchCount
                    )
                case 'new':
                    return [...posts].sort((a, b) => {
                        const aTime = a.createdAt?.toMillis?.() || 0
                        const bTime = b.createdAt?.toMillis?.() || 0
                        return bTime - aTime
                    })
                default:
                    return posts
            }
        },
        []
    )

    // Fetch posts in current viewport
    const loadVisiblePosts = useCallback(async () => {
        // Refs, not state closures: the camera-settle timer can invoke a
        // version of this captured before a mode change committed
        if (
            !mapRef.current ||
            isListModeRef.current ||
            isSearchModeRef.current
        )
            return

        // Below the pin threshold the map renders cluster bubbles from
        // geohash_cells instead — don't run the (radius-capped) pin query
        // at all. Clear any pins left over from a higher zoom so they
        // don't linger under the bubbles, and flag the state so the
        // bottom sheet explains itself instead of claiming "no shots".
        const zoom = await mapRef.current.getZoom()
        if (zoom < PIN_MIN_ZOOM) {
            setZoomedTooFarOut(true)
            setVisiblePosts((prev) => (prev.length ? [] : prev))
            setLoadingPosts(false)
            return
        }
        setZoomedTooFarOut(false)

        // Throttle to one fetch per second, but defer instead of dropping —
        // otherwise a pan within 1s of the last fetch never loads its pins
        const now = Date.now()
        const elapsed = now - lastFetchRef.current
        if (elapsed < 1000) {
            if (throttleRetryRef.current)
                clearTimeout(throttleRetryRef.current)
            throttleRetryRef.current = setTimeout(
                () => loadVisiblePostsRef.current(),
                1000 - elapsed
            )
            return
        }
        lastFetchRef.current = now

        // Only surface the spinner on the very first load — background
        // refreshes after a pan shouldn't flip loading state (each toggle
        // re-renders the whole screen, including the bottom sheet)
        if (!hasLoadedOnceRef.current) setLoadingPosts(true)

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
                west: Math.min(lng1, lng2),
            }

            // Skip fetch if bounds haven't changed meaningfully (~100m at mid-latitudes)
            const prev = lastFetchBoundsRef.current
            if (prev) {
                const delta = 0.001
                if (
                    Math.abs(bounds.north - prev.north) < delta &&
                    Math.abs(bounds.south - prev.south) < delta &&
                    Math.abs(bounds.east - prev.east) < delta &&
                    Math.abs(bounds.west - prev.west) < delta
                ) {
                    setLoadingPosts(false)
                    return
                }
            }
            lastFetchBoundsRef.current = bounds

            // Single enriched call: locations + summaries, pre-filtered to originals
            const enrichedLocations = await fetchViewportPosts(bounds, {
                includeSummary: true,
                filterOriginal: true,
            })

            // Convert enriched locations to Post objects for existing rendering code
            const posts: Post[] = enrichedLocations
                .filter((loc) => loc.summary)
                .map(
                    (loc) =>
                        ({
                            ...loc.summary!,
                            id: loc.postId,
                            latitude: loc.latitude,
                            longitude: loc.longitude,
                            hasLocation: true,
                            parentPostId: null,
                            rootPostId: null,
                        }) as Post
                )

            // Cache posts so ThreadModal can use them without re-fetching
            cachePosts(posts)

            // Skip the state update (and the GeoJSON rebuild + native shape
            // re-upload it triggers) when the viewport returned the same posts.
            // Sorting happens in the sortedVisiblePosts memo.
            setVisiblePosts((prev) => {
                if (
                    prev.length === posts.length &&
                    prev.every((p, i) => p.id === posts[i].id)
                ) {
                    return prev
                }
                return posts
            })
            setViewportError(false)
        } catch (error) {
            console.error('Error fetching posts in viewport:', error)
            // No alert (would fire on every failed pan) — surfaced as an
            // error state in the bottom sheet instead
            setViewportError(true)
        } finally {
            hasLoadedOnceRef.current = true
            setLoadingPosts(false)
        }
    }, [cachePosts])

    // Refresh the map when a post is created or deleted anywhere in the
    // app — otherwise the 5-minute area cache plus the same-bounds skip
    // means your own new post doesn't appear until you pan away and back.
    usePostEvents((event) => {
        if (event.action !== 'create' && event.action !== 'delete') return
        invalidateAreaCache()
        lastFetchRef.current = 0
        lastFetchBoundsRef.current = null
        loadVisiblePostsRef.current?.()
    }, [])

    // Retry after a failed viewport fetch — reset the throttle/bounds cache
    // so the retry actually refetches instead of being skipped
    const handleViewportRetry = useCallback(() => {
        lastFetchRef.current = 0
        lastFetchBoundsRef.current = null
        loadVisiblePosts()
    }, [loadVisiblePosts])

    // Keep a stable reference so the deferred throttle retry always calls
    // the latest version of loadVisiblePosts
    useEffect(() => {
        loadVisiblePostsRef.current = loadVisiblePosts
    }, [loadVisiblePosts])

    // Clear pending fetch timers on unmount
    useEffect(() => {
        return () => {
            if (throttleRetryRef.current)
                clearTimeout(throttleRetryRef.current)
        }
    }, [])

    // Coverage toggle
    const cycleCoverageMode = useCallback(() => {
        setCoverageMode((prev) => {
            if (prev === 'off') return 'global'
            if (prev === 'global') return 'personal'
            return 'off'
        })
    }, [])

    // Handle map movement (settle handler). Originally wired to onMapIdle,
    // but that event never fires in @rnmapbox/maps 10.2.x on this setup —
    // verified in production logs: after the switch to onMapIdle, every
    // viewport fetch for three days came from the initial camera only, and
    // pans/zooms never refetched. Now driven by debounced onCameraChanged
    // (below): per-frame camera events only reset a timer, and this runs
    // once ~400ms after movement stops — same idle semantics, and still no
    // per-frame state updates or fetches.
    const handleMapIdle = useCallback(
        (state: MapState) => {
            if (isSearchModeRef.current) return
            if (!isMapReadyRef.current) return

            // Track zoom level for coverage precision switching
            const { zoom, bounds, center } = state.properties
            if (zoom !== undefined) {
                setCurrentZoom(zoom)
            }

            // Remember where the user left the map — the next launch mounts
            // here instead of waiting on a location fix. Fire-and-forget:
            // display-layer only.
            if (center && zoom !== undefined) {
                AsyncStorage.setItem(
                    STORED_CAMERA_KEY,
                    JSON.stringify({ lng: center[0], lat: center[1], zoom })
                ).catch(() => {})
            }

            // Update bounds for coverage queries
            if (bounds) {
                setCurrentBounds({
                    north: Math.max(bounds.ne[1], bounds.sw[1]),
                    south: Math.min(bounds.ne[1], bounds.sw[1]),
                    east: Math.max(bounds.ne[0], bounds.sw[0]),
                    west: Math.min(bounds.ne[0], bounds.sw[0]),
                })
            }
            loadVisiblePosts()
        },
        [loadVisiblePosts]
    )

    // Debounce camera events into a single settle call. Cleared on unmount.
    const cameraSettleTimerRef = useRef<ReturnType<typeof setTimeout>>(
        undefined
    )
    const handleCameraChanged = useCallback(
        (state: MapState) => {
            if (cameraSettleTimerRef.current) {
                clearTimeout(cameraSettleTimerRef.current)
            }
            cameraSettleTimerRef.current = setTimeout(
                () => handleMapIdle(state),
                400
            )
        },
        [handleMapIdle]
    )
    useEffect(() => {
        return () => {
            if (cameraSettleTimerRef.current) {
                clearTimeout(cameraSettleTimerRef.current)
            }
        }
    }, [])

    // onDidFinishLoadingMap callback
    const handleMapReady = useCallback(() => {
        isMapReadyRef.current = true
        // Execute any queued camera action
        if (pendingCameraActionRef.current) {
            pendingCameraActionRef.current()
            pendingCameraActionRef.current = null
        }
        // Trigger initial fetch once the map is ready
        if (!effectiveListId && !initialFetchDoneRef.current) {
            initialFetchDoneRef.current = true
            lastFetchRef.current = 0
            loadVisiblePosts()
        }
    }, [effectiveListId, loadVisiblePosts])

    // Hide blocked users' posts everywhere on the map (pins + bottom sheet).
    // Filtered reactively so a new block takes effect without a re-fetch.
    const blockedSet = React.useMemo(
        () => new Set(blockedUserIds),
        [blockedUserIds]
    )

    // Memoize sorted posts to avoid infinite render loop
    const sortedVisiblePosts = React.useMemo(() => {
        const unblocked =
            blockedSet.size === 0
                ? visiblePosts
                : visiblePosts.filter((p) => !blockedSet.has(p.authorId))
        return applySorting(unblocked, activeFilter)
    }, [visiblePosts, activeFilter, applySorting, blockedSet])

    const filteredSearchResults = React.useMemo(() => {
        if (blockedSet.size === 0) return searchPostResults
        return searchPostResults.filter((p) => !blockedSet.has(p.authorId))
    }, [searchPostResults, blockedSet])

    // Handle filter change
    const handleFilterChange = useCallback((filter: FilterType) => {
        setActiveFilter(filter)
    }, [])

    // Handle jump to location from bottom sheet
    const handleJumpToLocation = useCallback(
        (latitude: number, longitude: number) => {
            if (cameraRef.current) {
                cameraRef.current.setCamera({
                    centerCoordinate: [longitude, latitude],
                    zoomLevel: 16,
                    animationDuration: 800,
                })
            }
        },
        []
    )
    // Handle post press from bottom sheet
    const handlePostPress = useCallback(
        (postId: string) => {
            const posts = isSearchMode
                ? filteredSearchResults
                : sortedVisiblePosts
            const post = posts.find((p) => p.id === postId)
            if (post) {
                setSelectedPost(post)
                setShowThreadModal(true)
            }
        },
        [isSearchMode, filteredSearchResults, sortedVisiblePosts]
    )

    // Convert posts to GeoJSON for Mapbox (memoized to avoid recalculating on every render)
    const geoJSONData = React.useMemo(() => {
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
                    isLostPlace: isLostPlace(post),
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
    }, [sortedVisiblePosts, selectedPostId, user?.uid, caughtThreadIds])

    const handleMarkerPress = useCallback(
        (event: any) => {
            const feature = event.features?.[0]
            if (!feature) return

            const postId = feature.properties?.postId
            if (!postId) return

            setSelectedPostId(postId)
            handlePostPress(postId)
        },
        [handlePostPress]
    )

    // Proximity whisper: passing near a lost place gets one quiet line.
    // Foreground-only by design — computed from pins already on screen
    // and the map's own location fix; no background location, ever.
    // Singular and unnumbered ("a lost place", never "3 lost places") —
    // an invitation to notice, not a count.
    const WHISPER_RADIUS_METERS = 250
    const [whisperPost, setWhisperPost] = useState<Post | null>(null)
    const whisperedPinsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        if (!userLocation || isSearchMode || isListMode || whisperPost) return
        const { latitude, longitude } = userLocation.coords
        const staleCutoff =
            Date.now() - LOST_PLACE_INACTIVITY_DAYS * 86400000

        let nearest: Post | null = null
        let nearestDist = Infinity
        for (const post of sortedVisiblePosts) {
            if (!post.latitude || !post.longitude) continue
            if (post.authorId === user?.uid) continue
            if (whisperedPinsRef.current.has(post.id)) continue
            if (!isLostPlace(post)) continue
            // isLostPlace also flags brand-new 0-catch posts; a whisper
            // is about a record gone quiet, so require real staleness
            const lastActivity: any = post.lastCaughtAt ?? post.createdAt
            const lastMs =
                lastActivity?.toMillis?.() ??
                (lastActivity?.toDate
                    ? lastActivity.toDate().getTime()
                    : new Date(lastActivity).getTime())
            if (!lastMs || isNaN(lastMs) || lastMs > staleCutoff) continue

            const d = calculateDistance(
                latitude,
                longitude,
                post.latitude,
                post.longitude
            )
            if (d <= WHISPER_RADIUS_METERS && d < nearestDist) {
                nearest = post
                nearestDist = d
            }
        }
        if (nearest) {
            // Once per pin per session, even if dismissed untapped
            whisperedPinsRef.current.add(nearest.id)
            setWhisperPost(nearest)
        }
    }, [
        userLocation,
        sortedVisiblePosts,
        isSearchMode,
        isListMode,
        whisperPost,
        user?.uid,
    ])

    // Stable handler — an inline ShapeSource onPress is a new function each
    // render, which re-sends the prop across the bridge
    // Tap a bubble. Merged bubbles (Mapbox cluster of several cells) zoom
    // to their expansion level so they split apart; a single cell bubble
    // zooms straight to the cell's extent so its contents separate into
    // pins in one tap (AllTrails-style). A p5 cell (~4.9km) fits at
    // ~zoom 12, p6 (~1.2km) at ~zoom 14 — both above PIN_MIN_ZOOM, so
    // pins load immediately and native pin clustering handles the rest.
    const handleBubblePress = useCallback(async (event: any) => {
        const feature = event.features?.[0]
        if (!feature || !cameraRef.current) return

        if (feature.properties?.cluster) {
            const expansionZoom =
                await bubblesSourceRef.current?.getClusterExpansionZoom(
                    feature
                )
            if (expansionZoom) {
                cameraRef.current.setCamera({
                    centerCoordinate: (feature.geometry as any).coordinates,
                    zoomLevel: expansionZoom,
                    animationDuration: 600,
                })
            }
            return
        }

        const geohash = feature.properties?.geohash
        if (geohash) {
            const [minLat, minLon, maxLat, maxLon] =
                decodeGeohashBBox(geohash)
            cameraRef.current.fitBounds(
                [maxLon, maxLat],
                [minLon, minLat],
                60,
                600
            )
        }
    }, [])

    const handleShapeSourcePress = useCallback(
        async (event: any) => {
            const feature = event.features?.[0]
            if (!feature) return

            const isCluster = feature.properties?.cluster
            if (isCluster) {
                const expansionZoom =
                    await shapeSourceRef.current?.getClusterExpansionZoom(
                        feature
                    )

                if (expansionZoom && cameraRef.current) {
                    cameraRef.current.setCamera({
                        centerCoordinate: (feature.geometry as any)
                            .coordinates,
                        zoomLevel: expansionZoom,
                        animationDuration: 500,
                    })
                }
            } else {
                handleMarkerPress(event)
            }
        },
        [handleMarkerPress]
    )

    const handleThreadModalClose = () => {
        setShowThreadModal(false)
        setTimeout(() => {
            setSelectedPost(null)
            setSelectedPostId(null)
        }, 300)
    }

    const handlePostUpdate = (updatedPost: Post) => {
        setVisiblePosts((prev) =>
            prev.map((p) => (p.id === updatedPost.id ? updatedPost : p))
        )
    }

    const handlePostDelete = (postId: string) => {
        setVisiblePosts((prev) => prev.filter((p) => p.id !== postId))
        setShowThreadModal(false)
        setSelectedPost(null)
        setSelectedPostId(null)
    }

    // The app's chrome is dark-only (root layout pins DarkTheme) — a light
    // basemap under dark UI is exactly the clash the document restyle
    // removes, so the map is dark in both device schemes. Swap for the
    // custom paper-toned Studio style (MAPBOX_STUDIO_STYLE.md) once
    // published.
    const mapStyle = 'mapbox://styles/mapbox/dark-v11'

    const handleSearchClear = useCallback(() => {
        isSearchModeRef.current = false
        setIsSearchMode(false)
        setSearchPostResults([])
        setActiveSearchQuery('')
        router.setParams({ searchQuery: '' })
        // Resume normal map behavior. Reset the throttle/bounds cache first
        // (like handleViewportRetry) — the search overwrote visiblePosts, so
        // if the camera didn't move, an unreset reload would be skipped as
        // "same viewport" and leave the sheet stuck on the search results
        // (an empty search = "No shots in this area" over a full map).
        lastFetchRef.current = 0
        lastFetchBoundsRef.current = null
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

            {whisperPost && (
                <LostPlaceWhisper
                    // Below the HUD island (search bar + filter pills)
                    top={insets.top + 132}
                    message={`A lost place is near you — last photographed ${monthYear(whisperPost.lastCaughtAt ?? whisperPost.createdAt)}.`}
                    onPress={() => {
                        const target = whisperPost
                        setWhisperPost(null)
                        setSelectedPostId(target.id)
                        handlePostPress(target.id)
                    }}
                    onDismiss={() => setWhisperPost(null)}
                />
            )}

            {locationDenied && !browseWithoutLocation ? (
                // Location denied: explain and offer recovery instead of
                // silently dropping the user onto a default city
                <View style={styles.map}>
                    <View style={styles.locationDeniedContainer}>
                        <Ionicons
                            name="location-outline"
                            size={56}
                            color={colors.textTertiary}
                        />
                        <Text
                            style={styles.locationDeniedTitle}
                            accessibilityRole="header"
                        >
                            Turn on location to explore nearby
                        </Text>
                        <Text style={styles.locationDeniedText}>
                            The map shows real shots taken around you, and
                            catching one requires being at the spot. Your
                            location is never shown to other people.
                        </Text>
                        <TouchableOpacity
                            style={styles.locationDeniedPrimaryButton}
                            onPress={() => Linking.openSettings()}
                            accessibilityLabel="Open settings"
                            accessibilityRole="button"
                            accessibilityHint="Opens system settings for this app"
                        >
                            <Ionicons
                                name="settings-outline"
                                size={18}
                                color={colors.inverseTextPrimary}
                            />
                            <Text
                                style={styles.locationDeniedPrimaryButtonText}
                            >
                                Open Settings
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.locationDeniedSecondaryButton}
                            onPress={requestLocation}
                            accessibilityLabel="Try again"
                            accessibilityRole="button"
                        >
                            <Text
                                style={styles.locationDeniedSecondaryButtonText}
                            >
                                I&apos;ve enabled it — try again
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => setBrowseWithoutLocation(true)}
                            accessibilityLabel="Browse the map without location"
                            accessibilityRole="button"
                        >
                            <Text style={styles.locationDeniedLink}>
                                Browse the map without location
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : storedCamera === undefined ? (
                // AsyncStorage read is a few ms — blank placeholder for that
                // flash only, so Camera defaultSettings (mount-once) sees the
                // resolved value
                <View style={styles.map} />
            ) : (
                <MapView
                    ref={mapRef}
                    style={styles.map}
                    styleURL={mapStyle}
                    accessibilityLabel="Map showing photo locations"
                    logoEnabled={false}
                    scaleBarEnabled={false}
                    // Gesture feel tuned toward Google Maps. Most values pin
                    // Mapbox defaults explicitly so an SDK default change
                    // can't silently alter the feel.
                    gestureSettings={{
                        // Compound pinch: zoom around fingers while panning
                        // and rotating in one continuous gesture
                        pinchPanEnabled: true,
                        pinchZoomEnabled: true,
                        simultaneousRotateAndPinchZoomEnabled: true,
                        // Google's zoom vocabulary: double-tap +1 level,
                        // two-finger tap -1, double-tap-and-drag to zoom
                        doubleTapToZoomInEnabled: true,
                        doubleTouchToZoomOutEnabled: true,
                        quickZoomEnabled: true,
                        zoomAnimationAmount: 1.0, // Android: exactly one level per tap
                        rotateEnabled: true,
                        pitchEnabled: true,
                        panEnabled: true,
                        // Momentum after pinch/rotate ends (Android-only
                        // flags; iOS always decays)
                        pinchZoomDecelerationEnabled: true,
                        rotateDecelerationEnabled: true,
                        // iOS pan-fling friction: 0.998 = UIScrollView
                        // "normal" glide. Drop toward 0.99 (= .fast) if short
                        // flicks travel too far. Android: >0 just enables
                        // fling; friction isn't tunable via RN.
                        panDecelerationFactor: 0.998,
                    }}
                    // FPS cap, not booster — 120 unlocks ProMotion on iOS
                    // and is harmless above a display's refresh rate
                    preferredFramesPerSecond={120}
                    compassEnabled={true}
                    // Always visible (not just when rotated) so there's a
                    // persistent tap target to reorient north-up
                    compassFadeWhenNorth={false}
                    compassViewPosition={1} // 1 = Top Right
                    // Compass at top relative to map, BELOW HUD.
                    // HUD ~110px. Increasing spacing per user request.
                    compassViewMargins={{ x: 16, y: insets.top + 180 }}
                    onCameraChanged={handleCameraChanged}
                    onDidFinishLoadingMap={handleMapReady}
                >
                    {/* defaultSettings applies once on mount only. Controlled
                        zoomLevel/centerCoordinate props get re-sent to native
                        on every parent re-render (new array identity), which
                        can yank the camera back mid-pan. */}
                    <Camera
                        ref={cameraRef}
                        defaultSettings={{
                            // Last session's camera when we have it; without
                            // one, start on a world view rather than implying
                            // a specific place. The one-time correction
                            // effect flies to the user once located.
                            zoomLevel: storedCamera ? storedCamera.zoom : 1.5,
                            centerCoordinate: storedCamera
                                ? [storedCamera.lng, storedCamera.lat]
                                : [0, 20],
                        }}
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

                    {/* Coverage layer - shown when zoomed out with coverage mode active */}
                    {showCoverage && (
                        <ShapeSource
                            id="coverage-source"
                            shape={coverageGeoJSON!}
                        >
                            <FillLayer
                                id="coverage-fill"
                                style={{
                                    // Muted-ink wash: coverage is context,
                                    // not content — it should sit under
                                    // the pins, not compete with them
                                    fillColor:
                                        coverageMode === 'personal'
                                            ? 'rgba(196, 104, 224, 0.18)'
                                            : [
                                                  'interpolate',
                                                  ['linear'],
                                                  ['get', 'postCount'],
                                                  1,
                                                  'rgba(90, 147, 212, 0.06)',
                                                  10,
                                                  'rgba(90, 147, 212, 0.14)',
                                                  50,
                                                  'rgba(90, 147, 212, 0.22)',
                                                  200,
                                                  'rgba(90, 147, 212, 0.32)',
                                              ],
                                    fillOutlineColor:
                                        coverageMode === 'personal'
                                            ? 'rgba(196, 104, 224, 0.3)'
                                            : 'rgba(90, 147, 212, 0.2)',
                                }}
                            />
                        </ShapeSource>
                    )}

                    {/* Cluster bubbles - counts from geohash_cells at zooms
                        below the pin threshold (no pin fetch runs there).
                        Mapbox-clustered so nearby cells merge into one
                        bubble as you zoom out (totalCount sums their
                        originals); singles keep their own count. */}
                    {!isSearchMode && !isListMode && bubblesGeoJSON && (
                        <ShapeSource
                            id="bubbles-source"
                            ref={bubblesSourceRef}
                            shape={bubblesGeoJSON}
                            onPress={handleBubblePress}
                            cluster
                            clusterRadius={50}
                            clusterProperties={{
                                totalCount: ['+', ['get', 'count']],
                            }}
                        >
                            <CircleLayer
                                id="bubbles-layer"
                                style={{
                                    circlePitchAlignment: 'map',
                                    circleColor: MAP_COLORS.pin,
                                    circleOpacity: 0.6,
                                    circleRadius: [
                                        'interpolate',
                                        ['linear'],
                                        [
                                            'coalesce',
                                            ['get', 'totalCount'],
                                            ['get', 'count'],
                                        ],
                                        1,
                                        14,
                                        10,
                                        18,
                                        50,
                                        22,
                                        200,
                                        26,
                                    ],
                                    circleStrokeWidth: 1.5,
                                    circleStrokeColor: MAP_COLORS.stroke,
                                }}
                            />
                            <SymbolLayer
                                id="bubbles-count"
                                style={{
                                    textField: [
                                        'to-string',
                                        [
                                            'coalesce',
                                            ['get', 'totalCount'],
                                            ['get', 'count'],
                                        ],
                                    ],
                                    textSize: 13,
                                    textColor: '#ffffff',
                                    textPitchAlignment: 'map',
                                    textAllowOverlap: true,
                                }}
                            />
                        </ShapeSource>
                    )}

                    {/* Pin markers - hidden when coverage is active at low zoom */}
                    {!showCoverage && (
                        <ShapeSource
                            id="posts-source"
                            ref={shapeSourceRef}
                            shape={geoJSONData}
                            onPress={handleShapeSourcePress}
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
                                    circleOpacity: 0.6,
                                    circleStrokeWidth: 1.5,
                                    circleStrokeColor: MAP_COLORS.stroke,
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
                                        // Gold "lost place" pins disabled for now — re-enable by
                                        // adding back: ['get', 'isLostPlace'], MAP_COLORS.pinLostPlace,
                                        MAP_COLORS.pin,
                                    ],
                                    circleRadius: [
                                        'case',
                                        ['get', 'isSelected'],
                                        12,
                                        10,
                                    ],
                                    circleStrokeWidth: 1.5,
                                    circleStrokeColor: MAP_COLORS.stroke,
                                }}
                            />
                        </ShapeSource>
                    )}
                </MapView>
            )}

            {/* Center on location button - Below Compass */}
            {userLocation && (
                <TouchableOpacity
                    // Compass at ~180 + ~40 height = 220 + gap = 240
                    style={[styles.centerButton, { top: insets.top + 240 }]}
                    onPress={centerOnUserLocation}
                    activeOpacity={0.7}
                    accessibilityLabel="Center on my location"
                    accessibilityRole="button"
                    accessibilityHint="Pan the map to your current location"
                >
                    <Ionicons
                        name="locate"
                        size={24}
                        color={colors.textPrimary}
                    />
                </TouchableOpacity>
            )}

            {/* Coverage toggle button */}
            <TouchableOpacity
                style={[styles.coverageButton, { top: insets.top + 300 }]}
                onPress={cycleCoverageMode}
                activeOpacity={0.7}
                accessibilityLabel={`Coverage mode: ${coverageMode}`}
                accessibilityRole="button"
                accessibilityHint="Cycle between off, global, and personal coverage views"
            >
                <Ionicons
                    name={coverageMode === 'off' ? 'grid-outline' : 'grid'}
                    size={22}
                    color={
                        coverageMode === 'off'
                            ? colors.textPrimary
                            : coverageMode === 'global'
                              ? colors.primary
                              : colors.secondary
                    }
                />
            </TouchableOpacity>
            {coverageMode !== 'off' && (
                <View style={[styles.coverageLabel, { top: insets.top + 352 }]}>
                    <Text style={styles.coverageLabelText}>
                        {coverageMode === 'global' ? 'Global' : 'My Coverage'}
                    </Text>
                </View>
            )}

            {/* Bottom Sheet */}
            {(!locationDenied || browseWithoutLocation) && (
                <MapBottomSheet
                    posts={
                        isSearchMode
                            ? filteredSearchResults
                            : sortedVisiblePosts
                    }
                    loading={isSearchMode ? searchLoading : loadingPosts}
                    error={!isSearchMode && viewportError}
                    onRetry={handleViewportRetry}
                    onPostPress={handlePostPress}
                    onJumpToLocation={handleJumpToLocation}
                    selectedPostId={selectedPostId}
                    title={
                        isSearchMode
                            ? `"${activeSearchQuery}"`
                            : activeList?.name
                    }
                    subtitle={
                        isSearchMode
                            ? `${filteredSearchResults.length} shot${filteredSearchResults.length !== 1 ? 's' : ''} found`
                            : undefined
                    }
                    emptyTitle={
                        isSearchMode
                            ? `No shots match "${activeSearchQuery}"`
                            : isListMode
                              ? 'No shots in this list'
                              : zoomedTooFarOut
                                ? 'Viewing from above'
                                : undefined
                    }
                    emptySubtitle={
                        isSearchMode
                            ? 'Try different words, like "sunset viewpoint" or "street art"'
                            : isListMode
                              ? 'Shots added to this list will show up here'
                              : zoomedTooFarOut
                                ? 'Tap a cluster or zoom in to see shots'
                                : undefined
                    }
                    onClose={isSearchMode ? handleSearchClear : handleListClose}
                    isListMode={isListMode || isSearchMode}
                    // Belt to the derived isListMode: the zoomed-out header
                    // must never surface while a list or search is open
                    zoomedOut={!isListMode && !isSearchMode && zoomedTooFarOut}
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
        </View>
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
        color: colors.inverseTextPrimary,
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
    locationDeniedContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
        padding: 32,
        gap: 12,
    },
    locationDeniedTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    locationDeniedText: {
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 8,
    },
    locationDeniedPrimaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: colors.primary,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 32,
        alignSelf: 'stretch',
    },
    locationDeniedPrimaryButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.inverseTextPrimary,
    },
    locationDeniedSecondaryButton: {
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 32,
        alignSelf: 'stretch',
        alignItems: 'center',
    },
    locationDeniedSecondaryButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary,
    },
    locationDeniedLink: {
        fontSize: 14,
        color: colors.textTertiary,
        textDecorationLine: 'underline',
        marginTop: 8,
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
    coverageButton: {
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
    coverageLabel: {
        position: 'absolute',
        right: 16,
        width: 48,
        alignItems: 'center',
        zIndex: 15,
    },
    coverageLabelText: {
        fontSize: 9,
        fontWeight: '600',
        color: colors.textSecondary,
        textAlign: 'center',
    },
})
