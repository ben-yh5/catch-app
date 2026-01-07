# Quick Testing Instructions

## Prerequisites
You've already built the functions successfully! ✅

## Quick Manual Tests

### 1. Deploy to Firebase (Development)

```bash
cd /Users/ben/projects/game_dev/catch-app/functions
npm run deploy
```

This will deploy:
- ✅ `getPostLocation` - Get single post location
- ✅ `getPostLocations` - Get multiple post locations (batch)
- ✅ Updated `onPostDeleted` - Now cleans up lists
- ✅ Test helper functions (createTestPost, createTestList, etc.)

### 2. Test via App

Add this code to your app to test the new functions:

#### Test getPostLocation

```typescript
import { getFunctions, httpsCallable } from 'firebase/functions';
import { functions } from './src/services/firebase'; // Your firebase config

// After creating a post in the app, get its location
const getPostLocation = httpsCallable(functions, 'getPostLocation');

try {
  const result = await getPostLocation({ postId: 'YOUR_POST_ID' });
  console.log('✅ Location:', result.data);
  // Should show: { postId: '...', latitude: X, longitude: Y }
} catch (error) {
  console.error('❌ Error:', error);
}
```

#### Test getPostLocations (batch)

```typescript
const getPostLocations = httpsCallable(functions, 'getPostLocations');

try {
  const result = await getPostLocations({
    postIds: ['post1', 'post2', 'post3']
  });
  console.log('✅ Locations:', result.data.locations);
  // Should show array of locations
} catch (error) {
  console.error('❌ Error:', error);
}
```

#### Test List Cleanup (Full Workflow)

```typescript
// 1. Create a test post
const createTestPost = httpsCallable(functions, 'createTestPost');
const postResult = await createTestPost({
  caption: 'Test Post',
  lat: 37.7749,
  lng: -122.4194
});
console.log('Created post:', postResult.data.postId);

// 2. Create a test list
const createTestList = httpsCallable(functions, 'createTestList');
const listResult = await createTestList({
  name: 'Test List',
  description: 'Testing cleanup'
});
console.log('Created list:', listResult.data.listId);

// 3. Add post to list
const addPostToList = httpsCallable(functions, 'addPostToList');
await addPostToList({
  listId: listResult.data.listId,
  postId: postResult.data.postId
});
console.log('✅ Added post to list');

// 4. Delete the post
const deleteTestPost = httpsCallable(functions, 'deleteTestPost');
await deleteTestPost({ postId: postResult.data.postId });
console.log('Deleted post');

// 5. Wait for trigger (2-3 seconds)
await new Promise(resolve => setTimeout(resolve, 3000));

// 6. Verify cleanup
const verifyListCleanup = httpsCallable(functions, 'verifyListCleanup');
const verification = await verifyListCleanup({
  listId: listResult.data.listId,
  postId: postResult.data.postId
});
console.log(verification.data.message);
// Should show: "✅ Post was removed from list (cleanup succeeded)"
```

### 3. Deploy Security Rules

```bash
cd /Users/ben/projects/game_dev/catch-app
firebase deploy --only firestore:rules
```

### 4. Test Security Rules

Via Firebase Console or your app:

1. **Create a list** (should succeed when authenticated):
```typescript
import { collection, addDoc } from 'firebase/firestore';
import { db, auth } from './src/services/firebase';

const listRef = await addDoc(collection(db, 'lists'), {
  name: 'My Travel List',
  description: 'Places I want to visit',
  creatorId: auth.currentUser.uid,
  creatorUsername: 'yourUsername',
  postIds: [],
  isPublic: true,
  createdAt: new Date(),
  updatedAt: new Date()
});
console.log('✅ Created list:', listRef.id);
```

2. **Read a list** (should succeed for public lists):
```typescript
import { doc, getDoc } from 'firebase/firestore';

const listDoc = await getDoc(doc(db, 'lists', 'LIST_ID'));
console.log('✅ List data:', listDoc.data());
```

3. **Try to delete someone else's list** (should fail):
```typescript
import { doc, deleteDoc } from 'firebase/firestore';

try {
  await deleteDoc(doc(db, 'lists', 'SOMEONE_ELSES_LIST_ID'));
  console.log('❌ Should have failed!');
} catch (error) {
  console.log('✅ Correctly blocked:', error.message);
}
```

### 5. Cleanup Test Data

After testing, clean up:

```typescript
const cleanupTestData = httpsCallable(functions, 'cleanupTestData');
const result = await cleanupTestData();
console.log(result.data.message);
```

## Verification Checklist

- [ ] Functions deployed successfully
- [ ] `getPostLocation` returns coordinates for a valid post
- [ ] `getPostLocations` returns array of coordinates
- [ ] Security rules allow creating lists when authenticated
- [ ] Security rules prevent unauthorized updates/deletes
- [ ] Post deletion removes post from lists (check Firebase Console → Firestore → lists collection)
- [ ] Test data cleaned up

## Next Steps

Once all tests pass:

1. Remove test functions from production (optional):
   - Comment out `export * from './test-functions'` in `functions/src/index.ts`
   - Rebuild and redeploy

2. Move to Phase 2: Lists Feature
   - See TRAVEL_PIVOT_CHANGES.md Phase 2 tasks

## Troubleshooting

**Build errors?**
```bash
cd functions
npm install
npm run build
```

**Deployment errors?**
```bash
firebase login
firebase use --add  # Select your project
npm run deploy
```

**Can't call functions?**
- Check Firebase Console → Functions → ensure functions are deployed
- Check authentication (must be logged in)
- Check function logs in Firebase Console

**List cleanup not working?**
- Check Firebase Console → Functions → Logs
- Look for "Removed post X from Y list(s)" message
- Ensure trigger is deployed (check Functions list)
