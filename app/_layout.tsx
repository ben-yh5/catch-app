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
import { doc, getDoc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore'
import { db } from '@/services/firebase'

// Configure notification handler
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
})

export const unstable_settings = {
    anchor: '(tabs)',
}

async function registerForPushNotificationsAsync() {
    let token

    console.log('🔔 Platform:', Platform.OS)

    if (Platform.OS === 'android') {
        console.log('🔔 Setting up Android notification channel...')
        await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
        })
    }

    console.log('🔔 Checking notification permissions...')
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    console.log('🔔 Existing permission status:', existingStatus)
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
        console.log('🔔 Requesting notification permissions...')
        const { status } = await Notifications.requestPermissionsAsync()
        finalStatus = status
        console.log('🔔 Permission request result:', status)
    }

    if (finalStatus !== 'granted') {
        console.log('❌ Permission denied - cannot get push token')
        return null
    }

    console.log('🔔 Permissions granted, getting FCM token...')
    try {
        // For bare workflow, get the device push token (FCM token for Android, APNs for iOS)
        token = (await Notifications.getDevicePushTokenAsync()).data
        console.log('✅ Successfully got FCM push token:', token)
    } catch (error: any) {
        console.log('❌ Error getting push token:', error)
        console.log('❌ Error message:', error.message)
        console.log('❌ Error stack:', error.stack)
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
    const notificationListener = useRef<any>()
    const responseListener = useRef<any>()

    // Register for push notifications when user is authenticated
    useEffect(() => {
        if (!user) return

        console.log('🔔 Registering push notifications for user:', user.uid)

        registerForPushNotificationsAsync().then(async (token) => {
            if (token) {
                try {
                    console.log('🔔 Got push token:', token)
                    // Update user's push token in Firestore (use setDoc with merge to handle existing users)
                    const userDocRef = doc(db, 'users', user.uid)
                    await setDoc(userDocRef, {
                        pushToken: token,
                        followers: [],
                        following: []
                    }, { merge: true })
                    console.log('✅ Push token saved to Firestore')

                    // Verify it was saved
                    const userDoc = await getDoc(userDocRef)
                    console.log('🔍 Verified saved token:', userDoc.data()?.pushToken)
                } catch (error) {
                    console.error('❌ Error updating push token:', error)
                }
            } else {
                console.log('❌ No push token received - check permissions')
            }
        })

        // Listen for incoming notifications
        notificationListener.current = Notifications.addNotificationReceivedListener(
            (notification) => {
                console.log('Notification received:', notification)
            }
        )

        // Listen for notification responses (user taps notification)
        responseListener.current = Notifications.addNotificationResponseReceivedListener(
            (response) => {
                console.log('Notification response:', response)
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
    }, [user])

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
