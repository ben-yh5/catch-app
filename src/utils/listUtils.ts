import { collection, query, where, getDocs, addDoc, doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore'
import { db } from '@/services/firebase'

const SAVED_LIST_NAME = 'Saved'

/**
 * Get or create the user's "Saved" list
 * This is a special private list that's auto-created for bookmarking posts
 */
export async function getOrCreateSavedList(userId: string, username: string): Promise<string> {
    try {
        // Check if user already has a "Saved" list
        const savedListQuery = query(
            collection(db, 'lists'),
            where('creatorId', '==', userId),
            where('name', '==', SAVED_LIST_NAME)
        )

        const snapshot = await getDocs(savedListQuery)

        if (!snapshot.empty) {
            // Return existing Saved list ID
            return snapshot.docs[0].id
        }

        // Create new "Saved" list
        const newList = await addDoc(collection(db, 'lists'), {
            name: SAVED_LIST_NAME,
            description: 'Your saved posts',
            creatorId: userId,
            creatorUsername: username,
            postIds: [],
            isPublic: false,
            isSavedList: true, // Special flag to identify this as the saved list
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

/**
 * Toggle post in the Saved list (quick save/unsave)
 */
export async function toggleSavedPost(
    userId: string,
    username: string,
    postId: string
): Promise<{ saved: boolean; listId: string }> {
    try {
        const savedListId = await getOrCreateSavedList(userId, username)
        const listDoc = await getDoc(doc(db, 'lists', savedListId))

        if (!listDoc.exists()) {
            throw new Error('Saved list not found')
        }

        const listData = listDoc.data()
        const postIds = listData.postIds || []
        const isSaved = postIds.includes(postId)

        if (isSaved) {
            // Remove from Saved list
            await removePostFromList(savedListId, postId)
            return { saved: false, listId: savedListId }
        } else {
            // Add to Saved list
            await addPostToList(savedListId, postId)
            return { saved: true, listId: savedListId }
        }
    } catch (error) {
        console.error('Error toggling saved post:', error)
        throw error
    }
}
