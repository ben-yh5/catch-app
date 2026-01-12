# Geohash Implementation Guide

## Overview

This document provides a complete implementation plan for adding geohash-based geospatial queries to the Catch app. Geohashes enable efficient querying of posts within a map viewport, which is essential for the new map-centric discovery feature.

## What is Geohash?

A geohash encodes latitude/longitude coordinates into a short string where **nearby locations share common prefixes**. This allows efficient range queries in Firestore.

**Example:**
- San Francisco: `37.7749, -122.4194` → `"9q8yy9mf"`
- Nearby location: `37.7750, -122.4195` → `"9q8yy9mg"` (shares prefix `"9q8yy9m"`)
- New York: `40.7128, -74.0060` → `"dr5regw"` (completely different)

**Precision levels:**
- 5 characters ≈ 2.4 km (recommended for city-level discovery)
- 6 characters ≈ 610 m (recommended for neighborhood-level)
- 7 characters ≈ 76 m (very precise)

## Architecture Changes

### Current System:
```
posts/{postId}
  ├─ hasLocation: boolean (public)
  └─ (coordinates stored separately)

post_locations/{locationId}  [SERVER-ONLY ACCESS]
  ├─ postId: string
  ├─ latitude: number
  └─ longitude: number
```

### New System:
```
posts/{postId}
  ├─ hasLocation: boolean (public)
  └─ (unchanged)

post_locations/{locationId}  [SERVER-ONLY ACCESS]
  ├─ postId: string
  ├─ latitude: number
  ├─ longitude: number
  └─ geohash: string  ← NEW FIELD
```

**Key insight:** Geohash is stored in the **secure** `post_locations` collection (not exposed to client), maintaining security while enabling efficient queries.

## Dependencies

### NPM Package to Install:
```bash
npm install geofire-common
```

**What is `geofire-common`?**
- Official Firebase library for geospatial queries
- Maintained by the Firebase team
- Handles edge cases (borders, date line, etc.)
- Provides helper functions for geohash generation and querying

**Key functions:**
- `geohashForLocation([lat, lng])` - Generate geohash from coordinates
- `geohashQueryBounds(center, radiusInM)` - Get query ranges for a circular area
- `distanceBetween([lat1, lng1], [lat2, lng2])` - Calculate distance in meters

## Implementation Steps

### Step 1: Add Geohash to New Posts

**File:** `functions/src/index.ts`

**Modify the Cloud Function that creates post locations.** Look for where `post_locations` documents are created (likely in a function triggered when posts are created or when catches are validated).

**Add this import:**
```typescript
import { geohashForLocation } from 'geofire-common';
```

**Update the post location creation:**
```typescript
// OLD:
await admin.firestore().collection('post_locations').doc(locationId).set({
  postId: postId,
  latitude: latitude,
  longitude: longitude,
  createdAt: admin.firestore.FieldValue.serverTimestamp()
});

// NEW:
const geohash = geohashForLocation([latitude, longitude]);

await admin.firestore().collection('post_locations').doc(locationId).set({
  postId: postId,
  latitude: latitude,
  longitude: longitude,
  geohash: geohash,  // Add this line
  createdAt: admin.firestore.FieldValue.serverTimestamp()
});
```

**Locations to update:**
1. When original posts are created (PostScreen upload)
2. When catches are created (ThreadModal catch flow)
3. Any other location where `post_locations` documents are written

### Step 2: Backfill Existing Posts

**Create a new Cloud Function to add geohash to existing posts.**

**File:** `functions/src/index.ts`

Add this function:
```typescript
import { geohashForLocation } from 'geofire-common';

/**
 * Backfill geohash for existing post_locations
 * This is a one-time migration function
 * Call it via: firebase functions:shell
 * Then: backfillGeohashes()
 */
export const backfillGeohashes = functions.https.onRequest(async (req, res) => {
  try {
    const db = admin.firestore();
    const batch = db.batch();
    let updateCount = 0;

    // Get all post_locations without geohash
    const locationsSnapshot = await db.collection('post_locations').get();

    console.log(`Found ${locationsSnapshot.size} post_locations to check`);

    for (const doc of locationsSnapshot.docs) {
      const data = doc.data();

      // Skip if already has geohash
      if (data.geohash) {
        continue;
      }

      // Generate geohash from existing coordinates
      if (data.latitude && data.longitude) {
        const geohash = geohashForLocation([data.latitude, data.longitude]);
        batch.update(doc.ref, { geohash });
        updateCount++;

        console.log(`Adding geohash to ${doc.id}: ${geohash}`);
      } else {
        console.warn(`Missing coordinates for ${doc.id}`);
      }

      // Firestore batch limit is 500 operations
      if (updateCount >= 500) {
        await batch.commit();
        console.log(`Committed batch of ${updateCount} updates`);
        updateCount = 0;
      }
    }

    // Commit any remaining updates
    if (updateCount > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${updateCount} updates`);
    }

    res.status(200).send({
      success: true,
      message: `Backfilled ${updateCount} post_locations with geohash`
    });
  } catch (error) {
    console.error('Error backfilling geohashes:', error);
    res.status(500).send({ success: false, error: error.message });
  }
});
```

**How to run the backfill:**

```bash
# Deploy the function
cd functions
npm run build
npm run deploy

# Option A: Call via HTTP (if you make it publicly accessible temporarily)
# Add ?secret=your-secret-key for basic security
curl https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/backfillGeohashes

# Option B: Use Firebase Console
# Go to Functions > backfillGeohashes > Testing tab > Test function

# Option C: Use Firebase Shell (local testing)
firebase functions:shell
> backfillGeohashes()
```

**IMPORTANT:** After successful backfill, you can delete this function or add authentication to prevent unauthorized access.

### Step 3: Create Geospatial Query Cloud Function

**File:** `functions/src/index.ts`

Add a new Cloud Function to query posts by map bounds:

```typescript
import { geohashQueryBounds, distanceBetween } from 'geofire-common';

/**
 * Get posts within a map viewport or circular radius
 *
 * @param {object} bounds - Map bounds or center point
 * @param {number} bounds.north - Northern latitude (if using bounds)
 * @param {number} bounds.south - Southern latitude (if using bounds)
 * @param {number} bounds.east - Eastern longitude (if using bounds)
 * @param {number} bounds.west - Western longitude (if using bounds)
 * @param {number} bounds.centerLat - Center latitude (if using radius)
 * @param {number} bounds.centerLng - Center longitude (if using radius)
 * @param {number} bounds.radiusInMeters - Radius in meters (if using radius)
 *
 * @returns {Array} Array of { postId, latitude, longitude, geohash }
 */
export const getPostsInArea = functions.https.onCall(async (data, context) => {
  // Authentication check
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated to fetch post locations'
    );
  }

  const db = admin.firestore();

  try {
    let postLocations: any[] = [];

    // OPTION A: Query by radius (circular area)
    if (data.centerLat && data.centerLng && data.radiusInMeters) {
      const center = [data.centerLat, data.centerLng];
      const radiusInM = data.radiusInMeters;

      // Get geohash ranges that cover this circular area
      const bounds = geohashQueryBounds(center, radiusInM);

      console.log(`Querying ${bounds.length} geohash ranges for radius ${radiusInM}m`);

      // Execute queries in parallel
      const promises = bounds.map(([start, end]) => {
        return db.collection('post_locations')
          .where('geohash', '>=', start)
          .where('geohash', '<=', end)
          .get();
      });

      const snapshots = await Promise.all(promises);

      // Combine all results
      const allResults: any[] = [];
      snapshots.forEach(snapshot => {
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          allResults.push({
            postId: data.postId,
            latitude: data.latitude,
            longitude: data.longitude,
            geohash: data.geohash
          });
        });
      });

      // Filter to exact distance (geohash gives us a rectangle, we want a circle)
      postLocations = allResults.filter(location => {
        const distance = distanceBetween(
          center,
          [location.latitude, location.longitude]
        );
        return distance <= radiusInM;
      });

      console.log(`Found ${allResults.length} posts in geohash bounds, ${postLocations.length} within exact radius`);
    }

    // OPTION B: Query by bounding box (map viewport)
    else if (data.north && data.south && data.east && data.west) {
      // Calculate center point and approximate radius from bounds
      const centerLat = (data.north + data.south) / 2;
      const centerLng = (data.east + data.west) / 2;

      // Calculate diagonal distance as radius (ensures we cover entire viewport)
      const radiusInM = distanceBetween(
        [data.south, data.west],
        [data.north, data.east]
      ) / 2;

      console.log(`Viewport center: ${centerLat}, ${centerLng}, radius: ${radiusInM}m`);

      // Use same geohash query approach
      const center = [centerLat, centerLng];
      const bounds = geohashQueryBounds(center, radiusInM);

      const promises = bounds.map(([start, end]) => {
        return db.collection('post_locations')
          .where('geohash', '>=', start)
          .where('geohash', '<=', end)
          .get();
      });

      const snapshots = await Promise.all(promises);

      const allResults: any[] = [];
      snapshots.forEach(snapshot => {
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          allResults.push({
            postId: data.postId,
            latitude: data.latitude,
            longitude: data.longitude,
            geohash: data.geohash
          });
        });
      });

      // Filter to exact bounding box
      postLocations = allResults.filter(location => {
        return (
          location.latitude >= data.south &&
          location.latitude <= data.north &&
          location.longitude >= data.west &&
          location.longitude <= data.east
        );
      });

      console.log(`Found ${allResults.length} posts in geohash bounds, ${postLocations.length} within exact viewport`);
    }

    else {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Must provide either (centerLat, centerLng, radiusInMeters) or (north, south, east, west)'
      );
    }

    return {
      posts: postLocations,
      count: postLocations.length
    };

  } catch (error) {
    console.error('Error querying posts in area:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Error querying posts in area'
    );
  }
});
```

### Step 4: Create Client-Side Utility Function

**File:** `src/utils/geospatialQueries.ts` (NEW FILE)

Create this file:

```typescript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CircleArea {
  centerLat: number;
  centerLng: number;
  radiusInMeters: number;
}

export interface PostLocation {
  postId: string;
  latitude: number;
  longitude: number;
  geohash: string;
}

/**
 * Get posts within a map viewport
 */
export async function getPostsInViewport(bounds: MapBounds): Promise<PostLocation[]> {
  try {
    const getPostsInArea = httpsCallable<MapBounds, { posts: PostLocation[]; count: number }>(
      functions,
      'getPostsInArea'
    );

    const result = await getPostsInArea(bounds);
    return result.data.posts;
  } catch (error) {
    console.error('Error fetching posts in viewport:', error);
    throw error;
  }
}

/**
 * Get posts within a circular radius
 */
export async function getPostsInRadius(area: CircleArea): Promise<PostLocation[]> {
  try {
    const getPostsInArea = httpsCallable<CircleArea, { posts: PostLocation[]; count: number }>(
      functions,
      'getPostsInArea'
    );

    const result = await getPostsInArea(area);
    return result.data.posts;
  } catch (error) {
    console.error('Error fetching posts in radius:', error);
    throw error;
  }
}

/**
 * Helper: Get map bounds from Mapbox map instance
 */
export function getMapBounds(map: any): MapBounds {
  const bounds = map.getBounds();
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest()
  };
}
```

### Step 5: Update MapScreen to Use Geospatial Queries

**File:** `src/screens/MapScreen.tsx`

**Current approach:** Uses `getPostCoordinates` to fetch ALL post coordinates, then filters client-side.

**New approach:** Use geospatial query to fetch only posts in viewport.

**Changes needed:**

1. **Import the new utility:**
```typescript
import { getPostsInViewport, getMapBounds } from '@/utils/geospatialQueries';
```

2. **Replace the coordinate fetching logic:**

```typescript
// OLD APPROACH (delete this):
const coordinates = await getPostCoordinates(postIds);
const filteredCoordinates = coordinates.filter(/* viewport bounds */);

// NEW APPROACH:
const handleMapMoveEnd = async () => {
  if (!mapRef.current) return;

  try {
    setLoadingPosts(true);

    // Get current map bounds
    const bounds = getMapBounds(mapRef.current);

    // Fetch posts in viewport via geohash query
    const postLocations = await getPostsInViewport(bounds);

    // Fetch full post data for visible posts
    const postIds = postLocations.map(loc => loc.postId);
    const postDocs = await Promise.all(
      postIds.map(id => getDoc(doc(db, 'posts', id)))
    );

    const posts = postDocs
      .filter(doc => doc.exists())
      .map(doc => ({ id: doc.id, ...doc.data() }));

    // Combine posts with their coordinates
    const postsWithCoords = posts.map(post => {
      const location = postLocations.find(loc => loc.postId === post.id);
      return {
        ...post,
        latitude: location?.latitude,
        longitude: location?.longitude
      };
    });

    setPosts(postsWithCoords);
    setLoadingPosts(false);
  } catch (error) {
    console.error('Error fetching posts in viewport:', error);
    setLoadingPosts(false);
  }
};

// Add listener for map movement
useEffect(() => {
  if (!mapRef.current) return;

  const map = mapRef.current;

  // Debounce map movement to avoid excessive queries
  let timeoutId: NodeJS.Timeout;
  const handleMove = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(handleMapMoveEnd, 500); // Wait 500ms after user stops moving
  };

  map.on('moveend', handleMove);

  return () => {
    map.off('moveend', handleMove);
    clearTimeout(timeoutId);
  };
}, []);

// Initial load
useEffect(() => {
  handleMapMoveEnd();
}, []);
```

3. **Add loading state:**
```typescript
const [loadingPosts, setLoadingPosts] = useState(false);

// Show loading indicator on map
{loadingPosts && (
  <View style={styles.loadingOverlay}>
    <ActivityIndicator size="small" color={colors.primary} />
  </View>
)}
```

### Step 6: Update Firestore Security Rules

**File:** `firestore.rules`

Ensure `post_locations` collection remains secure (geohash field should NOT be readable by clients):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Post locations collection - SERVER ACCESS ONLY
    match /post_locations/{locationId} {
      // No read access (location data including geohash is private)
      allow read: if false;

      // Allow authenticated users to create location documents
      allow create: if request.auth != null;

      // No updates or deletes from clients (only Cloud Functions can delete)
      allow update, delete: if false;
    }

    // ... rest of your rules
  }
}
```

**Deploy rules:**
```bash
firebase deploy --only firestore:rules
```

### Step 7: Testing

**Test plan:**

1. **Test geohash generation:**
```bash
cd functions
npm test  # If you have tests, or manually test via Firebase shell

firebase functions:shell
> geohashForLocation([37.7749, -122.4194])
# Should return: "9q8yy9mf" or similar
```

2. **Test backfill:**
```bash
# Deploy and run backfill
firebase deploy --only functions:backfillGeohashes
# Call the function via HTTP or Firebase console
# Check Firestore Console: post_locations should have geohash field
```

3. **Test viewport query:**
```typescript
// In your app, add debug logging
const bounds = {
  north: 37.8,
  south: 37.7,
  east: -122.3,
  west: -122.5
};
const posts = await getPostsInViewport(bounds);
console.log(`Found ${posts.length} posts in San Francisco area`);
```

4. **Test map interaction:**
- Pan around map → should fetch new posts for each viewport
- Zoom in → should show fewer, more precise posts
- Zoom out → should show more posts in larger area
- Check Firebase Console logs for geohash query performance

### Step 8: Performance Optimization

**Caching strategy:**

Add caching to avoid repeated queries for the same area:

```typescript
// src/utils/geospatialQueries.ts

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { data: PostLocation[]; timestamp: number }>();

function getCacheKey(bounds: MapBounds): string {
  // Round to 3 decimal places (~100m precision) for cache key
  return `${bounds.north.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.west.toFixed(3)}`;
}

export async function getPostsInViewport(bounds: MapBounds): Promise<PostLocation[]> {
  const cacheKey = getCacheKey(bounds);
  const cached = cache.get(cacheKey);

  // Return cached data if fresh
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Returning cached posts for viewport');
    return cached.data;
  }

  // Fetch fresh data
  const getPostsInArea = httpsCallable<MapBounds, { posts: PostLocation[]; count: number }>(
    getFunctions(),
    'getPostsInArea'
  );

  const result = await getPostsInArea(bounds);

  // Cache the result
  cache.set(cacheKey, {
    data: result.data.posts,
    timestamp: Date.now()
  });

  // Clean old cache entries
  if (cache.size > 50) {
    const entries = Array.from(cache.entries());
    const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = sorted.slice(0, 25); // Remove oldest 25
    toDelete.forEach(([key]) => cache.delete(key));
  }

  return result.data.posts;
}
```

**Debouncing map queries:**

Already included in Step 5, but ensure you debounce map movement events (500ms is a good default).

## Migration Checklist

Use this checklist to track implementation progress:

- [ ] Install `geofire-common` npm package
- [ ] Update Cloud Functions to add geohash on new post creation
- [ ] Create and deploy `backfillGeohashes` Cloud Function
- [ ] Run backfill to add geohash to existing posts
- [ ] Verify geohash field exists in Firestore Console
- [ ] Create `getPostsInArea` Cloud Function
- [ ] Deploy all Cloud Functions
- [ ] Create `src/utils/geospatialQueries.ts` utility file
- [ ] Update MapScreen to use geospatial queries
- [ ] Test viewport queries on map movement
- [ ] Add caching layer for performance
- [ ] Update Firestore security rules (verify post_locations is secure)
- [ ] Deploy security rules
- [ ] Test on device/simulator
- [ ] Monitor Cloud Function logs for errors
- [ ] Delete or secure `backfillGeohashes` function after migration

## Expected Performance Improvements

**Before (current system):**
- Fetch ALL post coordinates: ~500-1000 posts (10-20 KB)
- Filter client-side
- Query time: ~500-1000ms

**After (geohash system):**
- Fetch only visible posts: ~20-100 posts (1-5 KB)
- Server-side filtering via indexed geohash
- Query time: ~200-400ms
- Scales to 10,000+ posts without performance degradation

## Troubleshooting

### Issue: "Missing index" error in Cloud Functions logs

**Solution:** Firestore needs a composite index on `geohash` field.

1. Check logs for index creation link
2. Click link to auto-create index
3. Wait 2-5 minutes for index to build
4. Retry query

**Or manually create index:**
- Collection: `post_locations`
- Fields: `geohash` (Ascending)
- Query scope: Collection

### Issue: No posts returned despite posts existing in area

**Possible causes:**
1. Geohash field missing (check Firestore Console)
2. Backfill didn't complete (re-run backfill)
3. Bounds are too small (zoom out map)
4. Security rules blocking access (check rules)

**Debug:**
```typescript
// Add logging to Cloud Function
console.log('Querying bounds:', bounds);
console.log('Geohash ranges:', geohashQueryBounds(center, radiusInM));
console.log('Results count:', postLocations.length);
```

### Issue: Too many posts returned (performance issue)

**Solution:** Limit results in Cloud Function:

```typescript
// Add limit to query
.where('geohash', '>=', start)
.where('geohash', '<=', end)
.limit(100)  // Add this
.get();
```

Or increase viewport filter strictness on client.

### Issue: Posts near edges not appearing

**Cause:** Geohash boundary issue.

**Solution:** Already handled by `geohashQueryBounds` (queries multiple ranges). If still occurring, increase radius slightly:

```typescript
const radiusInM = distanceBetween(...) / 2;
const paddedRadius = radiusInM * 1.2; // Add 20% padding
const bounds = geohashQueryBounds(center, paddedRadius);
```

## Security Considerations

1. **Geohash in post_locations:** Geohash is stored in the secure `post_locations` collection, NOT in the public `posts` collection. Clients cannot directly read geohash values.

2. **Cloud Function access control:** Only authenticated users can call `getPostsInArea`. Consider adding rate limiting if needed.

3. **Data exposure:** Cloud Function only returns coordinates for posts in the requested area, not all posts globally.

4. **Validation:** Cloud Function should validate bounds to prevent abuse (e.g., querying entire planet):

```typescript
// Add to getPostsInArea function
if (data.radiusInMeters && data.radiusInMeters > 100000) {
  throw new functions.https.HttpsError(
    'invalid-argument',
    'Radius cannot exceed 100km'
  );
}
```

## Future Enhancements

1. **Clustering:** Group nearby markers at low zoom levels (already implemented with Supercluster)
2. **Prefetching:** Prefetch adjacent viewport areas for smoother panning
3. **Real-time updates:** Listen to Firestore changes for new posts in viewport
4. **Heatmap:** Show post density using geohash aggregation
5. **Search by place name:** Geocode place names to coordinates, then query

## References

- [GeoFire for Cloud Firestore](https://github.com/firebase/geofire-js)
- [Firebase Geoqueries Documentation](https://firebase.google.com/docs/firestore/solutions/geoqueries)
- [Geohash Wikipedia](https://en.wikipedia.org/wiki/Geohash)
- [geofire-common NPM Package](https://www.npmjs.com/package/geofire-common)

## Questions or Issues?

If you encounter issues during implementation:

1. Check Cloud Function logs in Firebase Console
2. Verify Firestore indexes are created
3. Test queries in Firebase Functions shell
4. Check network requests in browser/app DevTools
5. Ensure `geofire-common` version is up to date

---

**Document Version:** 1.0
**Last Updated:** 2026-01-11
**Author:** Claude (AI Assistant)
**For:** Catch App - Geospatial Query Implementation
