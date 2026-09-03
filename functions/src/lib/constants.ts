/** Maximum distance (in meters) a user must be from a post location to catch it */
export const CATCH_RADIUS_METERS = 100

/**
 * Minutes a catch permit (catch_permits/{uid}_{rootPostId}) stays valid after
 * validateCatch approves. Long enough to cover photo checks + upload on a slow
 * connection; short enough that a permit can't be stockpiled.
 */
export const CATCH_PERMIT_TTL_MINUTES = 10

/**
 * Distance threshold (meters) for Pioneer classification: an original post
 * farther than this from every existing pin earns permanent Pioneer
 * attribution ("first found here"). Attribution only — there is no point
 * economy.
 */
export const NEARBY_THRESHOLD_METERS = 50

/**
 * Days since last catch before a post counts as a "lost place" (gold pin on
 * the map — a spot whose photographic record has a gap worth filling).
 */
export const LOST_PLACE_INACTIVITY_DAYS = 30

/** Maximum results per geohash sub-query in getPostsInArea */
export const GEOHASH_QUERY_LIMIT = 200

/** Maximum total results returned from getPostsInArea */
export const MAX_AREA_RESULTS = 200

/**
 * Cloud Functions concurrency caps (`runWith({ maxInstances })`).
 * A cost-control backstop independent of any app-level rate limiting —
 * bounds how far a single function can scale under abuse or a traffic spike.
 */
export const MAX_INSTANCES = {
    /** Typical callables/triggers */
    DEFAULT: 20,
    /** Functions that call paid external APIs per invocation (Gemini, Nominatim) */
    EXPENSIVE: 5,
    /** Rare, heavy, admin-only batch jobs */
    ADMIN: 2,
}
