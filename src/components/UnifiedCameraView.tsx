/**
 * UnifiedCameraView - Camera interface for both posts and catches
 *
 * Provides a full-screen camera experience with:
 * - Full screen immersive viewfinder (16:9 or device aspect)
 * - Square crop guide overlay (to show what will be captured)
 * - Front/back camera toggle
 * - Ghost Mode: Original reference image overlaid at 50% opacity
 *
 * Used by:
 * - PostScreen: Creating new original posts
 * - ThreadModal: Catching existing posts (shows original photo as reference)
 */

import { CATCH_RADIUS_METERS } from '@/utils/catchValidation'
import { Ionicons } from '@expo/vector-icons'
import { CameraType, CameraView } from 'expo-camera'
import { Image } from 'expo-image'
import * as Location from 'expo-location'
import { distanceBetween } from 'geofire-common'
import React, { useEffect, useRef, useState } from 'react'
import {
    Dimensions,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')
// Square size is full width
const CAPTURE_SIZE = screenWidth

interface UnifiedCameraViewProps {
    onPhotoTaken: (uri: string) => void
    onCancel: () => void
    originalPhotoUrl?: string
    /**
     * Target coordinates for catches. When set, a live distance pill shows
     * whether the user is within catch range BEFORE they commit to a photo.
     */
    targetLocation?: { latitude: number; longitude: number } | null
}

export default function UnifiedCameraView({
    onPhotoTaken,
    onCancel,
    originalPhotoUrl,
    targetLocation,
}: UnifiedCameraViewProps) {
    const [facing, setFacing] = useState<CameraType>('back')
    const [isCameraReady, setIsCameraReady] = useState(false)
    const [ghostOpacity] = useState(0.5)
    const [showGhost, setShowGhost] = useState(true)
    const [liveDistance, setLiveDistance] = useState<number | null>(null)
    const cameraRef = useRef<CameraView>(null)
    const insets = useSafeAreaInsets()

    // Live distance to the target while framing the shot
    useEffect(() => {
        if (!targetLocation) return

        let cancelled = false
        let subscription: Location.LocationSubscription | null = null

        ;(async () => {
            const { status } = await Location.getForegroundPermissionsAsync()
            if (status !== 'granted' || cancelled) return
            try {
                subscription = await Location.watchPositionAsync(
                    {
                        accuracy: Location.Accuracy.Balanced,
                        timeInterval: 2000,
                        distanceInterval: 3,
                    },
                    (loc) => {
                        const km = distanceBetween(
                            [loc.coords.latitude, loc.coords.longitude],
                            [targetLocation.latitude, targetLocation.longitude]
                        )
                        setLiveDistance(Math.round(km * 1000))
                    }
                )
                if (cancelled) subscription.remove()
            } catch (error) {
                console.warn('[Camera] Distance watcher failed:', error)
            }
        })()

        return () => {
            cancelled = true
            subscription?.remove()
        }
    }, [targetLocation])

    const handleCameraReady = () => {
        setIsCameraReady(true)
    }

    const handleTakePhoto = async () => {
        if (!isCameraReady || !cameraRef.current) return

        try {
            // Take the full picture
            const photo = await cameraRef.current.takePictureAsync({
                quality: 0.8,
                skipProcessing: true, // specific to android usually, helps speed
            })

            if (photo) {
                // The PostScreen handlePhotoTaken will handle cropping to square
                // based on the fact that we center-frame the subject
                onPhotoTaken(photo.uri)
            }
        } catch (error) {
            console.error('Error taking photo:', error)
        }
    }

    const handleFlipCamera = () => {
        setFacing((current) => (current === 'back' ? 'front' : 'back'))
    }

    // Toggle ghost mode visibility
    const toggleGhost = () => {
        setShowGhost((prev) => !prev)
    }

    // Calculate mask dimensions for the square guide
    // We want a square in the center. The top and bottom areas should be dimmed.
    // The camera fills the screen.
    // Center Y of screen
    const centerY = screenHeight / 2
    // Top of the square
    const squareTop = centerY - CAPTURE_SIZE / 2
    // Bottom of the square
    const squareBottom = centerY + CAPTURE_SIZE / 2

    return (
        <View style={styles.container}>
            <StatusBar hidden />

            {/* Full Screen Camera */}
            <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing={facing}
                // We use flex:1 to fill screen, ratio is handled by OS usually to fill parent
                // If on Android we might need specific ratio string if preview looks stretched
                onCameraReady={handleCameraReady}
            >
                {/* Ghost Image Overlay */}
                {originalPhotoUrl && showGhost && (
                    <View
                        style={[
                            styles.ghostContainer,
                            { opacity: ghostOpacity },
                        ]}
                    >
                        <Image
                            source={{ uri: originalPhotoUrl }}
                            style={{
                                width: CAPTURE_SIZE,
                                height: CAPTURE_SIZE,
                            }}
                            contentFit="cover"
                            accessibilityLabel="Original photo overlay for alignment"
                        />
                    </View>
                )}
            </CameraView>

            {/* Crop Guides (Dimmed areas) */}
            <View style={[styles.mask, { height: squareTop, top: 0 }]} />
            <View
                style={[
                    styles.mask,
                    { height: screenHeight - squareBottom, top: squareBottom },
                ]}
            />

            {/* Square Border Indicator */}
            <View
                style={[
                    styles.squareGuide,
                    {
                        top: squareTop,
                        height: CAPTURE_SIZE,
                    },
                ]}
            />

            {/* Live distance to target (catch mode) */}
            {targetLocation && liveDistance !== null && (
                <View
                    style={[
                        styles.distancePill,
                        { top: insets.top + 64 },
                        liveDistance <= CATCH_RADIUS_METERS
                            ? styles.distancePillInRange
                            : styles.distancePillOutOfRange,
                    ]}
                    accessibilityRole="text"
                    accessibilityLabel={
                        liveDistance <= CATCH_RADIUS_METERS
                            ? `In range, ${liveDistance} meters from the shot`
                            : `${liveDistance} meters away, get within ${CATCH_RADIUS_METERS} meters`
                    }
                >
                    <Ionicons
                        name={
                            liveDistance <= CATCH_RADIUS_METERS
                                ? 'checkmark-circle'
                                : 'walk'
                        }
                        size={16}
                        color="white"
                    />
                    <Text style={styles.distanceText}>
                        {liveDistance <= CATCH_RADIUS_METERS
                            ? `In range — ${liveDistance} m away`
                            : `${
                                  liveDistance < 1000
                                      ? `${liveDistance} m`
                                      : `${(liveDistance / 1000).toFixed(1)} km`
                              } away — get within ${CATCH_RADIUS_METERS} m`}
                    </Text>
                </View>
            )}

            {/* Top Controls */}
            <View style={[styles.topControls, { top: insets.top + 10 }]}>
                <TouchableOpacity
                    style={styles.iconButton}
                    onPress={onCancel}
                    accessibilityLabel="Close camera"
                    accessibilityRole="button"
                >
                    <Ionicons name="close" size={28} color="white" />
                </TouchableOpacity>

                {originalPhotoUrl && (
                    <TouchableOpacity
                        style={[
                            styles.ghostToggle,
                            !showGhost && styles.ghostToggleInactive,
                        ]}
                        onPress={toggleGhost}
                        accessibilityLabel={
                            showGhost
                                ? 'Hide ghost overlay'
                                : 'Show ghost overlay'
                        }
                        accessibilityRole="button"
                        accessibilityState={{ selected: showGhost }}
                    >
                        <Ionicons
                            name={showGhost ? 'eye' : 'eye-off'}
                            size={20}
                            color="white"
                        />
                        <Text style={styles.ghostText}>Ghost</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Bottom Controls */}
            <View
                style={[
                    styles.bottomControls,
                    { paddingBottom: insets.bottom + 20 },
                ]}
            >
                <TouchableOpacity
                    style={styles.iconButton}
                    onPress={handleFlipCamera}
                    accessibilityLabel={
                        facing === 'back'
                            ? 'Switch to front camera'
                            : 'Switch to back camera'
                    }
                    accessibilityRole="button"
                >
                    <Ionicons name="camera-reverse" size={28} color="white" />
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.captureButton,
                        !isCameraReady && styles.captureButtonDisabled,
                    ]}
                    onPress={handleTakePhoto}
                    disabled={!isCameraReady}
                    accessibilityLabel="Take photo"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !isCameraReady }}
                >
                    <View style={styles.captureButtonInner} />
                </TouchableOpacity>

                {/* Spacer to balance layout */}
                <View style={{ width: 44 }} />
            </View>

            {/* Camera Loading State */}
            {!isCameraReady && (
                <View style={styles.loadingOverlay}>
                    <Text style={styles.loadingText}>Starting Camera...</Text>
                </View>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'black',
    },
    camera: {
        flex: 1,
        justifyContent: 'center', // Centers the ghost image?
        alignItems: 'center',
    },
    mask: {
        position: 'absolute',
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        width: '100%',
    },
    squareGuide: {
        position: 'absolute',
        left: 0,
        right: 0,
        borderColor: 'rgba(255,255,255,0.3)',
        borderTopWidth: 1,
        borderBottomWidth: 1,
    },
    ghostContainer: {
        width: CAPTURE_SIZE,
        height: CAPTURE_SIZE,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        // Center vertically in the camera view (which matches screen)
        position: 'absolute',
        top: (screenHeight - CAPTURE_SIZE) / 2,
    },

    // Controls
    topControls: {
        position: 'absolute',
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        zIndex: 10,
    },
    bottomControls: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingHorizontal: 30,
    },

    // Buttons
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    ghostToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
    },
    ghostToggleInactive: {
        backgroundColor: 'rgba(0,0,0,0.3)',
        opacity: 0.7,
    },
    ghostText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
    distancePill: {
        position: 'absolute',
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        zIndex: 10,
    },
    distancePillInRange: {
        backgroundColor: 'rgba(48, 209, 88, 0.9)',
    },
    distancePillOutOfRange: {
        backgroundColor: 'rgba(255, 159, 10, 0.92)',
    },
    distanceText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 13,
    },

    // Shutter
    captureButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(255,255,255,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 4,
        borderColor: 'white',
    },
    captureButtonDisabled: {
        opacity: 0.5,
    },
    captureButtonInner: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'white',
    },

    // Loading
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'black',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 0,
    },
    loadingText: {
        color: 'white',
        fontSize: 16,
    },
})
