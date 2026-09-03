import { CatchIssue } from '@/components/CatchIssuesPanel'
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
import * as Haptics from 'expo-haptics'
import * as Location from 'expo-location'
import { addDoc, collection, doc, getDoc } from 'firebase/firestore'
import { ref } from 'firebase/storage'
import { uploadImageWithProgress } from '@/utils/uploadImage'
import { geohashForLocation } from 'geofire-common'
import { useRef, useState } from 'react'
import { Alert, Linking } from 'react-native'

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

const LOCATION_DENIED_ISSUE: CatchIssue = {
    title: 'Location needed',
    message:
        'Catching verifies you are really at the spot. Enable location access in Settings, then retake your photo.',
    requiresRetake: true,
    action: 'settings',
}

/**
 * useCatchFlow - Hook to manage the multi-step "Catch" process
 * Includes: sensor tracking, photo processing, distance/orientation validation, and Firestore upload
 *
 * Validation UX: quality checks (brightness/blur) run at capture time, and
 * confirm-time checks are collected into `issues` in a single pass — the
 * preview shows every problem at once with a Retake action, instead of
 * revealing one transient toast per attempt.
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
    const [uploadProgress, setUploadProgress] = useState<number | null>(null)
    const catchPressGuard = useRef(false)
    const [fetchingLocation, setFetchingLocation] = useState(false)

    // Set after a successful catch to drive the CatchRevealModal (the
    // then/now payoff screen). Holds its own copy of the photo URI because
    // handlePreviewCancel clears catchImageUri.
    const [revealData, setRevealData] = useState<{
        originalPost: Post
        catchPhotoUri: string
    } | null>(null)

    const [statusMessage, setStatusMessage] = useState<string>('')

    // Validation problems shown persistently in the preview
    const [issues, setIssues] = useState<CatchIssue[]>([])
    // Capture-time quality results, reused at confirm so checks run once
    const [qualityIssues, setQualityIssues] = useState<CatchIssue[]>([])

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
        // Double-tap guard: the permission await leaves a window where a
        // second tap re-enters before catchMode flips
        if (catchPressGuard.current || catchMode) return
        catchPressGuard.current = true
        try {
            await startCatch()
        } finally {
            catchPressGuard.current = false
        }
    }

    const startCatch = async () => {
        if (!cameraPermission?.granted) {
            const { granted } = await requestCameraPermission()
            if (!granted) {
                Alert.alert(
                    'Camera access needed',
                    'Catching a shot means re-taking it with your camera. Enable camera access in Settings to continue.',
                    [
                        { text: 'Not Now', style: 'cancel' },
                        {
                            text: 'Open Settings',
                            onPress: () => Linking.openSettings(),
                        },
                    ]
                )
                return
            }
        }
        setCatchMode(true)
        startSensors()
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

    const handlePhotoTaken = async (photoUri: string) => {
        captureAndStop()
        try {
            const processedUri = await cropToSquare(photoUri)
            setCatchImageUri(processedUri)
            setCatchMode(false)
            setCatchPreviewMode(true)
            setIssues([])
            setQualityIssues([])

            setFetchingLocation(true)
            // Quality checks and location fix run concurrently; problems
            // surface in the preview immediately, before captioning
            const [quality, locationResult] = await Promise.all([
                runQualityChecks(processedUri),
                (async () => {
                    const { status } =
                        await Location.requestForegroundPermissionsAsync()
                    if (status !== 'granted') return 'denied' as const
                    try {
                        const location = await Location.getCurrentPositionAsync(
                            {}
                        )
                        return {
                            latitude: location.coords.latitude,
                            longitude: location.coords.longitude,
                        }
                    } catch {
                        return 'error' as const
                    }
                })(),
            ])

            const found = [...quality]
            if (locationResult === 'denied') {
                found.push(LOCATION_DENIED_ISSUE)
            } else if (locationResult === 'error') {
                found.push({
                    title: 'Location unavailable',
                    message:
                        "Couldn't get a location fix. Move somewhere with a clearer view of the sky, then retake.",
                    requiresRetake: true,
                })
            } else {
                setCatchLocation(locationResult)
            }

            setQualityIssues(quality)
            setIssues(found)
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
        setIssues([])
        setQualityIssues([])
        resetCapture()
    }

    // Back to the camera without abandoning the whole flow — the recovery
    // path for every "retake" issue
    const handleRetake = () => {
        setCatchPreviewMode(false)
        setCatchImageUri(null)
        setCatchLocation(null)
        setStatusMessage('')
        setIssues([])
        setQualityIssues([])
        resetCapture()
        setCatchMode(true)
        startSensors()
    }

    const handleConfirmCatch = async (
        caption?: string,
        listIds?: Set<string>
    ) => {
        if (!rootPost || !catchImageUri || !user) {
            showToast(
                'error',
                'Something went wrong',
                'Please retake your photo and try again.'
            )
            return
        }

        if (!catchLocation) {
            // Location was denied or failed at capture — the panel already
            // explains the fix; just make sure it's visible
            setIssues((prev) =>
                prev.length > 0 ? prev : [LOCATION_DENIED_ISSUE]
            )
            return
        }

        // Prevent self-catch (UI should already disable the button, but guard here too)
        if (rootPost.authorId === user.uid) {
            showToast(
                'warning',
                'Not Allowed',
                'You cannot catch your own shot.'
            )
            return
        }

        setUploading(true)
        setIssues([])
        setStatusMessage('Checking your shot...')

        try {
            // Single validation pass: collect EVERY failed check so the user
            // sees all problems at once instead of one per attempt
            const validation = await validateCatch(
                rootPost.id,
                catchLocation.latitude,
                catchLocation.longitude
            )

            const found: CatchIssue[] = [...qualityIssues]

            if (!validation.isValid) {
                found.push({
                    title: 'Too far away',
                    message: `You're ${validation.distance} m from this shot. Get within ${validation.requiredDistance} m, then try again.`,
                })
            }

            const HEADING_THRESHOLD = 75
            const PITCH_THRESHOLD = 75

            // Fail fast: if the original recorded an orientation but the
            // device produced none, the angle check can't run — say so
            // instead of silently passing a weaker validation.
            if (validation.heading !== undefined && capturedHeading === null) {
                found.push({
                    title: 'Compass unavailable',
                    message:
                        "This shot requires matching the original's direction, but your device didn't report a compass heading. Retake the photo, holding your phone level.",
                    requiresRetake: true,
                })
            }
            if (validation.pitch !== undefined && capturedPitch === null) {
                found.push({
                    title: 'Tilt sensor unavailable',
                    message:
                        "This shot requires matching the original's angle, but your device didn't report a tilt reading. Retake the photo, holding your phone steady.",
                    requiresRetake: true,
                })
            }

            if (validation.heading !== undefined && capturedHeading !== null) {
                let headingDiff = Math.abs(validation.heading - capturedHeading)
                if (headingDiff > 180) headingDiff = 360 - headingDiff
                if (headingDiff > HEADING_THRESHOLD) {
                    found.push({
                        title: 'Wrong direction',
                        message: `Turn to face the original view — you're off by ${Math.round(headingDiff)}°. Use the ghost overlay to line up, then retake.`,
                        requiresRetake: true,
                    })
                }
            }

            if (validation.pitch !== undefined && capturedPitch !== null) {
                const pitchDiff = Math.abs(validation.pitch - capturedPitch)
                if (pitchDiff > PITCH_THRESHOLD) {
                    found.push({
                        title: 'Wrong angle',
                        message: `Tilt your phone to match the original angle — you're off by ${Math.round(pitchDiff)}°. Retake to try again.`,
                        requiresRetake: true,
                    })
                }
            }

            if (found.length > 0) {
                Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Warning
                ).catch(() => {})
                setUploading(false)
                setStatusMessage('')
                setIssues(found)
                return
            }

            // Visual Verification ("The Judge") — runs only once everything
            // else passes, since it's the expensive on-device model
            setStatusMessage('Comparing views...')
            try {
                const similarity = await verifyViewSimilarity(
                    rootPost.photoURL,
                    catchImageUri
                )
                const SIMILARITY_THRESHOLD = 0.65 // Adjusted based on MobileNetV2 testing (Secure: 0.60-0.70)

                if (similarity < SIMILARITY_THRESHOLD) {
                    setUploading(false)
                    setStatusMessage('')
                    setIssues([
                        {
                            title: "Views don't match",
                            message:
                                "Your photo doesn't match the original view closely enough. Use the ghost overlay to line it up, then retake.",
                            requiresRetake: true,
                        },
                    ])
                    return
                }
            } catch (aiError) {
                // Fail open: don't block a catch on an ML infra problem, but
                // surface it so degraded verification isn't silent.
                console.warn(
                    '[CatchFlow] Visual verification skipped due to error:',
                    aiError
                )
                showToast(
                    'info',
                    'Visual Match Unavailable',
                    'Verified location and angle only — visual check could not run.'
                )
            }

            // Upload & Create Post
            setStatusMessage('Uploading catch...')
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            // Fail fast: never persist a placeholder author on a post
            const username: string | undefined = userDoc.exists()
                ? userDoc.data().username
                : undefined
            if (!username) {
                setUploading(false)
                setStatusMessage('')
                showToast(
                    'error',
                    'Profile not ready',
                    'Your account has no username yet — finish profile setup and try again.'
                )
                return
            }

            const response = await fetch(catchImageUri)
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

            // Add to lists. Scoped so a list failure can't propagate to the
            // outer catch and masquerade as "Catch failed" — the catch post
            // already exists at this point.
            if (listIds && listIds.size > 0) {
                try {
                    await Promise.all(
                        Array.from(listIds).map((id) =>
                            addPostToList(id, docRef.id)
                        )
                    )
                } catch (listError) {
                    console.error('Error adding to lists:', listError)
                    showToast(
                        'warning',
                        'Caught, but not saved to lists',
                        "Your catch was posted, but couldn't be added to the selected lists."
                    )
                }
            }

            // Data contribution. Requires the original's real coordinates —
            // skip entirely rather than upload fabricated 0,0 into the
            // training set.
            if (
                dataContributionEnabled &&
                capturedHeading !== null &&
                postLocation
            ) {
                const originalMeta: ImageMetadata = {
                    latitude: postLocation.latitude,
                    longitude: postLocation.longitude,
                    heading: postLocation.heading,
                    pitch: postLocation.pitch,
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

            // The reveal modal (then/now) is the success feedback — no toast
            Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
            ).catch(() => {})
            setRevealData({
                originalPost: rootPost,
                catchPhotoUri: catchImageUri,
            })
            onSuccess({ id: docRef.id, ...postData } as Post)
            setStatusMessage('')
            handlePreviewCancel()
        } catch (error: any) {
            console.error('Error in catch confirm:', error)
            setUploading(false)
            setUploadProgress(null)
            setStatusMessage('')
            showToast(
                'error',
                'Catch failed',
                'Something went wrong — check your connection and try again.'
            )
        }
    }

    return {
        catchMode,
        catchPreviewMode,
        catchImageUri,
        fetchingLocation,
        uploading,
        uploadProgress,
        statusMessage,
        issues,
        heading,
        handleCatchPress,
        handlePhotoTaken,
        handleCameraCancel,
        handleConfirmCatch,
        handlePreviewCancel,
        handleRetake,
        revealData,
        dismissReveal: () => setRevealData(null),
    }
}
