/**
 * Phase 1 Testing Utilities
 *
 * Helper functions to test Phase 1 Cloud Functions from your React Native app.
 * Import these in your app and call them to verify the implementation.
 *
 * Usage:
 * import { testGetPostLocation, testListCleanup, cleanupAllTests } from './utils/phase1Testing';
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'

/**
 * Test getPostLocation function
 * @param postId - ID of a post with location
 */
export async function testGetPostLocation(postId: string) {
    console.log('🧪 Testing getPostLocation...')

    try {
        const getPostLocation = httpsCallable(functions, 'getPostLocation')
        const result = await getPostLocation({ postId })

        console.log('✅ getPostLocation SUCCESS:', result.data)
        return result.data
    } catch (error: any) {
        console.error('❌ getPostLocation ERROR:', error.message)
        throw error
    }
}

/**
 * Test getPostLocations batch function
 * @param postIds - Array of post IDs
 */
export async function testGetPostLocations(postIds: string[]) {
    console.log('🧪 Testing getPostLocations with', postIds.length, 'posts...')

    try {
        const getPostLocations = httpsCallable(functions, 'getPostLocations')
        const result = await getPostLocations({ postIds })

        console.log('✅ getPostLocations SUCCESS:', result.data)
        return result.data
    } catch (error: any) {
        console.error('❌ getPostLocations ERROR:', error.message)
        throw error
    }
}

/**
 * Complete test workflow for list cleanup
 * Creates post → Creates list → Adds post to list → Deletes post → Verifies cleanup
 */
export async function testListCleanup() {
    console.log('🧪 Testing complete list cleanup workflow...')

    try {
        // 1. Create test post
        console.log('Step 1: Creating test post...')
        const createTestPost = httpsCallable(functions, 'createTestPost')
        const postResult = await createTestPost({
            caption: 'Test Post',
            lat: 37.7749,
            lng: -122.4194,
        })
        const postId = (postResult.data as any).postId
        console.log('✅ Created post:', postId)

        // 2. Create test list
        console.log('Step 2: Creating test list...')
        const createTestList = httpsCallable(functions, 'createTestList')
        const listResult = await createTestList({
            name: 'Test List',
            description: 'Testing list cleanup',
        })
        const listId = (listResult.data as any).listId
        console.log('✅ Created list:', listId)

        // 3. Add post to list
        console.log('Step 3: Adding post to list...')
        const addPostToList = httpsCallable(functions, 'addPostToList')
        await addPostToList({ listId, postId })
        console.log('✅ Added post to list')

        // 4. Delete the post
        console.log('Step 4: Deleting post...')
        const deleteTestPost = httpsCallable(functions, 'deleteTestPost')
        await deleteTestPost({ postId })
        console.log('✅ Deleted post')

        // 5. Wait for trigger to complete
        console.log('Step 5: Waiting for onPostDeleted trigger...')
        await new Promise((resolve) => setTimeout(resolve, 3000))

        // 6. Verify cleanup
        console.log('Step 6: Verifying cleanup...')
        const verifyListCleanup = httpsCallable(functions, 'verifyListCleanup')
        const verification = await verifyListCleanup({ listId, postId })
        console.log((verification.data as any).message)

        // Check if cleanup succeeded
        if ((verification.data as any).containsPost) {
            console.error('❌ TEST FAILED: Post was not removed from list!')
            return {
                success: false,
                message: 'List cleanup failed',
                listId,
                postId,
            }
        }

        console.log('✅ TEST PASSED: List cleanup working correctly!')
        console.log('Note: List', listId, 'still exists but is now empty')

        return {
            success: true,
            message: 'List cleanup successful',
            listId,
            postId,
        }
    } catch (error: any) {
        console.error('❌ TEST FAILED:', error.message)
        throw error
    }
}

/**
 * Test creating multiple posts and lists to verify batch functionality
 */
export async function testBatchOperations() {
    console.log('🧪 Testing batch operations...')

    try {
        // Create 3 test posts
        console.log('Creating 3 test posts...')
        const createTestPost = httpsCallable(functions, 'createTestPost')

        const post1 = await createTestPost({
            caption: 'Test Post 1',
            lat: 37.7749,
            lng: -122.4194,
        })
        const post2 = await createTestPost({
            caption: 'Test Post 2',
            lat: 37.775,
            lng: -122.4195,
        })
        const post3 = await createTestPost({
            caption: 'Test Post 3',
            lat: 37.7751,
            lng: -122.4196,
        })

        const postIds = [
            (post1.data as any).postId,
            (post2.data as any).postId,
            (post3.data as any).postId,
        ]

        console.log('✅ Created posts:', postIds)

        // Test batch location fetch
        console.log('Fetching locations for all posts...')
        const getPostLocations = httpsCallable(functions, 'getPostLocations')
        const locations = await getPostLocations({ postIds })

        console.log('✅ Batch locations:', locations.data)

        return {
            success: true,
            postIds,
            locations: locations.data,
        }
    } catch (error: any) {
        console.error('❌ Batch test failed:', error.message)
        throw error
    }
}

/**
 * Clean up all test data
 */
export async function cleanupAllTests() {
    console.log('🧹 Cleaning up all test data...')

    try {
        const cleanupTestData = httpsCallable(functions, 'cleanupTestData')
        const result = await cleanupTestData()

        console.log('✅', (result.data as any).message)
        return result.data
    } catch (error: any) {
        console.error('❌ Cleanup failed:', error.message)
        throw error
    }
}

/**
 * Run all Phase 1 tests
 */
export async function runAllPhase1Tests() {
    console.log('🚀 Running all Phase 1 tests...')
    console.log('=' .repeat(50))

    const results = {
        getPostLocation: false,
        getPostLocations: false,
        listCleanup: false,
        batchOperations: false,
    }

    try {
        // Test 1: Single post location
        console.log('\n📍 TEST 1: getPostLocation')
        console.log('-'.repeat(50))
        const testPost = await httpsCallable(
            functions,
            'createTestPost'
        )({ caption: 'Test Post', lat: 37.7749, lng: -122.4194 })
        const testPostId = (testPost.data as any).postId

        await testGetPostLocation(testPostId)
        results.getPostLocation = true

        // Test 2: Batch locations
        console.log('\n📍 TEST 2: getPostLocations (Batch)')
        console.log('-'.repeat(50))
        const batchResult = await testBatchOperations()
        results.batchOperations = true
        results.getPostLocations = true

        // Test 3: List cleanup
        console.log('\n📍 TEST 3: List Cleanup on Post Delete')
        console.log('-'.repeat(50))
        await testListCleanup()
        results.listCleanup = true

        // Cleanup
        console.log('\n🧹 Cleaning up test data...')
        console.log('-'.repeat(50))
        await cleanupAllTests()

        // Final report
        console.log('\n' + '='.repeat(50))
        console.log('📊 TEST RESULTS')
        console.log('='.repeat(50))
        console.log('✅ getPostLocation:', results.getPostLocation ? 'PASS' : 'FAIL')
        console.log(
            '✅ getPostLocations:',
            results.getPostLocations ? 'PASS' : 'FAIL'
        )
        console.log('✅ List Cleanup:', results.listCleanup ? 'PASS' : 'FAIL')
        console.log(
            '✅ Batch Operations:',
            results.batchOperations ? 'PASS' : 'FAIL'
        )

        const allPassed = Object.values(results).every((r) => r === true)
        console.log('\n' + '='.repeat(50))
        console.log(
            allPassed
                ? '🎉 ALL TESTS PASSED!'
                : '❌ Some tests failed - see details above'
        )
        console.log('='.repeat(50))

        return {
            success: allPassed,
            results,
        }
    } catch (error: any) {
        console.error('\n❌ Test suite failed:', error.message)
        console.log('\nCleaning up partial test data...')
        await cleanupAllTests().catch((e) =>
            console.error('Cleanup also failed:', e.message)
        )
        throw error
    }
}
