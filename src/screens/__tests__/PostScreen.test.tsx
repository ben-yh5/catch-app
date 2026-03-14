import { fireEvent, render, waitFor } from '@testing-library/react-native'
import * as Location from 'expo-location'
import React from 'react'
import PostScreen from '../PostScreen'

// Mocks
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('expo-camera', () => ({
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
}))

jest.mock('expo-location', () => ({
    useForegroundPermissions: () => [{ granted: true }, jest.fn()],
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { Balanced: 3, Highest: 6 },
}))

jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        user: { uid: 'test-uid' },
        dataContributionEnabled: false,
    }),
}))

jest.mock('../../context/PostContext', () => ({
    usePost: () => ({ notifyPostEvent: jest.fn() }),
}))

jest.mock('../../hooks/useDeviceSensors', () => ({
    useDeviceSensors: () => ({
        startSensors: jest.fn(),
        stopSensors: jest.fn(),
        captureAndStop: jest.fn(),
        heading: 0,
        capturedHeading: 0,
        capturedPitch: 0,
    }),
}))

jest.mock('../../utils/imageProcessing', () => ({
    cropToSquare: jest.fn((uri) => Promise.resolve(uri)),
}))

jest.mock('../../utils/imageValidation', () => ({
    checkBlur: jest.fn(() => Promise.resolve(true)),
}))

jest.mock('../../services/firebase', () => ({
    db: {},
    storage: {},
}))

jest.mock('firebase/firestore', () => ({
    getDoc: jest.fn(),
    getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
    doc: jest.fn(),
    collection: jest.fn(),
    addDoc: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    documentId: jest.fn(),
}))

jest.mock('firebase/storage', () => ({
    ref: jest.fn(),
    uploadBytes: jest.fn(),
    getDownloadURL: jest.fn(),
}))

jest.mock('../../utils/catchValidation', () => ({
    validateCatch: jest.fn(),
}))

jest.mock('../../utils/geospatialQueries', () => ({
    getPostsInRadius: jest.fn(() => Promise.resolve([])),
}))

jest.mock('../../services/trainingData', () => ({
    uploadTrainingPair: jest.fn(),
}))

jest.mock('../../utils/listUtils', () => ({
    addPostToList: jest.fn(),
}))

jest.mock('../../utils/visualMatcher', () => ({
    findMostSimilar: jest.fn(() => Promise.resolve(null)),
}))

jest.mock('geofire-common', () => ({
    geohashForLocation: jest.fn(() => 'abc123'),
}))

jest.mock('@/theme/colors', () => ({
    colors: {
        background: '#000',
        primary: '#007AFF',
        textPrimary: '#fff',
        textTertiary: '#999',
    },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.spyOn(require('react-native').Alert, 'alert')

// Mock UnifiedCameraView to simulating taking a photo immediately
jest.mock('@/components/UnifiedCameraView', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Button, Text, View } = require('react-native')
    const Component = ({ onPhotoTaken }: any) => (
        <View>
            <Text>Camera View</Text>
            <Button
                title="Take Photo"
                onPress={() => onPhotoTaken('test-uri')}
            />
        </View>
    )
    return {
        __esModule: true,
        default: Component,
    }
})

// Mock UnifiedPreviewScreen to inspect props
jest.mock('@/components/UnifiedPreviewScreen', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text, View } = require('react-native')
    const Component = (props: any) => (
        <View>
            <Text>Preview Screen</Text>
            <Text>
                Button Text:{' '}
                {props.loadingLocation ? 'Fetching location...' : 'Post'}
            </Text>
        </View>
    )
    return {
        __esModule: true,
        default: Component,
    }
})

describe('PostScreen', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('opens camera and hangs on fetching location if location service does not respond', async () => {
        // Mock location hanging (never resolving promise)
        ;(Location.getCurrentPositionAsync as jest.Mock).mockReturnValue(
            new Promise(() => {})
        )

        const { getByText } = render(<PostScreen />)

        // Open Camera
        fireEvent.press(getByText('Open Camera'))

        // Take Photo
        fireEvent.press(getByText('Take Photo'))

        // Expect "Fetching location..." to appear and stay
        // We need to wait for the state update (setLoadingLocation(true))
        await waitFor(() => {
            expect(getByText('Button Text: Fetching location...')).toBeTruthy()
        })

        // Verify that after timeout, it recovers
        // Advance timers by 10s (timeout duration) + 1s buffer
        jest.advanceTimersByTime(11000)

        // Wait for the state update (setLoadingLocation(false))
        await waitFor(() => {
            // Should show "Post" because loadingLocation is false
            // And location is null (because it timed out/failed)
            // But button text is "Post" when not loading location.
            expect(getByText('Button Text: Post')).toBeTruthy()
        })
    })
})
