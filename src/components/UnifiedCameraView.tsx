/**
 * UnifiedCameraView - Camera interface for both posts and catches
 *
 * Built on react-native-vision-camera v5 (migrated from expo-camera, Sept
 * 2026 — expo-camera's Android zoom clamps to ≥1× and bridges every pinch
 * frame through JS, which felt nothing like the stock camera):
 * - Pinch-to-zoom is the NATIVE gesture (`enableNativeZoomGesture`) — zero
 *   JS involvement per frame. Because of that, the `zoom` prop must NOT be
 *   set (the two conflict); pills zoom imperatively via the controller.
 * - The back device requests the full virtual camera
 *   (ultra-wide + wide + telephoto), so zooming below 1× reaches the real
 *   ultrawide on both platforms where the OS exposes it.
 * - Zoom pills (0.5×/1×/2×) are computed from the controller's actual range
 *   in DISPLAY units: neutralRaw = zoom / displayableZoomFactor converts
 *   between raw zoom (iOS virtual devices start ultrawide at raw 1) and the
 *   user-facing factor. Same code path on both platforms.
 *
 * Provides a full-screen camera experience with:
 * - Full screen immersive viewfinder
 * - Square crop guide overlay (to show what will be captured)
 * - Front/back camera toggle
 * - Ghost Mode: Original reference image overlaid at 50% opacity
 *
 * Used by:
 * - PostScreen: Creating new original posts
 * - ThreadModal: Catching existing posts (shows original photo as reference)
 */

import { useToast } from '@/components/ui/Toast'
import { CATCH_RADIUS_METERS } from '@/utils/catchValidation'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import * as Location from 'expo-location'
import { distanceBetween } from 'geofire-common'
import React, { useEffect, useRef, useState } from 'react'
import {
    ActivityIndicator,
    Dimensions,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
    Camera,
    CameraRef,
    useCameraDevice,
    usePhotoOutput,
} from 'react-native-vision-camera'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')
// Square size is full width
const CAPTURE_SIZE = screenWidth

type Facing = 'back' | 'front'

interface ZoomPill {
    label: string
    /** Target factor in display units (1 = the wide lens's natural FOV) */
    display: number
}

interface UnifiedCameraViewProps {
    onPhotoTaken: (uri: string) => void | Promise<void>
    onCancel: () => void
    originalPhotoUrl?: string
    /**
     * Target coordinates for catches. When set, a live distance pill shows
     * whether the user is within catch range BEFORE they commit to a photo.
     */
    targetLocation?: { latitude: number; longitude: number } | null
    /**
     * Clearance for the bottom controls when the camera renders inside the
     * (tabs) navigator (pass useTabBarInset()). Omit in modals — they get
     * their own full-height window.
     */
    bottomInset?: number
}

export default function UnifiedCameraView({
    onPhotoTaken,
    onCancel,
    originalPhotoUrl,
    targetLocation,
    bottomInset = 0,
}: UnifiedCameraViewProps) {
    const [facing, setFacing] = useState<Facing>('back')
    const [isCameraReady, setIsCameraReady] = useState(false)
    const [capturing, setCapturing] = useState(false)
    const [ghostOpacity] = useState(0.5)
    const [showGhost, setShowGhost] = useState(true)
    const [liveDistance, setLiveDistance] = useState<number | null>(null)
    const [zoomPills, setZoomPills] = useState<ZoomPill[]>([])
    // Which pill the CURRENT zoom is nearest to (native pinch changes zoom
    // without any JS event, so this is refreshed by a light poll)
    const [nearestPill, setNearestPill] = useState<number>(1)
    // Converts display factors ↔ raw zoom: raw = display × neutralRaw
    const neutralRawRef = useRef(1)
    const cameraRef = useRef<CameraRef>(null)
    const insets = useSafeAreaInsets()
    const { showToast } = useToast()

    // The full virtual back camera (UW+W+T where available) so native zoom
    // can cross below 1× into the real ultrawide
    const device = useCameraDevice(
        facing,
        facing === 'back'
            ? {
                  physicalDevices: [
                      'ultra-wide-angle',
                      'wide-angle',
                      'telephoto',
                  ],
              }
            : undefined
    )
    const photoOutput = usePhotoOutput({ quality: 0.8 })

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

    const handleCameraStarted = () => {
        setIsCameraReady(true)
        const controller = cameraRef.current?.controller
        if (!controller || controller.displayableZoomFactor <= 0) {
            setZoomPills([])
            return
        }

        // Raw zoom at which the display factor reads 1× (iOS virtual devices
        // open at raw 1 = ultrawide; Android ratio semantics make this 1)
        const neutralRaw = controller.zoom / controller.displayableZoomFactor
        neutralRawRef.current = neutralRaw

        // Never open on the ultrawide — normalize the session to 1×
        if (Math.abs(controller.displayableZoomFactor - 1) > 0.01) {
            controller.setZoom(neutralRaw).catch(() => {})
        }
        setNearestPill(1)

        if (facing !== 'back') {
            setZoomPills([])
            return
        }
        const minDisplay = controller.minZoom / neutralRaw
        const maxDisplay = controller.maxZoom / neutralRaw
        const pills: ZoomPill[] = []
        // Small tolerance: a 0.49× min still deserves the 0.5× pill
        if (minDisplay <= 0.55) pills.push({ label: '.5', display: 0.5 })
        pills.push({ label: '1×', display: 1 })
        if (maxDisplay >= 2) pills.push({ label: '2', display: 2 })
        setZoomPills(pills.length >= 2 ? pills : [])
    }

    // Native pinch adjusts zoom with no JS event — poll the controller
    // (a cheap property read) so the highlighted pill tracks reality
    useEffect(() => {
        if (!isCameraReady || zoomPills.length === 0) return
        const interval = setInterval(() => {
            const controller = cameraRef.current?.controller
            if (!controller) return
            const display = controller.displayableZoomFactor
            let nearest = zoomPills[0].display
            for (const pill of zoomPills) {
                if (
                    Math.abs(pill.display - display) <
                    Math.abs(nearest - display)
                ) {
                    nearest = pill.display
                }
            }
            setNearestPill(nearest)
        }, 400)
        return () => clearInterval(interval)
    }, [isCameraReady, zoomPills])

    const handleSelectZoom = (pill: ZoomPill) => {
        const controller = cameraRef.current?.controller
        if (!controller) return
        Haptics.selectionAsync().catch(() => {})
        const target = Math.min(
            controller.maxZoom,
            Math.max(controller.minZoom, pill.display * neutralRawRef.current)
        )
        // Animated ramp like the stock camera; fall back to a hard set
        controller
            .startZoomAnimation(target, 8)
            .catch(() => controller.setZoom(target).catch(() => {}))
        setNearestPill(pill.display)
    }

    const handleTakePhoto = async () => {
        if (!isCameraReady || capturing) return

        // Flip the overlay on BEFORE any await — capture + the parent's
        // square-crop take long enough that a frozen viewfinder with no
        // feedback reads as a dead shutter button
        setCapturing(true)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
        try {
            // Zoom note: the captured photo carries the same zoom/lens as
            // the preview, so cropToSquare's screen-vs-photo math should
            // hold — validate the saved image against the viewfinder on
            // device (incl. at 0.5×) when touching this.
            const photoFile = await photoOutput.capturePhotoToFile({}, {})
            // The PostScreen handlePhotoTaken will handle cropping to square
            // based on the fact that we center-frame the subject.
            // Await it so the overlay also covers the crop; normally the
            // parent unmounts this view when the preview takes over.
            await onPhotoTaken(`file://${photoFile.filePath}`)
        } catch (error) {
            // Fail loud: a silent failure here makes the shutter button feel
            // dead — the user keeps tapping with no idea anything went wrong
            console.error('Error taking photo:', error)
            showToast(
                'error',
                'Could not capture photo',
                'Something went wrong with the camera — please try again.'
            )
        } finally {
            setCapturing(false)
        }
    }

    const handleFlipCamera = () => {
        // New device = new session; readiness, pills and zoom all re-derive
        // in onStarted
        setIsCameraReady(false)
        setZoomPills([])
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

            {/* Full Screen Camera. Native pinch-to-zoom and tap-to-focus —
                no zoom prop (it conflicts with the native gesture). */}
            {device && (
                <Camera
                    ref={cameraRef}
                    style={styles.camera}
                    device={device}
                    outputs={[photoOutput]}
                    isActive={true}
                    resizeMode="cover"
                    enableNativeZoomGesture={true}
                    enableNativeTapToFocusGesture={true}
                    onStarted={handleCameraStarted}
                    onStopped={() => setIsCameraReady(false)}
                    onError={(error) => {
                        console.error('[Camera] Session error:', error)
                        showToast(
                            'error',
                            'Camera error',
                            'The camera hit a problem — try closing and reopening it.'
                        )
                    }}
                />
            )}

            {/* Ghost Image Overlay (sibling — the Camera view has no
                children; positioned over the square guide area) */}
            {originalPhotoUrl && showGhost && (
                <View
                    style={[styles.ghostContainer, { opacity: ghostOpacity }]}
                    pointerEvents="none"
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

            {/* Crop Guides (Dimmed areas). pointerEvents none so the native
                pinch/tap gestures reach the camera underneath */}
            <View
                style={[styles.mask, { height: squareTop, top: 0 }]}
                pointerEvents="none"
            />
            <View
                style={[
                    styles.mask,
                    { height: screenHeight - squareBottom, top: squareBottom },
                ]}
                pointerEvents="none"
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
                pointerEvents="none"
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

            {/* Bottom Controls — bottomInset already includes the system
                inset when set (tab bar clearance), so don't add both */}
            <View
                style={[
                    styles.bottomArea,
                    { paddingBottom: (bottomInset || insets.bottom) + 20 },
                ]}
            >
                {/* Zoom pills — real factors from the device's zoom range
                    (0.5× only appears when the ultrawide is reachable) */}
                {zoomPills.length >= 2 && (
                    <View style={styles.lensRow}>
                        {zoomPills.map((pill) => {
                            const active = nearestPill === pill.display
                            return (
                                <TouchableOpacity
                                    key={pill.label}
                                    style={[
                                        styles.lensPill,
                                        active && styles.lensPillActive,
                                    ]}
                                    onPress={() => handleSelectZoom(pill)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Zoom ${pill.display}x`}
                                    accessibilityState={{ selected: active }}
                                >
                                    <Text
                                        style={[
                                            styles.lensPillText,
                                            active &&
                                                styles.lensPillTextActive,
                                        ]}
                                    >
                                        {pill.label}
                                    </Text>
                                </TouchableOpacity>
                            )
                        })}
                    </View>
                )}

                <View style={styles.bottomControls}>
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
                        <Ionicons
                            name="camera-reverse"
                            size={28}
                            color="white"
                        />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.captureButton,
                            (!isCameraReady || capturing) &&
                                styles.captureButtonDisabled,
                        ]}
                        onPress={handleTakePhoto}
                        disabled={!isCameraReady || capturing}
                        accessibilityLabel="Take photo"
                        accessibilityRole="button"
                        accessibilityState={{
                            disabled: !isCameraReady || capturing,
                        }}
                    >
                        <View style={styles.captureButtonInner} />
                    </TouchableOpacity>

                    {/* Spacer to balance layout */}
                    <View style={{ width: 44 }} />
                </View>
            </View>

            {/* Camera Loading State */}
            {!isCameraReady && (
                <View style={styles.loadingOverlay}>
                    <Text style={styles.loadingText}>Starting Camera...</Text>
                </View>
            )}

            {/* Capture-in-progress overlay. pointerEvents="none" keeps the
                cancel button reachable if processing hangs */}
            {capturing && (
                <View style={styles.capturingOverlay} pointerEvents="none">
                    <ActivityIndicator size="large" color="#fff" />
                    <Text style={styles.loadingText}>Processing photo...</Text>
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
        ...StyleSheet.absoluteFillObject,
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
        // Center vertically over the camera view (which fills the screen)
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
    bottomArea: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
    bottomControls: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingHorizontal: 30,
    },
    lensRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 10,
        marginBottom: 16,
    },
    lensPill: {
        minWidth: 40,
        height: 32,
        paddingHorizontal: 10,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.35)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    lensPillActive: {
        backgroundColor: 'rgba(255,255,255,0.25)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.7)',
    },
    lensPillText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 13,
        fontWeight: '600',
    },
    lensPillTextActive: {
        color: 'white',
        fontSize: 13,
        fontWeight: '700',
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

    capturingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.55)',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        zIndex: 20,
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
