/**
 * useDeviceSensors Hook
 *
 * Manages device magnetometer and accelerometer sensors for compass heading
 * and pitch calculation. Used for photo orientation matching in catches.
 *
 * Features:
 * - Adaptive heading calculation (works in both flat and vertical orientations)
 * - Low-pass filtering for smooth readings
 * - Snapshot capture for saving sensor state at photo capture moment
 */

import { Accelerometer, Magnetometer } from 'expo-sensors'
import { useCallback, useEffect, useRef, useState } from 'react'

interface SensorData {
    x: number
    y: number
    z: number
}

interface DeviceSensorsResult {
    /** Current compass heading (0-360 degrees) */
    heading: number | null
    /** Current device pitch (-90 to 90 degrees) */
    pitch: number | null
    /** Captured heading at snapshot moment */
    capturedHeading: number | null
    /** Captured pitch at snapshot moment */
    capturedPitch: number | null
    /** Whether sensors are currently active */
    isActive: boolean
    /** Start sensor subscriptions */
    startSensors: () => Promise<void>
    /** Stop sensor subscriptions */
    stopSensors: () => void
    /** Capture current heading/pitch values and stop sensors */
    captureAndStop: () => void
    /** Reset captured values */
    resetCapture: () => void
}

/** Smoothing factor for low-pass filter (lower = smoother but slower) */
const SMOOTHING_ALPHA = 0.2

export function useDeviceSensors(): DeviceSensorsResult {
    // Live sensor values
    const [heading, setHeading] = useState<number | null>(null)
    const [pitch, setPitch] = useState<number | null>(null)

    // Captured (snapshotted) values
    const [capturedHeading, setCapturedHeading] = useState<number | null>(null)
    const [capturedPitch, setCapturedPitch] = useState<number | null>(null)

    // Subscription state
    const [isActive, setIsActive] = useState(false)
    const accelSubscriptionRef = useRef<{ remove: () => void } | null>(null)
    const magSubscriptionRef = useRef<{ remove: () => void } | null>(null)

    // Raw sensor data refs (avoid re-renders on every sensor update)
    const gravityRef = useRef<SensorData | null>(null)
    const magRef = useRef<SensorData | null>(null)

    // Smoothing refs for low-pass filter
    const smoothedHeadingRef = useRef<number | null>(null)
    const smoothedPitchRef = useRef<number | null>(null)

    /**
     * Calculate heading and pitch from raw sensor data
     * Uses cross-product method for tilt-compensated compass
     */
    const calculateHeading = useCallback(() => {
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

        // If Gravity Z is weak (< 0.7g), device is vertical (camera mode)
        if (Math.abs(G.z) < 0.7) {
            // Camera Mode (Vertical): Track -Z axis
            rawAngle = Math.atan2(-Ez_n, -Nz_n) * (180 / Math.PI)
        } else {
            // Map Mode (Flat): Track Y axis
            rawAngle = Math.atan2(Ey_n, Ny_n) * (180 / Math.PI)
        }

        if (rawAngle < 0) rawAngle += 360

        // 4. Calculate Pitch (vertical angle of camera)
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
    }, [])

    /**
     * Start sensor subscriptions
     */
    const startSensors = useCallback(async () => {
        if (accelSubscriptionRef.current || magSubscriptionRef.current) {
            return // Already active
        }

        const magAvailable = await Magnetometer.isAvailableAsync()
        const accelAvailable = await Accelerometer.isAvailableAsync()

        if (!magAvailable || !accelAvailable) {
            console.warn('[useDeviceSensors] Sensors not available')
            return
        }

        Magnetometer.setUpdateInterval(100)
        Accelerometer.setUpdateInterval(100)

        accelSubscriptionRef.current = Accelerometer.addListener(data => {
            gravityRef.current = data
            calculateHeading()
        })

        magSubscriptionRef.current = Magnetometer.addListener(data => {
            magRef.current = data
            calculateHeading()
        })

        setIsActive(true)
    }, [calculateHeading])

    /**
     * Stop sensor subscriptions
     */
    const stopSensors = useCallback(() => {
        accelSubscriptionRef.current?.remove()
        magSubscriptionRef.current?.remove()
        accelSubscriptionRef.current = null
        magSubscriptionRef.current = null
        gravityRef.current = null
        magRef.current = null
        setIsActive(false)
    }, [])

    /**
     * Capture current values and stop sensors
     */
    const captureAndStop = useCallback(() => {
        setCapturedHeading(heading)
        setCapturedPitch(pitch)
        stopSensors()
        // Reset smoothing refs for next session
        smoothedHeadingRef.current = null
        smoothedPitchRef.current = null
    }, [heading, pitch, stopSensors])

    /**
     * Reset captured values
     */
    const resetCapture = useCallback(() => {
        setCapturedHeading(null)
        setCapturedPitch(null)
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            accelSubscriptionRef.current?.remove()
            magSubscriptionRef.current?.remove()
        }
    }, [])

    return {
        heading,
        pitch,
        capturedHeading,
        capturedPitch,
        isActive,
        startSensors,
        stopSensors,
        captureAndStop,
        resetCapture,
    }
}
