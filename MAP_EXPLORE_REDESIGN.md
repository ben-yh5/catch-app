# Map & Explore Tab Redesign - Complete Implementation Guide

## Overview

This document describes a major redesign of the Catch app's discovery experience, transforming the Map tab into the primary discovery mechanism and reimagining the Explore tab as a curated homepage.

**Inspiration:** Strava map interface with bottom sheet

## High-Level Vision

### Current State:
- **Explore Tab:** Primary discovery via infinite scroll feed (Trending/New/Near filters)
- **Map Tab:** Secondary view showing all posts on map with basic interaction

### New State:
- **Map Tab:** Primary discovery with interactive map + scrollable bottom sheet
- **Explore Tab:** Curated homepage with horizontal carousels (Featured Lists, Trending, New, Near)

## Design Goals

1. **Spatial context first:** Users see WHERE posts are before deciding to catch them
2. **Logical discovery:** Location-based discovery makes sense for a "catch" mechanic
3. **Reduced scrolling fatigue:** Replace infinite scroll with viewport-based discovery
4. **Curated experience:** Explore becomes scannable, not overwhelming
5. **Performance:** Only load posts visible in current map viewport

---

## Part 1: Map Tab Redesign (Primary Discovery)

### New Map Tab Features

#### A. Bottom Sheet Implementation

**States:**
1. **Minimized:** Small pull tab (20-30px visible)
   - Map takes full screen
   - User can focus on map exploration

2. **Default (Half-height):** ~50% of screen height
   - Shows 3-5 post cards at once
   - Map still clearly visible at top
   - Primary browsing state

3. **Expanded:** ~80-90% of screen height
   - List-focused view
   - Map visible as header/context
   - For deep browsing

**Visual Layout:**
```
┌─────────────────────────────────┐
│                                 │
│        MAP VIEW (50%)           │  ← Map shows markers
│     (with markers)              │
│                                 │
├─────────────────────────────────┤
│         ━━━━━                   │  ← Pull handle
│  📍 142 shots in this area      │  ← Count + filter
│                                 │
│  ┌───────────────────────────┐ │
│  │  [Post Card 1]            │ │
│  └───────────────────────────┘ │
│  ┌───────────────────────────┐ │  ← Bottom sheet (50%)
│  │  [Post Card 2]            │ │     Shows posts in
│  └───────────────────────────┘ │     current viewport
│  ┌───────────────────────────┐ │
│  │  [Post Card 3]            │ │
│  └───────────────────────────┘ │
└─────────────────────────────────┘
```

#### B. Map Header (Compact UI)

**Current header** (too much space):
```
┌─────────────────────────────────┐
│  Map                            │
│                                 │
│  [Explore]    [My Catches]      │  ← Segmented control
│                                 │
└─────────────────────────────────┘
```

**New header** (compact, Strava-inspired):
```
┌─────────────────────────────────┐
│ ← Map              [Search] ⚙️  │  ← Minimal header (40px)
│                                 │
│ 🔥Trending ⚡New 📍Near         │  ← Floating filter pills
│                                 │
```

**Components:**
- Back button (left)
- Title "Map" (center-left)
- Search icon (optional, future feature)
- Settings/Filter icon (right)
- Floating filter pills (overlay on map, not in header bar)

#### C. Filter Pills (Replaces Segmented Control)

**Design:**
```
┌────────────┐ ┌────────┐ ┌────────┐
│ 🔥Trending │ │ ⚡New  │ │ 📍Near │  ← Small, rounded pills
└────────────┘ └────────┘ └────────┘
    Active       Inactive   Inactive
  (filled bg)   (outline)  (outline)
```

**Behavior:**
- Tap to switch filter
- Active pill has filled background (colors.primary)
- Inactive pills have outline style
- Pills float over map (not in header bar)
- Position: Top-left or top-center of map, below header

**Filters affect:**
- **Trending:** Posts sorted by catchCount (descending)
- **New:** Posts sorted by createdAt (descending)
- **Near:** Posts sorted by distance from user (ascending) - requires user location

#### D. Bottom Sheet Header

**Design:**
```
┌─────────────────────────────────┐
│            ━━━━━                │  ← Pull handle (centered)
│                                 │
│  📍 142 shots in this area      │  ← Dynamic count
│                                 │
└─────────────────────────────────┘
```

**Components:**
- Pull handle (visual affordance for dragging)
- Count text: "X shots in this area" (updates when map moves)
- Optional: Sort/Filter button (future enhancement)

#### E. Post Cards in Bottom Sheet

**Compact card design** (fits more on screen):
```
┌─────────────────────────────────┐
│ [img] @username     🏆 42       │  ← Horizontal layout
│ [160]  Caption text...          │  ← 160px square image
│ [px]   Jan 11, 2026             │
│       [📍 Go to location]       │  ← Icon button
└─────────────────────────────────┘
```

**Components:**
- Square thumbnail (160px x 160px) - left side
- Username (top-right)
- Catch count badge (top-right)
- Caption (max 2 lines, truncated)
- Date
- "Jump to location" icon button (navigate-outline icon)
- Tap card → Opens ThreadModal (full thread view)

#### F. Map/List Bidirectional Sync

**Interaction flows:**

1. **User pans/zooms map:**
   - Debounced (500ms after movement stops)
   - Fetch posts in new viewport via geohash query
   - Update bottom sheet list
   - Update count: "X shots in this area"

2. **User scrolls bottom sheet list:**
   - No automatic map panning (would be disorienting)
   - Each post card has "jump to location" icon button
   - Tapping icon → Map smoothly pans/zooms to that post
   - Tapping post card → Opens ThreadModal

3. **User taps marker on map:**
   - Highlight marker (different color/size)
   - Bottom sheet scrolls to that post card
   - Highlight post card briefly (flash animation)
   - Optional: Auto-expand bottom sheet to half-height if minimized

4. **User taps "jump to location" icon:**
   - Map pans/zooms to center on that post
   - Marker highlights
   - Bottom sheet stays at current height (doesn't auto-minimize)

### Data Flow Architecture

#### Viewport-Based Discovery:

```
┌─────────────────────────────────────────────────┐
│  User pans map                                  │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Get map bounds (north, south, east, west)      │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Call Cloud Function: getPostsInArea(bounds)    │
│  - Uses geohash queries for efficiency          │
│  - Returns array of {postId, lat, lng, geohash} │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Fetch full post data for returned postIds      │
│  - Query posts collection                       │
│  - Get author, caption, photoURL, etc.          │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Apply filter (Trending/New/Near)               │
│  - Sort by catchCount, createdAt, or distance   │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Update state:                                  │
│  - visiblePosts                                 │
│  - Update bottom sheet list                     │
│  - Update map markers                           │
│  - Update count text                            │
└─────────────────────────────────────────────────┘
```

#### Filter Changes (Trending/New/Near):

```
┌─────────────────────────────────────────────────┐
│  User taps filter pill                          │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Re-sort existing visiblePosts array            │
│  - Trending: sort by catchCount desc            │
│  - New: sort by createdAt desc                  │
│  - Near: sort by distance from user asc         │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  Update bottom sheet list (instant)             │
│  - No network request needed                    │
│  - Just re-order existing data                  │
└─────────────────────────────────────────────────┘
```

**Key insight:** Filters don't change WHICH posts are shown (determined by viewport), only the ORDER.

### Performance Optimizations

#### 1. Debouncing Map Queries
```typescript
let moveTimeout: NodeJS.Timeout;

const handleMapMove = () => {
  clearTimeout(moveTimeout);
  moveTimeout = setTimeout(async () => {
    await fetchPostsInViewport();
  }, 500); // Wait 500ms after user stops moving
};
```

#### 2. Caching Viewport Queries
```typescript
// Cache key based on rounded bounds (100m precision)
const cacheKey = `${north.toFixed(3)},${south.toFixed(3)},${east.toFixed(3)},${west.toFixed(3)}`;
const cached = viewportCache.get(cacheKey);

if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
  return cached.data; // Return cached data if < 5 minutes old
}
```

#### 3. Bottom Sheet Optimization
```typescript
<BottomSheetFlatList
  data={visiblePosts}
  renderItem={renderPostCard}
  keyExtractor={(item) => item.id}
  windowSize={5}              // Only render 5 screens worth
  maxToRenderPerBatch={10}    // Render 10 items per batch
  removeClippedSubviews={true} // Remove off-screen views
  initialNumToRender={6}       // Render 6 items initially
/>
```

#### 4. Image Optimization
```typescript
// Use smaller thumbnails in bottom sheet (not full 1080px)
<Image
  source={{ uri: post.photoURL }}
  style={{ width: 160, height: 160 }}
  contentFit="cover"
  cachePolicy="memory-disk"
  priority="normal" // Not "high" - map is priority
/>
```

#### 5. Marker Clustering
- Already implemented with Supercluster
- At low zoom: Show clusters ("12 posts")
- At high zoom: Show individual markers
- Only render markers in visible viewport (not all posts)

### Technical Implementation Details

#### Required Packages:
```bash
npm install @gorhom/bottom-sheet
npm install geofire-common  # For geohash queries
```

#### State Management:
```typescript
const [visiblePosts, setVisiblePosts] = useState<Post[]>([])
const [activeFilter, setActiveFilter] = useState<'trending' | 'new' | 'near'>('trending')
const [bottomSheetIndex, setBottomSheetIndex] = useState(1) // 0=min, 1=half, 2=full
const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
const [loadingPosts, setLoadingPosts] = useState(false)
const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null)
```

#### Bottom Sheet Setup:
```typescript
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet'

const bottomSheetRef = useRef<BottomSheet>(null)
const snapPoints = useMemo(() => ['8%', '50%', '90%'], []) // min, half, full

<BottomSheet
  ref={bottomSheetRef}
  index={1} // Start at half-height
  snapPoints={snapPoints}
  enablePanDownToClose={false} // Keep it always visible
  backgroundStyle={{ backgroundColor: colors.card }}
  handleIndicatorStyle={{ backgroundColor: colors.textTertiary }}
>
  <BottomSheetFlatList
    data={visiblePosts}
    renderItem={renderPostCard}
    // ... optimization props
  />
</BottomSheet>
```

#### Geospatial Query Integration:
```typescript
import { getPostsInViewport } from '@/utils/geospatialQueries'

const fetchPostsInViewport = async () => {
  if (!mapRef.current) return

  setLoadingPosts(true)

  try {
    // Get map bounds
    const bounds = mapRef.current.getBounds()
    const mapBounds = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest()
    }

    // Fetch posts via geohash query (Cloud Function)
    const postLocations = await getPostsInViewport(mapBounds)

    // Fetch full post data
    const postIds = postLocations.map(loc => loc.postId)
    const postDocs = await Promise.all(
      postIds.map(id => getDoc(doc(db, 'posts', id)))
    )

    const posts = postDocs
      .filter(doc => doc.exists())
      .map(doc => {
        const postData = doc.data()
        const location = postLocations.find(loc => loc.postId === doc.id)
        return {
          id: doc.id,
          ...postData,
          latitude: location?.latitude,
          longitude: location?.longitude
        }
      })

    // Apply filter
    const sortedPosts = applySorting(posts, activeFilter)

    setVisiblePosts(sortedPosts)
  } catch (error) {
    console.error('Error fetching posts:', error)
  } finally {
    setLoadingPosts(false)
  }
}

const applySorting = (posts: Post[], filter: FilterType) => {
  switch (filter) {
    case 'trending':
      return [...posts].sort((a, b) => b.catchCount - a.catchCount)
    case 'new':
      return [...posts].sort((a, b) => b.createdAt - a.createdAt)
    case 'near':
      if (!userLocation) return posts
      return [...posts].sort((a, b) => {
        const distA = calculateDistance(userLocation, { lat: a.latitude, lng: a.longitude })
        const distB = calculateDistance(userLocation, { lat: b.latitude, lng: b.longitude })
        return distA - distB
      })
    default:
      return posts
  }
}
```

---

## Part 2: Explore Tab Redesign (Curated Homepage)

### New Explore Tab Features

#### A. Overview

Transform from infinite scroll to **curated carousels** (like App Store, Netflix, Instagram Explore):

**Layout:**
```
┌─────────────────────────────────────┐
│  Explore                            │  ← Header (title only)
├─────────────────────────────────────┤
│                                     │
│  📋 Featured Lists                  │  ← Section 1
│  [List1] [List2] [List3] → See All │  ← Horizontal scroll
│                                     │
│  🔥 Trending                        │  ← Section 2
│  [Post] [Post] [Post] → See All     │  ← Horizontal scroll
│                                     │
│  ⚡ New                             │  ← Section 3
│  [Post] [Post] [Post] → See All     │  ← Horizontal scroll
│                                     │
│  📍 Near You                        │  ← Section 4 (if location available)
│  [Post] [Post] [Post] → See All     │  ← Horizontal scroll
│                                     │
└─────────────────────────────────────┘
     ↕️ Vertical scroll through sections
```

#### B. Section Components

**Each section has:**
1. **Header:** Icon + Title + "See All" button
2. **Horizontal carousel:** FlatList with `horizontal={true}`
3. **Items:** 10-15 posts per section (limited, not infinite)
4. **"See All" action:** Navigate to Map tab with that filter applied

#### C. Section Definitions

##### 1. Featured Lists (Keep existing)
- Same as current implementation
- Horizontal scroll of public lists
- Shows 4-thumbnail grid preview
- "See All" → Navigate to Lists tab

##### 2. Trending Posts
- Query: Top 15 posts by catchCount
- Sort: Descending catchCount
- Card size: 180px x 180px (larger than current list cards)
- "See All" → Navigate to Map tab with Trending filter

##### 3. New Posts
- Query: Latest 15 posts by createdAt
- Sort: Descending createdAt
- Card size: 180px x 180px
- "See All" → Navigate to Map tab with New filter

##### 4. Near You (Conditional)
- Only show if user has granted location permission
- Query: Posts with location within 10km radius
- Sort: By distance (closest first)
- Card size: 180px x 180px
- "See All" → Navigate to Map tab with Near filter + pan to user location

#### D. Card Design (Simplified)

**Horizontal carousel card:**
```
┌─────────────────┐
│                 │
│   [Photo 180px] │  ← Square photo
│                 │
├─────────────────┤
│ @username       │  ← Username
│ 🏆 42           │  ← Catch count (small)
└─────────────────┘
```

**Minimal design:**
- Just photo, username, catch count
- No caption (keeps it scannable)
- Tap card → Opens ThreadModal
- No "jump to location" button here (that's for Map tab)

#### E. Empty States

**No location permission (Near You section):**
```
┌─────────────────────────────────────┐
│  📍 Near You                        │
│                                     │
│  🗺️  Enable location to see        │
│      nearby posts                   │
│                                     │
│     [Enable Location]               │  ← Button
└─────────────────────────────────────┘
```

**No posts in section:**
- Don't show the section at all (e.g., if no Featured Lists exist)
- Or show skeleton loaders while loading

#### F. Data Fetching Strategy

**On Explore tab focus:**
1. Fetch Featured Lists (existing logic)
2. Fetch Trending posts (limit 15)
3. Fetch New posts (limit 15)
4. Fetch Near posts (limit 15, if location available)

**Queries:**
```typescript
// Trending
const trendingQuery = query(
  collection(db, 'posts'),
  where('isOriginal', '==', true),
  orderBy('catchCount', 'desc'),
  limit(15)
)

// New
const newQuery = query(
  collection(db, 'posts'),
  where('isOriginal', '==', true),
  orderBy('createdAt', 'desc'),
  limit(15)
)

// Near (use geohash query for efficiency)
const nearPosts = await getPostsInRadius({
  centerLat: userLocation.lat,
  centerLng: userLocation.lng,
  radiusInMeters: 10000 // 10km
})
const sortedNear = nearPosts
  .sort((a, b) => /* distance sort */)
  .slice(0, 15)
```

**Caching:**
- Cache results for 5 minutes
- Pull-to-refresh re-fetches all sections
- Use PostContext events to invalidate cache on new posts

#### G. "See All" Navigation

When user taps "See All" on a section:

```typescript
// Trending "See All"
router.push({
  pathname: '/(tabs)/map',
  params: { filter: 'trending' }
})

// New "See All"
router.push({
  pathname: '/(tabs)/map',
  params: { filter: 'new' }
})

// Near "See All"
router.push({
  pathname: '/(tabs)/map',
  params: {
    filter: 'near',
    panToUser: 'true' // Map should pan to user location
  }
})
```

**Map tab receives params and:**
1. Set active filter pill
2. Pan map to appropriate location (user location for "near", or center on posts)
3. Open bottom sheet to half-height

---

## Part 3: Implementation Checklist

### Phase 1: Geohash Foundation
- [ ] Install `geofire-common` package
- [ ] Update Cloud Functions to add geohash on post creation
- [ ] Create and run backfill script for existing posts
- [ ] Create `getPostsInArea` Cloud Function
- [ ] Create `src/utils/geospatialQueries.ts` utility
- [ ] Test geohash queries in isolation
- [ ] Deploy Cloud Functions

### Phase 2: Map Tab Redesign
- [ ] Install `@gorhom/bottom-sheet` package
- [ ] Create new MapScreen layout structure
- [ ] Implement compact header (remove segmented control)
- [ ] Add floating filter pills (Trending/New/Near)
- [ ] Integrate BottomSheet component
- [ ] Design compact post card component
- [ ] Implement viewport-based post fetching
- [ ] Add map movement debouncing
- [ ] Implement filter sorting (client-side)
- [ ] Add "jump to location" icon button functionality
- [ ] Implement tap-marker-to-scroll-list behavior
- [ ] Add loading states and empty states
- [ ] Test performance with 100+ posts
- [ ] Optimize image loading in bottom sheet
- [ ] Add caching layer for viewport queries

### Phase 3: Explore Tab Redesign
- [ ] Remove infinite scroll logic from ExploreScreen
- [ ] Remove filter tabs from header
- [ ] Create horizontal carousel component
- [ ] Implement Featured Lists section (keep existing)
- [ ] Implement Trending section (new)
- [ ] Implement New section (new)
- [ ] Implement Near You section (new, conditional)
- [ ] Add "See All" buttons with navigation
- [ ] Handle navigation params in Map tab
- [ ] Implement pull-to-refresh for all sections
- [ ] Add empty states for each section
- [ ] Test data fetching and caching
- [ ] Optimize horizontal FlatList performance

### Phase 4: Polish & Testing
- [ ] Test map/list sync interactions
- [ ] Test filter switching
- [ ] Test "See All" navigation flow
- [ ] Test empty states (no location, no posts, etc.)
- [ ] Test performance on low-end devices
- [ ] Add loading skeletons
- [ ] Add error handling and retry logic
- [ ] Test with 1000+ posts (stress test)
- [ ] Check memory usage during map panning
- [ ] Verify all existing features still work (ThreadModal, Lists, etc.)
- [ ] User testing and feedback

---

## Part 4: Migration Considerations

### Breaking Changes:
1. **Explore tab behavior changes completely** - users expecting infinite scroll will see carousels
2. **Map tab becomes primary discovery** - onboarding may be needed

### User Communication:
- Consider an in-app tooltip/tutorial on first launch after update
- "New! Discover posts on the map" → point to Map tab
- "Swipe through curated collections" → point to Explore tab

### Gradual Rollout Option:
1. **Phase 1:** Deploy Map tab changes only, keep Explore as-is
2. **Phase 2:** Deploy Explore changes after user feedback on Map
3. Monitor analytics: Which tab gets more engagement?

### Analytics to Track:
- Map tab engagement time (before vs after)
- Explore tab engagement time (before vs after)
- Number of posts opened from Map vs Explore
- Filter usage (Trending/New/Near)
- Bottom sheet interactions (expand/collapse frequency)

---

## Part 5: Performance Benchmarks

### Target Performance Metrics:

**Map Tab:**
- Viewport query response time: < 400ms
- Bottom sheet scroll FPS: 60fps
- Map pan smoothness: 60fps
- Memory usage: < 200MB

**Explore Tab:**
- Initial load time: < 1s
- Horizontal scroll FPS: 60fps
- Image loading: Progressive (top section first)
- Memory usage: < 150MB

### Optimization Techniques:

1. **Lazy loading sections:** Load Explore sections as user scrolls down
2. **Image prefetching:** Prefetch adjacent viewport areas on map
3. **Intersection observer:** Only load images when section is visible
4. **Memoization:** Memoize post cards, carousel components
5. **Debouncing:** All map interactions debounced 300-500ms
6. **Cache aggressively:** 5-minute cache for all queries

---

## Part 6: Future Enhancements

### Map Tab:
1. **Search by location name** - Geocode and pan to searched location
2. **Draw radius tool** - User draws circle, see posts in that area
3. **Heatmap mode** - Show post density with color gradient
4. **Saved locations** - Bookmark favorite areas
5. **Post clusters** - Group nearby posts into clusters at low zoom

### Explore Tab:
1. **Personalized "For You" section** - Based on user's catch history
2. **"Catching Streak" section** - Posts in series (same location thread)
3. **"Expiring Soon" section** - If you add time-limited posts in future
4. **User collections** - Curated lists from followed users

### Both:
1. **Dark mode optimization** - Ensure map tiles look good in dark mode
2. **Offline mode** - Cache recently viewed areas for offline viewing
3. **AR view** - Show posts in augmented reality (camera overlay)

---

## Part 7: Design References

### Inspiration Apps:

**Strava:**
- Bottom sheet with map
- Compact header
- Smooth map/list interaction

**Airbnb:**
- Map with list below
- Tap marker → highlight in list
- Viewport-based queries

**Google Maps:**
- Bottom sheet states (minimized/half/full)
- Pull handle affordance
- Smooth animations

**Instagram Explore:**
- Curated sections
- Horizontal scrolling carousels
- "See All" pattern

---

## Part 8: Questions & Answers

### Q: What happens if user has no location permission?
**A:** "Near" filter pill is disabled on Map tab (grayed out). "Near You" section doesn't appear on Explore tab (or shows "Enable Location" CTA).

### Q: How many posts should be shown in bottom sheet?
**A:** No hard limit - show all posts in viewport (typically 20-200 depending on zoom level). Bottom sheet scrolls infinitely through viewport results.

### Q: Should bottom sheet auto-minimize when panning map?
**A:** No - keep it at current height. User manually controls bottom sheet position. Only exception: tapping a marker can auto-expand to half-height if minimized.

### Q: What if viewport has 500+ posts?
**A:** Implement server-side limit (e.g., 200 posts max per viewport). Encourage user to zoom in for more detail. Or implement pagination in bottom sheet.

### Q: Should Explore carousels show user's own posts?
**A:** Yes, if they rank high enough (Trending) or are recent enough (New). Don't filter out user's posts.

### Q: What happens when user creates a new post?
**A:** PostContext event triggers:
- Map tab: Add new post to viewport if it's in bounds
- Explore tab: Invalidate cache, add to "New" section

---

## Part 9: File Structure

### New Files:
```
src/
├── utils/
│   └── geospatialQueries.ts       (NEW - geohash query utilities)
├── components/
│   ├── MapBottomSheet.tsx         (NEW - bottom sheet with post list)
│   ├── FilterPills.tsx            (NEW - floating filter pills)
│   ├── ExploreSection.tsx         (NEW - reusable carousel section)
│   └── CompactPostCard.tsx        (NEW - card for carousels)
└── screens/
    ├── MapScreen.tsx              (MAJOR CHANGES)
    └── ExploreScreen.tsx          (MAJOR CHANGES)
```

### Modified Files:
```
functions/
└── src/
    └── index.ts                   (Add geohash logic + new Cloud Function)

package.json                        (Add @gorhom/bottom-sheet, geofire-common)
```

---

## Part 10: Accessibility Considerations

1. **Bottom sheet:** Ensure screen readers announce sheet state (minimized/expanded)
2. **Filter pills:** Use role="button" and clear labels
3. **Map markers:** Provide text alternatives for markers
4. **"Jump to location" icon:** Add accessibility label "Pan map to this location"
5. **Carousels:** Ensure keyboard navigation works (web)
6. **Pull handle:** Large enough touch target (44x44 min)

---

**Document Version:** 1.0
**Last Updated:** 2026-01-11
**Author:** Claude (AI Assistant)
**Related Document:** GEOHASH_IMPLEMENTATION.md (technical implementation)

This document provides the complete UX/UI vision. The GEOHASH_IMPLEMENTATION.md document provides the technical implementation details for the geospatial query foundation.
