import {
    DarkTheme,
    DefaultTheme,
    ThemeProvider,
} from '@react-navigation/native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState, useRef } from 'react'
import 'react-native-reanimated'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { useColorScheme } from '@/hooks/use-color-scheme'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { PostProvider } from '@/context/PostContext'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '@/services/firebase'

// Configure notification handler
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
})

export const unstable_settings = {
    anchor: '(tabs)',
}

async function registerForPushNotificationsAsync() {
    let token

    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
        })
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync()
        finalStatus = status
    }

    if (finalStatus !== 'granted') {
        return null
    }

    try {
        // For bare workflow, get the device push token (FCM token for Android, APNs for iOS)
        token = (await Notifications.getDevicePushTokenAsync()).data
    } catch {
        return null
    }

    return token
}

function RootLayoutNav() {
    const colorScheme = useColorScheme()
    const { user, loading } = useAuth()
    const segments = useSegments()
    const router = useRouter()
    const [hasUserDoc, setHasUserDoc] = useState<boolean | null>(null)
    const notificationListener = useRef<any>(null)
    const responseListener = useRef<any>(null)

    // Register for push notifications when user is authenticated
    useEffect(() => {
        if (!user) return

        registerForPushNotificationsAsync().then(async (token) => {
            if (token) {
                try {
                    // Only update push token for existing users
                    // Do not create user documents here - let signup/username-setup handle that
                    const userDocRef = doc(db, 'users', user.uid)

                    // Check if user doc exists
                    const userDoc = await getDoc(userDocRef)
                    if (userDoc.exists()) {
                        // User exists, update push token
                        await setDoc(userDocRef, {
                            pushToken: token,
                        }, { merge: true })
                    }
                    // If user doc doesn't exist, do nothing - they're in the username setup flow
                } catch (error) {
                    console.error('Error updating push token:', error)
                }
            }
        })

        // Listen for incoming notifications
        notificationListener.current = Notifications.addNotificationReceivedListener(
            () => {
                // Notification received
            }
        )

        // Listen for notification responses (user taps notification)
        responseListener.current = Notifications.addNotificationResponseReceivedListener(
            (response) => {
                const data = response.notification.request.content.data

                // Navigate to user profile if notification contains userId
                if (data.userId) {
                    router.push(`/user-profile?userId=${data.userId}` as any)
                }
            }
        )

        return () => {
            if (notificationListener.current) {
                notificationListener.current.remove()
            }
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
        const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
            setHasUserDoc(docSnap.exists())
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
            segments[0] === 'user-profile' ||
            segments[0] === 'create-list' ||
            segments[0] === 'list-detail'
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
    }, [user, loading, segments, hasUserDoc, router])

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
                    name="create-list"
                    options={{ presentation: 'modal', headerShown: false }}
                />
                <Stack.Screen
                    name="list-detail"
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
