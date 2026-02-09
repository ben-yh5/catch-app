import UnifiedCameraView from '@/components/UnifiedCameraView'
import UnifiedPreviewScreen from '@/components/UnifiedPreviewScreen'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { useDeviceSensors } from '@/hooks/useDeviceSensors'
import { db, storage } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { getPostsInRadius } from '@/utils/geospatialQueries'
import { cropToSquare } from '@/utils/imageProcessing'
import { checkBlur } from '@/utils/imageValidation'
import { addPostToList } from '@/utils/listUtils'
import { Ionicons } from '@expo/vector-icons'
import { useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
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
    const processingRef = useRef(false)
    const router = useRouter()
    const { user } = useAuth()
    const { notifyPostEvent } = usePost()

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

            // 1. Try last known location first for speed
            const lastKnown = await Location.getLastKnownPositionAsync({})
            if (lastKnown) {
                const now = Date.now()
                // If reasonably fresh (e.g., < 60 seconds), use it immediately
                if (now - lastKnown.timestamp < 60000) {
                    console.log('[PostScreen] Using fresh last known location')
                    return {
                        latitude: lastKnown.coords.latitude,
                        longitude: lastKnown.coords.longitude,
                    }
                }
            }

            // 2. Fetch fresh location with timeout
            try {
                const locationPromise = Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                })

                const timeoutPromise = new Promise<Location.LocationObject>((_, reject) => {
                    setTimeout(() => reject(new Error('Location request timed out')), 10000)
                })

                const location = await Promise.race([locationPromise, timeoutPromise])
                console.log('[PostScreen] Got fresh location')
                return {
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                }
            } catch (error) {
                console.warn('[PostScreen] Error getting fresh location:', error)

                // 3. Fallback to last known if available (even if stale)
                if (lastKnown) {
                    console.log('[PostScreen] Falling back to stale last known location')
                    return {
                        latitude: lastKnown.coords.latitude,
                        longitude: lastKnown.coords.longitude,
                    }
                }
                throw error
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
        stopSensors()
        setLoadingLocation(false)
    }

    const handlePost = async (caption?: string, listIds?: Set<string>) => {
        if (!user || !capturedImage) {
            Alert.alert('Error', 'User not authenticated or no image captured')
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
            Alert.alert('Too Blurry', 'Your photo is too blurry. Please steady your hand and try again.')
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

            // Calculate expected points based on nearby posts
            // This is a client-side estimate matching server logic
            let expectedPoints = 10 // PIONEER
            let type = 'Pioneer'

            // We need to check if there are nearby posts
            // Since we can't easily query geohashes here without bringing in more logic,
            // we'll rely on the server validation for the exact points.
            // But for immediate feedback, we can optimistically assume Pioneer unless we know otherwise.
            // Actually, we can't easily know without querying.
            // Let's just say "Contribution points incoming" but make it specific to the action.

            // Edit: Requirement is "show how many points are awarded".
            // Implementation Plan says: "Perform client-side check using getPostsInRadius(50) to estimate points."

            // Let's do that check
            const nearbyPosts = await getPostsInRadius({
                centerLat: location.latitude,
                centerLng: location.longitude,
                radiusInMeters: 50
            })

            const isPioneer = nearbyPosts.length === 0
            const points = isPioneer ? 10 : 2
            const badge = isPioneer ? 'Pioneer' : 'Nearby'

            const alertTitle = isPioneer ? 'Pioneer Bonus! (+10 XP)' : 'Shared! (+2 XP)'
            const alertMsg = isPioneer
                ? 'You mapped a new area! You are the first to post here.'
                : 'You added to the map! Nice shot.'

            Alert.alert(alertTitle, alertMsg)

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
