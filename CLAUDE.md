# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Catch** is a travel passport mobile app built with React Native and Expo where users discover and visit photo-worthy locations around the world. Users share locations on a global map and others can "catch" them by visiting and taking photos at the same places.

## Tech Stack

- **Framework**: React Native 0.81 with Expo SDK 54
- **Language**: TypeScript 5.9
- **Routing**: Expo Router 6 (file-based routing)
- **Backend**: Firebase 12 (Authentication, Firestore, Storage, Cloud Functions)
- **State Management**: React Context (AuthContext, PostContext)

### Client Stack

| Layer | Libraries |
|---|---|
| **UI & Layout** | `react-native-safe-area-context`, `expo-blur`, `expo-splash-screen`, `expo-status-bar`, `@expo/vector-icons`, `expo-symbols` |
| **Navigation** | `expo-router`, `@react-navigation/native`, `@react-navigation/bottom-tabs`, `react-native-screens`, `react-native-pager-view`, `react-native-tab-view` |
| **Animations & Gestures** | `react-native-reanimated`, `react-native-gesture-handler`, `@gorhom/bottom-sheet` |
| **Maps & Location** | `react-native-maps`, `@rnmapbox/maps`, `expo-location`, `geofire-common` |
| **Camera & Media** | `expo-camera`, `expo-image`, `expo-image-picker`, `expo-image-manipulator` |
| **Firebase** | `firebase` (JS SDK), `@react-native-firebase/app`, `@react-native-firebase/app-check` |
| **Auth** | `@react-native-google-signin/google-signin` (native Google Sign-In) |
| **Notifications** | `expo-notifications` (FCM/APNs, not Expo push) |
| **Device APIs** | `expo-sensors`, `expo-haptics`, `expo-device`, `expo-file-system`, `expo-linking`, `expo-web-browser` |
| **ML** | `react-native-fast-tflite`, `react-native-worklets` |
| **Storage** | `@react-native-async-storage/async-storage` |

### Server Stack (Cloud Functions)

| Layer | Libraries |
|---|---|
| **Runtime** | Node 20, `firebase-functions` 3.x |
| **Admin SDK** | `firebase-admin` 11.x |
| **Image Processing** | `sharp` (thumbnail/medium generation) |
| **Geospatial** | `geofire-common` (geohash queries) |
| **AI / Embeddings** | `@google/generative-ai` (Gemini 2.0 Flash for vision/query expansion, `gemini-embedding-001` for 768-dim vectors) |
| **File System** | `fs-extra` |

### Dev & Testing

| Tool | Libraries |
|---|---|
| **Testing** | `jest`, `jest-expo`, `@testing-library/react-native`, `@firebase/rules-unit-testing` |
| **Linting** | `eslint`, `eslint-config-expo`, `@typescript-eslint/parser` |
| **Build** | `expo-dev-client`, EAS Build |

## Git Usage Rules

- Git may only be used to **view** history (e.g. `git log`, `git show`, `git diff`, `git status`). 
- **Never** run `git revert` (or otherwise rewrite/undo history).
- **Never** push to or pull from GitHub (no `git push`, `git pull`, `git fetch`, or `gh` operations that modify the remote).

## Development Commands

```bash
# Start development server
npm start

# Run on specific platform (required for native modules like Google Sign-In)
npx expo run:ios
npx expo run:android

# Rebuild native folders after config changes
npx expo prebuild --clean

# Linting
npm run lint

# Tests
npm test                # Run all tests (jest)
npm run test:watch      # Watch mode

# Firebase Functions (from functions/ directory)
cd functions
npm run build           # Compile TypeScript
npm run deploy          # Deploy to Firebase
npm run serve           # Build + run emulators locally
npm run logs            # View function logs
```

## Architecture

### Routing (Expo Router)

Routes are defined by file structure in `app/`. Screen logic lives in `src/screens/`, imported by thin route files.

**When adding new routes**, update `app/_layout.tsx`:
1. Add route name to the protected routes check in auth redirect logic
2. Add `<Stack.Screen name="route-name" options={{ headerShown: false }} />` to the Stack navigator

The `unstable_settings.initialRouteName` ensures authenticated users land on tabs.

### Authentication Flow

`AuthProvider` in `src/context/AuthContext.tsx` wraps the app and listens to Firebase auth state. Root layout redirects based on state:
- No user → `/login`
- User but no Firestore doc → `/username-setup` (Google Sign-In new users)
- Authenticated with doc → `/(tabs)`

Methods: Email/Password and Google Sign-In (`@react-native-google-signin/google-signin`).

### Post Event System

`PostContext` (`src/context/PostContext.tsx`) uses ref-based event listeners to coordinate state across screens without causing re-renders:
- `notifyPostEvent(action, postId?, userId?)` — emit events (`create`, `delete`, `catch`, `update`)
- `usePostEvents(callback, deps)` — subscribe in components
- Allows granular local state updates (e.g., remove deleted post) instead of full re-fetches

### Thread System

Posts form threads. Original posts have `isOriginal: true`. Catches reference the root via `rootPostId`.

**Querying**: Explore feed filters `where('isOriginal', '==', true)`. Thread contents: query `where('rootPostId', '==', postId)` plus the root itself.

**Deletion edge cases** (handled by `onPostDeleted` Cloud Function):
- Catch deleted → decrement root's `catchCount`, clean up location
- Root with catches deleted → promote oldest catch to new root, repoint all catches
- Root without catches → delete location data

### Contribution System

Users earn contribution points. Defined in `src/utils/contributionConfig.ts` and mirrored in `functions/src/index.ts`:
- **Pioneer Post** (10 pts): Original post >50m from any existing pin
- **Nearby Post** (2 pts): Original post within 50m of existing pins
- **Catch** (14 pts): Catching any post
- **Royalties**: Original poster earns 7 pts (Pioneer) or 2 pts (Nearby) when their post is caught

Pioneer/Nearby classification uses geohash queries on `post_locations` in `onPostCreated`.

### Location Security

Post coordinates are **never** sent to clients. The `posts` collection only has a `hasLocation` boolean. Actual coordinates live in `post_locations` (client read access blocked by security rules). All coordinate access goes through Cloud Functions: `validateCatch`, `getPostLocation`, `getPostLocations`, `getPostsInArea`.

### Image Pipeline

- Images cropped to 1080x1080px squares client-side (`expo-image-manipulator`)
- Uploaded to Storage at `/posts/{userId}/{timestamp}.jpg`
- `onImageUpload` Cloud Function (Storage trigger) auto-generates `_thumb` (200x200) and `_medium` (600x600) variants
- Posts store `photoURL`, `thumbnailURL`, `mediumURL`

### Semantic Search (Vector Search)

Natural language search powered by Gemini and Firestore vector search. Users search for locations like "sunset viewpoints" or "colorful street art".

**Post enrichment pipeline** (`onPostCreated` trigger, async — failures don't block post creation):
1. **Reverse geocoding**: Nominatim API → `locationMeta` (country, city, neighborhood, street, formattedAddress)
2. **Vision auto-tagging**: Gemini 2.0 Flash analyzes the post image → `visualMeta` (tags, scene, landmark, mood)
3. **Embedding generation**: Combines caption + address + city + scene + tags + mood + landmark → `gemini-embedding-001` (768-dim, `RETRIEVAL_DOCUMENT`) → stored as Firestore Vector on `post_locations`

**Search flow** (`searchPosts` callable):
1. Short queries (≤4 words) expanded via Gemini 2.0 Flash (synonyms/related phrases)
2. Query embedded with `gemini-embedding-001` (768-dim, `RETRIEVAL_QUERY`)
3. `post_locations.findNearest()` — top 50 by cosine distance
4. Geo re-ranking if user location provided: `vectorDistance × (1 + log10(1 + distanceKm) × 0.3)`
5. Relevance filter: discard results with `vectorDistance > 0.50`
6. Batch fetch full post docs, merge location/visual metadata, return `SearchPost[]`

**Client integration**: `ExploreSearchBar` component → MapScreen calls `searchPosts` → displays results as map pins with bottom sheet.

**Backfill**: `backfillEmbeddings` (admin-only, enforced via `requireAdmin()`) retroactively enriches existing posts. Supports `force` and `embeddingsOnly` flags.

### Notifications

In-app notifications stored in `users/{userId}/notifications/` subcollection. Push notifications via FCM/APNs using native device tokens (not Expo push service).

Notification types: `new_post`, `follow`, `royalty`.

## Firestore Schema

### users/{userId}
- `username`, `email`, `createdAt`
- `totalPosts`, `totalCatches`, `contribution` (number)
- `followers`, `following` (arrays of user IDs)
- `blockedUsers` (array of user IDs; server-only writes via `blockUser`/`unblockUser`)
- `pushToken` (FCM/APNs token)

### users/{userId}/notifications/{notifId}
- `type`: `'new_post' | 'follow' | 'royalty'`
- `fromUserId`, `postId` (optional), `amount` (for royalty)
- `read`: boolean, `createdAt`

### posts/{postId}
- `authorId`, `authorUsername`, `caption`, `createdAt`
- `photoURL`, `thumbnailURL`, `mediumURL`
- `hasLocation`: boolean
- `isOriginal`: boolean, `parentPostId`, `rootPostId`
- `catchCount`: number (meaningful on root posts only)
- `isPioneer`: boolean, `contributionEarned`: number

### post_locations/{locationId} (server-only, client reads blocked)
- `postId`, `latitude`, `longitude`, `geohash`
- `heading`, `pitch` (optional)
- `locationMeta`: `{ country, city, neighborhood, street, formattedAddress }` (from Nominatim)
- `visualMeta`: `{ tags: string[], scene, landmark, mood }` (from Gemini vision)
- `embedding`: 768-dim Firestore Vector (from Gemini embedding-001)
- `metadataVersion`: number

### lists/{listId}
- `name`, `userId`, `postIds` (array), `isPublic`

### usernames/{lowercaseUsername} (uniqueness index, server-only writes)
- `uid`: user ID that owns this username

### processed_events/{eventId} (trigger deduplication, server-only)
- `processedAt`: timestamp

### training_pairs/{pairId} (opt-in ML training data, written by client when `dataContributionEnabled`)
- `pairId`, `userId`, `originalId`, `catchId`, `label` (`POSITIVE` | `HARD_NEGATIVE`)
- `originalStoragePath`, `catchStoragePath` — images live under the `training_data/` Storage prefix
- `originalMeta`, `catchMeta`: `{ latitude, longitude, heading?, pitch?, date }`
- Consumed by the offline training pipeline in the separate `catch-ml-training` repo (not part of this repo) — see `src/services/trainingData.ts` for the upload path

## Cloud Functions (`functions/src/index.ts`)

| Function | Type | Purpose |
|---|---|---|
| `validateCatch` | HTTPS Callable | Validates proximity, prevents self-catch and duplicate catches |
| `getPostLocation` | HTTPS Callable | Returns coordinates for a single post |
| `getPostLocations` | HTTPS Callable | Batch coordinates (max 500 posts) |
| `getPostsInArea` | HTTPS Callable | Geospatial query by viewport bounds or radius |
| `setupUsername` | HTTPS Callable | Atomically claims username + creates user doc (prevents TOCTOU race) |
| `followUser` | HTTPS Callable | Atomically updates both users' following/followers arrays in a transaction |
| `unfollowUser` | HTTPS Callable | Atomically removes from both users' following/followers arrays in a transaction |
| `reportUser` / `reportPost` | HTTPS Callable | Content/user reports into `reports` collection; one report per reporter per target |
| `blockUser` / `unblockUser` | HTTPS Callable | Manages caller's `blockedUsers` array; blocking also severs follows both ways. Client filters blocked authors from feeds/map |
| `reconcileContributions` | HTTPS Callable | Admin-only: recomputes `contribution`/`totalPosts`/`totalCatches` from surviving posts' `contributionEarned`; `dryRun` (default) reports drift without fixing |
| `onPostCreated` | Firestore Trigger | Contribution points, Pioneer/Nearby check, catchCount increment, notifications. Idempotent via `context.eventId` dedup |
| `onPostDeleted` | Firestore Trigger | Thread promotion, counter decrements (catchCount), list cleanup. Idempotent via `context.eventId` dedup |
| `onUserFollowed` | Firestore Trigger | Follow notifications (in-app + push) |
| `searchPosts` | HTTPS Callable | Semantic vector search: query expansion → embedding → Firestore `findNearest()` → geo re-ranking |
| `backfillEmbeddings` | HTTPS Callable | Admin-only: retroactively enriches existing posts with geocoding, vision tags, and embeddings |
| `backfillCoverage` | HTTPS Callable | Admin-only: rebuilds `geohash_cells`/`user_coverage` from existing `post_locations` |
| `onImageUpload` | Storage Trigger | Auto-generates thumbnail and medium image variants |

## Key Patterns

- **Modal over navigation**: `ThreadModal` component shows post details as a modal to avoid white flash during screen transitions
- **Deduplication**: `ExploreScreen` and `ProfileScreen` filter new posts against existing IDs to prevent duplicate keys
- **Safe area insets**: Modals use `Math.max(insets.top - 30, 10)` for compact layout on notched devices
- **Platform branching**: Camera is native-only (`expo-camera`); use `Alert.alert()` on native, `window.alert()` on web
- **Path alias**: `@/` maps to `src/` (configured in tsconfig)
- **`post_locations` geohash**: Used for spatial queries; new posts must include geohash via `geohashForLocation()` from `geofire-common`
- **Server-only counters**: `catchCount`, `contribution`, `totalPosts`, `totalCatches` are only writable by Cloud Functions (admin SDK). Client-side Firestore rules block direct updates to these fields.
- **Trigger idempotency + atomic balances**: `onPostCreated` and `onPostDeleted` run all balance-critical writes (contribution, counters, royalties, `contributionEarned`) in a single transaction that also owns the `processed_events/{eventId}` dedup marker — all-or-nothing and exactly-once. Best-effort work (notifications, enrichment, coverage, list/location cleanup) runs after the transaction, each step in its own try/catch.
- **Royalty clawback tracking**: catches store `royaltyRecipientId`, `royaltyAmount`, and `royaltyRootPostId` at creation. Deletion claws back the royalty only if the paying root still exists and the catch was never re-pointed by thread promotion (`royaltyRootPostId === rootPostId`); otherwise the royalty was already settled when the old root was deleted.
- **Username uniqueness**: `setupUsername` Cloud Function uses a `usernames/{lowercase}` collection as an atomic uniqueness index via Firestore transaction.
- **Atomic follow/unfollow**: `followUser`/`unfollowUser` Cloud Functions update both users' arrays in a single transaction. No client-side writes to `followers` or `following`.
- **Geospatial query limits**: `getPostsInArea` caps results at 200 per geohash sub-query and 500 total. Validates `radiusInMeters > 0`, coordinate ranges, and viewport bounds.
- **Async post enrichment**: `onPostCreated` runs geocoding, vision tagging, and embedding generation in try/catch blocks — failures are logged but don't block post creation or other trigger logic.
- **Vector index**: `post_locations` requires a Firestore vector index on the `embedding` field (768-dim, flat, cosine). Created via `gcloud firestore indexes composite create`.
- **Gemini lazy init**: `getGenAI()` initializes the Gemini client on first use to avoid cold start overhead when the function isn't needed.
- **Admin-only functions**: `backfillEmbeddings` and `backfillCoverage` call `requireAdmin()` (`functions/src/lib/adminAuth.ts`), which checks the caller's UID against the comma-separated `ADMIN_UIDS` env var. Fails closed — if unset, nobody passes.
- **Cost-control backstop**: every callable and trigger sets `runWith({ maxInstances })` (`MAX_INSTANCES` in `functions/src/lib/constants.ts`) — a hard cap on concurrent instances independent of any app-level rate limiting, so a traffic spike or abuse can't scale a single function unboundedly.
- **Visual match verification ("the Judge")**: `src/utils/visualMatcher.ts` runs a TFLite Siamese-style similarity check (`assets/models/view_encoder.tflite`) between the original post photo and a catch attempt. Fails open — if the model errors, `useCatchFlow.ts` logs a warning, shows an "Visual Match Unavailable" toast, and lets the catch proceed on location/angle checks alone rather than silently skipping.
- **ML training pipeline lives outside this repo**: the model above is trained in a separate `catch-ml-training` repo (GLDv2 base training + fine-tuning on opt-in app data). This repo only ships the exported `.tflite` file and the opt-in collection flow (`dataContributionEnabled`, `src/services/trainingData.ts`) that feeds it.

## Firestore Security Rules

Rules enforce authorization, not just authentication:
- **Users**: Reads require authentication (`allow read: if request.auth != null`). Self-update restricted to allowlisted fields (`username`, `pushToken`, `notificationSettings`, `dataContributionEnabled`, `bio`). Server-computed fields (`contribution`, `totalPosts`, `totalCatches`, `followers`, `following`) only writable by Cloud Functions (admin SDK).
- **Followers/Following**: Managed exclusively by `followUser`/`unfollowUser` Cloud Functions. No client-side writes.
- **Posts**: `create` requires `authorId == auth.uid`. No client-side updates allowed (`catchCount` managed by Cloud Functions). Only author can delete.
- **Notifications**: Proper subcollection rules under `match /notifications/{notifId}` with owner-only access. Updates restricted to `read` field only.
- **Post locations**: `create` validates required fields (`postId`, `latitude`, `longitude`, `geohash`) and coordinate ranges. No client reads.

## Storage Security Rules

- **Content validation**: All upload paths enforce `isValidImage()` — content type must be `image/(jpeg|png|webp)` and size ≤ 10MB.
- **Posts**: Owner-only writes to `/posts/{userId}/`, public reads.
- **Training data**: Any authenticated user can write (client-side opt-in check), authenticated reads.
- **User profiles**: Owner-only writes to `/users/{userId}/`, public reads.

## TODOs

- **Notification performance**: `markAllNotificationsAsRead()` in `AuthContext.tsx` currently uses a client-side batch update. For better efficiency, implement a Cloud Function that does a bulk update: `UPDATE notifications SET read=true WHERE userId=X AND read=false`.
