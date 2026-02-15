import { initializeApp } from 'firebase/app'
import { initializeAuth, getReactNativePersistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
import { initializeAppCheck, CustomProvider } from 'firebase/app-check'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

// Initialize Firebase Auth with AsyncStorage persistence
export const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
})

export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

// Initialize App Check (native platforms only)
// Bridges native attestation (App Attest / Play Integrity) to JS SDK
// TODO: Requires Apple Developer Program (App Attest) and Google Play Console (Play Integrity).
// TODO: Enable providers in Firebase Console > App Check, then register debug tokens for development.
if (Platform.OS !== 'web') {
    try {
        const rnFirebaseAppCheck = require('@react-native-firebase/app-check')
        const rnAppCheck = rnFirebaseAppCheck.default()

        // Activate native provider (App Attest for iOS, Play Integrity for Android)
        const provider = rnFirebaseAppCheck.firebase.appCheck().newReactNativeFirebaseAppCheckProvider()
        provider.configure({
            apple: { provider: __DEV__ ? 'debug' : 'appAttest' },
            android: { provider: __DEV__ ? 'debug' : 'playIntegrity' },
        })
        rnAppCheck.initializeAppCheck({ provider, isTokenAutoRefreshEnabled: true })

        // Bridge native tokens to JS SDK via CustomProvider
        const customProvider = new CustomProvider({
            getToken: async () => {
                const { token } = await rnAppCheck.getToken(true)
                return {
                    token,
                    expireTimeMillis: Date.now() + 3600000, // 1 hour
                }
            },
        })

        initializeAppCheck(app, {
            provider: customProvider,
            isTokenAutoRefreshEnabled: true,
        })
    } catch (error) {
        // App Check is non-blocking — app continues to work
        // Server is in 'warn' mode so requests without tokens are still accepted
        console.warn('App Check initialization failed:', error)
    }
}

export default app
