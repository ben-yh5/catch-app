/**
 * AuthContext - Authentication state management
 *
 * Provides Firebase authentication functionality including:
 * - Google Sign-In via OAuth
 * - Sign in with Apple (iOS)
 * - User session management
 *
 * New users (no Firestore doc yet) are routed to the username-setup screen by
 * the root layout (_layout.tsx), which creates their user document via the
 * setupUsername Cloud Function.
 */

import { auth, db, functions } from '@/services/firebase'
import { registerForPushNotificationsAsync } from '@/utils/registerForPushNotificationsAsync'
import { GoogleSignin } from '@react-native-google-signin/google-signin'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import {
    GoogleAuthProvider,
    OAuthProvider,
    onAuthStateChanged,
    signInWithCredential,
    signOut,
    User,
} from 'firebase/auth'
import {
    collection,
    doc,
    getDoc,
    limit,
    onSnapshot,
    query,
    updateDoc,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { Notification } from '@/types'

interface AuthContextType {
    user: User | null
    loading: boolean
    loginWithGoogle: () => Promise<void>
    loginWithApple: () => Promise<void>
    logout: () => Promise<void>
    deleteAccount: () => Promise<void>
    dataContributionEnabled: boolean
    toggleDataContribution: (enabled: boolean) => Promise<void>

    // Blocking
    blockedUserIds: string[]
    blockUser: (targetUserId: string) => Promise<void>
    unblockUser: (targetUserId: string) => Promise<void>

    // Passport stats
    totalPosts: number
    totalCatches: number
    updateStats: (stats: { totalPosts: number; totalCatches: number }) => void

    // Notifications
    notifications: Notification[]
    unreadCount: number
    notificationSettings: {
        notifyOnCatch: boolean
        notifyOnFollow: boolean
    }
    toggleNotificationSetting: (
        type: 'notifyOnCatch' | 'notifyOnFollow',
        enabled: boolean
    ) => Promise<void>
    markNotificationAsRead: (id: string) => Promise<void>
    markAllNotificationsAsRead: () => Promise<void>
    clearAllNotifications: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)
    const [dataContributionEnabled, setDataContributionEnabled] =
        useState(false)
    const [totalPosts, setTotalPosts] = useState(0)
    const [totalCatches, setTotalCatches] = useState(0)
    const [blockedUserIds, setBlockedUserIds] = useState<string[]>([])

    // Notification State
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [notificationSettings, setNotificationSettings] = useState({
        notifyOnCatch: true,
        notifyOnFollow: true,
    })

    useEffect(() => {
        // Configure Google Sign-In. Fail fast: an unset client ID otherwise
        // only surfaces as DEVELOPER_ERROR when the user taps Sign In.
        const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
        if (!webClientId) {
            throw new Error(
                'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set — Google Sign-In cannot work. Check your .env.'
            )
        }
        GoogleSignin.configure({ webClientId })

        // Listen for auth state changes
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setUser(user)
            if (user) {
                // Fetch user settings
                try {
                    const userDoc = await getDoc(doc(db, 'users', user.uid))
                    if (userDoc.exists()) {
                        const data = userDoc.data()
                        setDataContributionEnabled(
                            data.dataContributionEnabled || false
                        )
                        setTotalPosts(data.totalPosts || 0)
                        setTotalCatches(data.totalCatches || 0)
                        setBlockedUserIds(data.blockedUsers || [])

                        // Load notification settings
                        if (data.notificationSettings) {
                            setNotificationSettings({
                                notifyOnCatch:
                                    data.notificationSettings.notifyOnCatch ??
                                    true,
                                notifyOnFollow:
                                    data.notificationSettings.notifyOnFollow ??
                                    true,
                            })
                        }

                        // Register for push notifications
                        registerForPushNotificationsAsync().then((token) => {
                            if (token) {
                                updateDoc(doc(db, 'users', user.uid), {
                                    pushToken: token,
                                }).catch((err) =>
                                    console.error(
                                        'Error saving push token:',
                                        err
                                    )
                                )
                            }
                        })
                    }
                } catch (error) {
                    console.error('Error fetching user settings:', error)
                }
            } else {
                setDataContributionEnabled(false)
                setTotalPosts(0)
                setTotalCatches(0)
                setBlockedUserIds([])
                setNotifications([])
                setUnreadCount(0)
                setNotificationSettings({
                    notifyOnCatch: true,
                    notifyOnFollow: true,
                })
            }
            setLoading(false)
        })

        return unsubscribe
    }, [])

    useEffect(() => {
        if (!user) return

        const q = query(
            collection(db, 'users', user.uid, 'notifications'),
            limit(100)
        )

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const newNotifications = snapshot.docs.map(
                    (d) =>
                        ({
                            id: d.id,
                            ...d.data(),
                        }) as Notification
                )
                newNotifications.sort((a, b) => {
                    const tA = a.createdAt?.toMillis?.() || 0
                    const tB = b.createdAt?.toMillis?.() || 0
                    return tB - tA
                })

                setNotifications(newNotifications)
                setUnreadCount(
                    newNotifications.filter((n) => !n.read).length
                )
            },
            (error) => {
                console.error('Error listening to notifications:', error)
            }
        )

        return unsubscribe
    }, [user])

    const toggleNotificationSetting = async (
        type: 'notifyOnCatch' | 'notifyOnFollow',
        enabled: boolean
    ) => {
        if (!user) return

        const newSettings = { ...notificationSettings, [type]: enabled }
        setNotificationSettings(newSettings)

        try {
            await updateDoc(doc(db, 'users', user.uid), {
                notificationSettings: newSettings,
            })
        } catch (error) {
            console.error('Error updating notification settings:', error)
            // Revert on error
            setNotificationSettings(notificationSettings)
        }
    }

    const markNotificationAsRead = async (id: string) => {
        if (!user) return

        try {
            await updateDoc(doc(db, 'users', user.uid, 'notifications', id), {
                read: true,
            })
        } catch (error) {
            console.error('Error marking notification as read:', error)
        }
    }

    const clearAllNotifications = async () => {
        if (!user) return

        try {
            const { collection, getDocs, writeBatch, doc } =
                await import('firebase/firestore')
            const notificationsRef = collection(
                db,
                'users',
                user.uid,
                'notifications'
            )
            const snapshot = await getDocs(notificationsRef)

            if (snapshot.empty) return

            const batch = writeBatch(db)
            snapshot.docs.forEach((d) => {
                batch.delete(doc(db, 'users', user.uid, 'notifications', d.id))
            })

            await batch.commit()
            // Local state update is handled by onSnapshot
        } catch (error) {
            console.error('Error clearing notifications:', error)
            throw error
        }
    }

    const markAllNotificationsAsRead = async () => {
        if (!user) return

        // This should potentialy be a batch update or cloud function for efficiency
        // For now, client-side loop is okay for small numbers
        const unreadNotifications = notifications.filter((n) => !n.read)

        if (unreadNotifications.length === 0) return

        // Just mark the visible ones for now
        import('firebase/firestore').then(async ({ writeBatch, doc }) => {
            const batch = writeBatch(db)

            unreadNotifications.forEach((n) => {
                const ref = doc(db, 'users', user.uid, 'notifications', n.id)
                batch.update(ref, { read: true })
            })

            try {
                await batch.commit()
            } catch (error) {
                console.error('Error batch marking read:', error)
            }
        })
    }

    /**
     * Sign in with Google OAuth
     * For new Google users, they'll be redirected to username setup by root layout
     */
    const loginWithGoogle = async () => {
        try {
            await GoogleSignin.hasPlayServices({
                showPlayServicesUpdateDialog: true,
            })

            const signInResult = await GoogleSignin.signIn()

            const idToken = signInResult.data?.idToken

            if (!idToken) {
                throw new Error('No ID token found')
            }

            const googleCredential = GoogleAuthProvider.credential(idToken)

            await signInWithCredential(auth, googleCredential)

            // Note: We don't create the user document here for new users
            // They will be redirected to the username-setup screen by the root layout
        } catch (error: any) {
            console.error('Google Sign-In Error:', error)
            throw new Error(error.message)
        }
    }

    /**
     * Sign in with Apple (iOS only)
     *
     * Uses a nonce to protect against replay attacks: a random nonce is
     * SHA-256 hashed and passed to Apple, and the raw nonce is handed to
     * Firebase so it can verify the hash inside the returned identity token.
     * For new Apple users, they'll be redirected to username setup by root layout.
     */
    const loginWithApple = async () => {
        try {
            // Generate a random nonce and its SHA-256 hash for Apple
            const rawNonce = Crypto.randomUUID()
            const hashedNonce = await Crypto.digestStringAsync(
                Crypto.CryptoDigestAlgorithm.SHA256,
                rawNonce
            )

            const appleCredential = await AppleAuthentication.signInAsync({
                requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                ],
                nonce: hashedNonce,
            })

            const { identityToken } = appleCredential
            if (!identityToken) {
                throw new Error('No identity token found')
            }

            const provider = new OAuthProvider('apple.com')
            const firebaseCredential = provider.credential({
                idToken: identityToken,
                rawNonce,
            })

            await signInWithCredential(auth, firebaseCredential)

            // Note: We don't create the user document here for new users
            // They will be redirected to the username-setup screen by the root layout
        } catch (error: any) {
            // User canceled the Apple sign-in sheet — not an error worth surfacing
            if (error.code === 'ERR_REQUEST_CANCELED') {
                return
            }
            console.error('Apple Sign-In Error:', error)
            throw new Error(error.message)
        }
    }

    /**
     * Sign out current user from both Firebase and Google
     */
    const logout = async () => {
        try {
            // Clear push token before signing out so the old user
            // doesn't keep receiving notifications on this device
            if (auth.currentUser) {
                await updateDoc(doc(db, 'users', auth.currentUser.uid), {
                    pushToken: null,
                }).catch((err) =>
                    console.error('Error clearing push token:', err)
                )
            }
            await signOut(auth)
            await GoogleSignin.signOut()
        } catch (error: any) {
            throw new Error(error.message)
        }
    }

    /**
     * Delete the account via the deleteAccount Cloud Function, then sign out
     * locally. The server deletes the Firebase Auth user, but this session's
     * ID token stays valid until its next refresh (up to ~1 hour), so
     * onAuthStateChanged won't fire on its own — meanwhile the user-doc
     * listener sees the doc disappear and the root layout would bounce to
     * username-setup. Signing out immediately routes to /login instead.
     */
    const deleteAccount = async () => {
        const deleteAccountFn = httpsCallable(functions, 'deleteAccount')
        await deleteAccountFn({})
        // Local sign-out failures are ignored: the account is already gone
        // server-side, and surfacing an error here would misread as the
        // deletion having failed.
        await signOut(auth).catch((err) =>
            console.error('Error signing out after account deletion:', err)
        )
        await GoogleSignin.signOut().catch(() => {})
    }

    const updateStats = (stats: {
        totalPosts: number
        totalCatches: number
    }) => {
        setTotalPosts(stats.totalPosts)
        setTotalCatches(stats.totalCatches)
    }

    /**
     * Update data contribution setting
     */
    const toggleDataContribution = async (enabled: boolean) => {
        if (!user) return

        try {
            await updateDoc(doc(db, 'users', user.uid), {
                dataContributionEnabled: enabled,
            })
            setDataContributionEnabled(enabled)
        } catch (error: any) {
            console.error('Error updating data contribution setting', error)
            throw new Error(error.message)
        }
    }

    /**
     * Block / unblock — server-managed via Cloud Functions (blockedUsers is
     * not client-writable). Local state updates immediately so feeds and
     * profiles filter without a re-fetch.
     */
    const blockUser = async (targetUserId: string) => {
        const blockUserFn = httpsCallable(functions, 'blockUser')
        await blockUserFn({ targetUserId })
        setBlockedUserIds((prev) =>
            prev.includes(targetUserId) ? prev : [...prev, targetUserId]
        )
    }

    const unblockUser = async (targetUserId: string) => {
        const unblockUserFn = httpsCallable(functions, 'unblockUser')
        await unblockUserFn({ targetUserId })
        setBlockedUserIds((prev) => prev.filter((id) => id !== targetUserId))
    }

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                loginWithGoogle,
                loginWithApple,
                logout,
                deleteAccount,
                dataContributionEnabled,
                toggleDataContribution,
                blockedUserIds,
                blockUser,
                unblockUser,
                totalPosts,
                totalCatches,
                updateStats,
                notifications,
                unreadCount,
                notificationSettings,
                toggleNotificationSetting,
                markNotificationAsRead,
                markAllNotificationsAsRead,
                clearAllNotifications,
            }}
        >
            {children}
        </AuthContext.Provider>
    )
}

/**
 * Hook to access authentication context
 * Must be used within an AuthProvider
 */
export const useAuth = () => {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
