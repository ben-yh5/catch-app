# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Catch** is a travel passport mobile app built with React Native and Expo where users discover and visit photo-worthy locations around the world. Users share locations on a global map and others can "catch" them by visiting and taking photos at the same places.

## Tech Stack

- **Framework**: React Native with Expo SDK 54
- **Routing**: Expo Router (file-based routing)
- **Backend**: Firebase (Authentication, Firestore, Storage, Cloud Functions)
- **Language**: TypeScript
- **State Management**: React Context (AuthContext, PostContext)

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

## Cloud Functions (`functions/src/index.ts`)

| Function | Type | Purpose |
|---|---|---|
| `validateCatch` | HTTPS Callable | Validates proximity, prevents self-catch and duplicate catches |
| `getPostLocation` | HTTPS Callable | Returns coordinates for a single post |
| `getPostLocations` | HTTPS Callable | Batch coordinates (max 500 posts) |
| `getPostsInArea` | HTTPS Callable | Geospatial query by viewport bounds or radius |
| `recountUserData` | HTTPS Callable | Recalculates authenticated user's own stats only |
| `onPostCreated` | Firestore Trigger | Contribution points, Pioneer/Nearby check, catchCount increment, notifications |
| `onPostDeleted` | Firestore Trigger | Thread promotion, counter decrements (catchCount), list cleanup |
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

## Firestore Security Rules

Rules enforce authorization, not just authentication:
- **Users**: Self-update restricted to allowlisted fields (`username`, `pushToken`, `notificationSettings`, `dataContributionEnabled`, `following`, `bio`). Server-computed fields (`contribution`, `totalPosts`, `totalCatches`) only writable by admin SDK.
- **Followers**: Other users can modify only the `followers` array, restricted to single-element changes (prevents mass injection).
- **Posts**: `create` requires `authorId == auth.uid`. No client-side updates allowed (`catchCount` managed by Cloud Functions). Only author can delete.
- **Notifications**: Proper subcollection rules under `match /notifications/{notifId}` with owner-only access. Updates restricted to `read` field only.
- **Post locations**: `create` validates required fields (`postId`, `latitude`, `longitude`, `geohash`) and coordinate ranges. No client reads.
