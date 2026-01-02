# Phase 1 Testing Guide

This guide walks through testing all Phase 1 Cloud Functions implementations.

## Prerequisites

1. Firebase CLI installed and logged in
2. Functions built: `cd functions && npm run build`
3. Firebase emulators running (optional but recommended): `npm run serve`

## Setup

### Option 1: Using Firebase Emulator (Recommended)

```bash
cd functions
npm run build
npm run serve
```

This starts the Firebase Emulator with Functions support. You can then call functions via the emulator.

### Option 2: Deploy to Firebase (Production Testing)

```bash
cd functions
npm run build
npm run deploy
```

**Note:** Only deploy after local testing is successful!

## Test Suite

### Test 1: Security Rules for Lists Collection

**Goal:** Verify that the lists security rules work correctly.

**Manual Test (via Firebase Console or Emulator):**

1. Open Firebase Console → Firestore
2. Try to create a list document manually:
   ```json
   {
     "id": "test-list-1",
     "name": "My Test List",
     "description": "Testing lists security",
     "creatorId": "YOUR_USER_ID",
     "creatorUsername": "testuser",
     "postIds": [],
     "isPublic": true,
     "createdAt": "2024-01-01T00:00:00Z",
     "updatedAt": "2024-01-01T00:00:00Z"
   }
   ```

**Expected Results:**
- ✅ Authenticated users can create lists where creatorId matches their auth.uid
- ✅ Anyone can read public lists (isPublic: true)
- ✅ Only the creator can update/delete their lists
- ❌ Non-creators cannot update/delete others' lists

---

### Test 2: getPostLocation Cloud Function

**Goal:** Verify that the function returns correct coordinates for a single post.

**Setup:**
1. Create a test post with location (use the app or createTestPost helper)
2. Note the postId

**Test via App/Client:**
```typescript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const getPostLocation = httpsCallable(functions, 'getPostLocation');

// Test with valid post
const result1 = await getPostLocation({ postId: 'YOUR_POST_ID' });
console.log('Location:', result1.data);
// Expected: { postId: 'YOUR_POST_ID', latitude: 37.7749, longitude: -122.4194 }

// Test with non-existent post
try {
  await getPostLocation({ postId: 'invalid-id' });
} catch (error) {
  console.log('Expected error:', error.message); // 'Post not found'
}

// Test without authentication (should fail)
// Log out first, then:
try {
  await getPostLocation({ postId: 'YOUR_POST_ID' });
} catch (error) {
  console.log('Expected error:', error.message); // 'Must be logged in'
}
```

**Expected Results:**
- ✅ Returns correct latitude/longitude for valid post with location
- ❌ Throws 'not-found' error for non-existent post
- ❌ Throws 'failed-precondition' error for post without location
- ❌ Throws 'unauthenticated' error when not logged in

---

### Test 3: getPostLocations Cloud Function (Batch)

**Goal:** Verify that the function returns coordinates for multiple posts.

**Setup:**
1. Create 3-5 test posts with locations
2. Note all postIds

**Test via App/Client:**
```typescript
const getPostLocations = httpsCallable(functions, 'getPostLocations');

// Test with valid posts
const result1 = await getPostLocations({
  postIds: ['post1', 'post2', 'post3']
});
console.log('Locations:', result1.data.locations);
// Expected: [
//   { postId: 'post1', latitude: 37.7749, longitude: -122.4194 },
//   { postId: 'post2', latitude: 37.7750, longitude: -122.4195 },
//   { postId: 'post3', latitude: 37.7751, longitude: -122.4196 }
// ]

// Test with empty array
const result2 = await getPostLocations({ postIds: [] });
console.log('Empty result:', result2.data.locations); // Expected: []

// Test with mix of valid/invalid IDs
const result3 = await getPostLocations({
  postIds: ['post1', 'invalid-id', 'post2']
});
console.log('Partial result:', result3.data.locations);
// Expected: Only returns valid posts (post1, post2)

// Test with too many posts (>500)
try {
  const manyIds = Array(600).fill('post1');
  await getPostLocations({ postIds: manyIds });
} catch (error) {
  console.log('Expected error:', error.message);
  // 'Cannot fetch more than 500 post locations at once'
}
```

**Expected Results:**
- ✅ Returns array of locations for valid posts
- ✅ Returns empty array for empty input
- ✅ Gracefully handles mix of valid/invalid post IDs
- ❌ Throws error for >500 posts
- ❌ Throws 'unauthenticated' error when not logged in

---

### Test 4: onPostDeleted - List Cleanup

**Goal:** Verify that when a post is deleted, it's removed from all lists.

**Test Steps:**

1. **Create test post:**
   ```typescript
   const createTestPost = httpsCallable(functions, 'createTestPost');
   const postResult = await createTestPost({
     caption: 'Test Post',
     lat: 37.7749,
     lng: -122.4194
   });
   const postId = postResult.data.postId;
   console.log('Created post:', postId);
   ```

2. **Create test list:**
   ```typescript
   const createTestList = httpsCallable(functions, 'createTestList');
   const listResult = await createTestList({
     name: 'Test List',
     description: 'Testing list cleanup',
     postIds: []
   });
   const listId = listResult.data.listId;
   console.log('Created list:', listId);
   ```

3. **Add post to list:**
   ```typescript
   const addPostToList = httpsCallable(functions, 'addPostToList');
   await addPostToList({ listId, postId });
   console.log('Added post to list');
   ```

4. **Verify post is in list:**
   ```typescript
   const listDoc = await getDoc(doc(db, 'lists', listId));
   console.log('List postIds:', listDoc.data().postIds);
   // Expected: [postId]
   ```

5. **Delete the post:**
   ```typescript
   const deleteTestPost = httpsCallable(functions, 'deleteTestPost');
   await deleteTestPost({ postId });
   console.log('Deleted post');
   ```

6. **Wait for trigger to complete (2-3 seconds):**
   ```typescript
   await new Promise(resolve => setTimeout(resolve, 3000));
   ```

7. **Verify post was removed from list:**
   ```typescript
   const verifyListCleanup = httpsCallable(functions, 'verifyListCleanup');
   const verification = await verifyListCleanup({ listId, postId });
   console.log(verification.data.message);
   // Expected: "✅ Post {postId} was removed from list (cleanup succeeded)"
   ```

**Expected Results:**
- ✅ Post is initially added to list
- ✅ After deletion, post is automatically removed from list
- ✅ List still exists but postIds array no longer contains deleted post
- ✅ Multiple lists are updated if post was in multiple lists

---

### Test 5: Integration Test - Full Workflow

**Goal:** Test complete workflow from post creation to deletion with list cleanup.

**Test Steps:**

1. Create 3 test posts
2. Create 2 test lists
3. Add posts to lists:
   - List 1: post1, post2
   - List 2: post2, post3
4. Verify lists contain correct posts
5. Delete post2
6. Verify post2 is removed from both lists
7. Verify other posts remain in their respective lists
8. Clean up remaining test data

**Example Code:**
```typescript
// 1. Create posts
const post1 = await createTestPost({ caption: 'Test Post 1' });
const post2 = await createTestPost({ caption: 'Test Post 2' });
const post3 = await createTestPost({ caption: 'Test Post 3' });

// 2. Create lists
const list1 = await createTestList({ name: 'Test List 1' });
const list2 = await createTestList({ name: 'Test List 2' });

// 3. Add posts to lists
await addPostToList({ listId: list1.data.listId, postId: post1.data.postId });
await addPostToList({ listId: list1.data.listId, postId: post2.data.postId });
await addPostToList({ listId: list2.data.listId, postId: post2.data.postId });
await addPostToList({ listId: list2.data.listId, postId: post3.data.postId });

// 4. Verify initial state
const list1Doc = await getDoc(doc(db, 'lists', list1.data.listId));
const list2Doc = await getDoc(doc(db, 'lists', list2.data.listId));
console.log('List 1 posts:', list1Doc.data().postIds); // [post1, post2]
console.log('List 2 posts:', list2Doc.data().postIds); // [post2, post3]

// 5. Delete post2
await deleteTestPost({ postId: post2.data.postId });
await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for trigger

// 6. Verify post2 removed from both lists
const list1After = await getDoc(doc(db, 'lists', list1.data.listId));
const list2After = await getDoc(doc(db, 'lists', list2.data.listId));
console.log('List 1 posts after:', list1After.data().postIds); // [post1]
console.log('List 2 posts after:', list2After.data().postIds); // [post3]

// 7. Cleanup
await cleanupTestData();
```

**Expected Results:**
- ✅ Post appears in multiple lists
- ✅ Deleting post removes it from all lists
- ✅ Other posts in the lists are unaffected
- ✅ No errors or orphaned data

---

## Cleanup

After testing, clean up all test data:

```typescript
const cleanupTestData = httpsCallable(functions, 'cleanupTestData');
const result = await cleanupTestData();
console.log(result.data.message);
// Expected: "Cleanup complete: X posts, Y lists, Z locations deleted"
```

Or manually delete test documents via Firebase Console.

---

## Deploying Security Rules

After testing rules locally via emulator, deploy them to production:

```bash
firebase deploy --only firestore:rules
```

Verify deployment:
1. Open Firebase Console → Firestore → Rules
2. Check that the lists collection rules are present
3. Test creating/reading lists via the app

---

## Deploying Cloud Functions

After all tests pass, deploy to production:

```bash
cd functions
npm run build
npm run deploy
```

Verify deployment:
1. Open Firebase Console → Functions
2. Check that new functions appear:
   - getPostLocation
   - getPostLocations
   - Test functions (createTestPost, createTestList, etc.)
3. Check logs for any errors

---

## Removing Test Functions from Production

The test functions in `test-functions.ts` are helpful for development but should be removed or restricted in production.

**Option 1: Remove exports (recommended for production)**

Edit `functions/src/index.ts`:
```typescript
// Remove or comment out this line:
// export * from './test-functions'
```

Then redeploy:
```bash
npm run build
npm run deploy
```

**Option 2: Add environment check**

Keep test functions but only export in development:
```typescript
// In functions/src/index.ts
if (process.env.FUNCTIONS_EMULATOR === 'true') {
  export * from './test-functions'
}
```

---

## Troubleshooting

### Functions don't appear after deployment
- Check build output: `npm run build`
- Check Firebase Console → Functions → Logs
- Verify IAM permissions

### Security rules not working
- Ensure rules are deployed: `firebase deploy --only firestore:rules`
- Check Firebase Console → Firestore → Rules tab
- Test via Firebase Console or Emulator UI

### Trigger not executing
- Check Firebase Console → Functions → Logs
- Ensure sufficient permissions for service account
- Verify Firestore indexes if needed

### List cleanup not working
- Check function logs for errors
- Verify `onPostDeleted` trigger is deployed
- Add manual logging to verify trigger execution
- Check that query `where('postIds', 'array-contains', postId)` works

---

## Success Criteria

All Phase 1 tasks are complete when:

- ✅ Lists security rules deployed and working
- ✅ `getPostLocation` returns correct coordinates
- ✅ `getPostLocations` handles batch requests correctly
- ✅ `onPostDeleted` removes posts from all lists
- ✅ All error cases handled gracefully
- ✅ No console errors or warnings
- ✅ Test data cleaned up
- ✅ Functions deployed to production (optional)
