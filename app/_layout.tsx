import {
    DarkTheme,
    ThemeProvider,
} from '@react-navigation/native'
import * as Notifications from 'expo-notifications'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import 'react-native-reanimated'
import { enableFreeze } from 'react-native-screens'

// Suspend React rendering for screens that are not visible (paired with
// freezeOnBlur on the tab navigator) so background tabs — the Mapbox map
// especially — can't do JS-thread work while the user is on another tab.
enableFreeze(true)

import ErrorBoundary from '@/components/ErrorBoundary'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { PostProvider } from '@/context/PostContext'
import { db } from '@/services/firebase'
import { doc, onSnapshot } from 'firebase/firestore'

// Configure notification handler
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
})

export const unstable_settings = {
    initialRouteName: '(tabs)',
}

function RootLayoutNav() {
    const { user, loading } = useAuth()
    const segments = useSegments()
    const router = useRouter()
    const [hasUserDoc, setHasUserDoc] = useState<boolean | null>(null)
    const responseListener = useRef<any>(null)

    // Listen for notification responses (user taps notification)
    useEffect(() => {
        if (!user) return

        responseListener.current =
            Notifications.addNotificationResponseReceivedListener(
                (response) => {
                    const data = response.notification.request.content.data

                    // Navigate to user profile if notification contains userId
                    if (data.userId) {
                        router.push({
                            pathname: '/user-profile',
                            params: { userId: data.userId },
                        } as any)
                    }
                }
            )

        return () => {
            if (responseListener.current) {
                responseListener.current.remove()
            }
        }
    }, [user, router])

    // Check if user document exists in Firestore (real-time listener)
    useEffect(() => {
        if (!user) {
            setHasUserDoc(null)
            return
        }

        const userDocRef = doc(db, 'users', user.uid)
        const unsubscribe = onSnapshot(
            userDocRef,
            (docSnap) => {
                setHasUserDoc(docSnap.exists())
            },
            (error) => {
                console.error('Error listening to user document:', error)
                setHasUserDoc(false)
            }
        )

        return () => unsubscribe()
    }, [user])

    useEffect(() => {
        if (loading || (user && hasUserDoc === null)) return

        const inAuthGroup = segments[0] === '(tabs)'
        const inProtectedRoute =
            segments[0] === 'settings' ||
            segments[0] === 'user-profile' ||
            segments[0] === 'create-list' ||
            segments[0] === 'list-detail' ||
            segments[0] === 'blocked-users' ||
            segments[0] === 'passport'
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
            !inProtectedRoute
        ) {
            // Redirect to tabs if user is authenticated, has user doc, and not in a protected route
            router.replace('/(tabs)')
        }
    }, [user, loading, segments, hasUserDoc, router])

    return (
        // The app's screens are designed dark-only — always hand navigation
        // the dark theme so its chrome (headers, sheets) can't render light
        // over dark screens when the device is in light mode.
        <ThemeProvider value={DarkTheme}>
            <Stack
                screenOptions={{
                    headerShown: false,
                    // Platform default on Android is a slow cross-fade;
                    // ios_from_right gives the native iOS push on both platforms
                    animation: 'ios_from_right',
                }}
            >
                <Stack.Screen name="login" />
                <Stack.Screen name="username-setup" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="user-profile" />
                <Stack.Screen name="settings" />
                <Stack.Screen
                    name="create-list"
                    options={{ presentation: 'modal' }}
                />
                <Stack.Screen name="list-detail" />
                <Stack.Screen name="blocked-users" />
                <Stack.Screen name="passport" />
            </Stack>
            <StatusBar style="light" />
        </ThemeProvider>
    )
}

function RootLayoutInner() {
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <ErrorBoundary>
                <AuthProvider>
                    <PostProvider>
                        <ToastProvider>
                            <RootLayoutNav />
                        </ToastProvider>
                    </PostProvider>
                </AuthProvider>
            </ErrorBoundary>
        </GestureHandlerRootView>
    )
}

export default RootLayoutInner
