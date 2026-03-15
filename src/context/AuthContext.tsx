/**
 * AuthContext - Authentication state management
 *
 * Provides Firebase authentication functionality including:
 * - Email/password authentication
 * - Google Sign-In via OAuth
 * - User session management
 * - Automatic Firestore user document creation
 *
 * The root layout (_layout.tsx) uses this context to handle auth-based navigation
 * and redirect users to username setup when needed.
 */

import { auth, db } from '@/services/firebase'
import { registerForPushNotificationsAsync } from '@/utils/registerForPushNotificationsAsync'
import { GoogleSignin } from '@react-native-google-signin/google-signin'
import {
    createUserWithEmailAndPassword,
    fetchSignInMethodsForEmail,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithCredential,
    signInWithEmailAndPassword,
    signOut,
    User,
} from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { Notification } from '@/types'

interface AuthContextType {
    user: User | null
    loading: boolean
    login: (email: string, password: string) => Promise<void>
    signup: (email: string, password: string, username: string) => Promise<void>
    loginWithGoogle: () => Promise<void>
    logout: () => Promise<void>
    dataContributionEnabled: boolean
    toggleDataContribution: (enabled: boolean) => Promise<void>

    // Contribution stats
    contribution: number
    totalPosts: number
    totalCatches: number
    updateStats: (stats: {
        contribution: number
        totalPosts: number
        totalCatches: number
    }) => void

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
    const [contribution, setContribution] = useState(0)
    const [totalPosts, setTotalPosts] = useState(0)
    const [totalCatches, setTotalCatches] = useState(0)

    // Notification State
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [notificationSettings, setNotificationSettings] = useState({
        notifyOnCatch: true,
        notifyOnFollow: true,
    })

    useEffect(() => {
        // Configure Google Sign-In
        GoogleSignin.configure({
            webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        })

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
                        setContribution(data.contribution || 0)
                        setTotalPosts(data.totalPosts || 0)
                        setTotalCatches(data.totalCatches || 0)

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
                setContribution(0)
                setTotalPosts(0)
                setTotalCatches(0)
                setNotifications([])
                setUnreadCount(0)
            }
            setLoading(false)
        })

        return unsubscribe
    }, [])

    useEffect(() => {
        if (!user) return

        let unsubscribe: (() => void) | undefined

        import('firebase/firestore').then(
            ({ collection, query, onSnapshot, limit }) => {
                console.log(
                    `[AuthContext] Setting up listener for: users/${user.uid}/notifications`
                )

                const q = query(
                    collection(db, 'users', user.uid, 'notifications'),
                    limit(100)
                )

                unsubscribe = onSnapshot(
                    q,
                    (snapshot) => {
                        console.log(
                            `[AuthContext] Notification snapshot size: ${snapshot.size} for user ${user.uid}`
                        )
                        if (!snapshot.empty) {
                            console.log(
                                '[AuthContext] Latest notification sample:',
                                snapshot.docs[0].data()
                            )
                        }

                        const newNotifications = snapshot.docs.map(
                            (doc) =>
                                ({
                                    id: doc.id,
                                    ...doc.data(),
                                }) as Notification
                        )
                        // Sort manually since we removed orderBy
                        newNotifications.sort((a, b) => {
                            const tA = a.createdAt?.toMillis?.() || 0
                            const tB = b.createdAt?.toMillis?.() || 0
                            return tB - tA
                        })

                        setNotifications(newNotifications)

                        // Update unread count
                        const unread = newNotifications.filter(
                            (n) => !n.read
                        ).length
                        setUnreadCount(unread)
                    },
                    (error) => {
                        console.error(
                            'Error listening to notifications:',
                            error
                        )
                    }
                )
            }
        )

        return () => {
            if (unsubscribe) {
                unsubscribe()
            }
        }
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
     * Sign in existing user with email and password
     */
    const login = async (email: string, password: string) => {
        try {
            await signInWithEmailAndPassword(auth, email, password)
        } catch (error: any) {
            throw new Error(error.message)
        }
    }

    /**
     * Create new user account with email, password, and username
     * Automatically creates Firestore user document with default values
     */
    const signup = async (
        email: string,
        password: string,
        username: string
    ) => {
        try {
            const userCredential = await createUserWithEmailAndPassword(
                auth,
                email,
                password
            )
            const user = userCredential.user

            // Create user document in Firestore
            await setDoc(doc(db, 'users', user.uid), {
                username: username,
                email: email,
                totalCatches: 0,
                totalPosts: 0,
                contribution: 0,
                followers: [],
                following: [],
                pushToken: null,
                dataContributionEnabled: false,
                createdAt: new Date(),
            })
        } catch (error: any) {
            throw new Error(error.message)
        }
    }

    /**
     * Sign in with Google OAuth
     * For new Google users, they'll be redirected to username setup by root layout
     * Existing users can link their Google account to an email/password account
     */
    const loginWithGoogle = async () => {
        try {
            await GoogleSignin.hasPlayServices({
                showPlayServicesUpdateDialog: true,
            })

            const signInResult = await GoogleSignin.signIn()

            const idToken = signInResult.data?.idToken
            const googleEmail = signInResult.data?.user.email

            if (!idToken) {
                throw new Error('No ID token found')
            }

            const googleCredential = GoogleAuthProvider.credential(idToken)

            await signInWithCredential(auth, googleCredential)

            // Check if this was an account linking scenario
            if (googleEmail) {
                await fetchSignInMethodsForEmail(auth, googleEmail)
            }

            // Note: We don't create the user document here for new users
            // They will be redirected to the username-setup screen by the root layout
        } catch (error: any) {
            console.error('Google Sign-In Error:', error)

            if (
                error.code === 'auth/account-exists-with-different-credential'
            ) {
                throw new Error(
                    'An account already exists with this email. Try signing in with email and password instead.'
                )
            }

            throw new Error(error.message)
        }
    }

    /**
     * Sign out current user from both Firebase and Google
     */
    const logout = async () => {
        try {
            await signOut(auth)
            await GoogleSignin.signOut()
        } catch (error: any) {
            throw new Error(error.message)
        }
    }

    const updateStats = (stats: {
        contribution: number
        totalPosts: number
        totalCatches: number
    }) => {
        setContribution(stats.contribution)
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

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                login,
                signup,
                loginWithGoogle,
                logout,
                dataContributionEnabled,
                toggleDataContribution,
                contribution,
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
