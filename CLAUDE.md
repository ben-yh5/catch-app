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

Methods: Google Sign-In (`@react-native-google-signin/google-signin`), Sign in with Apple (iOS, `expo-apple-authentication`), and Email/Password (`/email-auth` screen: sign in, sign up, and password reset via `sendPasswordResetEmail`). All new users — regardless of provider — get their Firestore doc created via `/username-setup` → `setupUsername` Cloud Function.

**Email verification**: password-provider accounts must verify their email (Google/Apple arrive pre-verified). Signup fire-and-forgets `sendEmailVerification`; the root layout routes unverified password users to `/verify-email` (polls `user.reload()`, resend + sign-out escape hatch) *before* username setup. Enforced server-side too: `setupUsername` rejects unverified password tokens (`failed-precondition`) and the posts `create` rule requires `email_verified` when `sign_in_provider == 'password'`. After verification the client force-refreshes the ID token (`getIdToken(true)`) so rules see the claim.

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

### Progression (no point economy)

There is deliberately **no scoring economy** — no points, XP, royalties, or catch multipliers. Progression is passport-style collection and attribution:
- **Pioneer attribution**: An original post >50m from any existing pin gets `isPioneer: true` — permanent "first found here" credit. Classification uses geohash queries on `post_locations` in `onPostCreated` (threshold in `NEARBY_THRESHOLD_METERS`, `functions/src/lib/constants.ts`). Deliberately **thread metadata only** (Sept 2026): being first is circumstance, not an act, and is trivially farmable — no gold stamps, no stat tile, no payoff-screen celebration. Status flows through catches.
- **Counters as stats**: `totalPosts` / `totalCatches` on user docs are plain counts, not currency.
- **Caught notification**: When someone catches your post you get a `caught` notification (in-app + push) — the reward is knowing someone stood where you stood.
- **Lost places (gold pins)**: Posts with 0 catches or no catch in >30 days render gold on the map (`isLostPlace()` in `src/utils/postClassification.ts`), pointing players at spots whose photographic record has a gap.
- **Nudge over penalty**: `NudgeCard` suggests catching an existing nearby thread instead of posting a duplicate — behavior is steered by UX, not point differentials.
- **Catch reveal**: After a successful catch, `CatchRevealModal` shows the then/now pair side by side on a passport-page card with an animated CAUGHT stamp (`PassportStamp`) — this payoff screen is the success feedback (no toast). Wired into both catch paths (`useCatchFlow` → ThreadModal, and PostScreen's nudge path).
- **Post stamp**: After sharing an original, `PostStampModal` shows the photo on a passport-page card with a blue POSTED stamp — replaces the old success toast (no pioneer variant on purpose). Stamp place lines come from a display-only client reverse geocode (`src/utils/reverseGeocode.ts`, OS geocoder — never persisted; omitted when unavailable, no placeholders).
- **Catch permits**: `validateCatch` is a gate, not advice — success issues a 10-minute permit that security rules require for the catch write and `onPostCreated` consumes in its transaction. See `catch_permits` schema entry.
- **Passport**: third profile tab (Posts / Catches / Passport, `PassportView` component) on both own and other profiles shows stat tiles (countries/cities/catches) plus the closed passport **cover** (`PassportCover`, navy + gold embossing). The passport itself (`PassportBooklet`) renders **inline on the tab** (and on the `/passport` deep-link screen) with **true-book geometry** (`passportPageSize`: the open spread fits the window width, so the closed cover is one page face — half a spread). The closed cover sits centered; tapping swings it open around the spine while the booklet slides so the spread centers; a back-turn on the first spread swings it shut. Gesture arbitration with the profile pager is by responder claim: the book's PanResponder claims touches at touch-down, so swipes starting inside the spread turn pages while swipes outside still switch tabs (a tap requires stillness in both axes so vertical scrolls aren't misread as page taps). Book layout: each spread is two page faces meeting at the white center crease, white dotted guide line per face, up to two circular ink stamps per face (2×2 per spread, `StampFace`), one stamp per city from `user_coverage.cities` — never one per post/catch. Stamp jitter is deterministic (seeded from the city key); each face clips its own stamps, so ink never crosses the crease or page edge but may bleed across the dotted line. Page turns are a real **leaf**: a page-width flap pivoting at the crease, front = outgoing page, back = incoming page (pre-mirrored), faces swapping at edge-on; driven by core `PanResponder` (drag-to-turn with commit/cancel snap, or tap a page side). **CRITICAL — two device-verified rules: (1) 3D perspective transforms exist only on the mid-turn leaf and mid-swing cover, never at rest — RN hit-testing is unreliable under perspective transforms (resting identity 3D transforms killed all taps/swipes). (2) No React state change mid-gesture — on the new architecture, re-rendering the responder's subtree kills the active PanResponder (moves stop arriving); both leaves stay pre-mounted and drags write only shared values, with setSpreadIndex deferred to turn completion.** Ink color: pink = has caught there (the prestige ink — catching is the verified act), blue = only posted. Pages are unbounded, no totals, no empty pre-printed slots. Shared data hook: `usePassportData`; `/passport` remains as a deep-link shell that opens the modal (pass `?userId=` for another user's). Own passport reads `user_coverage` directly; other users' go through the `getPassport` callable (cities only — never the geohash cell arrays) which honors the owner's `passportPublic` setting (default public; Settings toggle). Collection and attribution only — no levels or completion rewards. See `PASSPORT_SCREEN.md`.

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

Notification types: `new_post`, `follow`, `caught`.

## Firestore Schema

### users/{userId}
- `username`, `email`, `createdAt`
- `totalPosts`, `totalCatches` (plain counters, not currency)
- `followers`, `following` (arrays of user IDs)
- `blockedUsers` (array of user IDs; server-only writes via `blockUser`/`unblockUser`)
- `pushToken` (FCM/APNs token)
- `passportPublic` (boolean, default public — only explicit `false` hides the passport from other users)

### users/{userId}/notifications/{notifId}
- `type`: `'new_post' | 'follow' | 'caught'`
- `fromUserId`, `postId` (optional)
- `read`: boolean, `createdAt`

### posts/{postId}
- `authorId`, `authorUsername`, `caption`, `createdAt`
- `photoURL`, `thumbnailURL`, `mediumURL`
- `hasLocation`: boolean
- `isOriginal`: boolean, `parentPostId`, `rootPostId`
- `catchCount`: number (meaningful on root posts only), `lastCaughtAt`: timestamp
- `isPioneer`: boolean (attribution: first find at this spot)

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

### catch_permits/{uid}_{rootPostId} (server-only)
- `uid`, `rootPostId`, `expiresAt`, `createdAt`
- Issued by `validateCatch` on success (10 min TTL). Security rules require a live permit to create a catch post; `onPostCreated` consumes it (first catch wins) and rejects+deletes permitless catches (stamped `rejectedNoPermit` so `onPostDeleted` skips counter decrements)

### user_coverage/{userId} (server-only writes, owner-only reads)
- `cells5`, `cells6`: geohash arrays (map coverage overlay)
- `cities`: map keyed `{country}|{city}` → `{ country, city, posted, caught, pioneers, lastActivity }` — passport stamps. Written best-effort by `onPostCreated` (originals stamp their geocoded city; catches inherit the root's `locationMeta`), rebuilt by `backfillCoverage`. Permanent: post deletion does not decrement stamps.

### training_pairs/{pairId} (opt-in ML training data, written by client when `dataContributionEnabled`)
- `pairId`, `userId`, `originalId`, `catchId`, `label` (`POSITIVE` | `HARD_NEGATIVE`)
- `originalStoragePath`, `catchStoragePath` — images live under the `training_data/` Storage prefix
- `originalMeta`, `catchMeta`: `{ latitude, longitude, heading?, pitch?, date }`
- Consumed by the offline training pipeline in the separate `catch-ml-training` repo (not part of this repo) — see `src/services/trainingData.ts` for the upload path

## Cloud Functions (`functions/src/index.ts`)

| Function | Type | Purpose |
|---|---|---|
| `validateCatch` | HTTPS Callable | Validates proximity, prevents self-catch and duplicate catches. On success issues a short-lived catch permit (`catch_permits/{uid}_{rootPostId}`, 10 min TTL) |
| `getPostLocation` | HTTPS Callable | Returns coordinates for a single post |
| `getPostLocations` | HTTPS Callable | Batch coordinates (max 500 posts) |
| `getPostsInArea` | HTTPS Callable | Geospatial query by viewport bounds or radius |
| `setupUsername` | HTTPS Callable | Atomically claims username + creates user doc (prevents TOCTOU race) |
| `followUser` | HTTPS Callable | Atomically updates both users' following/followers arrays in a transaction |
| `unfollowUser` | HTTPS Callable | Atomically removes from both users' following/followers arrays in a transaction |
| `reportUser` / `reportPost` | HTTPS Callable | Content/user reports into `reports` collection; one report per reporter per target |
| `blockUser` / `unblockUser` | HTTPS Callable | Manages caller's `blockedUsers` array; blocking also severs follows both ways. Client filters blocked authors from feeds/map |
| `markAllNotificationsRead` | HTTPS Callable | Bulk-marks all of the caller's notifications as read (batched server-side over the whole subcollection) |
| `reconcileCounters` | HTTPS Callable | Admin-only: recomputes `totalPosts`/`totalCatches` from surviving posts; `dryRun` (default) reports drift without fixing |
| `onPostCreated` | Firestore Trigger | Pioneer attribution, counter/catchCount increments, caught + follower notifications. Idempotent via `context.eventId` dedup |
| `onPostDeleted` | Firestore Trigger | Thread promotion, counter decrements (catchCount), list cleanup. Idempotent via `context.eventId` dedup |
| `onUserFollowed` | Firestore Trigger | Follow notifications (in-app + push) |
| `searchPosts` | HTTPS Callable | Semantic vector search: query expansion → embedding → Firestore `findNearest()` → geo re-ranking |
| `backfillEmbeddings` | HTTPS Callable | Admin-only: retroactively enriches existing posts with geocoding, vision tags, and embeddings |
| `backfillCoverage` | HTTPS Callable | Admin-only: rebuilds `geohash_cells`/`user_coverage` from existing `post_locations` |
| `getPassport` | HTTPS Callable | Returns a user's passport city stamps (cities map only — never `cells5`/`cells6`); respects `passportPublic` |
| `onImageUpload` | Storage Trigger | Auto-generates thumbnail and medium image variants |

## Key Patterns

- **Modal over navigation**: `ThreadModal` component shows post details as a modal to avoid white flash during screen transitions
- **Deduplication**: `ExploreScreen` and `ProfileScreen` filter new posts against existing IDs to prevent duplicate keys
- **Safe area insets**: Modals use `Math.max(insets.top - 30, 10)` for compact layout on notched devices
- **Platform branching**: Camera is native-only (`expo-camera`); use `Alert.alert()` on native, `window.alert()` on web
- **Path alias**: `@/` maps to `src/` (configured in tsconfig)
- **`post_locations` geohash**: Used for spatial queries; new posts must include geohash via `geohashForLocation()` from `geofire-common`
- **Cluster bubbles below pin zoom**: pins only load at zoom ≥ `PIN_MIN_ZOOM` (11 ≈ city view, `src/hooks/useCoverage.ts`). Below that, `useClusterBubbles` renders count bubbles straight from `geohash_cells` (`originalCount` field — originals only, so bubble counts match the pins found after zooming in; `postCount` counts all shots and drives the coverage choropleth). Bubble points are themselves Mapbox-clustered (`clusterProperties` sums `count` into `totalCount`), so nearby cells merge into one bubble as you zoom out. Tapping a merged bubble zooms to its expansion level; tapping a single-cell bubble fits the camera to the cell's extent (one tap → pins separate, AllTrails-style); further splitting is Mapbox's native pin clustering. Camera events use debounced `onCameraChanged` — `onMapIdle` never fires in rnmapbox 10.2.x on this setup (verified in production logs; do not switch back). No `getPostsInArea` call runs at bubble zooms, so the 100km radius cap can't produce false "no shots" at low zoom.
- **Server-only counters**: `catchCount`, `totalPosts`, `totalCatches` are only writable by Cloud Functions (admin SDK). Client-side Firestore rules block direct updates to these fields.
- **Trigger idempotency + atomic counters**: `onPostCreated` and `onPostDeleted` run all counter writes in a single transaction that also owns the `processed_events/{eventId}` dedup marker — all-or-nothing and exactly-once. Best-effort work (notifications, enrichment, coverage, list/location cleanup) runs after the transaction, each step in its own try/catch.
- **Fail fast, not fail soft**: data-critical failures must propagate, never be logged-and-swallowed. Both post triggers set `failurePolicy: true` and rethrow on counter-transaction failure so the platform retries (the dedup marker makes retries safe). `deleteAccount` aborts before the irreversible user-doc/Auth deletions if any data-cleanup step failed. Client code never persists placeholder values (no `'Anonymous'` authors, no 0,0 coordinates) — it aborts with a toast instead. Env config (`firebase.js`, Mapbox token, Google client ID) is asserted at startup rather than failing cryptically at first use. Defaults are acceptable only for display-layer values.
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
- **Users**: Reads require authentication (`allow read: if request.auth != null`). Self-update restricted to allowlisted fields (`username`, `pushToken`, `notificationSettings`, `dataContributionEnabled`, `passportPublic`, `bio`). Server-computed fields (`contribution`, `totalPosts`, `totalCatches`, `followers`, `following`) only writable by Cloud Functions (admin SDK).
- **Followers/Following**: Managed exclusively by `followUser`/`unfollowUser` Cloud Functions. No client-side writes.
- **Posts**: `create` requires `authorId == auth.uid`. Originals must have null `parentPostId`/`rootPostId` (no thread pollution); catches require a live `catch_permits/{uid}_{rootPostId}` doc (issued by `validateCatch`), so forged catches are blocked at the rules layer. No client-side updates allowed (`catchCount` managed by Cloud Functions). Only author can delete.
- **Notifications**: Proper subcollection rules under `match /notifications/{notifId}` with owner-only access. Updates restricted to `read` field only.
- **Post locations**: `create` validates required fields (`postId`, `latitude`, `longitude`, `geohash`) and coordinate ranges. No client reads.

## Storage Security Rules

- **Content validation**: All upload paths enforce `isValidImage()` — content type must be `image/(jpeg|png|webp)` and size ≤ 10MB.
- **Posts**: Owner-only writes to `/posts/{userId}/`, public reads.
- **Training data**: Any authenticated user can write (client-side opt-in check), authenticated reads.
- **User profiles**: Owner-only writes to `/users/{userId}/`, public reads.

## TODOs

See `TODO.md` for the prioritized work list.
