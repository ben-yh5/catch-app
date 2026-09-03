module.exports = {
    preset: 'jest-expo',
    transform: {
        '^.+\\.([jt]sx?|mjs)$': 'babel-jest',
    },
    transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|native-base|react-native-svg|firebase|@firebase)',
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        'firestore\\.rules\\.test\\.ts',
        // Shared test helpers, not a suite
        '/__tests__/setup\\.ts$',
        // Compiled output of functions/src — stale suites linger here after
        // their .ts sources are deleted, and the originals already run
        '<rootDir>/functions/lib/',
    ],
    setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
}
