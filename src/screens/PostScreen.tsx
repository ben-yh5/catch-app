import UnifiedCameraView from '@/components/UnifiedCameraView'
import UnifiedPreviewScreen from '@/components/UnifiedPreviewScreen'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { useDeviceSensors } from '@/hooks/useDeviceSensors'
import { db, storage } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Post } from '@/types'
import { validateCatch } from '@/utils/catchValidation'
import { getPostsInRadius } from '@/utils/geospatialQueries'
import { uploadTrainingPair } from '@/services/trainingData'
import { cropToSquare } from '@/utils/imageProcessing'
import { checkBlur } from '@/utils/imageValidation'
import { addPostToList } from '@/utils/listUtils'
import { findMostSimilar } from '@/utils/visualMatcher'
import { useToast } from '@/components/ui/Toast'
import { Ionicons } from '@expo/vector-icons'
import { useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    documentId,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { geohashForLocation } from 'geofire-common'
import React, { useRef, useState } from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface LocationData {
    latitude: number
    longitude: number
}

export default function PostScreen() {
    const [permission, requestPermission] = useCameraPermissions()
    const [status, requestLocationPermission] =
        Location.useForegroundPermissions()
    const [showCamera, setShowCamera] = useState(false)
    const [capturedImage, setCapturedImage] = useState<string | null>(null)
    const [location, setLocation] = useState<LocationData | null>(null)
    const [loadingLocation, setLoadingLocation] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [similarPost, setSimilarPost] = useState<Post | null>(null)
    const [catchTarget, setCatchTarget] = useState<Post | null>(null)
    const processingRef = useRef(false)
    const router = useRouter()
    const { user, dataContributionEnabled } = useAuth()
    const { notifyPostEvent } = usePost()
    const { showToast } = useToast()

    // Use shared sensor hook
    const {
        heading,
        capturedHeading,
        capturedPitch,
        startSensors,
        stopSensors,
        captureAndStop,
    } = useDeviceSensors()

    const handleOpenCamera = async () => {
        if (!permission) return

        if (!permission.granted) {
            const result = await requestPermission()
            if (!result.granted) {
                Alert.alert(
                    'Camera Permission Required',
                    'Please enable camera permissions in settings to take photos.'
                )
                return
            }
        }

        // Also request location permission here for the compass
        if (!status?.granted) {
            const result = await requestLocationPermission()
            if (!result.granted) {
                Alert.alert(
                    'Location Permission Required',
                    'Location is required for the compass and to tag your photos.'
                )
                return
            }
        }

        setShowCamera(true)
        startSensors()
    }

    const getDeviceLocation = async (): Promise<LocationData | null> => {
        try {
            if (!status?.granted) {
                const result = await requestLocationPermission()
                if (!result.granted) {
                    Alert.alert(
                        'Location Required',
                        'Location permission is required to share locations. Please enable location permissions in your device settings.'
                    )
                    return null
                }
            }

            // 1. Fetch fresh location (Strict Mode for New Posts)
            // We do NOT use lastKnownPosition here because new posts must be accurate
            try {
                const locationPromise = Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Highest, // Highest accuracy for new posts
                })

                const timeoutPromise = new Promise<Location.LocationObject>(
                    (_, reject) => {
                        setTimeout(
                            () =>
                                reject(new Error('Location request timed out')),
                            10000
                        )
                    }
                )

                const location = await Promise.race([
                    locationPromise,
                    timeoutPromise,
                ])
                console.log('[PostScreen] Got fresh location')
                return {
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                }
            } catch (error) {
                console.error(
                    '[PostScreen] Error getting fresh location:',
                    error
                )
                throw error
            }
        } catch (error) {
            console.error('Error getting device location:', error)
            showToast(
                'error',
                'Location Error',
                'Could not get your current location. Please try again or move to an area with better signal.'
            )
            return null
        }
    }

    const handlePhotoTaken = async (uri: string) => {
        // Snapshot sensor data at capture moment and stop sensors
        console.log('[PostScreen] Capturing photo. Heading:', heading)
        captureAndStop()

        // Mark as processing
        processingRef.current = true

        try {
            const processedUri = await cropToSquare(uri)

            // Check if cancelled
            if (!processingRef.current) {
                return
            }

            if (!processedUri) {
                throw new Error('Image processing returned null/undefined')
            }

            // Close camera and show preview
            setShowCamera(false)
            setCapturedImage(processedUri)
            setLoadingLocation(true)

            const photoLocation = await getDeviceLocation()

            // Check again if cancelled
            if (!processingRef.current) {
                setLoadingLocation(false)
                return
            }

            setLocation(photoLocation)
            setLoadingLocation(false)

            // Run nudge detection in background (non-blocking)
            if (photoLocation && processedUri) {
                checkForSimilarPosts(processedUri, photoLocation)
            }
        } catch (error) {
            console.error('Error in handlePhotoTaken:', error)
            if (processingRef.current) {
                showToast('error', 'Failed to process photo. Please try again.')
            }
        } finally {
            processingRef.current = false
        }
    }

    /**
     * Nudge: checks for visually similar nearby posts after photo capture.
     * Runs in background — doesn't block the preview screen.
     */
    const checkForSimilarPosts = async (
        imageUri: string,
        loc: LocationData
    ) => {
        try {
            // 1. Get nearby post locations
            const nearbyLocations = await getPostsInRadius({
                centerLat: loc.latitude,
                centerLng: loc.longitude,
                radiusInMeters: 50,
            })

            if (nearbyLocations.length === 0) return

            // 2. Batch fetch full post data (need photoURL)
            const postIds = nearbyLocations
                .map((l) => l.postId)
                .filter((id) => id) // safety
                .slice(0, 10) // limit batch size

            if (postIds.length === 0) return

            // Firestore 'in' queries support max 30 items
            const postsQuery = query(
                collection(db, 'posts'),
                where(documentId(), 'in', postIds)
            )
            const postsSnap = await getDocs(postsQuery)
            const nearbyPosts: Post[] = postsSnap.docs
                .map((d) => ({ id: d.id, ...d.data() }) as Post)
                .filter((p) => p.authorId !== user?.uid) // can't catch your own
                .filter((p) => p.isOriginal) // only root posts
                .slice(0, 3) // limit similarity checks

            if (nearbyPosts.length === 0) return

            // 3. Run visual similarity (use thumbnails for speed)
            const candidateUris = nearbyPosts.map(
                (p) => p.thumbnailURL || p.photoURL
            )
            const match = await findMostSimilar(imageUri, candidateUris)

            if (match) {
                console.log(
                    `[PostScreen] Nudge: similar post found (score=${match.score.toFixed(3)})`
                )
                setSimilarPost(nearbyPosts[match.index])
            }
        } catch (error) {
            // Non-critical — nudge failure should never block posting
            console.warn('[PostScreen] Nudge check failed:', error)
        }
    }

    const handleCatchInstead = (post: Post) => {
        // Switch to catch mode — keep the captured image, target this post
        setCatchTarget(post)
        setSimilarPost(null)
    }

    const handleNotAMatch = () => {
        const post = similarPost
        setSimilarPost(null)

        if (
            !dataContributionEnabled ||
            !post ||
            !capturedImage ||
            !location ||
            !user
        )
            return

        // Upload as hard negative in background — model thought they matched, user disagreed
        const meta = {
            latitude: location.latitude,
            longitude: location.longitude,
            heading: capturedHeading ?? undefined,
            pitch: capturedPitch ?? undefined,
            date: new Date(),
        }
        uploadTrainingPair(
            post.id,
            null,
            post.thumbnailURL || post.photoURL,
            capturedImage,
            meta,
            meta,
            'HARD_NEGATIVE',
            user.uid
        )
    }

    const handleCatchConfirm = async (
        caption?: string,
        listIds?: Set<string>
    ) => {
        if (!user || !capturedImage || !catchTarget || !location) {
            showToast('error', 'Missing information to complete catch.')
            return
        }

        setUploading(true)

        try {
            // 1. Validate catch (proximity, self-catch, duplicate)
            const validation = await validateCatch(
                catchTarget.id,
                location.latitude,
                location.longitude
            )
            if (!validation.isValid) {
                setUploading(false)
                showToast(
                    'warning',
                    'Too Far Away',
                    `You're ${validation.distance}m away. Must be within ${validation.requiredDistance}m.`
                )
                return
            }

            // 2. Quality check
            const isSharpEnough = await checkBlur(capturedImage)
            if (!isSharpEnough) {
                setUploading(false)
                showToast(
                    'warning',
                    'Too Blurry',
                    'Please steady your hand and try again.'
                )
                return
            }

            // 3. Upload image
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username = userDoc.exists()
                ? userDoc.data().username
                : 'Anonymous'

            const response = await fetch(capturedImage)
            const blob = await response.blob()
            const filename = `posts/${user.uid}/catch_${Date.now()}.jpg`
            const storageRef = ref(storage, filename)
            await uploadBytes(storageRef, blob)
            const photoURL = await getDownloadURL(storageRef)

            // 4. Create catch post
            const postData = {
                authorId: user.uid,
                authorUsername: username,
                photoURL,
                caption: caption?.trim() || '',
                hasLocation: true,
                catchCount: 0,
                parentPostId: catchTarget.id,
                rootPostId: catchTarget.id,
                isOriginal: false,
                createdAt: new Date(),
            }
            const docRef = await addDoc(collection(db, 'posts'), postData)

            // 5. Store location
            const geohash = geohashForLocation([
                location.latitude,
                location.longitude,
            ])
            await addDoc(collection(db, 'post_locations'), {
                postId: docRef.id,
                latitude: location.latitude,
                longitude: location.longitude,
                heading: capturedHeading,
                pitch: capturedPitch,
                geohash,
                createdAt: new Date(),
            })

            // 6. Add to lists
            if (listIds && listIds.size > 0) {
                await Promise.all(
                    Array.from(listIds).map((id) =>
                        addPostToList(id, docRef.id)
                    )
                ).catch((e) => console.error('Error adding to lists:', e))
            }

            showToast('success', 'Location caught!', 'Contribution earned!')

            // Reset state
            setCapturedImage(null)
            setLocation(null)
            setCatchTarget(null)
            setUploading(false)

            notifyPostEvent('catch', docRef.id, user.uid)
            router.push('/(tabs)/profile')
        } catch (error: any) {
            console.error('Error in catch confirm:', error)
            setUploading(false)
            showToast('error', 'Catch Failed', error.message || 'Unknown error')
        }
    }

    const handleCatchCancel = () => {
        // Go back to post preview mode (keep the image)
        setCatchTarget(null)
    }

    const handleCameraCancel = () => {
        processingRef.current = false
        setShowCamera(false)
        stopSensors()
        setLoadingLocation(false)
    }

    const handlePost = async (caption?: string, listIds?: Set<string>) => {
        if (!user || !capturedImage) {
            showToast('error', 'User not authenticated or no image captured')
            return
        }

        // Location is now mandatory
        if (!location) {
            Alert.alert(
                'Location Required',
                'You must enable location permissions to share a location. Please try again with location enabled.'
            )
            return
        }

        // Check for blur
        const isSharpEnough = await checkBlur(capturedImage)
        if (!isSharpEnough) {
            showToast(
                'warning',
                'Too Blurry',
                'Please steady your hand and try again.'
            )
            return
        }

        setUploading(true)

        try {
            // Get user's username from Firestore
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username = userDoc.exists()
                ? userDoc.data().username
                : 'Anonymous'

            // Convert image URI to blob
            const response = await fetch(capturedImage)
            const blob = await response.blob()

            // Create unique filename with timestamp
            const timestamp = Date.now()
            const filename = `posts/${user.uid}/${timestamp}.jpg`
            const storageRef = ref(storage, filename)

            // Upload image to Firebase Storage
            await uploadBytes(storageRef, blob)

            // Get download URL
            const photoURL = await getDownloadURL(storageRef)

            // Create post document in Firestore
            const postData = {
                authorId: user.uid,
                authorUsername: username,
                photoURL: photoURL,
                caption: caption?.trim() || '',
                hasLocation: true, // Always true now (location is mandatory)
                catchCount: 0,
                parentPostId: null,
                rootPostId: null, // Original posts have no root (they ARE the root)
                isOriginal: true,
                createdAt: new Date(),
            }

            const docRef = await addDoc(collection(db, 'posts'), postData)

            // Check nearby posts BEFORE writing location to estimate pioneer status
            const nearbyPosts = await getPostsInRadius({
                centerLat: location.latitude,
                centerLng: location.longitude,
                radiusInMeters: 50,
            })
            const isPioneer = nearbyPosts.length === 0

            // Store actual location in separate private collection with geohash
            const geohash = geohashForLocation([
                location.latitude,
                location.longitude,
            ])
            await addDoc(collection(db, 'post_locations'), {
                postId: docRef.id,
                latitude: location.latitude,
                longitude: location.longitude,
                heading: capturedHeading,
                pitch: capturedPitch,
                geohash: geohash,
                createdAt: new Date(),
            })

            // Add to selected lists
            if (listIds && listIds.size > 0) {
                try {
                    await Promise.all(
                        Array.from(listIds).map((listId) =>
                            addPostToList(listId, docRef.id)
                        )
                    )
                } catch (listError) {
                    console.error('Error adding to lists:', listError)
                }
            }

            const alertTitle = isPioneer
                ? 'Pioneer Bonus! (+10 XP)'
                : 'Shared! (+2 XP)'
            const alertMsg = isPioneer
                ? 'You mapped a new area! You are the first to post here.'
                : 'You added to the map! Nice shot.'

            showToast('success', alertTitle, alertMsg)

            // Reset state
            setCapturedImage(null)
            setLocation(null)
            setUploading(false)

            // Notify subscribers of new post creation
            notifyPostEvent('create', docRef.id, user.uid)

            // Navigate to profile
            router.push('/(tabs)/profile')
        } catch (error: any) {
            console.error('Error posting:', error)
            setUploading(false)
            showToast('error', 'Post Failed', error.message || 'Unknown error')
        }
    }

    const handleCancel = () => {
        processingRef.current = false
        setCapturedImage(null)
        setLocation(null)
        setSimilarPost(null)
        setCatchTarget(null)
        setLoadingLocation(false)
    }

    // Camera View
    if (showCamera) {
        return (
            <View style={{ flex: 1 }}>
                <UnifiedCameraView
                    onPhotoTaken={handlePhotoTaken}
                    onCancel={handleCameraCancel}
                />
            </View>
        )
    }

    // Preview View — catch mode (user tapped nudge card)
    if (capturedImage && catchTarget) {
        return (
            <UnifiedPreviewScreen
                imageUri={capturedImage}
                onConfirm={handleCatchConfirm}
                onCancel={handleCatchCancel}
                mode="catch"
                loading={uploading}
                loadingText="Catching..."
                hasLocation={!!location}
                loadingLocation={loadingLocation}
                originalPhotoUrl={catchTarget.photoURL}
            />
        )
    }

    // Preview View — post mode (default)
    if (capturedImage) {
        return (
            <UnifiedPreviewScreen
                imageUri={capturedImage}
                onConfirm={handlePost}
                onCancel={handleCancel}
                mode="post"
                loading={uploading}
                loadingText="Uploading..."
                hasLocation={!!location}
                loadingLocation={loadingLocation}
                similarPost={similarPost}
                onCatchInstead={handleCatchInstead}
                onNotAMatch={handleNotAMatch}
            />
        )
    }

    // Default View - Camera Button
    return (
        <View style={styles.container}>
            <Ionicons
                name="location"
                size={80}
                color="#ccc"
                style={styles.icon}
            />
            <Text style={styles.title} accessibilityRole="header">
                Share a Shot
            </Text>
            <Text style={styles.subtitle}>
                Capture and share photo-worthy views around the world
            </Text>

            <TouchableOpacity
                style={styles.openCameraButton}
                onPress={handleOpenCamera}
                accessibilityLabel="Open Camera"
                accessibilityRole="button"
                accessibilityHint="Open the camera to take a photo"
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
})
