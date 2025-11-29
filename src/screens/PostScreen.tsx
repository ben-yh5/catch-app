import React, { useState, useRef } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { collection, addDoc, doc, getDoc } from 'firebase/firestore'
import { storage, db } from '@/services/firebase'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import { colors } from '@/theme/colors'
import UnifiedCameraView from '@/components/UnifiedCameraView'
import UnifiedPreviewScreen from '@/components/UnifiedPreviewScreen'
import { cropToSquare } from '@/utils/imageProcessing'

interface LocationData {
    latitude: number
    longitude: number
}

export default function PostScreen() {
    const [permission, requestPermission] = useCameraPermissions()
    const [showCamera, setShowCamera] = useState(false)
    const [capturedImage, setCapturedImage] = useState<string | null>(null)
    const [location, setLocation] = useState<LocationData | null>(null)
    const [loadingLocation, setLoadingLocation] = useState(false)
    const [uploading, setUploading] = useState(false)
    const processingRef = useRef(false)
    const router = useRouter()
    const { user } = useAuth()
    const { triggerRefresh } = usePost()

    const handleOpenCamera = async () => {
        if (!permission) {
            return
        }

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

        setShowCamera(true)
    }

    const getDeviceLocation = async (): Promise<LocationData | null> => {
        try {
            const { status } =
                await Location.requestForegroundPermissionsAsync()

            if (status !== 'granted') {
                Alert.alert(
                    'Location Permission Required',
                    'Location is needed to tag your post. You can still post without it.'
                )
                return null
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
                'Could not get your current location.'
            )
            return null
        }
    }

    const handlePhotoTaken = async (uri: string) => {
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
        setLoadingLocation(false)
    }

    const handlePost = async (caption?: string) => {
        if (!user || !capturedImage) {
            Alert.alert('Error', 'User not authenticated or no image captured')
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
                caption: caption || '',
                hasLocation: !!location,
                catchCount: 0,
                parentPostId: null,
                rootPostId: null, // Original posts have no root (they ARE the root)
                isOriginal: true,
                createdAt: new Date(),
            }

            const docRef = await addDoc(collection(db, 'posts'), postData)

            // Store actual location in separate private collection
            if (location) {
                await addDoc(collection(db, 'post_locations'), {
                    postId: docRef.id,
                    latitude: location.latitude,
                    longitude: location.longitude,
                    createdAt: new Date(),
                })
            }

            Alert.alert('Success!', 'Your post has been created!')

            // Reset state
            setCapturedImage(null)
            setLocation(null)
            setUploading(false)

            // Trigger refresh for explore and profile pages
            triggerRefresh()

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
            <UnifiedCameraView
                onPhotoTaken={handlePhotoTaken}
                onCancel={handleCameraCancel}
            />
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
})
