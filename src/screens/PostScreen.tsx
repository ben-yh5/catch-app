import UnifiedCameraView from '@/components/UnifiedCameraView'
import UnifiedPreviewScreen from '@/components/UnifiedPreviewScreen'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { db, storage } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { cropToSquare } from '@/utils/imageProcessing'
import { addPostToList } from '@/utils/listUtils'
import { Ionicons } from '@expo/vector-icons'
import { useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { Accelerometer, Magnetometer } from 'expo-sensors'
import { addDoc, collection, doc, getDoc } from 'firebase/firestore'
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
    const [status, requestLocationPermission] = Location.useForegroundPermissions()
    const [showCamera, setShowCamera] = useState(false)
    const [capturedImage, setCapturedImage] = useState<string | null>(null)
    const [location, setLocation] = useState<LocationData | null>(null)
    const [loadingLocation, setLoadingLocation] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [heading, setHeading] = useState<number | null>(null)
    const [pitch, setPitch] = useState<number | null>(null)
    const [capturedHeading, setCapturedHeading] = useState<number | null>(null)
    const [capturedPitch, setCapturedPitch] = useState<number | null>(null)
    const processingRef = useRef(false)
    const router = useRouter()
    const { user } = useAuth()
    const { notifyPostEvent } = usePost()
    // Refs to hold latest sensor data
    const debugRef = useRef<any>({})
    const [subscription, setSubscription] = useState<{ remove: () => void } | null>(null)

    // Refs for sensor data
    const gravityRef = useRef<{ x: number; y: number; z: number } | null>(null)
    const magRef = useRef<{ x: number; y: number; z: number } | null>(null)
    // Smoothing refs for low-pass filter
    const smoothedHeadingRef = useRef<number | null>(null)
    const smoothedPitchRef = useRef<number | null>(null)
    const SMOOTHING_ALPHA = 0.2 // Lower = smoother but slower response
    const [accelSubscription, setAccelSubscription] = useState<any>(null)
    const [magSubscription, setMagSubscription] = useState<any>(null)

    const toggleSensors = async (shouldEnable: boolean) => {
        if (shouldEnable) {
            if (accelSubscription || magSubscription) return

            const magAvailable = await Magnetometer.isAvailableAsync()
            const accelAvailable = await Accelerometer.isAvailableAsync()

            if (!magAvailable || !accelAvailable) {
                console.warn('[PostScreen] Sensors not available')
                return
            }

            Magnetometer.setUpdateInterval(100)
            Accelerometer.setUpdateInterval(100)

            const accelSub = Accelerometer.addListener(data => {
                gravityRef.current = data
                calculateHeading()
            })

            const magSub = Magnetometer.addListener(data => {
                magRef.current = data
                calculateHeading()
            })

            setAccelSubscription(accelSub)
            setMagSubscription(magSub)
        } else {
            accelSubscription && accelSubscription.remove()
            magSubscription && magSubscription.remove()
            setAccelSubscription(null)
            setMagSubscription(null)
            gravityRef.current = null
            magRef.current = null
        }
    }

    const calculateHeading = () => {
        if (!gravityRef.current || !magRef.current) return

        const G = gravityRef.current
        const M = magRef.current

        // 1. Cross product G x M = E (East)
        const Ex = M.y * G.z - M.z * G.y
        const Ey = M.z * G.x - M.x * G.z
        const Ez = M.x * G.y - M.y * G.x

        const E_norm = Math.sqrt(Ex * Ex + Ey * Ey + Ez * Ez)
        if (E_norm < 0.1) return

        const Ex_n = Ex / E_norm
        const Ey_n = Ey / E_norm
        const Ez_n = Ez / E_norm

        // 2. Cross product N = G x E (North)
        const Nx = G.y * Ez_n - G.z * Ey_n
        const Ny = G.z * Ex_n - G.x * Ez_n
        const Nz = G.x * Ey_n - G.y * Ex_n

        const N_norm = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz)
        const Nx_n = Nx / N_norm
        const Ny_n = Ny / N_norm
        const Nz_n = Nz / N_norm

        // 3. Adaptive Heading Calculation
        let rawAngle = 0

        // If Gravity Z is weak (< 0.7g), we are vertical
        if (Math.abs(G.z) < 0.7) {
            // Camera Mode (Vertical): Track -Z axis
            rawAngle = Math.atan2(-Ez_n, -Nz_n) * (180 / Math.PI)
        } else {
            // Map Mode (Flat): Track Y axis
            rawAngle = Math.atan2(Ey_n, Ny_n) * (180 / Math.PI)
        }

        if (rawAngle < 0) rawAngle += 360

        // 4. Calculate Pitch (vertical angle of camera)
        // When phone is vertical, G.z indicates how much camera tilts up/down
        // Pitch: -90° (looking down) to +90° (looking up), 0° = level
        const rawPitch = Math.asin(Math.max(-1, Math.min(1, G.z))) * (180 / Math.PI)

        // 5. Apply low-pass filter for smoothing
        if (smoothedHeadingRef.current === null) {
            smoothedHeadingRef.current = rawAngle
        } else {
            // Handle wraparound at 0°/360°
            let delta = rawAngle - smoothedHeadingRef.current
            if (delta > 180) delta -= 360
            if (delta < -180) delta += 360
            smoothedHeadingRef.current = (smoothedHeadingRef.current + SMOOTHING_ALPHA * delta + 360) % 360
        }

        if (smoothedPitchRef.current === null) {
            smoothedPitchRef.current = rawPitch
        } else {
            smoothedPitchRef.current = smoothedPitchRef.current + SMOOTHING_ALPHA * (rawPitch - smoothedPitchRef.current)
        }

        setHeading(Math.round(smoothedHeadingRef.current))
        setPitch(Math.round(smoothedPitchRef.current))
    }
    // Cleanup sensors
    React.useEffect(() => {
        return () => {
            subscription && subscription.remove()
        }
    }, [])

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
        toggleSensors(true)
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
                'Could not get your current location. Please try again.'
            )
            return null
        }
    }

    const handlePhotoTaken = async (uri: string) => {
        // Snapshot sensor data at capture moment
        console.log('[PostScreen] Capturing photo. Heading:', heading, 'Pitch:', pitch)
        setCapturedHeading(heading)
        setCapturedPitch(pitch)
        toggleSensors(false)
        // Reset smoothing refs for next session
        smoothedHeadingRef.current = null
        smoothedPitchRef.current = null

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
        } catch (error) {
            console.error('Error in handlePhotoTaken:', error)
            if (processingRef.current) {
                Alert.alert('Error', 'Failed to process photo. Please try again.')
            }
        } finally {
            processingRef.current = false
        }
    }

    const handleCameraCancel = () => {
        processingRef.current = false
        setShowCamera(false)
        toggleSensors(false)
        setLoadingLocation(false)
    }

    const handlePost = async (title?: string, caption?: string, listIds?: Set<string>) => {
        if (!user || !capturedImage) {
            Alert.alert('Error', 'User not authenticated or no image captured')
            return
        }

        // Title is required
        if (!title?.trim()) {
            Alert.alert('Title Required', 'Please add a title for your post.')
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
                title: title.trim(),
                caption: caption?.trim() || '',
                hasLocation: true, // Always true now (location is mandatory)
                catchCount: 0,
                parentPostId: null,
                rootPostId: null, // Original posts have no root (they ARE the root)
                isOriginal: true,
                createdAt: new Date(),
            }

            const docRef = await addDoc(collection(db, 'posts'), postData)

            // Store actual location in separate private collection with geohash
            const geohash = geohashForLocation([location.latitude, location.longitude])
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
                        Array.from(listIds).map(listId =>
                            addPostToList(listId, docRef.id)
                        )
                    )
                } catch (listError) {
                    console.error('Error adding to lists:', listError)
                }
            }

            Alert.alert('Success!', 'Your post has been created!')

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
            Alert.alert(
                'Error',
                `Failed to create post: ${error.message || 'Unknown error'}`
            )
        }
    }

    const handleCancel = () => {
        processingRef.current = false
        setCapturedImage(null)
        setLocation(null)
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
                <View style={{
                    position: 'absolute',
                    top: 100,
                    left: 20,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    padding: 10,
                    borderRadius: 8
                }}>
                    <Text style={{ color: 'white' }}>Mag: {heading}°</Text>
                    <Text style={{ color: 'white' }}>
                        a: {debugRef.current?.alpha?.toFixed(2)} b: {debugRef.current?.beta?.toFixed(2)} g: {debugRef.current?.gamma?.toFixed(2)}
                    </Text>
                </View>
            </View>
        )
    }

    // Preview View
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
            <Text style={styles.title}>Share a Shot</Text>
            <Text style={styles.subtitle}>
                Capture and share photo-worthy views around the world
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
})
