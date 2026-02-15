import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-reanimated', () => {
    const Reanimated = require('react-native-reanimated/mock');

    // The mock for `call` immediately calls the callback which is incorrect
    // So we override it with a no-op
    Reanimated.default.call = () => { };

    return Reanimated;
});

// Silence the warning: Animated: `useNativeDriver` is not supported because the native animated module is missing
// jest.mock('react-native/Libraries/Animated/src/NativeAnimatedHelper');

// Mock @react-native-firebase/app-check for App Check bridge
jest.mock('@react-native-firebase/app-check', () => ({
    default: () => ({
        initializeAppCheck: jest.fn(),
        getToken: jest.fn().mockResolvedValue({
            token: 'mock-app-check-token',
        }),
    }),
    firebase: {
        appCheck: () => ({
            newReactNativeFirebaseAppCheckProvider: () => ({
                configure: jest.fn(),
            }),
        }),
    },
}));
