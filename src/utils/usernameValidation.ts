/**
 * Username Validation Utility
 *
 * Provides username format validation and availability checking.
 * Used during signup and username setup flows to ensure valid, unique usernames.
 *
 * Rules:
 * - 3-20 characters
 * - Letters, numbers, underscores, and hyphens only
 * - Must be unique across all users
 */

import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/services/firebase'

/**
 * Check if a username is already taken
 * @param username - The username to check
 * @returns true if username is available, false if taken
 */
export const isUsernameAvailable = async (username: string): Promise<boolean> => {
    try {
        const usersRef = collection(db, 'users')
        const q = query(usersRef, where('username', '==', username))
        const querySnapshot = await getDocs(q)

        return querySnapshot.empty // true if no user has this username
    } catch (error) {
        console.error('Error checking username availability:', error)
        throw error
    }
}

/**
 * Validate username format
 * @param username - The username to validate
 * @returns error message if invalid, null if valid
 */
export const validateUsernameFormat = (username: string): string | null => {
    if (!username || username.trim().length === 0) {
        return 'Username is required'
    }

    if (username.length < 3) {
        return 'Username must be at least 3 characters'
    }

    if (username.length > 20) {
        return 'Username must be 20 characters or less'
    }

    // Only allow alphanumeric, underscore, and hyphen
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return 'Username can only contain letters, numbers, underscores, and hyphens'
    }

    return null
}
