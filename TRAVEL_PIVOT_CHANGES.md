# Travel-Passport Pivot - Implementation Plan

## Overview
Transforming Catch from a location-guessing scavenger hunt into a travel passport app where users discover and visit photo-worthy locations around the world.

## Core Concept Changes
- **Old**: Hide location, make others guess from photo
- **New**: Show locations on map, encourage travel and discovery
- **Keep**: 100m validation radius, photo timeline threads, social features, "Catch This Location"

---

## 1. Map Tab Implementation (NEW)

### Features
- Interactive map showing all catchable post locations
- Two modes with toggle at top:
  - **Explore Mode** (default): All catchable locations globally
  - **My Catches Mode**: Only locations you've caught (others hidden/grayed)
- Cluster/group nearby posts to prevent visual clutter
- Tap pin → opens ThreadModal
- Filter options: Popular / Trending / Nearby
- **"Get Directions" button** → opens Apple/Google Maps with coordinates

### Technical Requirements
- Use `react-native-maps` for iOS/Android
- Query posts with `hasLocation: true` from Firestore
- Fetch coordinates via Cloud Function (since `post_locations` is server-only)
- Cluster markers when zoomed out (use `react-native-maps-super-cluster` or similar)
- For "My Catches" mode: filter posts where user has a catch in the thread

### New Files
- `app/(tabs)/map.tsx` - Replace placeholder with full implementation
- `src/screens/MapScreen.tsx` - Main map logic
- Cloud Function: `getPostLocation` - Returns coordinates for a specific post (HTTPS Callable)

---

## 2. Lists Feature (NEW - Tab 4)

### Features
- Create, edit, delete lists
- Add posts to multiple lists
- Browse community lists (public only for now)
- List detail view showing grid of posts in list
- "Add to List" button in ThreadModal

### Firestore Schema

#### `lists/{listId}`
```typescript
{
  id: string;
  name: string;
  description: string; // optional
  creatorId: string;
  creatorUsername: string;
  postIds: string[]; // array of post IDs in this list
  isPublic: boolean; // always true for now
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

### Security Rules (Firestore)
```javascript
match /lists/{listId} {
  // Anyone can read public lists
  allow read: if resource.data.isPublic == true;

  // Only authenticated users can create lists
  allow create: if request.auth != null &&
                   request.auth.uid == request.resource.data.creatorId;

  // Only creator can update/delete
  allow update, delete: if request.auth != null &&
                            request.auth.uid == resource.data.creatorId;
}
```

### New Files
- `app/(tabs)/lists.tsx` - Lists tab route
- `src/screens/ListsScreen.tsx` - Browse your lists + community lists
- `src/screens/ListDetailScreen.tsx` - View posts in a specific list
- `app/create-list.tsx` - Modal for creating/editing lists

### Modified Files
- `src/components/ThreadModal.tsx` - Add "Add to List" button in three-dot menu

---

## 3. Explore Tab (Keep Name)

### Changes
- **Keep current feed implementation** as-is
- Remains Tab 1
- Shows original posts ordered by catchCount
- No major changes needed

---

## 4. Profile Changes (Minimal)

### Keep
- Current grid view (2 columns)
- Username, total posts, total catches stats
- Grid of user's posts (tappable → ThreadModal)

### Remove
- Don't add "Y countries" stat (not needed)
- Keep current implementation mostly as-is

---

## 5. Thread Modal Updates

### New Features
- **"Get Directions" button** below "Catch This Location"
  - Only shows if post has location
  - Opens Apple Maps (iOS) or Google Maps (Android) with coordinates
  - Needs Cloud Function call to get coordinates
- **Distance display**: "1.2 km away" or "342 m away" from user's current location
- **"Add to List" option** in three-dot menu

### Modified Files
- `src/components/ThreadModal.tsx`

---

## 6. Post Creation Flow

### Changes
- **Make location mandatory** (no more optional locations)
- Update UI copy to emphasize discovery/sharing places
- Remove any language about "hiding" location
- Caption is still the primary identifier (no separate place name field)

### Modified Files
- `src/screens/PostScreen.tsx` or `src/components/UnifiedCameraView.tsx`
- Update error handling if location permission denied (can't post without location)

---

## 7. Tab Bar Configuration

### Final Tab Structure
1. **Explore** - Feed of original posts (current implementation)
2. **Map** - Interactive map with Explore/My Catches toggle
3. **Post** - Camera/catch flow (unchanged)
4. **Lists** - Your lists + community lists
5. **Profile** - Your grid of catches + stats

### Modified Files
- `app/(tabs)/_layout.tsx` - Update tab configuration, icons, labels

---

## 8. Backend/Cloud Functions Changes

### New Cloud Functions

#### `getPostLocation` (HTTPS Callable)
Returns coordinates for a specific post (needed for map pins and directions).

**Request:**
```typescript
{ postId: string }
```

**Response:**
```typescript
{
  latitude: number;
  longitude: number;
  postId: string;
}
```

**Logic:**
- Authenticate user
- Verify post exists and has location
- Fetch from `post_locations` collection
- Return coordinates

#### `getPostLocations` (HTTPS Callable) - OPTIONAL
Batch version to fetch multiple post locations at once for map view.

**Request:**
```typescript
{ postIds: string[] }
```

**Response:**
```typescript
{
  locations: Array<{
    postId: string;
    latitude: number;
    longitude: number;
  }>
}
```

### Modified Cloud Functions

#### `validateCatch`
- No changes needed (already validates location within 100m)

#### `onPostDeleted`
- **NEW**: When a post is deleted, remove it from any lists
  - Query `lists` collection where `postIds` array-contains the deleted postId
  - Update each list to remove the postId from array

#### `onPostCreated`
- No changes needed (already handles totalCatches increment and notifications)

### Modified Files
- `functions/src/index.ts`

---

## 9. Firestore Schema Changes

### Posts Collection (Modify)
Make `hasLocation` effectively required by enforcing it in client code. No schema changes needed, but client must ensure all new posts have `hasLocation: true`.

### New Collections

#### `lists/{listId}`
See section 2 above for full schema.

---

## 10. Navigation/Routing Updates

### New Routes
- `app/(tabs)/lists.tsx` - Lists tab
- `app/create-list.tsx` - Create/edit list modal
- `app/list-detail.tsx` - View specific list (route: `/list-detail?listId=...`)

### Modified Routes
- `app/(tabs)/_layout.tsx` - Update tab bar config
- `app/_layout.tsx` - Add new route definitions to Stack navigator

---

## 11. Copy/Messaging Updates

### Updated User-Facing Text
- Post creation screen: "Share a location" instead of "Create a post"
- ThreadModal: Keep "Catch This Location" button
- Onboarding (if exists): Update to reflect travel/discovery theme
- Any "scavenger hunt" language → "discover and explore"

### Files to Update
- `src/components/ThreadModal.tsx`
- `src/screens/PostScreen.tsx` or camera components
- Any onboarding screens (if they exist)

---

## 12. Implementation Order (Suggested)

### Phase 1: Backend Foundation
1. Add `lists` Firestore collection and security rules
2. Implement `getPostLocation` Cloud Function
3. Implement `getPostLocations` Cloud Function (optional batch version)
4. Update `onPostDeleted` to clean up lists

### Phase 2: Lists Feature
1. Create `ListsScreen.tsx` - browse lists
2. Create list creation modal
3. Create `ListDetailScreen.tsx`
4. Add "Add to List" to ThreadModal
5. Wire up routing

### Phase 3: Map Feature
1. Install and configure `react-native-maps`
2. Create `MapScreen.tsx` with basic map
3. Fetch post locations and display markers
4. Implement clustering
5. Add Explore/My Catches toggle
6. Add filters (popular/trending/nearby)

### Phase 4: Integration & Polish
1. Add "Get Directions" to ThreadModal
2. Add distance display in ThreadModal
3. Make location mandatory in post creation
4. Update copy throughout app
5. Test end-to-end flows

---

## Database Migration Notes

### Current State
- Empty database, no existing posts
- Fresh start, no migration needed

### Required Firestore Changes
1. Add security rules for `lists` collection (see Section 2)
2. Keep existing rules for `users`, `posts`, `post_locations`

### Required Firebase Functions Deploy
1. Deploy new `getPostLocation` function
2. Deploy new `getPostLocations` function (if implementing)
3. Deploy updated `onPostDeleted` function

---

## Key Implementation Details

### Getting Coordinates for Map/Directions
Since `post_locations` collection is server-only, you must call Cloud Function to get coordinates:

```typescript
// In MapScreen or ThreadModal
const getPostLocation = httpsCallable(functions, 'getPostLocation');
const result = await getPostLocation({ postId: 'abc123' });
const { latitude, longitude } = result.data;
```

### Opening Directions
```typescript
// iOS
const url = `maps://maps.apple.com/?daddr=${latitude},${longitude}`;
Linking.openURL(url);

// Android
const url = `google.navigation:q=${latitude},${longitude}`;
Linking.openURL(url);

// Fallback (web)
const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
Linking.openURL(url);
```

### Map Clustering
Use `react-native-maps-super-cluster` or implement custom clustering logic to group nearby posts when zoomed out.

### Mandatory Location Enforcement
In post creation, block submission if location is null:

```typescript
if (!location) {
  Alert.alert('Location Required', 'You must enable location to post');
  return;
}
```

---

## Questions Resolved

✅ **Followers/following**: Keep all social features
✅ **Location required**: Mandatory for all new posts
✅ **Minimum thread spacing**: No enforcement, anyone can post anywhere
✅ **Place names**: Not needed, use user captions
✅ **Lists privacy**: Public only (private lists can be added later)
✅ **Current posts**: Database is empty, no migration needed
✅ **Tab name**: Keep "Explore" (not "Discover")
✅ **Profile stats**: Don't add "Y countries", keep current view
✅ **Button copy**: Keep "Catch This Location"

---

## Next Steps

1. Review this plan and confirm approach
2. Set up Firestore security rules for `lists` collection
3. Start Phase 1: Backend implementation
4. Test each phase before moving to next
5. Deploy incrementally to avoid breaking existing functionality

---

## Notes
- Keep 100m validation radius (critical for photo timeline consistency)
- This pivot makes the app more accessible (no geoguessr skills needed)
- Map becomes primary discovery tool, not profile
- Lists help users plan trips and curate collections
- Social features remain intact (follow, notifications, etc.)

---

# TASK BREAKDOWN

Each task below is independently testable and can be completed in isolation. Complete tasks in order within each phase.

## PHASE 1: Backend Foundation

### Task 1.1: Add Lists Security Rules
**Goal**: Update Firestore security rules to support lists collection

**Steps**:
1. Open Firebase Console → Firestore → Rules
2. Add the lists security rules (see Section 2 above)
3. Publish rules

**Test**:
- Try creating a list document manually in Firestore console
- Verify rules allow authenticated users to create/update/delete their own lists
- Verify anyone can read public lists

**Dependencies**: None

---

### Task 1.2: Implement `getPostLocation` Cloud Function
**Goal**: Create Cloud Function that returns coordinates for a single post

**Steps**:
1. Open `functions/src/index.ts`
2. Add `getPostLocation` function (see Section 8 for spec)
3. Build functions: `cd functions && npm run build`
4. Deploy: `npm run deploy`

**Test**:
1. Create a test post with location in the app
2. In app, call the function with the post ID
3. Verify it returns correct latitude/longitude
4. Test with non-existent post ID (should error gracefully)
5. Test without authentication (should reject)

**Dependencies**: None

---

### Task 1.3: Implement `getPostLocations` Cloud Function (OPTIONAL)
**Goal**: Create Cloud Function that returns coordinates for multiple posts at once

**Steps**:
1. Open `functions/src/index.ts`
2. Add `getPostLocations` function (see Section 8 for spec)
3. Build and deploy

**Test**:
1. Create 3-5 test posts with locations
2. Call function with array of post IDs
3. Verify it returns array of coordinates
4. Test with mix of valid/invalid IDs
5. Test with empty array

**Dependencies**: None (can skip if you prefer to fetch one-by-one)

---

### Task 1.4: Update `onPostDeleted` to Clean Up Lists
**Goal**: When post is deleted, remove it from all lists

**Steps**:
1. Open `functions/src/index.ts`
2. Find `onPostDeleted` function
3. Add logic to query lists where `postIds` array-contains deleted postId
4. Update each list to remove postId from array
5. Build and deploy

**Test**:
1. Create a list manually in Firestore
2. Add a post ID to the list's `postIds` array
3. Delete that post from the app
4. Verify the post ID is removed from the list automatically

**Dependencies**: Task 1.1 (security rules)

---

## PHASE 2: Lists Feature

### Task 2.1: Add Tab Bar Configuration for Lists
**Goal**: Add Lists tab to bottom navigation

**Steps**:
1. Open `app/(tabs)/_layout.tsx`
2. Add fourth tab: Lists (between Post and Profile)
3. Choose appropriate icon (e.g., `list` or `bookmark-outline`)
4. Create placeholder `app/(tabs)/lists.tsx` that just shows "Lists Coming Soon"

**Test**:
1. Run app
2. Verify Lists tab appears in tab bar
3. Tap Lists tab, verify placeholder screen shows
4. Verify navigation works between all tabs

**Dependencies**: None

---

### Task 2.2: Create List Creation Modal
**Goal**: UI to create and edit lists

**Steps**:
1. Create `app/create-list.tsx` as modal route
2. Add form: list name (required), description (optional)
3. Add save button that creates list in Firestore
4. Add cancel button to close modal
5. Update `app/_layout.tsx` to register route

**Test**:
1. Open modal (can test by navigating manually: `router.push('/create-list')`)
2. Fill in name and description
3. Tap save
4. Verify list appears in Firestore console
5. Test validation (empty name should show error)
6. Test cancel button

**Dependencies**: Task 1.1 (security rules), Task 2.1 (routing setup)

---

### Task 2.3: Create ListsScreen - Your Lists View
**Goal**: Screen showing user's created lists

**Steps**:
1. Create `src/screens/ListsScreen.tsx`
2. Query `lists` collection where `creatorId == currentUser.uid`
3. Display as simple FlatList with list names
4. Add FAB (floating action button) to create new list → opens create-list modal
5. Tap list → navigate to list detail (placeholder for now)
6. Update `app/(tabs)/lists.tsx` to use this screen

**Test**:
1. Open Lists tab
2. Verify your created lists appear
3. Tap FAB, verify create modal opens
4. Create a list, verify it appears in the list
5. Pull to refresh, verify lists reload

**Dependencies**: Task 2.1, Task 2.2

---

### Task 2.4: Create ListDetailScreen
**Goal**: Screen showing all posts in a specific list

**Steps**:
1. Create `src/screens/ListDetailScreen.tsx`
2. Create route `app/list-detail.tsx` that accepts `listId` param
3. Fetch list document from Firestore
4. Fetch all posts where `postId` in `list.postIds` array (batch query)
5. Display posts in grid (2 columns, like profile)
6. Tap post → open ThreadModal
7. Add delete list button (with confirmation)

**Test**:
1. Create a list
2. Manually add some post IDs to the list in Firestore
3. Navigate to list detail
4. Verify posts appear in grid
5. Tap post, verify ThreadModal opens
6. Test delete list functionality

**Dependencies**: Task 2.3

---

### Task 2.5: Add "Add to List" in ThreadModal
**Goal**: Allow adding posts to lists from ThreadModal

**Steps**:
1. Open `src/components/ThreadModal.tsx`
2. Add "Add to List" option in three-dot menu
3. When tapped, show bottom sheet with user's lists
4. User selects list(s) to add current post to
5. Update Firestore: add postId to list's `postIds` array using `arrayUnion`
6. Show success toast

**Test**:
1. Create 2-3 lists
2. Open any post in ThreadModal
3. Tap three-dot menu → "Add to List"
4. Select a list
5. Verify post is added to list (check Firestore or navigate to list detail)
6. Test adding to multiple lists
7. Test removing from list (optional: add "Remove from List" option)

**Dependencies**: Task 2.3, Task 2.4

---

### Task 2.6: Add Community Lists Browse (OPTIONAL)
**Goal**: Browse public lists created by other users

**Steps**:
1. Update `src/screens/ListsScreen.tsx`
2. Add tabs: "My Lists" | "Community"
3. Community tab queries `lists` where `isPublic == true`, ordered by `createdAt`
4. Show list name, creator username, post count
5. Tap → navigate to list detail (read-only for others' lists)

**Test**:
1. Create lists with different users
2. Switch to Community tab
3. Verify other users' public lists appear
4. Tap a community list, verify you can view but not edit

**Dependencies**: Task 2.4

---

## PHASE 3: Map Feature

### Task 3.1: Install and Configure React Native Maps
**Goal**: Add maps package and configure for iOS/Android

**Steps**:
1. Install: `npx expo install react-native-maps`
2. Add to `app.config.js` if needed for API keys
3. Run prebuild: `npx expo prebuild --clean`
4. Test basic map renders on iOS/Android

**Test**:
1. Create simple test screen with `<MapView>` component
2. Run on iOS simulator: `npx expo run:ios`
3. Run on Android emulator: `npx expo run:android`
4. Verify map displays correctly on both platforms

**Dependencies**: None

---

### Task 3.2: Create Basic MapScreen with All Posts
**Goal**: Display all posts with locations as markers on map

**Steps**:
1. Create `src/screens/MapScreen.tsx`
2. Query all posts where `hasLocation == true`
3. Call `getPostLocations` function to fetch coordinates for all posts
4. Display markers on map at each coordinate
5. Center map on user's current location
6. Update `app/(tabs)/map.tsx` to use this screen

**Test**:
1. Create 5-10 test posts with locations in different areas
2. Open Map tab
3. Verify all posts appear as markers
4. Tap marker → should show callout with post info
5. Verify map centers on your location

**Dependencies**: Task 3.1, Task 1.2 or 1.3 (getPostLocation function)

---

### Task 3.3: Add Marker Tap → ThreadModal
**Goal**: Tapping a marker opens the post's thread

**Steps**:
1. In MapScreen, add `onPress` handler to markers
2. Get postId from tapped marker
3. Open ThreadModal with that postId

**Test**:
1. Open Map tab
2. Tap any marker
3. Verify ThreadModal opens with correct post
4. Verify timeline shows full thread
5. Close modal, verify map is still in same position

**Dependencies**: Task 3.2

---

### Task 3.4: Add Explore/My Catches Toggle
**Goal**: Switch between viewing all posts vs only caught posts

**Steps**:
1. Add toggle/segmented control at top of MapScreen: "Explore" | "My Catches"
2. In "My Catches" mode, filter markers to only show posts where:
   - User is the author, OR
   - User has a catch in the thread (query posts where `rootPostId == postId` and `authorId == currentUser.uid`)
3. Update marker styling to differentiate

**Test**:
1. Create posts and catch some posts from other users
2. Toggle to "My Catches"
3. Verify only your posts and caught posts appear
4. Toggle back to "Explore"
5. Verify all posts reappear

**Dependencies**: Task 3.3

---

### Task 3.5: Implement Marker Clustering
**Goal**: Group nearby markers when zoomed out

**Steps**:
1. Install: `npm install react-native-maps-super-cluster`
2. Wrap markers with clustering logic
3. Configure cluster radius and minimum zoom
4. Style cluster markers to show count

**Test**:
1. Create 20+ posts in similar area
2. Zoom out on map
3. Verify markers cluster together with count badge
4. Zoom in, verify clusters split into individual markers
5. Tap cluster, verify map zooms to show clustered posts

**Dependencies**: Task 3.4

---

### Task 3.6: Add Filters (Popular/Trending/Nearby)
**Goal**: Filter which posts show on map

**Steps**:
1. Add filter buttons below toggle: "All" | "Popular" | "Trending" | "Nearby"
2. Popular: filter to posts with `catchCount >= 5`
3. Trending: filter to posts created in last 7 days
4. Nearby: filter to posts within 10km of user's location (calculate client-side)
5. Update markers when filter changes

**Test**:
1. Create posts with varying catch counts and dates
2. Test each filter
3. Verify correct posts appear for each filter
4. Test "Nearby" by changing device location
5. Combine filters with "My Catches" toggle

**Dependencies**: Task 3.5

---

## PHASE 4: Integration & Polish

### Task 4.1: Add "Get Directions" to ThreadModal
**Goal**: Button that opens Maps app with navigation to post location

**Steps**:
1. Open `src/components/ThreadModal.tsx`
2. Add "Get Directions" button below "Catch This Location"
3. Only show if post has location
4. Call `getPostLocation` function to fetch coordinates
5. Open Maps app with coordinates (see Section 11 for code)
6. Handle iOS/Android/Web differences

**Test**:
1. Open any post with location in ThreadModal
2. Tap "Get Directions"
3. Verify Maps app opens with correct destination
4. Test on iOS (Apple Maps) and Android (Google Maps)
5. Test with post without location (button should not appear)

**Dependencies**: Task 1.2 (getPostLocation function)

---

### Task 4.2: Add Distance Display in ThreadModal
**Goal**: Show "X km away" or "X m away" from user's current location

**Steps**:
1. In ThreadModal, fetch post location via `getPostLocation`
2. Get user's current location via `expo-location`
3. Calculate distance using Haversine formula (can reuse from `validateCatch` logic)
4. Display below post info: "1.2 km away" or "342 m away"
5. Handle loading state and permission denied

**Test**:
1. Open post in ThreadModal
2. Verify distance displays correctly
3. Test with posts at different distances
4. Test when location permission denied (should gracefully hide or show message)
5. Change device location, verify distance updates

**Dependencies**: Task 4.1 (already fetches location)

---

### Task 4.3: Make Location Mandatory in Post Creation
**Goal**: Prevent creating posts without location

**Steps**:
1. Open `src/screens/PostScreen.tsx` or `src/components/UnifiedCameraView.tsx`
2. Block "Post" button if location is null
3. Show error message: "Location required to post"
4. Update UI to clarify location is required (not optional)
5. Handle case where user denies location permission

**Test**:
1. Deny location permission
2. Try to create post
3. Verify error message shows and post is blocked
4. Grant permission, retry
5. Verify post succeeds with location

**Dependencies**: None

---

### Task 4.4: Update Copy Throughout App
**Goal**: Update user-facing text to reflect travel theme

**Steps**:
1. Find all instances of "scavenger hunt" language
2. Update PostScreen: "Share a location" instead of "Create a post"
3. Update any help/info text to emphasize discovery/travel
4. Keep "Catch This Location" button text (already decided)
5. Update placeholder/empty states

**Test**:
1. Read through app as new user
2. Verify all copy feels cohesive with travel theme
3. Check empty states (no posts, no lists, etc.)
4. Verify no outdated "guessing game" language remains

**Dependencies**: None (can be done anytime)

---

### Task 4.5: End-to-End Testing
**Goal**: Test complete user flows

**Test Scenarios**:
1. **New User Journey**:
   - Sign up → Create post with location → See it on map → Create list → Add post to list

2. **Catching Flow**:
   - Browse map → Find post → Get directions → Navigate to location → Catch post → Verify appears in "My Catches"

3. **Lists Flow**:
   - Create list → Browse map → Add multiple posts to list → View list → Share list (if implemented) → Delete list

4. **Social Flow**:
   - Follow user → User posts → Get notification → View their profile → Catch their post → See your catch in thread timeline

5. **Thread Timeline**:
   - View original post → See multiple catches → Swipe through timeline → Delete original (if yours) → Verify oldest catch becomes new root

**Dependencies**: All previous tasks

---

## Task Checklist

Copy this checklist to track your progress:

**Phase 1: Backend**
- [ ] Task 1.1: Add Lists Security Rules
- [ ] Task 1.2: Implement `getPostLocation` Cloud Function
- [ ] Task 1.3: Implement `getPostLocations` Cloud Function (optional)
- [ ] Task 1.4: Update `onPostDeleted` to Clean Up Lists

**Phase 2: Lists**
- [ ] Task 2.1: Add Tab Bar Configuration for Lists
- [ ] Task 2.2: Create List Creation Modal
- [ ] Task 2.3: Create ListsScreen - Your Lists View
- [ ] Task 2.4: Create ListDetailScreen
- [ ] Task 2.5: Add "Add to List" in ThreadModal
- [ ] Task 2.6: Add Community Lists Browse (optional)

**Phase 3: Map**
- [ ] Task 3.1: Install and Configure React Native Maps
- [ ] Task 3.2: Create Basic MapScreen with All Posts
- [ ] Task 3.3: Add Marker Tap → ThreadModal
- [ ] Task 3.4: Add Explore/My Catches Toggle
- [ ] Task 3.5: Implement Marker Clustering
- [ ] Task 3.6: Add Filters (Popular/Trending/Nearby)

**Phase 4: Polish**
- [ ] Task 4.1: Add "Get Directions" to ThreadModal
- [ ] Task 4.2: Add Distance Display in ThreadModal
- [ ] Task 4.3: Make Location Mandatory in Post Creation
- [ ] Task 4.4: Update Copy Throughout App
- [ ] Task 4.5: End-to-End Testing

---

## Estimated Time per Task

- Phase 1 tasks: 30-60 min each
- Phase 2 tasks: 1-2 hours each
- Phase 3 tasks: 1-3 hours each
- Phase 4 tasks: 30 min - 1 hour each
- Task 4.5 (E2E testing): 2-3 hours

**Total estimated time: 25-35 hours**
