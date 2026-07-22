/** Maximum distance (in meters) a user must be from a post location to catch it */
export const CATCH_RADIUS_METERS = 100

/** Contribution System Constants */
export const CONTRIBUTION = {
    PIONEER_POST: 10, // Creating a post >50m from existing pins
    NEARBY_POST: 2, // Creating a post within 50m of existing pins
    CATCH: 14, // Catching any post
    ROYALTY_PIONEER: 7, // Royalty to original poster when Pioneer post is caught
    ROYALTY_NEARBY: 2, // Royalty to original poster when Nearby post is caught
    NEARBY_THRESHOLD_METERS: 50,
    BOUNTY_MULTIPLIER: 3, // Gold pin: 3x catch pts for dead posts
    TRENDING_MULTIPLIER: 1.5, // Silver pin: 1.5x catch pts for popular posts
    TRENDING_THRESHOLD: 5, // Catches needed to be trending
    BOUNTY_INACTIVITY_DAYS: 30, // Days since last catch to become bounty
}

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
