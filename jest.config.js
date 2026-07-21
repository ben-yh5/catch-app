module.exports = {
    preset: 'jest-expo',
    transform: {
        '^.+\\.([jt]sx?|mjs)$': 'babel-jest',
    },
    transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|native-base|react-native-svg|firebase|@firebase)',
    ],
    testPathIgnorePatterns: ['/node_modules/', 'firestore\\.rules\\.test\\.ts'],
    setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
}
