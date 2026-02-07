import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import React from 'react';
import PostScreen from '../PostScreen';

// Mocks
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('expo-camera', () => ({
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock('expo-location', () => ({
    useForegroundPermissions: () => [{ granted: true }, jest.fn()],
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { Balanced: 3 },
}));

jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: { uid: 'test-uid' } }),
}));

jest.mock('../../context/PostContext', () => ({
    usePost: () => ({ notifyPostEvent: jest.fn() }),
}));

jest.mock('../../hooks/useDeviceSensors', () => ({
    useDeviceSensors: () => ({
        startSensors: jest.fn(),
        stopSensors: jest.fn(),
        captureAndStop: jest.fn(),
        heading: 0,
        capturedHeading: 0,
        capturedPitch: 0,
    }),
}));

jest.mock('../../utils/imageProcessing', () => ({
    cropToSquare: jest.fn((uri) => Promise.resolve(uri)),
}));

jest.mock('../../utils/imageValidation', () => ({
    checkBlur: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../services/firebase', () => ({
    db: {},
    storage: {},
}));

jest.mock('firebase/firestore', () => ({
    getDoc: jest.fn(),
    doc: jest.fn(),
    collection: jest.fn(),
    addDoc: jest.fn(),
}));

jest.mock('firebase/storage', () => ({
    ref: jest.fn(),
    uploadBytes: jest.fn(),
    getDownloadURL: jest.fn(),
}));

jest.spyOn(require('react-native').Alert, 'alert');

// Mock UnifiedCameraView to simulating taking a photo immediately
jest.mock('@/components/UnifiedCameraView', () => {
    const { Button, Text, View } = require('react-native');
    const Component = ({ onPhotoTaken }: any) => (
        <View>
            <Text>Camera View</Text>
            <Button title="Take Photo" onPress={() => onPhotoTaken('test-uri')} />
        </View>
    );
    return {
        __esModule: true,
        default: Component,
    };
});

// Mock UnifiedPreviewScreen to inspect props
jest.mock('@/components/UnifiedPreviewScreen', () => {
    const { Text, View } = require('react-native');
    const Component = (props: any) => (
        <View>
            <Text>Preview Screen</Text>
            <Text>Button Text: {props.loadingLocation ? 'Fetching location...' : 'Post'}</Text>
        </View>
    );
    return {
        __esModule: true,
        default: Component,
    };
});

describe('PostScreen', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('opens camera and hangs on fetching location if location service does not respond', async () => {
        // Mock location hanging (never resolving promise)
        (Location.getCurrentPositionAsync as jest.Mock).mockReturnValue(new Promise(() => { }));

        const { getByText, queryByText } = render(<PostScreen />);

        // Open Camera
        fireEvent.press(getByText('Open Camera'));

        // Take Photo
        fireEvent.press(getByText('Take Photo'));

        // Expect "Fetching location..." to appear and stay
        // We need to wait for the state update (setLoadingLocation(true))
        await waitFor(() => {
            expect(getByText('Button Text: Fetching location...')).toBeTruthy();
        });

        // Verify that after timeout, it recovers
        // Advance timers by 10s (timeout duration) + 1s buffer
        jest.advanceTimersByTime(11000);

        // Wait for the state update (setLoadingLocation(false))
        await waitFor(() => {
            // Should show "Post" because loadingLocation is false
            // And location is null (because it timed out/failed)
            // But button text is "Post" when not loading location.
            expect(getByText('Button Text: Post')).toBeTruthy();
        });
    });
});
