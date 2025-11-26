import {
    DarkTheme,
    DefaultTheme,
    ThemeProvider,
} from '@react-navigation/native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import 'react-native-reanimated'

import { useColorScheme } from '@/hooks/use-color-scheme'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { PostProvider } from '@/context/PostContext'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '@/services/firebase'

export const unstable_settings = {
    anchor: '(tabs)',
}

function RootLayoutNav() {
    const colorScheme = useColorScheme()
    const { user, loading } = useAuth()
    const segments = useSegments()
    const router = useRouter()
    const [hasUserDoc, setHasUserDoc] = useState<boolean | null>(null)

    // Check if user document exists in Firestore (real-time listener)
    useEffect(() => {
        if (!user) {
            setHasUserDoc(null)
            return
        }

        const userDocRef = doc(db, 'users', user.uid)
        const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
            setHasUserDoc(docSnap.exists())
            console.log('📄 User doc exists:', docSnap.exists())
        }, (error) => {
            console.error('Error listening to user document:', error)
            setHasUserDoc(false)
        })

        return () => unsubscribe()
    }, [user])

    useEffect(() => {
        if (loading || (user && hasUserDoc === null)) return

        const inAuthGroup = segments[0] === '(tabs)'
        const inProtectedRoute =
            segments[0] === 'settings' ||
            segments[0] === 'user-profile'
        const inUsernameSetup = segments[0] === 'username-setup'

        if (!user && (inAuthGroup || inProtectedRoute || inUsernameSetup)) {
            // Redirect to login if user is not authenticated
            router.replace('/login')
        } else if (user && hasUserDoc === false && !inUsernameSetup) {
            // Redirect to username setup if user is authenticated but has no user document
            router.replace('/username-setup')
        } else if (
            user &&
            hasUserDoc === true &&
            !inAuthGroup &&
            !inProtectedRoute &&
            segments[0] !== 'modal'
        ) {
            // Redirect to tabs if user is authenticated, has user doc, and not in a protected route
            router.replace('/(tabs)')
        }
    }, [user, loading, segments, hasUserDoc])

    return (
        <ThemeProvider
            value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}
        >
            <Stack>
                <Stack.Screen name="login" options={{ headerShown: false }} />
                <Stack.Screen name="signup" options={{ headerShown: false }} />
                <Stack.Screen name="username-setup" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                    name="user-profile"
                    options={{ headerShown: false }}
                />
                <Stack.Screen
                    name="settings"
                    options={{ headerShown: false }}
                />
                <Stack.Screen
                    name="modal"
                    options={{ presentation: 'modal', title: 'Modal' }}
                />
            </Stack>
            <StatusBar style="auto" />
        </ThemeProvider>
    )
}

export default function RootLayout() {
    return (
        <AuthProvider>
            <PostProvider>
                <RootLayoutNav />
            </PostProvider>
        </AuthProvider>
    )
}
