import React, { createContext, useState, useEffect, useContext } from 'react'
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    User,
    GoogleAuthProvider,
    signInWithCredential,
} from 'firebase/auth'
import { auth, db } from '@/services/firebase'
import { doc, setDoc, getDoc } from 'firebase/firestore'
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

    const login = async (email: string, password: string) => {
        try {
            await signInWithEmailAndPassword(auth, email, password)
        } catch (error: any) {
            throw new Error(error.message)
        }
    }

    const signup = async (
        email: string,
        password: string,
        username: string
    ) => {
        try {
            // Create user account
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
                bookmarkedPosts: [],
                createdAt: new Date(),
            })
        } catch (error: any) {
            throw new Error(error.message)
        }
    }

    const loginWithGoogle = async () => {
        try {
            // Check if your device supports Google Play
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })

            // Get the users ID token
            const signInResult = await GoogleSignin.signIn()
            const idToken = signInResult.data?.idToken

            if (!idToken) {
                throw new Error('No ID token found')
            }

            // Create a Google credential with the token
            const googleCredential = GoogleAuthProvider.credential(idToken)

            // Sign-in the user with the credential
            const userCredential = await signInWithCredential(auth, googleCredential)
            const user = userCredential.user

            // Check if user document exists in Firestore
            const userDocRef = doc(db, 'users', user.uid)
            const userDoc = await getDoc(userDocRef)

            // If user document doesn't exist, create it (first-time Google sign-in)
            if (!userDoc.exists()) {
                const username = user.displayName || user.email?.split('@')[0] || 'User'
                await setDoc(userDocRef, {
                    username: username,
                    email: user.email || '',
                    totalCatches: 0,
                    bookmarkedPosts: [],
                    createdAt: new Date(),
                })
            }
        } catch (error: any) {
            throw new Error(error.message)
        }
    }

    const logout = async () => {
        try {
            await signOut(auth)
            // Also sign out from Google
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

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
