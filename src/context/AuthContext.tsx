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
    linkWithCredential,
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
            console.log('🔵 Starting Google Sign-In...')
            console.log('🔵 Web Client ID:', process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)

            // Check if your device supports Google Play
            console.log('🔵 Checking Google Play Services...')
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
            console.log('✅ Google Play Services available')

            // Get the users ID token
            console.log('🔵 Starting sign-in flow...')
            const signInResult = await GoogleSignin.signIn()
            console.log('🔵 Sign-in result:', JSON.stringify(signInResult, null, 2))

            const idToken = signInResult.data?.idToken
            const googleEmail = signInResult.data?.user.email
            console.log('🔵 ID Token:', idToken ? 'Present' : 'Missing')
            console.log('🔵 Google Email:', googleEmail)

            if (!idToken) {
                throw new Error('No ID token found')
            }

            // Create a Google credential with the token
            console.log('🔵 Creating Firebase credential...')
            const googleCredential = GoogleAuthProvider.credential(idToken)

            // Sign-in the user with the credential
            console.log('🔵 Signing in with Firebase...')
            const userCredential = await signInWithCredential(auth, googleCredential)
            const user = userCredential.user
            console.log('✅ Firebase sign-in successful, UID:', user.uid)

            // Check if this was an account linking scenario
            if (googleEmail) {
                const signInMethods = await fetchSignInMethodsForEmail(auth, googleEmail)
                if (signInMethods.length > 1) {
                    console.log('✅ Google account linked to existing email/password account')
                }
            }

            // Note: We don't create the user document here for new users
            // They will be redirected to the username-setup screen by the root layout
            console.log('✅ Google Sign-In complete!')
        } catch (error: any) {
            console.error('❌ Google Sign-In Error:', error)
            console.error('❌ Error code:', error.code)
            console.error('❌ Error message:', error.message)
            console.error('❌ Full error:', JSON.stringify(error, null, 2))

            // Handle account-exists-with-different-credential error
            if (error.code === 'auth/account-exists-with-different-credential') {
                throw new Error(
                    'An account already exists with this email. Try signing in with email and password instead.'
                )
            }

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
