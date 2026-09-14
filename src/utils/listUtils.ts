/**
 * List Management Utility
 *
 * Curated lists only — the quick-save bookmark pile lives in
 * `users/{uid}/saves` (see src/services/saves.ts and SavesContext).
 * The list's `postIds` array is the source of truth for membership/order;
 * add/remove here also mirror a tag onto the saver's save doc so the save
 * sheet's checkboxes stay in sync.
 */

import { auth, db } from '@/services/firebase'
import { tagSaveWithList, untagSaveFromList } from '@/services/saves'
import {
    arrayRemove,
    arrayUnion,
    collection,
    doc,
    getDocs,
    query,
    updateDoc,
    where,
} from 'firebase/firestore'

/**
 * Add a post to a list (adding to a list implies saving the post)
 */
export async function addPostToList(
    listId: string,
    postId: string
): Promise<void> {
    try {
        await updateDoc(doc(db, 'lists', listId), {
            postIds: arrayUnion(postId),
            updatedAt: new Date(),
        })
        const uid = auth.currentUser?.uid
        if (uid) {
            await tagSaveWithList(uid, postId, listId)
        }
    } catch (error) {
        console.error('Error adding post to list:', error)
        throw error
    }
}

/**
 * Remove a post from a list (the save itself survives — removing from a
 * list doesn't unsave)
 */
export async function removePostFromList(
    listId: string,
    postId: string
): Promise<void> {
    try {
        await updateDoc(doc(db, 'lists', listId), {
            postIds: arrayRemove(postId),
            updatedAt: new Date(),
        })
        const uid = auth.currentUser?.uid
        if (uid) {
            await untagSaveFromList(uid, postId, listId)
        }
    } catch (error) {
        console.error('Error removing post from list:', error)
        throw error
    }
}

/**
 * Get all lists that contain a specific post (for the user)
 */
export async function getListsContainingPost(
    userId: string,
    postId: string
): Promise<string[]> {
    try {
        const listsQuery = query(
            collection(db, 'lists'),
            where('creatorId', '==', userId),
            where('postIds', 'array-contains', postId)
        )

        const snapshot = await getDocs(listsQuery)
        return snapshot.docs.map((doc) => doc.id)
    } catch (error) {
        console.error('Error getting lists containing post:', error)
        return []
    }
}
