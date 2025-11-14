import React, { useState, useRef } from 'react'
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    Image,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    ActivityIndicator,
    PanResponder,
    Dimensions,
} from 'react-native'
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import * as ImageManipulator from 'expo-image-manipulator'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { collection, addDoc, doc, getDoc } from 'firebase/firestore'
import { storage, db } from '@/services/firebase'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { colors } from '@/theme/colors'

const { width: screenWidth } = Dimensions.get('window')
const CONTAINER_SIZE = screenWidth - 40 // Account for padding

interface LocationData {
    latitude: number
    longitude: number
}

export default function PostScreen() {
    const [permission, requestPermission] = useCameraPermissions()
    const [showCamera, setShowCamera] = useState(false)
    const [facing, setFacing] = useState<CameraType>('back')
    const [capturedImage, setCapturedImage] = useState<string | null>(null)
    const [caption, setCaption] = useState('')
    const [location, setLocation] = useState<LocationData | null>(null)
    const [loadingLocation, setLoadingLocation] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 })
    const [imageScale, setImageScale] = useState(1)
    const [imageDimensions, setImageDimensions] = useState({
        width: 0,
        height: 0,
    })
    const [containerSize, setContainerSize] = useState(CONTAINER_SIZE)
    const [scrollEnabled, setScrollEnabled] = useState(true)
    const cameraRef = useRef<CameraView>(null)
    const router = useRouter()
    const { user } = useAuth()
    const { triggerRefresh } = usePost()
    const imagePositionRef = useRef({ x: 0, y: 0 })
    const panStartPosition = useRef({ x: 0, y: 0 })

    // Update ref whenever position changes
    React.useEffect(() => {
        imagePositionRef.current = imagePosition
    }, [imagePosition])

    const panResponder = React.useMemo(
        () =>
            PanResponder.create({
                onStartShouldSetPanResponder: () => true,
                onStartShouldSetPanResponderCapture: () => true,
                onMoveShouldSetPanResponder: () => true,
                onMoveShouldSetPanResponderCapture: () => true,
                onPanResponderTerminationRequest: () => false,
                onPanResponderGrant: () => {
                    // Disable scrolling while panning the image
                    setScrollEnabled(false)
                    // Capture current position from ref (not state)
                    panStartPosition.current = { ...imagePositionRef.current }
                },
                onPanResponderMove: (evt, gestureState) => {
                    // Only allow vertical panning (y-axis)
                    let newY = panStartPosition.current.y + gestureState.dy

                    // Calculate bounds based on actual rendered image dimensions
                    if (
                        imageDimensions.width > 0 &&
                        imageDimensions.height > 0 &&
                        containerSize > 0
                    ) {
                        // Image fills container width (100%), calculate actual rendered height
                        const imageAspectRatio =
                            imageDimensions.height / imageDimensions.width
                        const renderedHeight = containerSize * imageAspectRatio

                        // Calculate bounds
                        // Image top can be at most at container top (y = 0)
                        // Image bottom can be at most at container bottom
                        const maxY = 0
                        const minY = containerSize - renderedHeight

                        // Only constrain if image is taller than container
                        if (renderedHeight > containerSize) {
                            // Clamp newY between minY and maxY
                            newY = Math.max(minY, Math.min(maxY, newY))
                        } else {
                            // Image is shorter than container, center it vertically
                            newY = (containerSize - renderedHeight) / 2
                        }
                    }

                    setImagePosition({
                        x: 0, // No horizontal panning
                        y: newY,
                    })
                },
                onPanResponderRelease: () => {
                    // Re-enable scrolling when done panning
                    setScrollEnabled(true)
                },
            }),
        [imageDimensions, containerSize]
    )

    const handleOpenCamera = async () => {
        if (!permission) {
            // Camera permissions are still loading
            return
        }

        if (!permission.granted) {
            // Request permission
            const result = await requestPermission()
            if (!result.granted) {
                Alert.alert(
                    'Camera Permission Required',
                    'Please enable camera permissions in settings to take photos.'
                )
                return
            }
        }

        setShowCamera(true)
    }

    const getDeviceLocation = async (): Promise<LocationData | null> => {
        try {
            // Request location permission
            const { status } =
                await Location.requestForegroundPermissionsAsync()

            if (status !== 'granted') {
                Alert.alert(
                    'Location Permission Required',
                    'Location is needed to tag your post. You can still post without it.'
                )
                return null
            }

            // Get current location
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            })

            return {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
            }
        } catch (error) {
            console.error('Error getting device location:', error)
            Alert.alert(
                'Location Error',
                'Could not get your current location.'
            )
            return null
        }
    }

    const handleTakePhoto = async () => {
        if (cameraRef.current) {
            try {
                const photo = await cameraRef.current.takePictureAsync({
                    quality: 0.8,
                })

                if (photo) {
                    await processPhoto(photo.uri)
                }
            } catch (error) {
                console.error('Error taking photo:', error)
                Alert.alert('Error', 'Failed to take photo. Please try again.')
                setLoadingLocation(false)
            }
        }
    }

    const prepareImageForPreview = async (uri: string): Promise<string> => {
        try {
            console.log('Preparing image for preview...')
            // Just resize for preview - we'll crop when posting
            const resized = await ImageManipulator.manipulateAsync(
                uri,
                [{ resize: { width: 1080 } }],
                {
                    compress: 0.8,
                    format: ImageManipulator.SaveFormat.JPEG,
                }
            )
            console.log('Image prepared successfully')
            return resized.uri
        } catch (error) {
            console.error('Error preparing image:', error)
            return uri
        }
    }

    const cropAndCompressImage = async (uri: string): Promise<string> => {
        try {
            console.log('Cropping and compressing image...')

            // Get image dimensions
            const { width, height } = await new Promise<{
                width: number
                height: number
            }>((resolve, reject) => {
                Image.getSize(
                    uri,
                    (width, height) => resolve({ width, height }),
                    reject
                )
            })

            // Calculate crop to square based on position
            const size = Math.min(width, height)
            const offsetX = -imagePosition.x * imageScale
            const offsetY = -imagePosition.y * imageScale

            const manipulations = [
                {
                    crop: {
                        originX: Math.max(0, Math.min(offsetX, width - size)),
                        originY: Math.max(0, Math.min(offsetY, height - size)),
                        width: size,
                        height: size,
                    },
                },
                { resize: { width: 1080 } },
            ]

            const result = await ImageManipulator.manipulateAsync(
                uri,
                manipulations,
                {
                    compress: 0.7,
                    format: ImageManipulator.SaveFormat.JPEG,
                }
            )

            console.log('Image cropped and compressed successfully')
            return result.uri
        } catch (error) {
            console.error('Error cropping image:', error)
            // Fallback: just compress without crop
            const compressed = await ImageManipulator.manipulateAsync(
                uri,
                [{ resize: { width: 1080 } }],
                {
                    compress: 0.7,
                    format: ImageManipulator.SaveFormat.JPEG,
                }
            )
            return compressed.uri
        }
    }

    const processPhoto = async (uri: string) => {
        setShowCamera(false)
        setLoadingLocation(true)

        // Prepare image for preview
        const previewUri = await prepareImageForPreview(uri)
        setCapturedImage(previewUri)

        // Get image dimensions
        Image.getSize(previewUri, (width, height) => {
            setImageDimensions({ width, height })
            console.log('Image dimensions:', width, height)
        })

        // Reset position and scale
        setImagePosition({ x: 0, y: 0 })
        setImageScale(1)

        // Get device location
        const photoLocation = await getDeviceLocation()

        setLocation(photoLocation)
        setLoadingLocation(false)

        if (photoLocation) {
            console.log('Location extracted:', photoLocation)
        } else {
            console.log('No location available')
        }
    }

    const handleFlipCamera = () => {
        setFacing((current) => (current === 'back' ? 'front' : 'back'))
    }

    const handlePost = async () => {
        if (!user || !capturedImage) {
            Alert.alert('Error', 'User not authenticated or no image captured')
            return
        }

        console.log('Starting post upload...')
        console.log('User ID:', user.uid)
        console.log('Image URI:', capturedImage)

        setUploading(true)

        try {
            // Get user's username from Firestore
            console.log('Fetching username from Firestore...')
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username = userDoc.exists()
                ? userDoc.data().username
                : 'Anonymous'
            console.log('Username:', username)

            // Crop and compress image based on user positioning
            console.log('Cropping image...')
            const croppedUri = await cropAndCompressImage(capturedImage)

            // Convert image URI to blob
            console.log('Converting image to blob...')
            const response = await fetch(croppedUri)
            const blob = await response.blob()
            console.log('Blob size:', blob.size, 'bytes')

            // Create unique filename with timestamp
            const timestamp = Date.now()
            const filename = `posts/${user.uid}/${timestamp}.jpg`
            const storageRef = ref(storage, filename)
            console.log('Uploading to Storage path:', filename)

            // Upload image to Firebase Storage
            console.log('Starting upload to Firebase Storage...')
            const uploadResult = await uploadBytes(storageRef, blob)
            console.log('Upload complete:', uploadResult)

            // Get download URL
            console.log('Getting download URL...')
            const photoURL = await getDownloadURL(storageRef)
            console.log('Download URL:', photoURL)

            // Create post document in Firestore (without exposing exact coordinates)
            const postData = {
                authorId: user.uid,
                authorUsername: username,
                photoURL: photoURL,
                caption: caption || '',
                hasLocation: !!location, // Only store boolean flag
                catchCount: 0,
                parentPostId: null,
                isOriginal: true,
                createdAt: new Date(),
            }

            console.log('Creating Firestore document...', postData)
            const docRef = await addDoc(collection(db, 'posts'), postData)
            console.log('Post created with ID:', docRef.id)

            // Store actual location in separate private collection (only accessible by Cloud Functions)
            if (location) {
                await addDoc(collection(db, 'post_locations'), {
                    postId: docRef.id,
                    latitude: location.latitude,
                    longitude: location.longitude,
                    createdAt: new Date(),
                })
                console.log('Location stored in private collection')
            }

            // Show success message
            const locationText = location ? 'Location: Captured' : 'No location'

            Alert.alert(
                'Success!',
                `Your post has been created!\n\nPost ID: ${docRef.id}\n${caption || '(no caption)'}\n${locationText}`
            )

            // Reset state
            setCapturedImage(null)
            setCaption('')
            setLocation(null)
            setUploading(false)

            // Trigger refresh for explore and profile pages
            triggerRefresh()

            // Navigate to profile
            router.push('/(tabs)/profile')
        } catch (error: any) {
            console.error('❌ ERROR posting:', error)
            console.error('Error code:', error.code)
            console.error('Error message:', error.message)
            console.error('Full error:', JSON.stringify(error, null, 2))
            setUploading(false)

            Alert.alert(
                'Error',
                `Failed to create post:\n\n${error.code || 'Unknown'}\n${error.message}`
            )
        }
    }

    const handleCancel = () => {
        setCapturedImage(null)
        setCaption('')
        setLocation(null)
        setShowCamera(false)
        setImagePosition({ x: 0, y: 0 })
        setImageScale(1)
    }

    // Camera View
    if (showCamera) {
        return (
            <View style={styles.cameraContainer}>
                <CameraView
                    ref={cameraRef}
                    style={styles.camera}
                    facing={facing}
                >
                    <View style={styles.cameraControls}>
                        <TouchableOpacity
                            style={styles.cameraButton}
                            onPress={() => setShowCamera(false)}
                        >
                            <Ionicons name="close" size={32} color="#fff" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.captureButton}
                            onPress={handleTakePhoto}
                        >
                            <View style={styles.captureButtonInner} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.cameraButton}
                            onPress={handleFlipCamera}
                        >
                            <Ionicons
                                name="camera-reverse"
                                size={32}
                                color="#fff"
                            />
                        </TouchableOpacity>
                    </View>
                </CameraView>
            </View>
        )
    }

    // Preview View
    if (capturedImage) {
        return (
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.container}
            >
                <ScrollView
                    contentContainerStyle={styles.previewContainer}
                    scrollEnabled={scrollEnabled}
                >
                    <Text style={styles.previewTitle}>Preview Your Post</Text>

                    <Text style={styles.cropHint}>
                        Drag to adjust photo position
                    </Text>

                    <View
                        style={styles.imageContainer}
                        {...panResponder.panHandlers}
                        onLayout={(event) => {
                            const { width } = event.nativeEvent.layout
                            setContainerSize(width)
                        }}
                    >
                        <Image
                            source={{ uri: capturedImage }}
                            style={[
                                styles.previewImage,
                                imageDimensions.width > 0 &&
                                    imageDimensions.height > 0 && {
                                        aspectRatio:
                                            imageDimensions.width /
                                            imageDimensions.height,
                                        height: undefined,
                                    },
                                {
                                    transform: [
                                        { translateX: imagePosition.x },
                                        { translateY: imagePosition.y },
                                        { scale: imageScale },
                                    ],
                                },
                            ]}
                        />
                    </View>

                    {/* Location Display */}
                    <View style={styles.locationContainer}>
                        {loadingLocation ? (
                            <View style={styles.locationLoading}>
                                <ActivityIndicator
                                    size="small"
                                    color={colors.primary}
                                />
                                <Text style={styles.locationLoadingText}>
                                    Getting location...
                                </Text>
                            </View>
                        ) : location ? (
                            <View style={styles.locationInfo}>
                                <Ionicons
                                    name="location"
                                    size={18}
                                    color={colors.primary}
                                />
                                <Text style={styles.locationText}>
                                    Location captured
                                </Text>
                            </View>
                        ) : (
                            <View style={styles.locationInfo}>
                                <Ionicons
                                    name="location-outline"
                                    size={18}
                                    color={colors.textTertiary}
                                />
                                <Text style={styles.noLocationText}>
                                    No location available
                                </Text>
                            </View>
                        )}
                    </View>

                    <TextInput
                        style={styles.captionInput}
                        placeholder="Add a caption or hint..."
                        placeholderTextColor={colors.textTertiary}
                        value={caption}
                        onChangeText={setCaption}
                        multiline
                        maxLength={200}
                    />

                    <View style={styles.buttonRow}>
                        <TouchableOpacity
                            style={[styles.actionButton, styles.cancelButton]}
                            onPress={handleCancel}
                            disabled={uploading}
                        >
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.actionButton,
                                styles.postButton,
                                (loadingLocation || uploading) &&
                                    styles.postButtonDisabled,
                            ]}
                            onPress={handlePost}
                            disabled={loadingLocation || uploading}
                        >
                            {uploading ? (
                                <View style={styles.uploadingContainer}>
                                    <ActivityIndicator
                                        size="small"
                                        color="#fff"
                                    />
                                    <Text style={styles.postButtonText}>
                                        Uploading...
                                    </Text>
                                </View>
                            ) : (
                                <Text style={styles.postButtonText}>Post</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        )
    }

    // Default View - Camera Button
    return (
        <View style={styles.container}>
            <Ionicons
                name="camera"
                size={80}
                color="#ccc"
                style={styles.icon}
            />
            <Text style={styles.title}>Create a Post</Text>
            <Text style={styles.subtitle}>
                Take a photo to share with the community
            </Text>

            <TouchableOpacity
                style={styles.openCameraButton}
                onPress={handleOpenCamera}
            >
                <Ionicons name="camera" size={24} color="#fff" />
                <Text style={styles.openCameraButtonText}>Open Camera</Text>
            </TouchableOpacity>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
        padding: 20,
    },
    icon: {
        marginBottom: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 10,
        color: colors.textPrimary,
    },
    subtitle: {
        fontSize: 16,
        color: colors.textTertiary,
        marginBottom: 30,
        textAlign: 'center',
    },
    openCameraButton: {
        backgroundColor: colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 30,
        paddingVertical: 15,
        borderRadius: 10,
        gap: 10,
        marginBottom: 15,
    },
    openCameraButtonText: {
        color: colors.textPrimary,
        fontSize: 18,
        fontWeight: '600',
    },
    cameraContainer: {
        flex: 1,
        backgroundColor: '#000',
    },
    camera: {
        flex: 1,
    },
    cameraControls: {
        flex: 1,
        backgroundColor: 'transparent',
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-around',
        paddingBottom: 50,
    },
    cameraButton: {
        padding: 15,
    },
    captureButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 4,
        borderColor: '#fff',
    },
    captureButtonInner: {
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#000',
    },
    previewContainer: {
        padding: 20,
        alignItems: 'center',
    },
    previewTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 10,
        marginTop: 20,
        color: colors.textPrimary,
    },
    cropHint: {
        fontSize: 14,
        color: colors.textTertiary,
        marginBottom: 15,
        textAlign: 'center',
    },
    imageContainer: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: colors.imageBackground,
        marginBottom: 15,
        position: 'relative',
    },
    previewImage: {
        width: '100%',
        height: undefined,
        position: 'absolute',
        top: 0,
        left: 0,
    },
    locationContainer: {
        width: '100%',
        marginBottom: 15,
    },
    locationLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        backgroundColor: colors.card,
        borderRadius: 8,
        gap: 10,
    },
    locationLoadingText: {
        fontSize: 14,
        color: colors.textTertiary,
    },
    locationInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        backgroundColor: colors.card,
        borderRadius: 8,
        gap: 8,
    },
    locationText: {
        fontSize: 14,
        color: colors.primary,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    noLocationText: {
        fontSize: 14,
        color: colors.textTertiary,
        fontStyle: 'italic',
    },
    captionInput: {
        width: '100%',
        backgroundColor: colors.card,
        padding: 15,
        borderRadius: 10,
        fontSize: 16,
        minHeight: 100,
        textAlignVertical: 'top',
        marginBottom: 20,
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.textPrimary,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 15,
        width: '100%',
    },
    actionButton: {
        flex: 1,
        paddingVertical: 15,
        borderRadius: 10,
        alignItems: 'center',
    },
    cancelButton: {
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
    },
    cancelButtonText: {
        color: colors.textPrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    postButton: {
        backgroundColor: colors.primary,
    },
    postButtonDisabled: {
        backgroundColor: colors.cardElevated,
        opacity: 0.6,
    },
    postButtonText: {
        color: colors.textPrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    uploadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
})
