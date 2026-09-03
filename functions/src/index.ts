/**
 * Firebase Cloud Functions for Catch App
 *
 * This module provides server-side functions for:
 * - Location validation for catch functionality
 * - Post location data retrieval
 * - Post lifecycle management (creation/deletion)
 * - Push notifications for social features
 */

import * as admin from 'firebase-admin'

admin.initializeApp()

// ─── Storage Triggers ───────────────────────────────────────────────────────
import { onImageUpload } from './triggers/onImageUpload'
export { onImageUpload }

// ─── Firestore Triggers ─────────────────────────────────────────────────────
export { onPostCreated } from './triggers/onPostCreated'
export { onPostDeleted } from './triggers/onPostDeleted'
export { onUserFollowed } from './triggers/onUserFollowed'

// ─── Callable Functions: Catch & Post Locations ─────────────────────────────
export { validateCatch } from './callable/validateCatch'
export {
    getPostLocation,
    getPostLocations,
    getPostsInArea,
} from './callable/postLocations'

// ─── Callable Functions: Account Management ─────────────────────────────────
export {
    setupUsername,
    followUser,
    unfollowUser,
    reportUser,
    reportPost,
    blockUser,
    unblockUser,
    deleteAccount,
} from './callable/account'

// ─── Callable Functions: Notifications ──────────────────────────────────────
export { markAllNotificationsRead } from './callable/notifications'

// ─── Callable Functions: Admin Reconciliation ───────────────────────────────
export { reconcileCounters } from './callable/reconcile'

// ─── Callable Functions: Recommendations ────────────────────────────────────
export {
    recordCityIntent,
    getRecommendedFeed,
} from './callable/recommendations'

// ─── Callable Functions: Semantic Search ────────────────────────────────────
export { searchPosts, backfillEmbeddings } from './callable/search'

// ─── Callable Functions: Coverage ───────────────────────────────────────────
export { backfillCoverage } from './callable/coverage'
