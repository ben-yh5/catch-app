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
    const { user, loading, needsEmailVerification } = useAuth()
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
        // includeMetadataChanges so the cache→server transition fires an
        // event even when the doc data itself didn't change — otherwise a
        // deferred cache-negative below might never get its server answer
        const unsubscribe = onSnapshot(
            userDocRef,
            { includeMetadataChanges: true },
            (docSnap) => {
                if (docSnap.exists()) {
                    // A cached positive is trustworthy — the doc being in
                    // cache means it exists
                    setHasUserDoc(true)
                } else if (!docSnap.metadata.fromCache) {
                    // Only a server-confirmed absence may conclude "no
                    // doc". Offline with a cold cache Firestore reports an
                    // absence it can't verify — routing on it sent users
                    // to username-setup (a screen that offers to CLAIM a
                    // new username) over a mere network blip
                    setHasUserDoc(false)
                }
            },
            (error) => {
                // A listener error is not an answer either — leave the
                // state unknown so routing waits instead of deriving a
                // fact from a failure
                console.error('Error listening to user document:', error)
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
        const inVerifyEmail = segments[0] === 'verify-email'

        if (
            !user &&
            (inAuthGroup || inProtectedRoute || inUsernameSetup || inVerifyEmail)
        ) {
            // Redirect to login if user is not authenticated
            router.replace('/login')
        } else if (user && needsEmailVerification && !inVerifyEmail) {
            // Unverified email/password accounts must verify before anything
            // else — including claiming a (permanent, unique) username
            router.replace('/verify-email')
        } else if (
            user &&
            !needsEmailVerification &&
            hasUserDoc === false &&
            !inUsernameSetup
        ) {
            // Redirect to username setup if user is authenticated but has no user document
            router.replace('/username-setup')
        } else if (
            user &&
            !needsEmailVerification &&
            hasUserDoc === true &&
            !inAuthGroup &&
            !inProtectedRoute
        ) {
            // Redirect to tabs if user is authenticated, has user doc, and not in a protected route
            router.replace('/(tabs)')
        }
    }, [user, loading, segments, hasUserDoc, needsEmailVerification, router])

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
                <Stack.Screen name="email-auth" />
                <Stack.Screen name="verify-email" />
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
