# How to Test Phase 1 Implementation

## Quick Start (5 minutes)

### Step 1: Deploy Everything

```bash
# Deploy Cloud Functions
cd functions
npm run build
npm run deploy

# Deploy Firestore Security Rules
cd ..
firebase deploy --only firestore:rules
```

### Step 2: Add Test Button to Your App

Open any screen in your app (e.g., `ProfileScreen.tsx` or `SettingsScreen.tsx`) and add:

```typescript
import { runAllPhase1Tests } from '../utils/phase1Testing'
import { TouchableOpacity, Text, Alert } from 'react-native'

// Inside your component:
const handleRunTests = async () => {
    Alert.alert('Testing', 'Running Phase 1 tests... Check console for results.')

    try {
        const results = await runAllPhase1Tests()

        if (results.success) {
            Alert.alert('✅ Success', 'All Phase 1 tests passed!')
        } else {
            Alert.alert('❌ Failed', 'Some tests failed. Check console for details.')
        }
    } catch (error) {
        Alert.alert('❌ Error', error.message)
    }
}

// In your JSX:
<TouchableOpacity onPress={handleRunTests} style={styles.testButton}>
    <Text style={styles.testButtonText}>Run Phase 1 Tests</Text>
</TouchableOpacity>

// Add these styles:
const styles = StyleSheet.create({
    testButton: {
        backgroundColor: '#007AFF',
        padding: 15,
        borderRadius: 10,
        margin: 20,
        alignItems: 'center',
    },
    testButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
})
```

### Step 3: Run the App and Tap "Run Phase 1 Tests"

```bash
npx expo run:ios
# or
npx expo run:android
```

Tap the test button and watch the console for results!

---

## Individual Test Examples

### Test 1: Get Single Post Location

```typescript
import { testGetPostLocation } from '../utils/phase1Testing'

// After creating a post, get its location
const handleTestGetLocation = async (postId: string) => {
    try {
        const location = await testGetPostLocation(postId)
        console.log('Location:', location)
        // { postId: '...', latitude: 37.7749, longitude: -122.4194 }
    } catch (error) {
        console.error('Error:', error)
    }
}
```

### Test 2: Get Multiple Post Locations (Batch)

```typescript
import { testGetPostLocations } from '../utils/phase1Testing'

const handleTestBatchLocations = async (postIds: string[]) => {
    try {
        const result = await testGetPostLocations(postIds)
        console.log('Batch locations:', result.locations)
        // [{ postId, latitude, longitude }, ...]
    } catch (error) {
        console.error('Error:', error)
    }
}
```

### Test 3: List Cleanup Workflow

```typescript
import { testListCleanup } from '../utils/phase1Testing'

const handleTestListCleanup = async () => {
    try {
        const result = await testListCleanup()

        if (result.success) {
            console.log('✅ List cleanup working!')
        } else {
            console.log('❌ List cleanup failed!')
        }
    } catch (error) {
        console.error('Error:', error)
    }
}
```

### Test 4: Clean Up Test Data

```typescript
import { cleanupAllTests } from '../utils/phase1Testing'

const handleCleanup = async () => {
    try {
        const result = await cleanupAllTests()
        console.log(result.message)
        // "Cleanup complete: X posts, Y lists, Z locations deleted"
    } catch (error) {
        console.error('Error:', error)
    }
}
```

---

## What Each Test Does

### 🧪 Test 1: getPostLocation
- Creates a test post with location
- Calls `getPostLocation` function
- Verifies coordinates are returned correctly
- **Expected Result:** Returns `{ postId, latitude, longitude }`

### 🧪 Test 2: getPostLocations (Batch)
- Creates 3 test posts with different locations
- Calls `getPostLocations` with all post IDs
- Verifies all coordinates are returned
- **Expected Result:** Returns array of locations

### 🧪 Test 3: List Cleanup
- Creates a test post
- Creates a test list
- Adds post to list
- Deletes the post
- Waits for `onPostDeleted` trigger
- Verifies post was removed from list
- **Expected Result:** List no longer contains deleted post

### 🧪 Test 4: Batch Operations
- Creates multiple posts
- Fetches all locations in one call
- **Expected Result:** Efficient batch fetching works

---

## Console Output Example

When you run `runAllPhase1Tests()`, you'll see:

```
🚀 Running all Phase 1 tests...
==================================================

📍 TEST 1: getPostLocation
--------------------------------------------------
🧪 Testing getPostLocation...
✅ getPostLocation SUCCESS: { postId: 'abc123', latitude: 37.7749, longitude: -122.4194 }

📍 TEST 2: getPostLocations (Batch)
--------------------------------------------------
🧪 Testing batch operations...
Creating 3 test posts...
✅ Created posts: ['post1', 'post2', 'post3']
Fetching locations for all posts...
✅ Batch locations: { locations: [...] }

📍 TEST 3: List Cleanup on Post Delete
--------------------------------------------------
🧪 Testing complete list cleanup workflow...
Step 1: Creating test post...
✅ Created post: xyz789
Step 2: Creating test list...
✅ Created list: list123
Step 3: Adding post to list...
✅ Added post to list
Step 4: Deleting post...
✅ Deleted post
Step 5: Waiting for onPostDeleted trigger...
Step 6: Verifying cleanup...
✅ Post xyz789 was removed from list (cleanup succeeded)
✅ TEST PASSED: List cleanup working correctly!

🧹 Cleaning up test data...
--------------------------------------------------
✅ Cleanup complete: 4 posts, 1 lists, 0 locations deleted

==================================================
📊 TEST RESULTS
==================================================
✅ getPostLocation: PASS
✅ getPostLocations: PASS
✅ List Cleanup: PASS
✅ Batch Operations: PASS

==================================================
🎉 ALL TESTS PASSED!
==================================================
```

---

## Troubleshooting

### "Function not found" Error
**Solution:** Deploy functions first
```bash
cd functions
npm run build
npm run deploy
```

### "Permission denied" Error
**Solution:** Deploy security rules
```bash
firebase deploy --only firestore:rules
```

### "Must be logged in" Error
**Solution:** Ensure you're authenticated in the app
- Check `auth.currentUser` is not null
- Log in before running tests

### Tests timeout or hang
**Solution:** Check Firebase Console → Functions → Logs
- Look for errors in function execution
- Verify indexes are created (Firestore will auto-create)

### List cleanup test fails
**Solution:** Wait longer for trigger
- Increase timeout in `testListCleanup()` from 3000ms to 5000ms
- Check Firebase Console → Functions → Logs for `onPostDeleted` execution

---

## Manual Verification (Firebase Console)

After running tests, verify in Firebase Console:

### 1. Check Functions Deployed
- Go to Firebase Console → Functions
- Verify these functions exist:
  - `getPostLocation`
  - `getPostLocations`
  - `createTestPost`
  - `createTestList`
  - `addPostToList`
  - `deleteTestPost`
  - `verifyListCleanup`
  - `cleanupTestData`

### 2. Check Security Rules
- Go to Firebase Console → Firestore → Rules
- Verify `lists` collection rules exist (around line 52)

### 3. Check Function Logs
- Go to Firebase Console → Functions → Logs
- Filter by function name
- Look for success messages like:
  - "Removed post X from Y list(s)"
  - "Created test post: ..."
  - "Cleanup complete: ..."

---

## Next Steps After Testing

Once all tests pass:

### 1. Remove Test Functions (Optional)

Edit `functions/src/index.ts`:
```typescript
// Comment out this line:
// export * from './test-functions'
```

Then:
```bash
cd functions
npm run build
npm run deploy
```

### 2. Remove Test Button from App

Remove the test button you added to ProfileScreen/SettingsScreen.

### 3. Move to Phase 2

Start implementing the Lists UI:
- See `TRAVEL_PIVOT_CHANGES.md` Phase 2
- Begin with Task 2.1: Add Lists tab to tab bar

---

## Quick Reference

| Test Function | Purpose |
|---------------|---------|
| `runAllPhase1Tests()` | Run complete test suite |
| `testGetPostLocation(postId)` | Test single location fetch |
| `testGetPostLocations(postIds)` | Test batch location fetch |
| `testListCleanup()` | Test post deletion cleanup |
| `testBatchOperations()` | Test multiple posts |
| `cleanupAllTests()` | Clean up all test data |

---

**Ready to test!** 🚀

Follow Step 1 → Step 2 → Step 3 above, then tap the test button in your app!
