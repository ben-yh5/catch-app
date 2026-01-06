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

import React, { createContext, useState, useEffect, useContext } from 'react'
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    User,
    GoogleAuthProvider,
    signInWithCredential,
    fetchSignInMethodsForEmail,
} from 'firebase/auth'
import { auth, db } from '@/services/firebase'
import { doc, setDoc} from 'firebase/firestore'
import { GoogleSignin } from '@react-native-google-signin/google-signin'

interface AuthContextType {
    user: User | null
    loading: boolean
    login: (email: string, password: string) => Promise<void>
    signup: (email: string, password: string, username: string) => Promise<void>
    loginWithGoogle: () => Promise<void>
    logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Configure Google Sign-In
        GoogleSignin.configure({
            webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        })

        // Listen for auth state changes
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setUser(user)
            setLoading(false)
        })

        return unsubscribe
    }, [])

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
                followers: [],
                following: [],
                pushToken: null,
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
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })

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

            if (error.code === 'auth/account-exists-with-different-credential') {
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

    return (
        <AuthContext.Provider value={{ user, loading, login, signup, loginWithGoogle, logout }}>
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
