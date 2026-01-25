/**
 * List Management Utility
 *
 * Handles operations for the Lists feature, which replaced the deprecated
 * bookmarkedPosts system. Users can create multiple lists to organize posts.
 *
 * Key Features:
 * - Auto-creates a default "My List" for each user
 * - Add/remove posts from lists
 * - Check if posts are saved
 * - Toggle quick save/unsave
 */

import { db } from '@/services/firebase'
import { addDoc, arrayRemove, arrayUnion, collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'

const SAVED_LIST_NAME = 'My List'

/**
 * Get or create the user's default "My List"
 * This is a special private list that's auto-created for saving shots
 */
export async function getOrCreateSavedList(userId: string, username: string): Promise<string> {
    try {
        // Check if user already has their default list (by isSavedList flag)
        const savedListQuery = query(
            collection(db, 'lists'),
            where('creatorId', '==', userId),
            where('isSavedList', '==', true)
        )

        const snapshot = await getDocs(savedListQuery)

        if (!snapshot.empty) {
            // Return existing default list ID
            return snapshot.docs[0].id
        }

        // Fallback: check by name for backward compatibility
        const nameQuery = query(
            collection(db, 'lists'),
            where('creatorId', '==', userId),
            where('name', '==', SAVED_LIST_NAME)
        )
        const nameSnapshot = await getDocs(nameQuery)

        if (!nameSnapshot.empty) {
            return nameSnapshot.docs[0].id
        }

        // Create new "My List"
        const newList = await addDoc(collection(db, 'lists'), {
            name: SAVED_LIST_NAME,
            description: 'Your saved shots',
            creatorId: userId,
            creatorUsername: username,
            postIds: [],
            isPublic: false,
            isSavedList: true, // Special flag to identify this as the default list
            createdAt: new Date(),
            updatedAt: new Date(),
        })

        return newList.id
    } catch (error) {
        console.error('Error getting/creating Saved list:', error)
        throw error
    }
}

/**
 * Add a post to a list
 */
export async function addPostToList(listId: string, postId: string): Promise<void> {
    try {
        await updateDoc(doc(db, 'lists', listId), {
            postIds: arrayUnion(postId),
            updatedAt: new Date(),
        })
    } catch (error) {
        console.error('Error adding post to list:', error)
        throw error
    }
}

/**
 * Remove a post from a list
 */
export async function removePostFromList(listId: string, postId: string): Promise<void> {
    try {
        await updateDoc(doc(db, 'lists', listId), {
            postIds: arrayRemove(postId),
            updatedAt: new Date(),
        })
    } catch (error) {
        console.error('Error removing post from list:', error)
        throw error
    }
}

/**
 * Check if a post is in any of the user's lists
 */
export async function isPostSaved(userId: string, postId: string): Promise<boolean> {
    try {
        const listsQuery = query(
            collection(db, 'lists'),
            where('creatorId', '==', userId),
            where('postIds', 'array-contains', postId)
        )

        const snapshot = await getDocs(listsQuery)
        return !snapshot.empty
    } catch (error) {
        console.error('Error checking if post is saved:', error)
        return false
    }
}

/**
 * Get all lists that contain a specific post (for the user)
 */
export async function getListsContainingPost(userId: string, postId: string): Promise<string[]> {
    try {
        const listsQuery = query(
            collection(db, 'lists'),
            where('creatorId', '==', userId),
            where('postIds', 'array-contains', postId)
        )

        const snapshot = await getDocs(listsQuery)
        return snapshot.docs.map(doc => doc.id)
    } catch (error) {
        console.error('Error getting lists containing post:', error)
        return []
    }
}
