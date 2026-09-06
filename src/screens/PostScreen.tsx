import { CatchIssue } from '@/components/CatchIssuesPanel'
import CatchRevealModal from '@/components/CatchRevealModal'
import UnifiedCameraView from '@/components/UnifiedCameraView'
import UnifiedPreviewScreen from '@/components/UnifiedPreviewScreen'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { useDeviceSensors } from '@/hooks/useDeviceSensors'
import { useTabBarInset } from '@/hooks/useTabBarInset'
import { db, storage } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Post } from '@/types'
import { validateCatch } from '@/utils/catchValidation'
import { getPostsInRadius } from '@/utils/geospatialQueries'
import { uploadTrainingPair } from '@/services/trainingData'
import { cropToSquare } from '@/utils/imageProcessing'
import { checkBlur, checkBrightness } from '@/utils/imageValidation'
import { addPostToList } from '@/utils/listUtils'
import { findMostSimilar } from '@/utils/visualMatcher'
import { useToast } from '@/components/ui/Toast'
import { Ionicons } from '@expo/vector-icons'
import { useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { useFocusEffect, useRouter } from 'expo-router'
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
import { ref } from 'firebase/storage'
import { uploadImageWithProgress } from '@/utils/uploadImage'
import { geohashForLocation } from 'geofire-common'
import React, { useCallback, useRef, useState } from 'react'
import {
    Alert,
    BackHandler,
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'

interface LocationData {
    latitude: number
    longitude: number
}

const openSettingsAlert = (title: string, message: string) => {
    Alert.alert(title, message, [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ])
}

const LOCATION_DENIED_ISSUE: CatchIssue = {
    title: 'Location needed',
    message:
        'Shots are pinned to the real spot where you took them. Enable location access in Settings, then retake your photo.',
    requiresRetake: true,
    action: 'settings',
}

const LOCATION_ERROR_ISSUE: CatchIssue = {
    title: 'Location unavailable',
    message:
        "Couldn't get a location fix. Move somewhere with a clearer view of the sky, then retake.",
    requiresRetake: true,
}

export default function PostScreen() {
    const tabBarInset = useTabBarInset()
    const [permission, requestPermission] = useCameraPermissions()
    const [status, requestLocationPermission] =
        Location.useForegroundPermissions()
    const [showCamera, setShowCamera] = useState(false)
    const [capturedImage, setCapturedImage] = useState<string | null>(null)
    const [location, setLocation] = useState<LocationData | null>(null)
    const [loadingLocation, setLoadingLocation] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState<number | null>(null)
    const [similarPost, setSimilarPost] = useState<Post | null>(null)
    const [catchTarget, setCatchTarget] = useState<Post | null>(null)
    const [revealData, setRevealData] = useState<{
        originalPost: Post
        catchPhotoUri: string
    } | null>(null)
    // Validation problems shown persistently on the preview screen
    const [previewIssues, setPreviewIssues] = useState<CatchIssue[]>([])
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
        // permission is null until useCameraPermissions resolves — on the
        // first focus that happens after the auto-open below has already
        // fired, so ask directly: requestPermission() resolves immediately
        // with the current status when it's already determined
        if (!permission?.granted) {
            const result = await requestPermission()
            if (!result.granted) {
                openSettingsAlert(
                    'Camera access needed',
                    'Sharing a shot means taking a fresh photo. Enable camera access in Settings to continue.'
                )
                return
            }
        }

        // Also request location permission here for the compass
        if (!status?.granted) {
            const result = await requestLocationPermission()
            if (!result.granted) {
                openSettingsAlert(
                    'Location access needed',
                    'Shots are pinned to the real spot where you take them. Enable location access in Settings to continue.'
                )
                return
            }
        }

        setShowCamera(true)
        startSensors()
    }

    // The plus tab IS the camera — open it as soon as the tab gains focus.
    // Ref indirection keeps the focus callback stable so this fires once per
    // focus (never on state changes while focused): cancelling the camera or
    // a preview lands on the fallback screen instead of bouncing back in.
    const autoOpenRef = useRef<() => void>(() => {})
    autoOpenRef.current = () => {
        if (!showCamera && !capturedImage && !revealData && !uploading) {
            handleOpenCamera()
        }
    }
    // Blur closes what focus opened, so the camera session and sensors don't
    // keep running behind another tab. A captured preview survives tab
    // switches — only the live camera is torn down.
    const blurCloseRef = useRef<() => void>(() => {})
    blurCloseRef.current = () => {
        if (showCamera) {
            handleCameraCancel()
        }
    }
    // Android hardware back mirrors the on-screen cancel instead of popping
    // to the home tab: catch preview → post preview → camera. Unhandled cases
    // (camera, fallback screen, mid-upload) fall through to the navigator.
    const backPressRef = useRef<() => boolean>(() => false)
    backPressRef.current = () => {
        if (!capturedImage || uploading) return false
        if (catchTarget) {
            handleCatchCancel()
        } else {
            handleCancel()
        }
        return true
    }
    useFocusEffect(
        useCallback(() => {
            const backSub = BackHandler.addEventListener(
                'hardwareBackPress',
                () => backPressRef.current()
            )
            autoOpenRef.current()
            return () => {
                backSub.remove()
                blurCloseRef.current()
            }
        }, [])
    )

    const getDeviceLocation = async (): Promise<
        LocationData | 'denied' | 'error'
    > => {
        try {
            if (!status?.granted) {
                const result = await requestLocationPermission()
                if (!result.granted) {
                    return 'denied'
                }
            }

            // Fetch fresh location (Strict Mode for New Posts)
            // We do NOT use lastKnownPosition here because new posts must be accurate
            const locationPromise = Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Highest, // Highest accuracy for new posts
            })

            const timeoutPromise = new Promise<Location.LocationObject>(
                (_, reject) => {
                    setTimeout(
                        () => reject(new Error('Location request timed out')),
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
            console.error('Error getting device location:', error)
            return 'error'
        }
    }

    const runQualityChecks = async (uri: string): Promise<CatchIssue[]> => {
        const [isBrightEnough, isSharpEnough] = await Promise.all([
            checkBrightness(uri),
            checkBlur(uri),
        ])
        const found: CatchIssue[] = []
        if (!isBrightEnough) {
            found.push({
                title: 'Too dark',
                message: 'Retake your photo with better lighting.',
                requiresRetake: true,
            })
        }
        if (!isSharpEnough) {
            found.push({
                title: 'Too blurry',
                message: 'Hold your phone steady and retake the photo.',
                requiresRetake: true,
            })
        }
        return found
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
            setPreviewIssues([])
            setLoadingLocation(true)

            // Quality checks and location fix run concurrently; problems
            // surface in the preview immediately, before captioning
            const [locationResult, quality] = await Promise.all([
                getDeviceLocation(),
                runQualityChecks(processedUri),
            ])

            // Check again if cancelled
            if (!processingRef.current) {
                setLoadingLocation(false)
                return
            }

            const found = [...quality]
            let photoLocation: LocationData | null = null
            if (locationResult === 'denied') {
                found.push(LOCATION_DENIED_ISSUE)
            } else if (locationResult === 'error') {
                found.push(LOCATION_ERROR_ISSUE)
            } else {
                photoLocation = locationResult
            }

            setLocation(photoLocation)
            setPreviewIssues(found)
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
        if (!user || !capturedImage || !catchTarget) {
            showToast(
                'error',
                'Something went wrong',
                'Please retake your photo and try again.'
            )
            return
        }

        if (!location) {
            // Location was denied or failed at capture — the panel already
            // explains the fix; just make sure it's visible
            setPreviewIssues((prev) =>
                prev.length > 0 ? prev : [LOCATION_DENIED_ISSUE]
            )
            return
        }

        setUploading(true)
        setPreviewIssues([])

        try {
            // 1. Validate catch (proximity, self-catch, duplicate) —
            // quality was already checked at capture time
            const validation = await validateCatch(
                catchTarget.id,
                location.latitude,
                location.longitude
            )
            if (!validation.isValid) {
                setUploading(false)
                setPreviewIssues([
                    {
                        title: 'Too far away',
                        message: `You're ${validation.distance} m from this shot. Get within ${validation.requiredDistance} m, then try again.`,
                    },
                ])
                return
            }

            // 2. Upload image
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            // Fail fast: never persist a placeholder author on a post
            const username: string | undefined = userDoc.exists()
                ? userDoc.data().username
                : undefined
            if (!username) {
                setUploading(false)
                showToast(
                    'error',
                    'Profile not ready',
                    'Your account has no username yet — finish profile setup and try again.'
                )
                return
            }

            const response = await fetch(capturedImage)
            const blob = await response.blob()
            const filename = `posts/${user.uid}/catch_${Date.now()}.jpg`
            const storageRef = ref(storage, filename)
            setUploadProgress(0)
            const photoURL = await uploadImageWithProgress(
                storageRef,
                blob,
                setUploadProgress
            )
            setUploadProgress(null)

            // 3. Create catch post
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

            // 4. Store location
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

            // 5. Add to lists — the catch itself succeeded, so a list
            // failure must be reported as exactly that, not swallowed
            if (listIds && listIds.size > 0) {
                try {
                    await Promise.all(
                        Array.from(listIds).map((id) =>
                            addPostToList(id, docRef.id)
                        )
                    )
                } catch (e) {
                    console.error('Error adding to lists:', e)
                    showToast(
                        'warning',
                        'Caught, but not saved to lists',
                        "Your catch was posted, but couldn't be added to the selected lists."
                    )
                }
            }

            // The reveal modal (then/now) is the success feedback — no toast.
            // Capture reveal data before resetting state; navigation happens
            // when the user dismisses the reveal.
            setRevealData({
                originalPost: catchTarget,
                catchPhotoUri: capturedImage,
            })

            // Reset state
            setCapturedImage(null)
            setLocation(null)
            setCatchTarget(null)
            setPreviewIssues([])
            setUploading(false)

            notifyPostEvent('catch', docRef.id, user.uid)
        } catch (error: any) {
            console.error('Error in catch confirm:', error)
            setUploading(false)
            setUploadProgress(null)
            showToast(
                'error',
                'Catch failed',
                'Something went wrong — check your connection and try again.'
            )
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
            showToast(
                'error',
                'Something went wrong',
                'Please retake your photo and try again.'
            )
            return
        }

        // Location is mandatory — the capture-time panel already explains
        // the fix if it's missing (quality problems disable the button)
        if (!location) {
            setPreviewIssues((prev) =>
                prev.length > 0 ? prev : [LOCATION_DENIED_ISSUE]
            )
            return
        }

        setUploading(true)

        try {
            // Get user's username from Firestore.
            // Fail fast: never persist a placeholder author on a post
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username: string | undefined = userDoc.exists()
                ? userDoc.data().username
                : undefined
            if (!username) {
                setUploading(false)
                showToast(
                    'error',
                    'Profile not ready',
                    'Your account has no username yet — finish profile setup and try again.'
                )
                return
            }

            // Convert image URI to blob
            const response = await fetch(capturedImage)
            const blob = await response.blob()

            // Create unique filename with timestamp
            const timestamp = Date.now()
            const filename = `posts/${user.uid}/${timestamp}.jpg`
            const storageRef = ref(storage, filename)

            // Upload image to Firebase Storage (with progress)
            setUploadProgress(0)
            const photoURL = await uploadImageWithProgress(
                storageRef,
                blob,
                setUploadProgress
            )
            setUploadProgress(null)

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

            // Add to selected lists — the post itself succeeded, so a list
            // failure must be reported as exactly that, not swallowed
            if (listIds && listIds.size > 0) {
                try {
                    await Promise.all(
                        Array.from(listIds).map((listId) =>
                            addPostToList(listId, docRef.id)
                        )
                    )
                } catch (listError) {
                    console.error('Error adding to lists:', listError)
                    showToast(
                        'warning',
                        'Posted, but not saved to lists',
                        "Your shot was posted, but couldn't be added to the selected lists."
                    )
                }
            }

            const alertTitle = isPioneer ? 'Pioneer!' : 'Shared!'
            const alertMsg = isPioneer
                ? "You're the first to map this spot."
                : 'You added to the map! Nice shot.'

            showToast('success', alertTitle, alertMsg)

            // Reset state
            setCapturedImage(null)
            setLocation(null)
            setPreviewIssues([])
            setUploading(false)

            // Notify subscribers of new post creation
            notifyPostEvent('create', docRef.id, user.uid)

            // Navigate to profile
            router.push('/(tabs)/profile')
        } catch (error: any) {
            console.error('Error posting:', error)
            setUploading(false)
            setUploadProgress(null)
            showToast('error', 'Post Failed', error.message || 'Unknown error')
        }
    }

    // Back from the preview returns to the camera (dropping the shot and any
    // catch mode) — the tab is the camera; leaving it is what exits the flow
    const handleCancel = () => {
        processingRef.current = false
        setCapturedImage(null)
        setLocation(null)
        setSimilarPost(null)
        setCatchTarget(null)
        setPreviewIssues([])
        setLoadingLocation(false)
        setShowCamera(true)
        startSensors()
    }

    // Back to the camera without abandoning the flow (keeps catch mode if
    // active) — the recovery path for every "retake" issue
    const handleRetake = () => {
        processingRef.current = false
        setCapturedImage(null)
        setLocation(null)
        setSimilarPost(null)
        setPreviewIssues([])
        setLoadingLocation(false)
        setShowCamera(true)
        startSensors()
    }

    // Camera View
    if (showCamera) {
        return (
            <View style={{ flex: 1 }}>
                <UnifiedCameraView
                    onPhotoTaken={handlePhotoTaken}
                    onCancel={handleCameraCancel}
                    bottomInset={tabBarInset}
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
                issues={previewIssues}
                onRetake={handleRetake}
                uploadProgress={uploadProgress}
                bottomInset={tabBarInset}
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
                issues={previewIssues}
                onRetake={handleRetake}
                uploadProgress={uploadProgress}
                bottomInset={tabBarInset}
            />
        )
    }

    // Default View - Camera Button
    return (
        <View style={styles.container}>
            {/* Catch reveal — then/now payoff after catching via the nudge */}
            <CatchRevealModal
                visible={!!revealData}
                originalPost={revealData?.originalPost ?? null}
                catchPhotoUri={revealData?.catchPhotoUri ?? null}
                onClose={() => {
                    setRevealData(null)
                    router.push('/(tabs)/profile')
                }}
            />
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
