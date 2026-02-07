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

import CatchBadge from '@/components/ui/CatchBadge'
import CaughtBadge from '@/components/ui/CaughtBadge'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { useCatchFlow } from '@/hooks/useCatchFlow'
import { db, functions } from '@/services/firebase'
import { colors } from '@/theme/colors'
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
    where
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import React, { useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    FlatList, // Renamed to avoid conflict with expo-linking
    Modal,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ViewToken,
    useWindowDimensions
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ListSelectionBottomSheet from './ListSelectionBottomSheet'
import UnifiedCameraView from './UnifiedCameraView'
import UnifiedPreviewScreen from './UnifiedPreviewScreen'

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
    const { user, dataContributionEnabled } = useAuth()
    const { notifyPostEvent } = usePost()
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

    // Location state
    const [postLocation, setPostLocation] = useState<{ latitude: number; longitude: number; heading?: number; pitch?: number } | null>(null)
    const [distance, setDistance] = useState<number | null>(null)

    // Hook-based catch flow
    const {
        catchMode,
        catchPreviewMode,
        catchImageUri,
        fetchingLocation,
        uploading,
        heading,
        handleCatchPress,
        handlePhotoTaken,
        handleCameraCancel,
        handleConfirmCatch,
        handlePreviewCancel,
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
            setTimeout(() => {
                const newIndex = updatedThreadPosts.length - 1
                setCurrentIndex(newIndex)
                flatListRef.current?.scrollToIndex({
                    index: newIndex,
                    animated: true,
                })
            }, 100)
        }
    })

    // Get the currently displayed post
    const currentPost = threadPosts[currentIndex] || null

    // Fetch all posts in the thread
    useEffect(() => {
        if (visible && post) {
            fetchThread()
        }
    }, [visible, post])

    // Scroll to initial post when thread loads
    useEffect(() => {
        if (threadPosts.length > 0 && initialPostId) {
            const index = threadPosts.findIndex((p) => p.id === initialPostId)
            if (index >= 0 && flatListRef.current) {
                // Small delay to ensure FlatList is ready
                setTimeout(() => {
                    const validIndex = index >= 0 ? index : 0
                    if (validIndex < threadPosts.length) {
                        flatListRef.current?.scrollToIndex({
                            index: validIndex,
                            animated: false,
                        })
                        setCurrentIndex(validIndex)
                    }
                }, 100)
            }
        }
    }, [threadPosts, initialPostId])

    // Update save status when current post changes
    useEffect(() => {
        if (currentPost && user) {
            fetchSaveStatus()
        }
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
    }, [visible, threadPosts])

    const fetchThread = async () => {
        if (!post) return

        setLoadingThread(true)
        try {
            // Determine the root post ID
            const rootId = post.rootPostId || post.id

            // Fetch the root post
            const rootDocRef = doc(db, 'posts', rootId)
            const rootDoc = await getDoc(rootDocRef)

            const posts: Post[] = []

            if (rootDoc.exists()) {
                posts.push({
                    id: rootDoc.id,
                    ...rootDoc.data(),
                } as Post)
            } else {
                // Root post was deleted, but we might have been passed a catch
                // Just show the post we have
                console.warn('Root post not found, showing single post')
                setThreadPosts([post])
                setCurrentIndex(0)
                setLoadingThread(false)
                return
            }

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

            if (posts.length === 0) {
                // No posts found in thread, close modal with error
                Alert.alert('Error', 'This shot is no longer available')
                onClose()
                setLoadingThread(false)
                return
            }

            setThreadPosts(posts)

            // Set initial index
            const startPostId = initialPostId || post.id
            const index = posts.findIndex((p) => p.id === startPostId)
            const validIndex = index >= 0 ? index : 0
            setCurrentIndex(validIndex)
        } catch (error) {
            console.error('Error fetching thread:', error)
            Alert.alert('Error', 'Failed to load shot details')
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
            const locationData = result.data as { latitude: number; longitude: number; postId: string; heading?: number; pitch?: number }

            setPostLocation({
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                heading: locationData.heading,
                pitch: locationData.pitch
            })

            // Get user's current location
            const { status } = await Location.requestForegroundPermissionsAsync()
            if (status === 'granted') {
                // detailed hanging
                const locationPromise = Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                })

                const timeoutPromise = new Promise<Location.LocationObject>((_, reject) => {
                    setTimeout(() => reject(new Error('Location request timed out')), 10000)
                })

                const userLoc = await Promise.race([locationPromise, timeoutPromise])

                // Calculate distance
                const dist = calculateDistance(
                    userLoc.coords.latitude,
                    userLoc.coords.longitude,
                    locationData.latitude,
                    locationData.longitude
                )
                setDistance(Math.round(dist))
            }

            // Ensure the post has hasLocation=true so the button shows up
            setThreadPosts(current => current.map((p, i) =>
                i === 0 ? { ...p, hasLocation: true } : p
            ))
        } catch (error) {
            console.error('Error fetching post location:', error)
            setPostLocation(null)
            setDistance(null)
        }
    }

    const handleGetDirections = async () => {
        if (!postLocation) {
            Alert.alert('Location Not Available', 'Location data is not available for this post.')
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
            Alert.alert('Error', 'Could not open maps application.')
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

    const handleSaveStateChange = (saved: boolean) => {
        setIsSaved(saved)
    }

    const handleShare = async () => {
        setShowOptionsMenu(false)
        Alert.alert('Share', 'Share functionality coming soon!')
    }

    const handleDeletePost = async () => {
        if (!user || !currentPost) return

        setShowOptionsMenu(false)

        const confirmDelete = await new Promise<boolean>((resolve) => {
            Alert.alert(
                'Delete Post',
                currentPost.isOriginal && threadPosts.length > 1
                    ? 'This is the original post. Deleting it will promote the oldest catch to become the new thread starter. Continue?'
                    : 'Are you sure you want to delete this post?',
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
            // Delete the post
            await deleteDoc(doc(db, 'posts', currentPost.id))

            // Update local state
            const newThreadPosts = threadPosts.filter(
                (p) => p.id !== currentPost.id
            )
            setThreadPosts(newThreadPosts)

            // Adjust current index if needed
            if (newThreadPosts.length === 0) {
                // No more posts, close modal
                onPostDelete?.(currentPost.id)
                notifyPostEvent('delete', currentPost.id, currentPost.authorId)
                onClose()
                return
            } else if (currentIndex >= newThreadPosts.length) {
                setCurrentIndex(newThreadPosts.length - 1)
            }

            Alert.alert('Success', 'Post deleted successfully')
            onPostDelete?.(currentPost.id)
            notifyPostEvent('delete', currentPost.id, currentPost.authorId)
        } catch (error) {
            console.error('Error deleting post:', error)
            Alert.alert('Error', 'Error deleting post. Please try again.')
        }
    }

    const formatDate = (timestamp: any) => {
        if (!timestamp) return 'Unknown date'
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })
    }

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

    const getItemLayout = React.useCallback((_: any, index: number) => ({
        length: cardWidth,
        offset: cardWidth * index,
        index,
    }), [cardWidth])

    const renderGalleryItem = React.useCallback(({ item }: { item: Post }) => (
        <View style={[styles.galleryItem, { width: cardWidth, height: cardWidth }]}>
            <Image
                source={{ uri: item.photoURL }}
                style={styles.galleryImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                priority="high"
            />
            {item.authorId === user?.uid && (
                <CaughtBadge containerStyle={styles.caughtBadgeOverlay} size={24} />
            )}
        </View>
    ), [cardWidth, user?.uid])

    if (!post) return null

    // Camera mode
    if (catchMode) {
        const rootPost = threadPosts[0]
        return (
            <Modal
                visible={visible}
                animationType="fade"
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
                animationType="fade"
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
                    loadingText="Creating catch..."
                    originalPhotoUrl={rootPost?.photoURL}
                    hasLocation={true}
                    loadingLocation={fetchingLocation}
                />
            </Modal>
        )
    }

    return (
        <Modal
            visible={visible}
            animationType="fade"
            transparent={true}
            onRequestClose={() => {
                setShowOptionsMenu(false)
                onClose()
            }}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { paddingTop: insets.top + 10 }]}>
                    {loadingThread ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator
                                size="large"
                                color={colors.primary}
                            />
                        </View>
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
                                        >
                                            <Ionicons
                                                name="arrow-back"
                                                size={24}
                                                color={colors.textPrimary}
                                            />
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => {
                                                setShowOptionsMenu(false)
                                                if (currentPost) {
                                                    router.push({
                                                        pathname: '/user-profile',
                                                        params: { userId: currentPost.authorId },
                                                    })
                                                }
                                            }}
                                        >
                                            <Text style={styles.cardUsername}>
                                                @{currentPost?.authorUsername || '...'}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                    <View style={styles.cardHeaderRight}>
                                        <CatchBadge
                                            count={threadPosts[0]?.catchCount || 0}
                                            containerStyle={styles.catchBadge}
                                        />
                                        <TouchableOpacity
                                            onPress={handleSavePress}
                                            style={styles.headerIconButton}
                                        >
                                            <Ionicons
                                                name={isSaved ? 'bookmark' : 'bookmark-outline'}
                                                size={22}
                                                color={isSaved ? colors.iconActive : colors.iconInactive}
                                            />
                                        </TouchableOpacity>
                                        <View style={{ zIndex: 10 }}>
                                            <TouchableOpacity
                                                onPress={() => setShowOptionsMenu(!showOptionsMenu)}
                                                style={styles.headerIconButton}
                                            >
                                                <Ionicons
                                                    name="ellipsis-horizontal"
                                                    size={22}
                                                    color={colors.textPrimary}
                                                />
                                            </TouchableOpacity>

                                            {showOptionsMenu && (
                                                <View style={styles.optionsMenuInCard}>
                                                    <TouchableOpacity
                                                        style={styles.optionsMenuItem}
                                                        onPress={() => {
                                                            setShowOptionsMenu(false)
                                                            setShowAddToListModal(true)
                                                        }}
                                                    >
                                                        <Text style={styles.optionsMenuText}>Add to List</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        style={styles.optionsMenuItem}
                                                        onPress={handleShare}
                                                    >
                                                        <Text style={styles.optionsMenuText}>Share</Text>
                                                    </TouchableOpacity>
                                                    {currentPost?.authorId === user?.uid && (
                                                        <TouchableOpacity
                                                            style={[styles.optionsMenuItem, styles.optionsMenuItemLast]}
                                                            onPress={handleDeletePost}
                                                        >
                                                            <Text style={[styles.optionsMenuText, styles.optionsMenuTextDanger]}>
                                                                Delete
                                                            </Text>
                                                        </TouchableOpacity>
                                                    )}
                                                </View>
                                            )}
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
                                    onViewableItemsChanged={onViewableItemsChanged}
                                    viewabilityConfig={viewabilityConfig}
                                    getItemLayout={getItemLayout}
                                    style={{
                                        width: width - 20,
                                        height: width - 20,
                                        flexGrow: 0,
                                    }}
                                    initialScrollIndex={
                                        (() => {
                                            const index = initialPostId
                                                ? threadPosts.findIndex(
                                                    (p) => p.id === initialPostId
                                                )
                                                : 0
                                            return index >= 0 ? index : 0
                                        })()
                                    }
                                    onScrollToIndexFailed={onScrollToIndexFailed}
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
                                                    { width: `${(currentIndex / (threadPosts.length - 1)) * 100}%` }
                                                ]}
                                            />
                                            {/* Dots */}
                                            {threadPosts.map((_, index) => (
                                                <TouchableOpacity
                                                    key={index}
                                                    style={[
                                                        styles.timelineDot,
                                                        { left: `${(index / (threadPosts.length - 1)) * 100}%` },
                                                        index <= currentIndex && styles.timelineDotFilled,
                                                        index === currentIndex && styles.timelineDotActive,
                                                    ]}
                                                    onPress={() => {
                                                        flatListRef.current?.scrollToIndex({
                                                            index,
                                                            animated: true,
                                                        })
                                                    }}
                                                />
                                            ))}
                                        </View>
                                        <Text style={styles.progressText}>
                                            {currentIndex + 1} of {threadPosts.length}
                                        </Text>
                                    </View>
                                )}

                                {/* Card Footer */}
                                <View style={styles.cardFooter}>
                                    {/* Title and Caption section */}
                                    <View style={styles.captionSection}>


                                        {currentPost?.caption && (
                                            <Text style={styles.caption} numberOfLines={2}>
                                                {currentPost.caption}
                                            </Text>
                                        )}

                                        <View style={styles.metaRow}>
                                            <Text style={styles.dateText}>
                                                {currentPost ? formatDate(currentPost.createdAt) : ''}
                                            </Text>
                                            {distance !== null && threadPosts[0]?.hasLocation && (
                                                <>
                                                    <Text style={styles.dateSeparator}> • </Text>
                                                    <Text style={styles.distanceText}>
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
                                                threadPosts[0]?.authorId === user?.uid && styles.catchButtonDisabled,
                                            ]}
                                            onPress={handleCatchPress}
                                            disabled={threadPosts[0]?.authorId === user?.uid}
                                        >
                                            <Ionicons name="camera" size={20} color="#fff" />
                                            <Text style={styles.catchButtonText}>Catch This Shot</Text>
                                        </TouchableOpacity>

                                        {/* Locate on Map Button */}
                                        {threadPosts[0]?.hasLocation && (
                                            <TouchableOpacity
                                                style={styles.directionsButton}
                                                onPress={handleLocateOnMap}
                                            >
                                                <Ionicons name="map-outline" size={20} color={colors.primary} />
                                                <Text style={styles.directionsButtonText}>Locate on Map</Text>
                                            </TouchableOpacity>
                                        )}

                                        {/* Get Directions Button */}
                                        {threadPosts[0]?.hasLocation && postLocation && (
                                            <TouchableOpacity
                                                style={styles.directionsButton}
                                                onPress={handleGetDirections}
                                            >
                                                <Ionicons name="navigate-outline" size={20} color={colors.primary} />
                                                <Text style={styles.directionsButtonText}>Directions</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </View>
                            </View>
                        </View>
                    )}
                </View>
            </View>

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
});
