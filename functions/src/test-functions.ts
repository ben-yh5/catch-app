/**
 * Manual Test Suite for Cloud Functions
 *
 * This file contains test functions that can be called manually from the Firebase Functions Shell
 * or via the Firebase Emulator to test the newly implemented Phase 1 functions.
 *
 * Usage:
 * 1. Run: npm run shell (in functions directory)
 * 2. Call functions like: testGetPostLocation()
 */

import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

// Initialize admin if not already initialized (for testing)
if (!admin.apps.length) {
    admin.initializeApp()
}

const db = admin.firestore()

/**
 * Test Helper: Create a test post with location
 */
export const createTestPost = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated')
    }

    const { caption = 'Test Post', lat = 37.7749, lng = -122.4194 } = data
    const userId = context.auth.uid

    try {
        // Create post
        const postRef = await db.collection('posts').add({
            authorId: userId,
            authorUsername: 'testuser',
            photoURL: 'https://example.com/test.jpg',
            caption,
            hasLocation: true,
            catchCount: 0,
            isOriginal: true,
            parentPostId: null,
            rootPostId: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        // Create location
        await db.collection('post_locations').add({
            postId: postRef.id,
            latitude: lat,
            longitude: lng,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        functions.logger.info(`Created test post: ${postRef.id}`)
        return {
            success: true,
            postId: postRef.id,
            message: `Test post created with ID: ${postRef.id}`,
        }
    } catch (error) {
        functions.logger.error('Error creating test post:', error)
        throw new functions.https.HttpsError('internal', 'Failed to create test post')
    }
})

/**
 * Test Helper: Create a test list
 */
export const createTestList = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated')
    }

    const { name = 'Test List', description = 'A test list', postIds = [] } = data
    const userId = context.auth.uid

    try {
        const listRef = await db.collection('lists').add({
            name,
            description,
            creatorId: userId,
            creatorUsername: 'testuser',
            postIds,
            isPublic: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        functions.logger.info(`Created test list: ${listRef.id}`)
        return {
            success: true,
            listId: listRef.id,
            message: `Test list created with ID: ${listRef.id}`,
        }
    } catch (error) {
        functions.logger.error('Error creating test list:', error)
        throw new functions.https.HttpsError('internal', 'Failed to create test list')
    }
})

/**
 * Test Helper: Add post to list
 */
export const addPostToList = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated')
    }

    const { listId, postId } = data

    if (!listId || !postId) {
        throw new functions.https.HttpsError('invalid-argument', 'listId and postId required')
    }

    try {
        await db.collection('lists').doc(listId).update({
            postIds: admin.firestore.FieldValue.arrayUnion(postId),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        functions.logger.info(`Added post ${postId} to list ${listId}`)
        return {
            success: true,
            message: `Post ${postId} added to list ${listId}`,
        }
    } catch (error) {
        functions.logger.error('Error adding post to list:', error)
        throw new functions.https.HttpsError('internal', 'Failed to add post to list')
    }
})

/**
 * Test Helper: Delete a test post
 */
export const deleteTestPost = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated')
    }

    const { postId } = data

    if (!postId) {
        throw new functions.https.HttpsError('invalid-argument', 'postId required')
    }

    try {
        await db.collection('posts').doc(postId).delete()

        functions.logger.info(`Deleted test post: ${postId}`)
        return {
            success: true,
            message: `Post ${postId} deleted`,
        }
    } catch (error) {
        functions.logger.error('Error deleting test post:', error)
        throw new functions.https.HttpsError('internal', 'Failed to delete test post')
    }
})

/**
 * Test Helper: Verify list cleanup after post deletion
 */
export const verifyListCleanup = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated')
    }

    const { listId, postId } = data

    if (!listId || !postId) {
        throw new functions.https.HttpsError('invalid-argument', 'listId and postId required')
    }

    try {
        const listDoc = await db.collection('lists').doc(listId).get()

        if (!listDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'List not found')
        }

        const listData = listDoc.data()
        const hasPost = listData?.postIds?.includes(postId) || false

        functions.logger.info(`List ${listId} contains post ${postId}: ${hasPost}`)

        return {
            success: true,
            listId,
            postId,
            containsPost: hasPost,
            postIds: listData?.postIds || [],
            message: hasPost
                ? `⚠️ Post ${postId} is still in list (cleanup failed)`
                : `✅ Post ${postId} was removed from list (cleanup succeeded)`,
        }
    } catch (error) {
        functions.logger.error('Error verifying list cleanup:', error)
        throw new functions.https.HttpsError('internal', 'Failed to verify list cleanup')
    }
})

/**
 * Cleanup Helper: Delete all test data
 */
export const cleanupTestData = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated')
    }

    try {
        let deletedPosts = 0
        let deletedLists = 0
        let deletedLocations = 0

        // Delete test posts
        const postsQuery = await db
            .collection('posts')
            .where('caption', '>=', 'Test Post')
            .where('caption', '<=', 'Test Post\uf8ff')
            .get()

        const batch1 = db.batch()
        postsQuery.docs.forEach((doc) => {
            batch1.delete(doc.ref)
            deletedPosts++
        })
        await batch1.commit()

        // Delete test lists
        const listsQuery = await db
            .collection('lists')
            .where('name', '>=', 'Test List')
            .where('name', '<=', 'Test List\uf8ff')
            .get()

        const batch2 = db.batch()
        listsQuery.docs.forEach((doc) => {
            batch2.delete(doc.ref)
            deletedLists++
        })
        await batch2.commit()

        // Delete orphaned test locations (this will run after posts are deleted)
        // Wait a bit for triggers to finish
        await new Promise((resolve) => setTimeout(resolve, 2000))

        const locationsQuery = await db.collection('post_locations').get()

        const batch3 = db.batch()
        for (const doc of locationsQuery.docs) {
            const locationData = doc.data()
            const postExists = await db
                .collection('posts')
                .doc(locationData.postId)
                .get()

            if (!postExists.exists) {
                batch3.delete(doc.ref)
                deletedLocations++
            }
        }
        await batch3.commit()

        functions.logger.info(
            `Cleanup complete: ${deletedPosts} posts, ${deletedLists} lists, ${deletedLocations} locations`
        )

        return {
            success: true,
            deletedPosts,
            deletedLists,
            deletedLocations,
            message: `Cleanup complete: ${deletedPosts} posts, ${deletedLists} lists, ${deletedLocations} locations deleted`,
        }
    } catch (error) {
        functions.logger.error('Error cleaning up test data:', error)
        throw new functions.https.HttpsError('internal', 'Failed to cleanup test data')
    }
})
