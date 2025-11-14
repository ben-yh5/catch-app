import React, { useRef, useState } from 'react'
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Dimensions,
    Image,
} from 'react-native'
import { CameraView, CameraType } from 'expo-camera'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')

interface UnifiedCameraViewProps {
    onPhotoTaken: (uri: string) => void
    onCancel: () => void
    originalPhotoUrl?: string // For catch mode - shows the original photo below
}

export default function UnifiedCameraView({
    onPhotoTaken,
    onCancel,
    originalPhotoUrl,
}: UnifiedCameraViewProps) {
    const [facing, setFacing] = useState<CameraType>('back')
    const [isCameraReady, setIsCameraReady] = useState(false)
    const cameraRef = useRef<CameraView>(null)

    const handleCameraReady = () => {
        console.log('Camera is ready')
        setIsCameraReady(true)
    }

    const handleTakePhoto = async () => {
        if (!isCameraReady) {
            console.log('Camera not ready yet')
            return
        }

        if (cameraRef.current) {
            try {
                console.log('Taking picture...')
                const photo = await cameraRef.current.takePictureAsync({
                    quality: 0.8,
                })

                if (photo) {
                    console.log('Picture taken successfully:', photo.uri)
                    onPhotoTaken(photo.uri)
                }
            } catch (error) {
                console.error('Error taking photo:', error)
            }
        }
    }

    const handleFlipCamera = () => {
        setFacing((current) => (current === 'back' ? 'front' : 'back'))
    }

    // Calculate the size of the 1:1 camera view (80% of screen width)
    const cameraViewSize = screenWidth * 0.8
    // Calculate vertical position to center it in the upper portion
    const cameraViewTop = originalPhotoUrl
        ? 0.0 // Higher up if showing original photo to fit both
        : (screenHeight - cameraViewSize) / 2 - 50 // Centered, accounting for controls

    return (
        <View style={styles.container}>
            {/* Square camera view container */}
            <View
                style={[
                    styles.cameraViewContainer,
                    {
                        width: cameraViewSize,
                        height: cameraViewSize,
                        top: cameraViewTop,
                        left: (screenWidth - cameraViewSize) / 2,
                    },
                ]}
            >
                <CameraView
                    ref={cameraRef}
                    style={styles.camera}
                    facing={facing}
                    ratio="1:1"
                    onCameraReady={handleCameraReady}
                />
            </View>

            {/* Original photo display for catch mode */}
            {originalPhotoUrl && (
                <View
                    style={[
                        styles.originalPhotoContainer,
                        { top: cameraViewTop + cameraViewSize + 10 },
                    ]}
                >
                    <Text style={styles.originalPhotoLabel}>
                        Original Photo:
                    </Text>
                    <Image
                        source={{ uri: originalPhotoUrl }}
                        style={[
                            styles.originalPhoto,
                            {
                                width: cameraViewSize,
                                height: cameraViewSize,
                            },
                        ]}
                        resizeMode="cover"
                    />
                </View>
            )}

            {/* Camera controls - outside camera view to avoid Android crashes */}
            <View style={styles.controls}>
                <TouchableOpacity
                    style={styles.controlButton}
                    onPress={onCancel}
                >
                    <Text style={styles.controlText}>✕</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.captureButton,
                        !isCameraReady && styles.captureButtonDisabled,
                    ]}
                    onPress={handleTakePhoto}
                    disabled={!isCameraReady}
                >
                    <View style={styles.captureButtonInner} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.controlButton}
                    onPress={handleFlipCamera}
                >
                    <Text style={styles.controlText}>⟳</Text>
                </TouchableOpacity>
            </View>

            {/* Camera ready indicator */}
            {!isCameraReady && (
                <View style={styles.loadingIndicator}>
                    <Text style={styles.loadingText}>Camera loading...</Text>
                </View>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    cameraViewContainer: {
        position: 'absolute',
        borderRadius: 10,
        overflow: 'hidden',
        borderWidth: 3,
        borderColor: '#fff',
    },
    camera: {
        flex: 1,
    },
    originalPhotoContainer: {
        position: 'absolute',
        alignSelf: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    originalPhotoLabel: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 4,
    },
    originalPhoto: {
        borderRadius: 10,
        borderWidth: 3,
        borderColor: '#fff',
    },
    controls: {
        position: 'absolute',
        bottom: 50,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    controlButton: {
        padding: 15,
        width: 60,
        height: 60,
        justifyContent: 'center',
        alignItems: 'center',
    },
    controlText: {
        color: '#fff',
        fontSize: 32,
        fontWeight: 'bold',
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
    captureButtonDisabled: {
        opacity: 0.5,
    },
    captureButtonInner: {
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#000',
    },
    loadingIndicator: {
        position: 'absolute',
        top: 100,
        alignSelf: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    loadingText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
})
