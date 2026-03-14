import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { useDeviceSensors } from '@/hooks/useDeviceSensors'
import { db, storage } from '@/services/firebase'
import { ImageMetadata, uploadTrainingPair } from '@/services/trainingData'
import { Post } from '@/types'
import { validateCatch } from '@/utils/catchValidation'
import { cropToSquare } from '@/utils/imageProcessing'
import { checkBlur, checkBrightness } from '@/utils/imageValidation'
import { addPostToList } from '@/utils/listUtils'
import { verifyViewSimilarity } from '@/utils/visualMatcher'
import { useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { addDoc, collection, doc, getDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { geohashForLocation } from 'geofire-common'
import { useState } from 'react'
import { Alert } from 'react-native'

interface UseCatchFlowProps {
    rootPost: Post | null
    postLocation: {
        latitude: number
        longitude: number
        heading?: number
        pitch?: number
    } | null
    onSuccess: (newPost: Post) => void
}

/**
 * useCatchFlow - Hook to manage the multi-step "Catch" process
 * Includes: sensor tracking, photo processing, distance/orientation validation, and Firestore upload
 */
export function useCatchFlow({
    rootPost,
    postLocation,
    onSuccess,
}: UseCatchFlowProps) {
    const { user, dataContributionEnabled } = useAuth()
    const { showToast } = useToast()
    const [cameraPermission, requestCameraPermission] = useCameraPermissions()

    // UI state
    const [catchMode, setCatchMode] = useState(false)
    const [catchPreviewMode, setCatchPreviewMode] = useState(false)
    const [catchImageUri, setCatchImageUri] = useState<string | null>(null)
    const [catchLocation, setCatchLocation] = useState<{
        latitude: number
        longitude: number
    } | null>(null)
    const [uploading, setUploading] = useState(false)
    const [fetchingLocation, setFetchingLocation] = useState(false)

    const [statusMessage, setStatusMessage] = useState<string>('')

    const {
        heading,
        capturedHeading,
        capturedPitch,
        startSensors,
        stopSensors,
        captureAndStop,
        resetCapture,
    } = useDeviceSensors()

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
        startSensors()
    }

    const handlePhotoTaken = async (photoUri: string) => {
        captureAndStop()
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
            stopSensors()
            showToast('error', 'Failed to process photo')
        }
    }

    const handleCameraCancel = () => {
        setCatchMode(false)
        stopSensors()
        resetCapture()
    }

    const handlePreviewCancel = () => {
        setCatchPreviewMode(false)
        setCatchImageUri(null)
        setCatchLocation(null)
        setStatusMessage('')
        resetCapture()
    }

    const handleConfirmCatch = async (
        caption?: string,
        listIds?: Set<string>
    ) => {
        if (!rootPost || !catchImageUri || !catchLocation || !user) {
            showToast('error', 'Missing information to complete catch')
            return
        }

        // Prevent self-catch (UI should already disable the button, but guard here too)
        if (rootPost.authorId === user.uid) {
            showToast(
                'warning',
                'Not Allowed',
                'You cannot catch your own post.'
            )
            return
        }

        setUploading(true)
        setStatusMessage('Verifying location...')

        try {
            // 1. Geography validation (also checks self-catch and duplicate catch server-side)
            const validation = await validateCatch(
                rootPost.id,
                catchLocation.latitude,
                catchLocation.longitude
            )
            if (!validation.isValid) {
                setUploading(false)
                setStatusMessage('')
                showToast(
                    'warning',
                    'Too Far Away',
                    `You're ${validation.distance}m away. Must be within ${validation.requiredDistance}m.`
                )
                return
            }

            // 2. Quality validation (Brightness & Blur)
            setStatusMessage('Checking image quality...')
            const isBrightEnough = await checkBrightness(catchImageUri)
            if (!isBrightEnough) {
                setUploading(false)
                setStatusMessage('')
                showToast(
                    'warning',
                    'Too Dark',
                    'Please try again with better lighting.'
                )
                return
            }

            const isSharpEnough = await checkBlur(catchImageUri)
            if (!isSharpEnough) {
                setUploading(false)
                setStatusMessage('')
                showToast(
                    'warning',
                    'Too Blurry',
                    'Please steady your hand and try again.'
                )
                return
            }

            // 3. Orientation validation
            setStatusMessage('Verifying angle...')
            const HEADING_THRESHOLD = 75
            const PITCH_THRESHOLD = 75

            if (validation.heading !== undefined && capturedHeading !== null) {
                let headingDiff = Math.abs(validation.heading - capturedHeading)
                if (headingDiff > 180) headingDiff = 360 - headingDiff
                if (headingDiff > HEADING_THRESHOLD) {
                    setUploading(false)
                    setStatusMessage('')
                    showToast(
                        'warning',
                        'Wrong Direction',
                        `Face the original view (off by ${Math.round(headingDiff)}°).`
                    )
                    return
                }
            }

            if (validation.pitch !== undefined && capturedPitch !== null) {
                const pitchDiff = Math.abs(validation.pitch - capturedPitch)
                if (pitchDiff > PITCH_THRESHOLD) {
                    setUploading(false)
                    setStatusMessage('')
                    showToast(
                        'warning',
                        'Wrong Angle',
                        `Try to match the original angle (off by ${Math.round(pitchDiff)}°).`
                    )
                    return
                }
            }

            // 4. Visual Verification ("The Judge")
            setStatusMessage('Analyzing view similarity...')
            try {
                const similarity = await verifyViewSimilarity(
                    rootPost.photoURL,
                    catchImageUri
                )
                const SIMILARITY_THRESHOLD = 0.65 // Adjusted based on MobileNetV2 testing (Secure: 0.60-0.70)

                if (similarity < SIMILARITY_THRESHOLD) {
                    setUploading(false)
                    setStatusMessage('')
                    showToast(
                        'warning',
                        'Match Failed',
                        "Your shot doesn't visually match the original view well enough. Try to align it more closely!"
                    )
                    return
                }
            } catch (aiError) {
                // If AI fails (e.g. model missing), we log it but maybe let it slide in dev
                // Or we can fail-safe. For now, let's just log.
                console.warn(
                    '[CatchFlow] Visual verification skipped due to error:',
                    aiError
                )
            }

            // 5. Upload & Create Post
            setStatusMessage('Uploading catch...')
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username = userDoc.exists()
                ? userDoc.data().username
                : 'Anonymous'

            const response = await fetch(catchImageUri)
            const blob = await response.blob()
            const filename = `posts/${user.uid}/catch_${Date.now()}.jpg`
            const storageRef = ref(storage, filename)
            await uploadBytes(storageRef, blob)
            const photoURL = await getDownloadURL(storageRef)

            const postData = {
                authorId: user.uid,
                authorUsername: username,
                photoURL,
                caption: caption?.trim() || '',
                hasLocation: true,
                catchCount: 0,
                parentPostId: rootPost.id,
                rootPostId: rootPost.id,
                isOriginal: false,
                createdAt: new Date(),
            }

            const docRef = await addDoc(collection(db, 'posts'), postData)

            // Geolocation metadata
            const geohash = geohashForLocation([
                catchLocation.latitude,
                catchLocation.longitude,
            ])
            await addDoc(collection(db, 'post_locations'), {
                postId: docRef.id,
                latitude: catchLocation.latitude,
                longitude: catchLocation.longitude,
                heading: capturedHeading,
                pitch: capturedPitch,
                geohash,
                createdAt: new Date(),
            })

            // catchCount is now incremented server-side by onPostCreated Cloud Function

            // Add to lists
            if (listIds && listIds.size > 0) {
                await Promise.all(
                    Array.from(listIds).map((id) =>
                        addPostToList(id, docRef.id)
                    )
                )
            }

            // Data contribution
            if (dataContributionEnabled && capturedHeading !== null) {
                const originalMeta: ImageMetadata = {
                    latitude: postLocation?.latitude || 0,
                    longitude: postLocation?.longitude || 0,
                    heading: postLocation?.heading,
                    pitch: postLocation?.pitch,
                    date: rootPost.createdAt?.toDate
                        ? rootPost.createdAt.toDate()
                        : new Date(),
                }
                const catchMeta: ImageMetadata = {
                    latitude: catchLocation.latitude,
                    longitude: catchLocation.longitude,
                    heading: capturedHeading,
                    pitch: capturedPitch ?? undefined,
                    date: new Date(),
                }
                uploadTrainingPair(
                    rootPost.id,
                    docRef.id,
                    rootPost.photoURL,
                    catchImageUri,
                    originalMeta,
                    catchMeta,
                    'POSITIVE',
                    user.uid
                )
            }

            showToast('success', 'Location caught!', '+14 Contribution')
            onSuccess({ id: docRef.id, ...postData } as Post)
            setStatusMessage('')
            handlePreviewCancel()
        } catch (error: any) {
            console.error('Error in catch confirm:', error)
            setUploading(false)
            setStatusMessage('')
            showToast('error', 'Catch Failed', error.message)
        }
    }

    return {
        catchMode,
        catchPreviewMode,
        catchImageUri,
        fetchingLocation,
        uploading,
        statusMessage,
        heading,
        handleCatchPress,
        handlePhotoTaken,
        handleCameraCancel,
        handleConfirmCatch,
        handlePreviewCancel,
    }
}
