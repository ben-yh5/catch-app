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
| **File System** | `fs-extra` |

### Dev & Testing

| Tool | Libraries |
|---|---|
| **Testing** | `jest`, `jest-expo`, `@testing-library/react-native`, `@firebase/rules-unit-testing` |
| **Linting** | `eslint`, `eslint-config-expo`, `@typescript-eslint/parser` |
| **Build** | `expo-dev-client`, EAS Build |

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

### Notifications

In-app notifications stored in `users/{userId}/notifications/` subcollection. Push notifications via FCM/APNs using native device tokens (not Expo push service).

Notification types: `new_post`, `follow`, `royalty`.

## Firestore Schema

### users/{userId}
- `username`, `email`, `createdAt`
- `totalPosts`, `totalCatches`, `contribution` (number)
- `followers`, `following` (arrays of user IDs)
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

### lists/{listId}
- `name`, `userId`, `postIds` (array), `isPublic`

### usernames/{lowercaseUsername} (uniqueness index, server-only writes)
- `uid`: user ID that owns this username

### processed_events/{eventId} (trigger deduplication, server-only)
- `processedAt`: timestamp

### rate_limits/{userId} (per-user rate limiting, server-only)
- `{functionName}_ts`: array of timestamps (sliding window)

## Cloud Functions (`functions/src/index.ts`)

| Function | Type | Purpose |
|---|---|---|
| `validateCatch` | HTTPS Callable | Validates proximity, prevents self-catch and duplicate catches |
| `getPostLocation` | HTTPS Callable | Returns coordinates for a single post |
| `getPostLocations` | HTTPS Callable | Batch coordinates (max 500 posts) |
| `getPostsInArea` | HTTPS Callable | Geospatial query by viewport bounds or radius |
| `recountUserData` | HTTPS Callable | Recalculates authenticated user's own stats only |
| `setupUsername` | HTTPS Callable | Atomically claims username + creates user doc (prevents TOCTOU race) |
| `followUser` | HTTPS Callable | Atomically updates both users' following/followers arrays in a transaction |
| `unfollowUser` | HTTPS Callable | Atomically removes from both users' following/followers arrays in a transaction |
| `onPostCreated` | Firestore Trigger | Contribution points, Pioneer/Nearby check, catchCount increment, notifications. Idempotent via `context.eventId` dedup |
| `onPostDeleted` | Firestore Trigger | Thread promotion, counter decrements (catchCount), list cleanup. Idempotent via `context.eventId` dedup |
| `onUserFollowed` | Firestore Trigger | Follow notifications (in-app + push) |
| `onImageUpload` | Storage Trigger | Auto-generates thumbnail and medium image variants |

## Key Patterns

- **Modal over navigation**: `ThreadModal` component shows post details as a modal to avoid white flash during screen transitions
- **Deduplication**: `ExploreScreen` and `ProfileScreen` filter new posts against existing IDs to prevent duplicate keys
- **Safe area insets**: Modals use `Math.max(insets.top - 30, 10)` for compact layout on notched devices
- **Platform branching**: Camera is native-only (`expo-camera`); use `Alert.alert()` on native, `window.alert()` on web
- **Path alias**: `@/` maps to `src/` (configured in tsconfig)
- **`post_locations` geohash**: Used for spatial queries; new posts must include geohash via `geohashForLocation()` from `geofire-common`
- **Server-only counters**: `catchCount`, `contribution`, `totalPosts`, `totalCatches` are only writable by Cloud Functions (admin SDK). Client-side Firestore rules block direct updates to these fields.
- **Trigger idempotency**: `onPostCreated` and `onPostDeleted` deduplicate via `context.eventId` using a `processed_events` collection to handle Firestore's at-least-once delivery.
- **Username uniqueness**: `setupUsername` Cloud Function uses a `usernames/{lowercase}` collection as an atomic uniqueness index via Firestore transaction.
- **Atomic follow/unfollow**: `followUser`/`unfollowUser` Cloud Functions update both users' arrays in a single transaction. No client-side writes to `followers` or `following`.
- **Rate limiting**: All callable Cloud Functions enforce per-user rate limits via `checkRateLimit()` helper using `rate_limits/{userId}` Firestore docs. Three tiers: GENERAL (30/min), EXPENSIVE (10/min), SETUP (5/min). Fail-open design.
- **App Check**: Native attestation (App Attest for iOS, Play Integrity for Android) bridged to JS SDK via `CustomProvider` in `src/services/firebase.js`. Server-side `verifyAppCheck()` helper in Cloud Functions with configurable `warn`/`enforce` mode. Currently in `warn` mode.
- **Geospatial query limits**: `getPostsInArea` caps results at 200 per geohash sub-query and 500 total. Validates `radiusInMeters > 0`, coordinate ranges, and viewport bounds.

## Firestore Security Rules

Rules enforce authorization, not just authentication:
- **Users**: Reads require authentication (`allow read: if request.auth != null`). Self-update restricted to allowlisted fields (`username`, `pushToken`, `notificationSettings`, `dataContributionEnabled`, `bio`). Server-computed fields (`contribution`, `totalPosts`, `totalCatches`, `followers`, `following`) only writable by Cloud Functions (admin SDK).
- **Followers/Following**: Managed exclusively by `followUser`/`unfollowUser` Cloud Functions. No client-side writes.
- **Posts**: `create` requires `authorId == auth.uid`. No client-side updates allowed (`catchCount` managed by Cloud Functions). Only author can delete.
- **Notifications**: Proper subcollection rules under `match /notifications/{notifId}` with owner-only access. Updates restricted to `read` field only.
- **Post locations**: `create` validates required fields (`postId`, `latitude`, `longitude`, `geohash`) and coordinate ranges. No client reads.
- **Rate limits**: `rate_limits/{userId}` collection — admin SDK only (`allow read, write: if false`).

## Storage Security Rules

- **Content validation**: All upload paths enforce `isValidImage()` — content type must be `image/(jpeg|png|webp)` and size ≤ 10MB.
- **Posts**: Owner-only writes to `/posts/{userId}/`, public reads.
- **Training data**: Any authenticated user can write (client-side opt-in check), authenticated reads.
- **User profiles**: Owner-only writes to `/users/{userId}/`, public reads.

## TODOs

- **Notification performance**: `markAllNotificationsAsRead()` in `AuthContext.tsx` currently uses a client-side batch update. For better efficiency, implement a Cloud Function that does a bulk update: `UPDATE notifications SET read=true WHERE userId=X AND read=false`.
