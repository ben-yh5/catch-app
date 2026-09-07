/**
 * ThreadModal - Full-screen modal for viewing post threads
 *
 * This is the primary post viewing interface, showing:
 * - Horizontal swipeable gallery of all posts in a thread (original + catches)
 * - Interactive timeline visualization with progress dots
 * - Post metadata (author, caption, date, catch count)
 * - Actions: Catch, Add to List, Share, Delete (own posts only)
 *
 * Key Features:
 * - Starts at initialPostId if provided, otherwise shows root post
 * - "Catch This Location" always catches the ROOT post (not current slide)
 * - Timeline shows thread progression with filled/unfilled dots
 * - Deleting root post promotes oldest catch to new root (handled by Cloud Function)
 *
 * Thread Structure:
 * - Root post: isOriginal=true, rootPostId=null
 * - Catches: isOriginal=false, rootPostId=<root_id>
 */

import CatchRevealModal from '@/components/CatchRevealModal'
import ReportBottomSheet from '@/components/ReportBottomSheet'
import CatchBadge from '@/components/ui/CatchBadge'
import CaughtBadge from '@/components/ui/CaughtBadge'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { useCatchFlow } from '@/hooks/useCatchFlow'
import { db, functions } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { formatPostDate } from '@/utils/dateUtils'
import { Post } from '@/types'
import { isPostSaved } from '@/utils/listUtils'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import * as Linking from 'expo-linking'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import React, { useEffect, useRef, useState } from 'react'
import {
    Alert,
    FlatList, // Renamed to avoid conflict with expo-linking
    Modal,
    Platform,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ViewToken,
    useWindowDimensions,
} from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ListSelectionBottomSheet from './ListSelectionBottomSheet'
import UnifiedCameraView from './UnifiedCameraView'
import UnifiedPreviewScreen from './UnifiedPreviewScreen'
import { ThreadModalSkeleton } from './ui/Skeleton'

interface ThreadModalProps {
    visible: boolean
    post: Post | null // The post that was tapped (could be original or a catch)
    onClose: () => void
    onPostUpdate?: (updatedPost: Post) => void
    onPostDelete?: (postId: string) => void
    initialPostId?: string // If provided, start the gallery at this post
}

export default function ThreadModal({
    visible,
    post,
    onClose,
    onPostUpdate,
    onPostDelete,
    initialPostId,
}: ThreadModalProps) {
    const { user } = useAuth()
    const { notifyPostEvent } = usePost()
    const { showToast } = useToast()
    const router = useRouter()
    const insets = useSafeAreaInsets()

    // Thread state
    const [threadPosts, setThreadPosts] = useState<Post[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)
    const [loadingThread, setLoadingThread] = useState(true)
    const flatListRef = useRef<FlatList>(null)

    // UI state
    const [isSaved, setIsSaved] = useState(false)
    const [showOptionsMenu, setShowOptionsMenu] = useState(false)
    const [showAddToListModal, setShowAddToListModal] = useState(false)
    const [showReportSheet, setShowReportSheet] = useState(false)

    // Location state
    const [postLocation, setPostLocation] = useState<{
        latitude: number
        longitude: number
        heading?: number
        pitch?: number
    } | null>(null)
    const [distance, setDistance] = useState<number | null>(null)

    // Hook-based catch flow
    const {
        catchMode,
        catchPreviewMode,
        catchImageUri,
        fetchingLocation,
        uploading,
        uploadProgress,
        statusMessage,
        issues,
        handleCatchPress,
        handlePhotoTaken,
        handleCameraCancel,
        handleConfirmCatch,
        handlePreviewCancel,
        handleRetake,
        revealData,
        dismissReveal,
    } = useCatchFlow({
        rootPost: threadPosts[0] || null,
        postLocation,
        onSuccess: (newPost) => {
            const updatedThreadPosts = threadPosts.map((p, i) =>
                i === 0 ? { ...p, catchCount: (p.catchCount || 0) + 1 } : p
            )
            updatedThreadPosts.push(newPost)
            setThreadPosts(updatedThreadPosts)

            // Update parent state
            onPostUpdate?.({
                ...threadPosts[0],
                catchCount: (threadPosts[0].catchCount || 0) + 1,
            })

            // Navigate to new catch
            requestAnimationFrame(() => {
                const newIndex = updatedThreadPosts.length - 1
                setCurrentIndex(newIndex)
                flatListRef.current?.scrollToIndex({
                    index: newIndex,
                    animated: true,
                })
            })
        },
    })

    // Get the currently displayed post
    const currentPost = threadPosts[currentIndex] || null

    // Fetch all posts in the thread
    useEffect(() => {
        if (visible && post) {
            fetchThread()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, post])

    // Scroll to initial post when thread first loads (once per open —
    // later threadPosts changes like delete/catch manage their own scrolling)
    const hasScrolledToInitial = useRef(false)
    const navigatingToProfile = useRef(false)
    useEffect(() => {
        if (!visible) {
            hasScrolledToInitial.current = false
            navigatingToProfile.current = false
        }
    }, [visible])
    useEffect(() => {
        if (threadPosts.length === 0 || hasScrolledToInitial.current) return
        hasScrolledToInitial.current = true

        if (initialPostId) {
            const index = threadPosts.findIndex((p) => p.id === initialPostId)
            if (index >= 0 && flatListRef.current) {
                requestAnimationFrame(() => {
                    if (index < threadPosts.length) {
                        flatListRef.current?.scrollToIndex({
                            index,
                            animated: false,
                        })
                        setCurrentIndex(index)
                    }
                })
            }
        }
    }, [threadPosts, initialPostId])

    // Update save status when current post changes
    useEffect(() => {
        if (currentPost && user) {
            fetchSaveStatus()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPost?.id, user])

    // Fetch location data when root post changes
    useEffect(() => {
        if (visible && threadPosts.length > 0) {
            const rootPost = threadPosts[0]
            if (rootPost?.hasLocation) {
                fetchPostLocationAndDistance(rootPost.id)
            } else {
                setPostLocation(null)
                setDistance(null)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, threadPosts])

    const fetchThread = async () => {
        if (!post) return

        setLoadingThread(true)
        try {
            // Determine the root post ID
            let rootId = post.rootPostId || post.id

            // Fetch the root post
            let rootDoc = await getDoc(doc(db, 'posts', rootId))

            if (!rootDoc.exists() && rootId !== post.id) {
                // The root was deleted and the thread may have been re-rooted
                // by the Cloud Function. Re-fetch the tapped post to pick up
                // its new rootPostId (or its own promotion to root).
                const selfDoc = await getDoc(doc(db, 'posts', post.id))
                if (selfDoc.exists()) {
                    const freshPost = selfDoc.data() as Post
                    rootId = freshPost.rootPostId || post.id
                    rootDoc =
                        rootId === post.id
                            ? selfDoc
                            : await getDoc(doc(db, 'posts', rootId))
                }
            }

            // Callers may pass a bare { id } stub so the modal can open the
            // same frame the row is tapped (e.g. notification rows). If the
            // doc we landed on is itself a catch, follow its root pointer so
            // the full thread loads.
            if (rootDoc.exists()) {
                const fetchedRootId = (rootDoc.data() as Post).rootPostId
                if (fetchedRootId && fetchedRootId !== rootDoc.id) {
                    rootId = fetchedRootId
                    rootDoc = await getDoc(doc(db, 'posts', rootId))
                }
            }

            if (!rootDoc.exists()) {
                showToast('error', 'This shot is no longer available')
                onClose()
                return
            }

            const posts: Post[] = [
                {
                    id: rootDoc.id,
                    ...rootDoc.data(),
                } as Post,
            ]

            // Fetch all catches in this thread
            const catchesQuery = query(
                collection(db, 'posts'),
                where('rootPostId', '==', rootId),
                orderBy('createdAt', 'asc')
            )

            const catchesSnapshot = await getDocs(catchesQuery)
            catchesSnapshot.forEach((doc) => {
                posts.push({
                    id: doc.id,
                    ...doc.data(),
                } as Post)
            })

            setThreadPosts(posts)

            // Set initial index
            const startPostId = initialPostId || post.id
            const index = posts.findIndex((p) => p.id === startPostId)
            const validIndex = index >= 0 ? index : 0
            setCurrentIndex(validIndex)
        } catch (error) {
            console.error('Error fetching thread:', error)
            showToast('error', 'Failed to load shot details')
            onClose()
        } finally {
            setLoadingThread(false)
        }
    }

    const fetchSaveStatus = async () => {
        if (!user || !currentPost) return

        try {
            const saved = await isPostSaved(user.uid, currentPost.id)
            setIsSaved(saved)
        } catch (error) {
            console.error('Error fetching save status:', error)
        }
    }

    // Haversine formula to calculate distance between two coordinates
    const calculateDistance = (
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

    const fetchPostLocationAndDistance = async (postId: string) => {
        try {
            // Fetch post location from Cloud Function
            const getPostLocation = httpsCallable(functions, 'getPostLocation')
            const result = await getPostLocation({ postId })
            const locationData = result.data as {
                latitude: number
                longitude: number
                postId: string
                heading?: number
                pitch?: number
            }

            setPostLocation({
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                heading: locationData.heading,
                pitch: locationData.pitch,
            })

            // Get user's current location
            const { status } =
                await Location.requestForegroundPermissionsAsync()
            if (status === 'granted') {
                // detailed hanging
                let userLoc: Location.LocationObject | null = null
                try {
                    const locationPromise = Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    })
                    const timeoutPromise = new Promise<Location.LocationObject>(
                        (_, reject) => {
                            setTimeout(
                                () =>
                                    reject(
                                        new Error('Location request timed out')
                                    ),
                                5000
                            )
                        }
                    )
                    userLoc = await Promise.race([
                        locationPromise,
                        timeoutPromise,
                    ])
                } catch {
                    console.warn(
                        'Current location timed out, trying last known...'
                    )
                    userLoc = await Location.getLastKnownPositionAsync()
                }

                if (userLoc) {
                    // Calculate distance
                    const dist = calculateDistance(
                        userLoc.coords.latitude,
                        userLoc.coords.longitude,
                        locationData.latitude,
                        locationData.longitude
                    )
                    setDistance(Math.round(dist))
                }
            }
        } catch (error) {
            console.error('Error fetching post location:', error)
            setPostLocation(null)
            setDistance(null)
        }
    }

    const handleGetDirections = async () => {
        if (!postLocation) {
            showToast('warning', 'Location not available for this shot')
            return
        }

        const { latitude, longitude } = postLocation

        try {
            let url: string
            if (Platform.OS === 'ios') {
                // iOS - Open Apple Maps
                url = `maps://maps.apple.com/?daddr=${latitude},${longitude}`
            } else if (Platform.OS === 'android') {
                // Android - Open Google Maps with navigation
                url = `google.navigation:q=${latitude},${longitude}`
            } else {
                // Web fallback
                url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
            }

            const supported = await Linking.canOpenURL(url)
            if (supported) {
                await Linking.openURL(url)
            } else {
                // Fallback to web URL
                const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
                await Linking.openURL(webUrl)
            }
        } catch (error) {
            console.error('Error opening directions:', error)
            showToast('error', 'Could not open maps application')
        }
    }

    const handleLocateOnMap = () => {
        if (!currentPost) return

        onClose()
        // Navigate to map with postId
        router.push(`/(tabs)/map?postId=${currentPost.id}` as any)
    }

    const handleSavePress = () => {
        setShowAddToListModal(true)
        setShowOptionsMenu(false)
    }

    const handleShare = async () => {
        setShowOptionsMenu(false)
        if (!currentPost) return
        try {
            const caption = currentPost.caption
                ? `"${currentPost.caption}" — `
                : ''
            await Share.share({
                message: `${caption}a shot by @${currentPost.authorUsername} on Catch\n${currentPost.photoURL}`,
            })
        } catch (error) {
            console.error('Error sharing post:', error)
            showToast('error', "Couldn't share", 'Please try again.')
        }
    }

    const handleDeletePost = async () => {
        if (!user || !currentPost) return

        setShowOptionsMenu(false)

        const confirmDelete = await new Promise<boolean>((resolve) => {
            Alert.alert(
                'Delete Shot',
                currentPost.isOriginal && threadPosts.length > 1
                    ? 'This is the original shot. Deleting it will make the oldest catch the new start of this timeline. Continue?'
                    : 'Are you sure you want to delete this shot?',
                [
                    {
                        text: 'Cancel',
                        onPress: () => resolve(false),
                        style: 'cancel',
                    },
                    {
                        text: 'Delete',
                        onPress: () => resolve(true),
                        style: 'destructive',
                    },
                ]
            )
        })

        if (!confirmDelete) return

        try {
            const deletedPost = currentPost

            // Delete the post
            await deleteDoc(doc(db, 'posts', deletedPost.id))

            let newThreadPosts = threadPosts.filter(
                (p) => p.id !== deletedPost.id
            )

            if (newThreadPosts.length === 0) {
                // No more posts, close modal
                onPostDelete?.(deletedPost.id)
                notifyPostEvent('delete', deletedPost.id, deletedPost.authorId)
                onClose()
                return
            }

            if (deletedPost.isOriginal) {
                // Mirror the onPostDeleted Cloud Function: the oldest catch
                // is promoted to new root and remaining catches repointed
                const [promoted, ...rest] = newThreadPosts
                const newRoot: Post = {
                    ...promoted,
                    isOriginal: true,
                    parentPostId: null,
                    rootPostId: null,
                    catchCount: Math.max(
                        0,
                        (deletedPost.catchCount || 0) - 1
                    ),
                }
                newThreadPosts = [
                    newRoot,
                    ...rest.map((p) => ({
                        ...p,
                        rootPostId: newRoot.id,
                        parentPostId: newRoot.id,
                    })),
                ]
                onPostUpdate?.(newRoot)
            } else {
                // Catch deleted — decrement root's catch count
                const updatedRoot: Post = {
                    ...newThreadPosts[0],
                    catchCount: Math.max(
                        0,
                        (newThreadPosts[0].catchCount || 0) - 1
                    ),
                }
                newThreadPosts = [updatedRoot, ...newThreadPosts.slice(1)]
                onPostUpdate?.(updatedRoot)
            }

            const newIndex = Math.min(currentIndex, newThreadPosts.length - 1)
            setThreadPosts(newThreadPosts)
            setCurrentIndex(newIndex)

            // The paged FlatList keeps its old scroll offset when data
            // shrinks, which can point past the new content and leave the
            // gallery blank — snap it onto the surviving card
            requestAnimationFrame(() => {
                flatListRef.current?.scrollToIndex({
                    index: newIndex,
                    animated: false,
                })
            })

            showToast('success', 'Shot deleted')
            onPostDelete?.(deletedPost.id)
            notifyPostEvent('delete', deletedPost.id, deletedPost.authorId)
        } catch (error) {
            console.error('Error deleting post:', error)
            showToast('error', 'Failed to delete shot. Please try again.')
        }
    }

    // Shared formatter — a duplicate local version had drifted (different
    // null behavior from dateUtils)
    const formatDate = (timestamp: any) =>
        formatPostDate(timestamp) || 'Unknown date'

    const onViewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            if (viewableItems.length > 0 && viewableItems[0].index !== null) {
                setCurrentIndex(viewableItems[0].index)
            }
        }
    ).current

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 50,
    }).current

    const { width } = useWindowDimensions()
    const cardWidth = width - 20

    const keyExtractor = React.useCallback((item: Post) => item.id, [])

    const onScrollToIndexFailed = React.useCallback((info: any) => {
        setTimeout(() => {
            flatListRef.current?.scrollToIndex({
                index: info.index,
                animated: false,
            })
        }, 100)
    }, [])

    const getItemLayout = React.useCallback(
        (_: any, index: number) => ({
            length: cardWidth,
            offset: cardWidth * index,
            index,
        }),
        [cardWidth]
    )

    const renderGalleryItem = React.useCallback(
        ({ item }: { item: Post }) => (
            <View
                style={[
                    styles.galleryItem,
                    { width: cardWidth, height: cardWidth },
                ]}
            >
                <Image
                    source={{ uri: item.photoURL }}
                    style={styles.galleryImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    priority="high"
                    accessibilityLabel={`Photo by ${item.authorUsername || 'unknown user'}`}
                />
                {item.authorId === user?.uid && (
                    <CaughtBadge
                        containerStyle={styles.caughtBadgeOverlay}
                        size={24}
                    />
                )}
            </View>
        ),
        [cardWidth, user?.uid]
    )

    if (!post) return null

    // Camera mode
    if (catchMode) {
        const rootPost = threadPosts[0]
        return (
            <Modal
                visible={visible}
                animationType="none"
                transparent={true}
                onRequestClose={() => {
                    handleCameraCancel()
                    onClose()
                }}
            >
                <UnifiedCameraView
                    onPhotoTaken={handlePhotoTaken}
                    onCancel={handleCameraCancel}
                    originalPhotoUrl={rootPost?.photoURL}
                    targetLocation={postLocation}
                />
            </Modal>
        )
    }

    // Preview mode
    if (catchPreviewMode && catchImageUri) {
        const rootPost = threadPosts[0]
        return (
            <Modal
                visible={visible}
                animationType="none"
                transparent={true}
                onRequestClose={() => {
                    handlePreviewCancel()
                    onClose()
                }}
            >
                <UnifiedPreviewScreen
                    imageUri={catchImageUri}
                    onConfirm={handleConfirmCatch}
                    onCancel={handlePreviewCancel}
                    mode="catch"
                    loading={uploading}
                    loadingText={statusMessage || 'Creating catch...'}
                    originalPhotoUrl={rootPost?.photoURL}
                    hasLocation={true}
                    loadingLocation={fetchingLocation}
                    issues={issues}
                    onRetake={handleRetake}
                    uploadProgress={uploadProgress}
                />
            </Modal>
        )
    }

    return (
        <Modal
            visible={visible}
            animationType="none"
            transparent={true}
            onRequestClose={() => {
                // Hardware back closes the options menu first (it used to be
                // its own nested Modal with its own back handling)
                if (showOptionsMenu) {
                    setShowOptionsMenu(false)
                    return
                }
                onClose()
            }}
        >
            {/* RN Modal's built-in fade is a fixed ~300ms; animate the content
                ourselves so opening feels immediate */}
            <Animated.View
                entering={FadeIn.duration(150)}
                style={styles.modalOverlay}
            >
                <View
                    style={[
                        styles.modalContent,
                        { paddingTop: insets.top + 10 },
                    ]}
                >
                    {loadingThread ? (
                        <ThreadModalSkeleton />
                    ) : (
                        <View style={styles.contentContainer}>
                            {/* Post Card */}
                            <View style={styles.postCard}>
                                {/* Card Header */}
                                <View style={styles.cardHeader}>
                                    <View style={styles.cardHeaderLeft}>
                                        <TouchableOpacity
                                            style={styles.backButtonInCard}
                                            onPress={() => {
                                                setShowOptionsMenu(false)
                                                onClose()
                                            }}
                                            accessibilityLabel="Close"
                                            accessibilityRole="button"
                                        >
                                            {/* 'close', not 'arrow-back' —
                                                this dismisses a modal, it
                                                doesn't navigate back */}
                                            <Ionicons
                                                name="close"
                                                size={24}
                                                color={colors.textPrimary}
                                            />
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => {
                                                setShowOptionsMenu(false)
                                                if (
                                                    !currentPost ||
                                                    navigatingToProfile.current
                                                )
                                                    return
                                                navigatingToProfile.current =
                                                    true
                                                // Push first: the modal stays
                                                // up covering the transition
                                                // (closing immediately would
                                                // flash the tab beneath), then
                                                // closes once the profile has
                                                // slid in under it
                                                router.push({
                                                    pathname: '/user-profile',
                                                    params: {
                                                        userId: currentPost.authorId,
                                                    },
                                                })
                                                setTimeout(onClose, 400)
                                            }}
                                            accessibilityLabel={`@${currentPost?.authorUsername || 'unknown'}`}
                                            accessibilityRole="link"
                                            accessibilityHint="View profile"
                                        >
                                            <Text style={styles.cardUsername}>
                                                @
                                                {currentPost?.authorUsername ||
                                                    '...'}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                    <View style={styles.cardHeaderRight}>
                                        <CatchBadge
                                            count={
                                                threadPosts[0]?.catchCount || 0
                                            }
                                            containerStyle={styles.catchBadge}
                                        />
                                        <TouchableOpacity
                                            onPress={handleSavePress}
                                            style={styles.headerIconButton}
                                            accessibilityLabel={
                                                isSaved
                                                    ? 'Remove from list'
                                                    : 'Save to list'
                                            }
                                            accessibilityRole="button"
                                        >
                                            <Ionicons
                                                name={
                                                    isSaved
                                                        ? 'bookmark'
                                                        : 'bookmark-outline'
                                                }
                                                size={22}
                                                color={
                                                    isSaved
                                                        ? colors.iconActive
                                                        : colors.iconInactive
                                                }
                                            />
                                        </TouchableOpacity>
                                        <View style={{ zIndex: 10 }}>
                                            <TouchableOpacity
                                                onPress={() =>
                                                    setShowOptionsMenu(
                                                        !showOptionsMenu
                                                    )
                                                }
                                                style={styles.headerIconButton}
                                                accessibilityLabel="Options menu"
                                                accessibilityRole="button"
                                                accessibilityState={{
                                                    expanded: showOptionsMenu,
                                                }}
                                            >
                                                <Ionicons
                                                    name="ellipsis-horizontal"
                                                    size={22}
                                                    color={colors.textPrimary}
                                                />
                                            </TouchableOpacity>

                                        </View>
                                    </View>
                                </View>

                                {/* Image Gallery */}
                                <FlatList
                                    ref={flatListRef}
                                    data={threadPosts}
                                    renderItem={renderGalleryItem}
                                    keyExtractor={keyExtractor}
                                    horizontal
                                    pagingEnabled
                                    showsHorizontalScrollIndicator={false}
                                    onViewableItemsChanged={
                                        onViewableItemsChanged
                                    }
                                    viewabilityConfig={viewabilityConfig}
                                    getItemLayout={getItemLayout}
                                    style={{
                                        width: width - 20,
                                        height: width - 20,
                                        flexGrow: 0,
                                    }}
                                    initialScrollIndex={(() => {
                                        const index = initialPostId
                                            ? threadPosts.findIndex(
                                                  (p) => p.id === initialPostId
                                              )
                                            : 0
                                        return index >= 0 ? index : 0
                                    })()}
                                    onScrollToIndexFailed={
                                        onScrollToIndexFailed
                                    }
                                />

                                {/* Thread Timeline - dots with connecting line */}
                                {threadPosts.length > 1 && (
                                    <View style={styles.timelineContainer}>
                                        <View style={styles.timeline}>
                                            {/* Connecting line */}
                                            <View style={styles.timelineLine} />
                                            {/* Filled portion of line */}
                                            <View
                                                style={[
                                                    styles.timelineLineFilled,
                                                    {
                                                        width: `${(currentIndex / (threadPosts.length - 1)) * 100}%`,
                                                    },
                                                ]}
                                            />
                                            {/* Dots */}
                                            {threadPosts.map((_, index) => (
                                                <TouchableOpacity
                                                    key={index}
                                                    style={[
                                                        styles.timelineDot,
                                                        {
                                                            left: `${(index / (threadPosts.length - 1)) * 100}%`,
                                                        },
                                                        index <= currentIndex &&
                                                            styles.timelineDotFilled,
                                                        index ===
                                                            currentIndex &&
                                                            styles.timelineDotActive,
                                                    ]}
                                                    onPress={() => {
                                                        flatListRef.current?.scrollToIndex(
                                                            {
                                                                index,
                                                                animated: true,
                                                            }
                                                        )
                                                    }}
                                                    accessibilityLabel={`Go to photo ${index + 1} of ${threadPosts.length}`}
                                                    accessibilityRole="button"
                                                    accessibilityState={{
                                                        selected:
                                                            index ===
                                                            currentIndex,
                                                    }}
                                                />
                                            ))}
                                        </View>
                                        <Text style={styles.progressText}>
                                            {currentIndex + 1} of{' '}
                                            {threadPosts.length}
                                        </Text>
                                    </View>
                                )}

                                {/* Card Footer */}
                                <View style={styles.cardFooter}>
                                    {/* Title and Caption section */}
                                    <View style={styles.captionSection}>
                                        {currentPost?.caption && (
                                            <Text
                                                style={styles.caption}
                                                numberOfLines={2}
                                            >
                                                {currentPost.caption}
                                            </Text>
                                        )}

                                        <View style={styles.metaRow}>
                                            <Text style={styles.dateText}>
                                                {currentPost
                                                    ? formatDate(
                                                          currentPost.createdAt
                                                      )
                                                    : ''}
                                            </Text>
                                            {distance !== null &&
                                                threadPosts[0]?.hasLocation && (
                                                    <>
                                                        <Text
                                                            style={
                                                                styles.dateSeparator
                                                            }
                                                        >
                                                            {' '}
                                                            •{' '}
                                                        </Text>
                                                        <Text
                                                            style={
                                                                styles.distanceText
                                                            }
                                                        >
                                                            {distance < 1000
                                                                ? `${distance} m away`
                                                                : `${(distance / 1000).toFixed(1)} km away`}
                                                        </Text>
                                                    </>
                                                )}
                                        </View>
                                    </View>

                                    {/* Divider */}
                                    <View style={styles.footerDivider} />

                                    {/* Catch Button */}
                                    <View style={styles.actionsSection}>
                                        <TouchableOpacity
                                            style={[
                                                styles.catchButton,
                                                threadPosts[0]?.authorId ===
                                                    user?.uid &&
                                                    styles.catchButtonDisabled,
                                            ]}
                                            onPress={handleCatchPress}
                                            disabled={
                                                threadPosts[0]?.authorId ===
                                                user?.uid
                                            }
                                            accessibilityLabel="Catch This Shot"
                                            accessibilityRole="button"
                                            accessibilityState={{
                                                disabled:
                                                    threadPosts[0]?.authorId ===
                                                    user?.uid,
                                            }}
                                            accessibilityHint="Take a photo at this location"
                                        >
                                            <Ionicons
                                                name="camera"
                                                size={20}
                                                color="#fff"
                                            />
                                            <Text
                                                style={styles.catchButtonText}
                                            >
                                                Catch This Shot
                                            </Text>
                                        </TouchableOpacity>

                                        {/* Locate on Map Button */}
                                        {threadPosts[0]?.hasLocation && (
                                            <TouchableOpacity
                                                style={styles.directionsButton}
                                                onPress={handleLocateOnMap}
                                                accessibilityLabel="Locate on Map"
                                                accessibilityRole="button"
                                            >
                                                <Ionicons
                                                    name="map-outline"
                                                    size={20}
                                                    color={colors.primary}
                                                />
                                                <Text
                                                    style={
                                                        styles.directionsButtonText
                                                    }
                                                >
                                                    Locate on Map
                                                </Text>
                                            </TouchableOpacity>
                                        )}

                                        {/* Get Directions Button */}
                                        {threadPosts[0]?.hasLocation &&
                                            postLocation && (
                                                <TouchableOpacity
                                                    style={
                                                        styles.directionsButton
                                                    }
                                                    onPress={
                                                        handleGetDirections
                                                    }
                                                    accessibilityLabel="Get directions"
                                                    accessibilityRole="button"
                                                    accessibilityHint="Opens maps application"
                                                >
                                                    <Ionicons
                                                        name="navigate-outline"
                                                        size={20}
                                                        color={colors.primary}
                                                    />
                                                    <Text
                                                        style={
                                                            styles.directionsButtonText
                                                        }
                                                    >
                                                        Directions
                                                    </Text>
                                                </TouchableOpacity>
                                            )}
                                    </View>
                                </View>
                            </View>
                        </View>
                    )}
                </View>

                {/* Options dropdown — in-tree overlay instead of a nested
                    Modal so it appears the same frame the ⋯ button is
                    tapped (a nested RN Modal's native fade presentation
                    takes ~300ms). Rendered at the overlay root so the
                    scrim covers the whole screen. */}
                {showOptionsMenu && (
                    <>
                        {/* Scrim: tapping anywhere outside the menu
                            dismisses it */}
                        <TouchableOpacity
                            style={styles.optionsMenuScrim}
                            activeOpacity={1}
                            onPress={() => setShowOptionsMenu(false)}
                            accessibilityLabel="Dismiss menu"
                        />
                        <View
                            style={[
                                styles.optionsMenuInCard,
                                styles.optionsMenuFloating,
                                { top: insets.top + 64 },
                            ]}
                        >
                            <TouchableOpacity
                                style={styles.optionsMenuItem}
                                onPress={() => {
                                    setShowOptionsMenu(false)
                                    setShowAddToListModal(true)
                                }}
                                accessibilityRole="menuitem"
                                accessibilityLabel="Add to List"
                            >
                                <Text style={styles.optionsMenuText}>
                                    Add to List
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.optionsMenuItem}
                                onPress={handleShare}
                                accessibilityRole="menuitem"
                                accessibilityLabel="Share"
                            >
                                <Text style={styles.optionsMenuText}>
                                    Share
                                </Text>
                            </TouchableOpacity>
                            {currentPost?.authorId === user?.uid ? (
                                <TouchableOpacity
                                    style={[
                                        styles.optionsMenuItem,
                                        styles.optionsMenuItemLast,
                                    ]}
                                    onPress={handleDeletePost}
                                    accessibilityRole="menuitem"
                                    accessibilityLabel="Delete shot"
                                >
                                    <Text
                                        style={[
                                            styles.optionsMenuText,
                                            styles.optionsMenuTextDanger,
                                        ]}
                                    >
                                        Delete
                                    </Text>
                                </TouchableOpacity>
                            ) : (
                                <TouchableOpacity
                                    style={[
                                        styles.optionsMenuItem,
                                        styles.optionsMenuItemLast,
                                    ]}
                                    onPress={() => {
                                        setShowOptionsMenu(false)
                                        setShowReportSheet(true)
                                    }}
                                    accessibilityRole="menuitem"
                                    accessibilityLabel="Report shot"
                                >
                                    <Text
                                        style={[
                                            styles.optionsMenuText,
                                            styles.optionsMenuTextDanger,
                                        ]}
                                    >
                                        Report
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </>
                )}
            </Animated.View>

            {/* List Selection Bottom Sheet */}
            {currentPost && (
                <ListSelectionBottomSheet
                    visible={showAddToListModal}
                    postId={currentPost.id}
                    onClose={() => setShowAddToListModal(false)}
                    onSelectionChange={(selectedIds) => {
                        setIsSaved(selectedIds.size > 0)
                    }}
                />
            )}

            {/* Report Post Sheet */}
            {currentPost && (
                <ReportBottomSheet
                    visible={showReportSheet}
                    onClose={() => setShowReportSheet(false)}
                    targetUserId={currentPost.authorId}
                    targetUsername={currentPost.authorUsername}
                    targetPostId={currentPost.id}
                />
            )}

            {/* Catch reveal — the then/now payoff after a successful catch */}
            <CatchRevealModal
                visible={!!revealData}
                originalPost={revealData?.originalPost ?? null}
                catchPhotoUri={revealData?.catchPhotoUri ?? null}
                place={revealData?.place ?? null}
                onClose={dismissReveal}
            />
        </Modal>
    )
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: colors.modalOverlay,
    },
    modalContent: {
        flex: 1,
        width: '100%',
        position: 'relative',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    contentContainer: {
        flex: 1,
        padding: 10,
    },
    // Post Card - matches ExploreScreen card style
    postCard: {
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 3,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
    },
    cardHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButtonInCard: {
        padding: 4,
        marginRight: 8,
    },
    cardUsername: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    cardHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    catchBadge: {
        // Positioning details
    },
    headerIconButton: {
        padding: 4,
    },
    optionsMenuScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.25)',
    },
    optionsMenuFloating: {
        right: 24,
    },
    optionsMenuInCard: {
        position: 'absolute',
        top: 35,
        right: 0,
        backgroundColor: colors.cardElevated,
        borderRadius: 8,
        minWidth: 120,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 8,
        elevation: 5,
        overflow: 'hidden',
        zIndex: 1000,
    },
    optionsMenuItem: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    optionsMenuItemLast: {
        borderBottomWidth: 0,
    },
    optionsMenuText: {
        fontSize: 15,
        color: colors.textPrimary,
    },
    optionsMenuTextDanger: {
        color: '#ff4444',
    },
    cardFooter: {
        padding: 12,
        paddingTop: 10,
    },
    captionSection: {
        minHeight: 40, // Fixed min height for 1 line + date
    },
    postTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
        lineHeight: 24,
        marginBottom: 4,
    },
    caption: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 18,
    },
    metaRow: {
        marginTop: 6,
    },
    footerDivider: {
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        marginVertical: 12,
    },
    actionsSection: {
        gap: 12,
    },
    galleryFlatList: {
        flexGrow: 0,
    },
    galleryItem: {
        // Dimensions set in renderItem
    },
    galleryImage: {
        width: '100%',
        height: '100%',
        backgroundColor: colors.imageBackground,
    },
    timelineContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    timeline: {
        flex: 1,
        height: 12,
        justifyContent: 'center',
        position: 'relative',
    },
    timelineLine: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        borderRadius: 1,
    },
    timelineLineFilled: {
        position: 'absolute',
        left: 0,
        height: 2,
        backgroundColor: colors.primary,
        borderRadius: 1,
    },
    timelineDot: {
        position: 'absolute',
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        marginLeft: -5,
        borderWidth: 2,
        borderColor: colors.card,
    },
    timelineDotFilled: {
        backgroundColor: colors.primary,
    },
    timelineDotActive: {
        width: 14,
        height: 14,
        borderRadius: 7,
        marginLeft: -7,
        marginTop: -2,
    },
    metadataRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
    },
    metadataText: {
        fontSize: 13,
        color: colors.textTertiary,
    },
    dateText: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    dateSeparator: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    distanceText: {
        fontSize: 12,
        color: colors.secondary,
        fontWeight: '500',
    },
    progressText: {
        fontSize: 12,
        color: colors.textTertiary,
        minWidth: 50,
    },
    catchButton: {
        backgroundColor: colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 12,
        gap: 8,
    },
    catchButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    catchButtonDisabled: {
        opacity: 0.6,
    },
    directionsButton: {
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderColor: colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
        gap: 8,
    },
    directionsButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primary,
    },
    caughtBadgeOverlay: {
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 1,
    },
})
