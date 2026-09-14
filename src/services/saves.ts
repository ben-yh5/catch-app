/**
 * Saves — one-tap bookmarks.
 *
 * `users/{uid}/saves/{postId}` is the source of truth for "is this post
 * saved". Doc id == postId gives an O(1) membership check client-side via
 * the SavesContext snapshot. `listIds` are tags mirroring which curated
 * lists the post was added to (the list's own `postIds` array remains the
 * source of truth for list membership/order — tags just power the
 * checkboxes in the save sheet).
 */

import { db } from '@/services/firebase'
import {
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    onSnapshot,
    setDoc,
    updateDoc,
} from 'firebase/firestore'

function saveRef(userId: string, postId: string) {
    return doc(db, 'users', userId, 'saves', postId)
}

export async function savePost(userId: string, postId: string): Promise<void> {
    await setDoc(saveRef(userId, postId), {
        postId,
        savedAt: new Date(),
        listIds: [],
    })
}

export async function unsavePost(
    userId: string,
    postId: string
): Promise<void> {
    await deleteDoc(saveRef(userId, postId))
}

/**
 * Tag a save with a list (called when the post is added to a list). Creates
 * the save doc if the post wasn't bookmarked yet — adding to a list implies
 * saving.
 */
export async function tagSaveWithList(
    userId: string,
    postId: string,
    listId: string
): Promise<void> {
    const ref = saveRef(userId, postId)
    const snap = await getDoc(ref)
    if (snap.exists()) {
        await updateDoc(ref, { listIds: arrayUnion(listId) })
    } else {
        await setDoc(ref, {
            postId,
            savedAt: new Date(),
            listIds: [listId],
        })
    }
}

/**
 * Remove a list tag from a save. The save itself survives — removing a post
 * from a list doesn't unsave it.
 */
export async function untagSaveFromList(
    userId: string,
    postId: string,
    listId: string
): Promise<void> {
    const ref = saveRef(userId, postId)
    const snap = await getDoc(ref)
    if (snap.exists()) {
        await updateDoc(ref, { listIds: arrayRemove(listId) })
    }
}

/**
 * Live subscription to the user's saved post ids. Firestore latency
 * compensation fires the callback immediately on local writes, so callers
 * get optimistic UI for free.
 */
export function subscribeSaves(
    userId: string,
    onChange: (savedIds: Set<string>) => void
): () => void {
    return onSnapshot(
        collection(db, 'users', userId, 'saves'),
        (snapshot) => {
            onChange(new Set(snapshot.docs.map((d) => d.id)))
        },
        (error) => {
            console.error('[saves] subscription error:', error)
        }
    )
}
