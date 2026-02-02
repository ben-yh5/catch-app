import { db } from '@/services/firebase'
import { Post } from '@/types'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'

/**
 * Fetches multiple posts by ID in batches to respect Firestore limits
 * Firestore 'in' queries are limited to 30 items
 */
export async function batchGetPosts(postIds: string[]): Promise<Post[]> {
    if (!postIds.length) return []

    // Deduplicate IDs
    const uniqueIds = [...new Set(postIds)]
    const chunks = []
    const chunkSize = 30 // Firestore limit for 'in' queries

    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
        chunks.push(uniqueIds.slice(i, i + chunkSize))
    }

    const results = await Promise.all(
        chunks.map(async (chunk) => {
            try {
                const q = query(
                    collection(db, 'posts'),
                    where(documentId(), 'in', chunk)
                )
                const snapshot = await getDocs(q)
                return snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                } as Post))
            } catch (chunkError) {
                console.warn('Error fetching chunk of posts:', chunkError)
                return []
            }
        })
    )

    return results.flat()
}
