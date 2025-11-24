import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { db, storage } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { validateCatch } from '@/utils/catchValidation'
import { cropToSquare } from '@/utils/imageProcessing'
import { Ionicons } from '@expo/vector-icons'
import { useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    increment,
    orderBy,
    query,
    updateDoc,
    where,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import React, { useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ViewToken,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import UnifiedCameraView from './UnifiedCameraView'
import UnifiedPreviewScreen from './UnifiedPreviewScreen'

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

interface ThreadModalProps {
    visible: boolean
    post: Post | null // The post that was tapped (could be original or a catch)
    onClose: () => void
    onPostUpdate?: (updatedPost: Post) => void
    onPostDelete?: (postId: string) => void
    initialPostId?: string // If provided, start the gallery at this post
}

const { width } = Dimensions.get('window')

export default function ThreadModal({
    visible,
    post,
    onClose,
    onPostUpdate,
    onPostDelete,
    initialPostId,
}: ThreadModalProps) {
    const { user } = useAuth()
    const { triggerRefresh } = usePost()
    const router = useRouter()
    const insets = useSafeAreaInsets()

    // Thread state
    const [threadPosts, setThreadPosts] = useState<Post[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)
    const [loadingThread, setLoadingThread] = useState(true)
    const flatListRef = useRef<FlatList>(null)

    // UI state
    const [bookmarked, setBookmarked] = useState(false)
    const [showOptionsMenu, setShowOptionsMenu] = useState(false)

    // Catch flow states
    const [catchMode, setCatchMode] = useState(false)
    const [catchPreviewMode, setCatchPreviewMode] = useState(false)
    const [catchImageUri, setCatchImageUri] = useState<string | null>(null)
    const [catchLocation, setCatchLocation] = useState<{
        latitude: number
        longitude: number
    } | null>(null)
    const [cameraPermission, requestCameraPermission] = useCameraPermissions()
    const [uploading, setUploading] = useState(false)
    const [fetchingLocation, setFetchingLocation] = useState(false)

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
                    flatListRef.current?.scrollToIndex({
                        index,
                        animated: false,
                    })
                    setCurrentIndex(index)
                }, 100)
            }
        }
    }, [threadPosts, initialPostId])

    // Update bookmark status when current post changes
    useEffect(() => {
        if (currentPost) {
            fetchBookmarkStatus()
        }
    }, [currentPost?.id])

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

            setThreadPosts(posts)

            // Set initial index
            const startPostId = initialPostId || post.id
            const index = posts.findIndex((p) => p.id === startPostId)
            setCurrentIndex(index >= 0 ? index : 0)
        } catch (error) {
            console.error('Error fetching thread:', error)
            // Fallback to just showing the single post
            setThreadPosts([post])
            setCurrentIndex(0)
        } finally {
            setLoadingThread(false)
        }
    }

    const fetchBookmarkStatus = async () => {
        if (!user || !currentPost) return

        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            if (userDoc.exists()) {
                const bookmarkedPosts = userDoc.data().bookmarkedPosts || []
                setBookmarked(bookmarkedPosts.includes(currentPost.id))
            }
        } catch (error) {
            console.error('Error fetching bookmark status:', error)
        }
    }

    const toggleBookmark = async () => {
        if (!user || !currentPost) return

        const wasBookmarked = bookmarked
        setBookmarked(!bookmarked)

        try {
            const userRef = doc(db, 'users', user.uid)
            if (wasBookmarked) {
                await updateDoc(userRef, {
                    bookmarkedPosts: arrayRemove(currentPost.id),
                })
            } else {
                await updateDoc(userRef, {
                    bookmarkedPosts: arrayUnion(currentPost.id),
                })
            }
        } catch (error) {
            console.error('Error toggling bookmark:', error)
            setBookmarked(wasBookmarked)
        }
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
                triggerRefresh()
                onClose()
                return
            } else if (currentIndex >= newThreadPosts.length) {
                setCurrentIndex(newThreadPosts.length - 1)
            }

            Alert.alert('Success', 'Post deleted successfully')
            onPostDelete?.(currentPost.id)
            triggerRefresh()
        } catch (error) {
            console.error('Error deleting post:', error)
            Alert.alert('Error', 'Error deleting post. Please try again.')
        }
    }

    const handleCatchPress = async () => {
        if (!cameraPermission?.granted) {
            const { granted } = await requestCameraPermission()
            if (!granted) {
                Alert.alert(
                    'Permission Required',
                    'Camera permission is required to catch this location.'
                )
                return
            }
        }

        setCatchMode(true)
    }

    const handleCatchPhotoTaken = async (photoUri: string) => {
        try {
            const processedUri = await cropToSquare(photoUri)

            setCatchImageUri(processedUri)
            setCatchMode(false)
            setCatchPreviewMode(true)

            setFetchingLocation(true)
            const { status } =
                await Location.requestForegroundPermissionsAsync()
            if (status === 'granted') {
                const location = await Location.getCurrentPositionAsync({})
                setCatchLocation({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                })
            }
            setFetchingLocation(false)
        } catch (error) {
            console.error('Error processing catch photo:', error)
            setCatchMode(false)
            Alert.alert('Error', 'Failed to process photo. Please try again.')
        }
    }

    const handleCatchCameraCancel = () => {
        setCatchMode(false)
    }

    const handleCatchConfirm = async (caption?: string) => {
        // Always catch the ROOT post, not the current post
        const rootPost = threadPosts[0]
        if (!rootPost || !catchImageUri) {
            Alert.alert('Error', 'Post or image not found. Please try again.')
            return
        }

        if (!catchLocation) {
            Alert.alert(
                'Permission Required',
                'Location permission is required to validate your catch.'
            )
            return
        }

        setUploading(true)
        try {
            // Validate against the ROOT post's location
            const validation = await validateCatch(
                rootPost.id,
                catchLocation.latitude,
                catchLocation.longitude
            )

            if (!validation.isValid) {
                setUploading(false)
                Alert.alert(
                    'Too Far Away',
                    `You're ${validation.distance}m away. Must be within ${validation.requiredDistance}m to catch this location.`
                )
            } else {
                await createCatchPost(catchImageUri, catchLocation, caption)
            }
        } catch (error: any) {
            console.error('Error validating catch:', error)
            setUploading(false)

            if (error.code === 'functions/not-found') {
                Alert.alert(
                    'Error',
                    'This post no longer exists or has no location data.'
                )
            } else if (error.code === 'functions/unauthenticated') {
                Alert.alert(
                    'Authentication Required',
                    'You must be logged in to catch posts.'
                )
            } else {
                Alert.alert(
                    'Error',
                    'Error validating your location. Please try again.'
                )
            }
        }
    }

    const handleCatchPreviewCancel = () => {
        setCatchPreviewMode(false)
        setCatchImageUri(null)
        setCatchLocation(null)
    }

    const createCatchPost = async (
        photoUri: string,
        location: { latitude: number; longitude: number },
        caption?: string
    ) => {
        if (!user) return

        // Always add to the ROOT post's thread
        const rootPost = threadPosts[0]
        if (!rootPost) return

        try {
            const response = await fetch(photoUri)
            const blob = await response.blob()

            const timestamp = Date.now()
            const storageRef = ref(
                storage,
                `posts/${user.uid}/${timestamp}.jpg`
            )
            await uploadBytes(storageRef, blob)
            const downloadURL = await getDownloadURL(storageRef)

            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username = userDoc.exists()
                ? userDoc.data().username
                : 'Unknown'

            const defaultCaption = `Caught @${rootPost.authorUsername}'s location!`
            const finalCaption = caption?.trim() || defaultCaption

            const catchPostRef = await addDoc(collection(db, 'posts'), {
                authorId: user.uid,
                authorUsername: username,
                photoURL: downloadURL,
                caption: finalCaption,
                hasLocation: true,
                catchCount: 0,
                isOriginal: false,
                parentPostId: rootPost.id,
                rootPostId: rootPost.id,
                createdAt: new Date(),
            })

            await addDoc(collection(db, 'post_locations'), {
                postId: catchPostRef.id,
                latitude: location.latitude,
                longitude: location.longitude,
                createdAt: new Date(),
            })

            // Increment the ROOT post's catchCount
            const rootPostRef = doc(db, 'posts', rootPost.id)
            await updateDoc(rootPostRef, {
                catchCount: increment(1),
            })

            // Update local thread state
            const newCatchPost: Post = {
                id: catchPostRef.id,
                authorId: user.uid,
                authorUsername: username,
                photoURL: downloadURL,
                caption: finalCaption,
                hasLocation: true,
                catchCount: 0,
                isOriginal: false,
                parentPostId: rootPost.id,
                rootPostId: rootPost.id,
                createdAt: { toDate: () => new Date() },
            }

            // Update root post's catch count locally
            const updatedThreadPosts = threadPosts.map((p, i) =>
                i === 0 ? { ...p, catchCount: p.catchCount + 1 } : p
            )
            updatedThreadPosts.push(newCatchPost)
            setThreadPosts(updatedThreadPosts)

            // Navigate to the new catch
            setCurrentIndex(updatedThreadPosts.length - 1)
            setTimeout(() => {
                flatListRef.current?.scrollToIndex({
                    index: updatedThreadPosts.length - 1,
                    animated: true,
                })
            }, 100)

            // Notify parent of update
            onPostUpdate?.({
                ...rootPost,
                catchCount: rootPost.catchCount + 1,
            })

            Alert.alert('Success', 'Great catch! Your post has been added to the thread.')

            // Reset catch states
            setCatchPreviewMode(false)
            setCatchImageUri(null)
            setCatchLocation(null)

            triggerRefresh()
        } catch (error) {
            console.error('Error creating catch post:', error)
            Alert.alert('Error', 'Error creating catch post. Please try again.')
        } finally {
            setUploading(false)
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

    const cardWidth = width - 20 // Account for container padding
    const getItemLayout = (_: any, index: number) => ({
        length: cardWidth,
        offset: cardWidth * index,
        index,
    })

    const renderGalleryItem = ({ item }: { item: Post }) => (
        <View style={styles.galleryItem}>
            <Image
                source={{ uri: item.photoURL }}
                style={styles.galleryImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
            />
        </View>
    )

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
                    setCatchMode(false)
                    onClose()
                }}
            >
                <UnifiedCameraView
                    onPhotoTaken={handleCatchPhotoTaken}
                    onCancel={handleCatchCameraCancel}
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
                    setCatchPreviewMode(false)
                    onClose()
                }}
            >
                <UnifiedPreviewScreen
                    imageUri={catchImageUri}
                    onConfirm={handleCatchConfirm}
                    onCancel={handleCatchPreviewCancel}
                    mode="catch"
                    loading={uploading}
                    loadingText="Creating catch..."
                    originalPhotoUrl={rootPost?.photoURL}
                    hasLocation={!!catchLocation}
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
                                        <View style={styles.catchBadge}>
                                            <Ionicons
                                                name="trophy"
                                                size={16}
                                                color={colors.secondary}
                                            />
                                            <Text style={styles.catchCount}>
                                                {threadPosts[0]?.catchCount || 0}
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            onPress={toggleBookmark}
                                            style={styles.headerIconButton}
                                        >
                                            <Ionicons
                                                name={bookmarked ? 'bookmark' : 'bookmark-outline'}
                                                size={22}
                                                color={bookmarked ? colors.iconActive : colors.iconInactive}
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
                                    keyExtractor={(item) => item.id}
                                    horizontal
                                    pagingEnabled
                                    showsHorizontalScrollIndicator={false}
                                    onViewableItemsChanged={onViewableItemsChanged}
                                    viewabilityConfig={viewabilityConfig}
                                    getItemLayout={getItemLayout}
                                    style={styles.galleryFlatList}
                                    initialScrollIndex={
                                        initialPostId
                                            ? threadPosts.findIndex(
                                                  (p) => p.id === initialPostId
                                              )
                                            : 0
                                    }
                                    onScrollToIndexFailed={(info) => {
                                        setTimeout(() => {
                                            flatListRef.current?.scrollToIndex({
                                                index: info.index,
                                                animated: false,
                                            })
                                        }, 100)
                                    }}
                                />

                                {/* Card Footer */}
                                <View style={styles.cardFooter}>
                                    {/* Caption section - fixed height */}
                                    <View style={styles.captionSection}>
                                        <Text style={styles.caption} numberOfLines={1}>
                                            {currentPost?.caption || '---'}
                                        </Text>

                                        <Text style={styles.dateText}>
                                            {currentPost ? formatDate(currentPost.createdAt) : ''}
                                        </Text>
                                    </View>

                                    {/* Divider */}
                                    <View style={styles.footerDivider} />

                                    {/* Thread Progress + Catch Button - fixed position */}
                                    <View style={styles.actionsSection}>
                                        <View style={styles.threadProgress}>
                                            <View style={styles.progressBar}>
                                                <View
                                                    style={[
                                                        styles.progressFill,
                                                        { width: `${((currentIndex + 1) / threadPosts.length) * 100}%` }
                                                    ]}
                                                />
                                            </View>
                                            <Text style={styles.progressText}>
                                                {currentIndex + 1} of {threadPosts.length}
                                            </Text>
                                        </View>

                                        <TouchableOpacity
                                            style={[
                                                styles.catchButton,
                                                (uploading || fetchingLocation || threadPosts[0]?.authorId === user?.uid) && styles.catchButtonDisabled,
                                            ]}
                                            onPress={handleCatchPress}
                                            disabled={uploading || fetchingLocation || threadPosts[0]?.authorId === user?.uid}
                                        >
                                            {uploading ? (
                                                <>
                                                    <ActivityIndicator size="small" color="#fff" />
                                                    <Text style={styles.catchButtonText}>Uploading...</Text>
                                                </>
                                            ) : fetchingLocation ? (
                                                <>
                                                    <ActivityIndicator size="small" color="#fff" />
                                                    <Text style={styles.catchButtonText}>Getting location...</Text>
                                                </>
                                            ) : (
                                                <>
                                                    <Ionicons name="camera" size={20} color="#fff" />
                                                    <Text style={styles.catchButtonText}>Catch This Location</Text>
                                                </>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                        </View>
                    )}
                </View>
            </View>
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
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.cardElevated,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        gap: 5,
    },
    catchCount: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.secondary,
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
    metaRow: {
        marginTop: 4,
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
        height: width - 20,
        flexGrow: 0,
    },
    galleryItem: {
        width: width - 20,
        height: width - 20,
    },
    galleryImage: {
        width: '100%',
        height: '100%',
        backgroundColor: colors.imageBackground,
    },
    caption: {
        fontSize: 15,
        color: colors.textSecondary,
        lineHeight: 20,
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
    threadProgress: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    progressBar: {
        flex: 1,
        height: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: colors.primary,
        borderRadius: 2,
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
})
