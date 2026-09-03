import { initializeApp } from 'firebase/app'
import { initializeAuth, getReactNativePersistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
import AsyncStorage from '@react-native-async-storage/async-storage'

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

// Fail fast: initializeApp accepts undefined fields silently and the failure
// would otherwise surface as a cryptic auth/invalid-api-key at first use.
for (const key of [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'appId',
]) {
    if (!firebaseConfig[key]) {
        throw new Error(
            `Missing Firebase config "${key}" — check EXPO_PUBLIC_FIREBASE_* in your .env`
        )
    }
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

export default app
