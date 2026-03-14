/**
 * Contribution System Configuration
 *
 * Central config for all contribution point values.
 * Used by both frontend (for display) and referenced by backend logic.
 */

export const CONTRIBUTION = {
    /** Points for creating a post >50m from any existing pin */
    PIONEER_POST: 10,

    /** Points for creating a post within 50m of existing pins */
    NEARBY_POST: 2,

    /** Points for catching any post */
    CATCH: 14,

    /** Royalty to original poster when their Pioneer post is caught */
    ROYALTY_PIONEER: 7,

    /** Royalty to original poster when their Nearby post is caught */
    ROYALTY_NEARBY: 2,

    /** Distance threshold (meters) for Pioneer vs Nearby classification */
    NEARBY_THRESHOLD_METERS: 50,

    /** Bounty (Gold Pin): catch multiplier for dead posts (0 catches or inactive >30 days) */
    BOUNTY_MULTIPLIER: 3,

    /** Trending (Silver Pin): catch multiplier for popular posts */
    TRENDING_MULTIPLIER: 1.5,

    /** Minimum catches for a post to be considered trending */
    TRENDING_THRESHOLD: 5,

    /** Days of inactivity before a post becomes a bounty */
    BOUNTY_INACTIVITY_DAYS: 30,
}
