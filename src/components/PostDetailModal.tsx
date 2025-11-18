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
    increment,
    updateDoc,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import React, { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
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
    isOriginal: boolean
    createdAt: any
}

interface PostDetailModalProps {
    visible: boolean
    post: Post | null
    onClose: () => void
    onPostUpdate?: (updatedPost: Post) => void
    onPostDelete?: (postId: string) => void
}

const { width } = Dimensions.get('window')

export default function PostDetailModal({
    visible,
    post,
    onClose,
    onPostUpdate,
    onPostDelete,
}: PostDetailModalProps) {
    const { user } = useAuth()
    const { triggerRefresh } = usePost()
    const router = useRouter()
    const insets = useSafeAreaInsets()

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

    useEffect(() => {
        if (visible && post) {
            fetchBookmarkStatus()
        }
    }, [visible, post])

    const fetchBookmarkStatus = async () => {
        if (!user || !post) return

        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            if (userDoc.exists()) {
                const bookmarkedPosts = userDoc.data().bookmarkedPosts || []
                setBookmarked(bookmarkedPosts.includes(post.id))
            }
        } catch (error) {
            console.error('Error fetching bookmark status:', error)
        }
    }

    const toggleBookmark = async () => {
        if (!user || !post) return

        const wasBookmarked = bookmarked
        setBookmarked(!bookmarked)

        try {
            const userRef = doc(db, 'users', user.uid)
            if (wasBookmarked) {
                await updateDoc(userRef, {
                    bookmarkedPosts: arrayRemove(post.id),
                })
            } else {
                await updateDoc(userRef, {
                    bookmarkedPosts: arrayUnion(post.id),
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
        if (!user || !post) return

        setShowOptionsMenu(false)

        const confirmDelete = await new Promise<boolean>((resolve) => {
            Alert.alert(
                'Delete Post',
                'Are you sure you want to delete this post?',
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
            await deleteDoc(doc(db, 'posts', post.id))
            Alert.alert('Success', 'Post deleted successfully')

            onPostDelete?.(post.id)
            triggerRefresh()
            onClose()
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
            console.log('Catch photo captured, URI:', photoUri)

            // Process the image to 1:1 square
            const processedUri = await cropToSquare(photoUri)
            console.log('Catch image processed, new URI:', processedUri)

            setCatchImageUri(processedUri)
            setCatchMode(false)
            setCatchPreviewMode(true)

            // Get location in the background
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
        if (!post || !catchImageUri) {
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
            const validation = await validateCatch(
                post.id,
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
        if (!user || !post) return

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

            const defaultCaption = `Caught @${post.authorUsername}'s location!`
            const finalCaption = caption?.trim() || defaultCaption

            const catchPostRef = await addDoc(collection(db, 'posts'), {
                authorId: user.uid,
                authorUsername: username,
                photoURL: downloadURL,
                caption: finalCaption,
                hasLocation: true,
                catchCount: 0,
                isOriginal: false,
                parentPostId: post.id,
                createdAt: new Date(),
            })

            await addDoc(collection(db, 'post_locations'), {
                postId: catchPostRef.id,
                latitude: location.latitude,
                longitude: location.longitude,
                createdAt: new Date(),
            })

            const parentPostRef = doc(db, 'posts', post.id)
            await updateDoc(parentPostRef, {
                catchCount: increment(1),
            })

            // Note: totalCatches is now auto-updated by Cloud Functions

            // Update local state
            const updatedPost = { ...post, catchCount: post.catchCount + 1 }
            onPostUpdate?.(updatedPost)

            Alert.alert('Success', 'Great catch! Your post has been created.')

            // Reset catch states
            setCatchPreviewMode(false)
            setCatchImageUri(null)
            setCatchLocation(null)

            triggerRefresh()
            onClose()
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

    if (!post) return null

    if (catchMode) {
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
                    originalPhotoUrl={post.photoURL}
                />
            </Modal>
        )
    }

    if (catchPreviewMode && catchImageUri) {
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
                    originalPhotoUrl={post.photoURL}
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
            <TouchableOpacity
                style={styles.modalOverlay}
                activeOpacity={1}
                onPress={() => {
                    if (showOptionsMenu) {
                        setShowOptionsMenu(false)
                    }
                }}
            >
                <Pressable
                    style={styles.modalContent}
                    onPress={() => {
                        if (showOptionsMenu) {
                            setShowOptionsMenu(false)
                        }
                    }}
                >
                    {/* Header bar */}
                    <View
                        style={[
                            styles.headerBar,
                            { paddingTop: Math.max(insets.top - 30, 10) },
                        ]}
                    >
                        <View style={styles.headerLeft}>
                            <TouchableOpacity
                                style={styles.backButton}
                                onPress={() => {
                                    setShowOptionsMenu(false)
                                    onClose()
                                }}
                            >
                                <Ionicons
                                    name="arrow-back"
                                    size={28}
                                    color={colors.textPrimary}
                                />
                            </TouchableOpacity>

                            <TouchableOpacity
                                onPress={() => {
                                    setShowOptionsMenu(false)
                                    router.push({
                                        pathname: '/user-profile',
                                        params: { userId: post.authorId },
                                    })
                                }}
                            >
                                <Text style={styles.headerUsername}>
                                    @{post.authorUsername}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.headerRight}>
                            <View style={styles.headerBadge}>
                                <Ionicons
                                    name="trophy"
                                    size={16}
                                    color={colors.secondary}
                                />
                                <Text style={styles.headerCatchCount}>
                                    {post.catchCount}
                                </Text>
                            </View>
                            <TouchableOpacity
                                onPress={toggleBookmark}
                                style={styles.headerButton}
                            >
                                <Ionicons
                                    name={
                                        bookmarked
                                            ? 'bookmark'
                                            : 'bookmark-outline'
                                    }
                                    size={24}
                                    color={
                                        bookmarked
                                            ? colors.iconActive
                                            : colors.iconInactive
                                    }
                                />
                            </TouchableOpacity>
                            <View style={{ zIndex: 10 }}>
                                <TouchableOpacity
                                    onPress={() =>
                                        setShowOptionsMenu(!showOptionsMenu)
                                    }
                                    style={styles.headerButton}
                                >
                                    <Ionicons
                                        name="ellipsis-horizontal"
                                        size={24}
                                        color={colors.textPrimary}
                                    />
                                </TouchableOpacity>

                                {showOptionsMenu && (
                                    <View style={styles.optionsMenu}>
                                        <TouchableOpacity
                                            style={styles.optionsMenuItem}
                                            onPress={handleShare}
                                        >
                                            <Text
                                                style={styles.optionsMenuText}
                                            >
                                                Share
                                            </Text>
                                        </TouchableOpacity>
                                        {post.authorId === user?.uid && (
                                            <TouchableOpacity
                                                style={[
                                                    styles.optionsMenuItem,
                                                    styles.optionsMenuItemLast,
                                                ]}
                                                onPress={handleDeletePost}
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
                                        )}
                                    </View>
                                )}
                            </View>
                        </View>
                    </View>

                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                        contentInsetAdjustmentBehavior="never"
                    >
                        <Image
                            source={{ uri: post.photoURL }}
                            style={styles.image}
                            resizeMode="cover"
                        />

                        <View style={styles.details}>
                            {post.caption ? (
                                <Text style={styles.caption}>
                                    {post.caption}
                                </Text>
                            ) : null}

                            <View style={styles.metadata}>
                                <View style={styles.metadataRow}>
                                    <Ionicons
                                        name="calendar-outline"
                                        size={16}
                                        color={colors.textTertiary}
                                    />
                                    <Text style={styles.metadataText}>
                                        {formatDate(post.createdAt)}
                                    </Text>
                                </View>
                            </View>

                            {post.authorId !== user?.uid && (
                                <>
                                    <Text style={styles.catchSubtitle}>
                                        Recreate this photo at the same
                                        location!
                                    </Text>
                                    <TouchableOpacity
                                        style={[
                                            styles.catchButton,
                                            (uploading || fetchingLocation) &&
                                                styles.catchButtonDisabled,
                                        ]}
                                        onPress={handleCatchPress}
                                        disabled={uploading || fetchingLocation}
                                    >
                                        {uploading ? (
                                            <>
                                                <ActivityIndicator
                                                    size="small"
                                                    color="#fff"
                                                />
                                                <Text
                                                    style={
                                                        styles.catchButtonText
                                                    }
                                                >
                                                    Uploading...
                                                </Text>
                                            </>
                                        ) : fetchingLocation ? (
                                            <>
                                                <ActivityIndicator
                                                    size="small"
                                                    color="#fff"
                                                />
                                                <Text
                                                    style={
                                                        styles.catchButtonText
                                                    }
                                                >
                                                    Getting location...
                                                </Text>
                                            </>
                                        ) : (
                                            <>
                                                <Ionicons
                                                    name="camera"
                                                    size={20}
                                                    color="#fff"
                                                />
                                                <Text
                                                    style={
                                                        styles.catchButtonText
                                                    }
                                                >
                                                    Catch This Location
                                                </Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    </ScrollView>
                </Pressable>
            </TouchableOpacity>
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
    headerBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingBottom: 10,
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    backButton: {
        padding: 4,
    },
    headerUsername: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
        marginLeft: 8,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.cardElevated,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        gap: 5,
    },
    headerCatchCount: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.secondary,
    },
    headerButton: {
        padding: 4,
    },
    optionsMenu: {
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
    scrollContent: {
        flexGrow: 1,
        paddingTop: 0,
    },
    image: {
        width: width,
        height: width,
        backgroundColor: colors.imageBackground,
    },
    details: {
        backgroundColor: colors.modalDark,
        padding: 20,
    },
    caption: {
        fontSize: 16,
        color: colors.textSecondary,
        lineHeight: 22,
        marginBottom: 16,
    },
    metadata: {
        gap: 8,
    },
    metadataRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    metadataText: {
        fontSize: 14,
        color: colors.textTertiary,
    },
    catchSubtitle: {
        fontSize: 14,
        color: colors.textTertiary,
        marginTop: 12,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    catchButton: {
        backgroundColor: colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 12,
        marginTop: 20,
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
