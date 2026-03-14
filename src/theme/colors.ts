/**
 * Color Theme
 *
 * Dark mode color palette for the Catch app.
 * Uses a blue/pink accent palette:
 * - Blue (#007AFF): Primary actions, uncaught/available state
 * - Pink (#CF2CF6): Caught/owned state, trophies, achievements
 */

export const colors = {
    // Backgrounds
    background: '#0a0a0a', // Near black
    card: '#1c1c1e', // Dark gray
    cardBackground: '#1c1c1e', // Alias for card
    cardElevated: '#2c2c2e', // Slightly lighter gray for badges/buttons
    surface: '#1c1c1e', // Standard surface color

    // Primary Accents
    primary: '#007AFF', // iOS blue - primary actions, uncaught state
    secondary: '#CF2CF6', // Pink - caught state, trophies
    accent: '#CF2CF6', // Pink - highlights, user location
    danger: '#FF3B30', // iOS red - delete/destructive actions

    // Caught State Indicators
    caughtBadge: '#CF2CF6', // Pink badge background (same as secondary)
    caughtBadgeText: '#ffffff', // White text on badge

    // Map Pin Colors
    pinDefault: '#007AFF', // Blue - uncaught posts
    pinCaught: '#CF2CF6', // Pink - caught by user
    pinSelected: '#CF2CF6', // Pink - currently selected
    pinBounty: '#FFD700', // Gold - bounty posts (0 catches or inactive >30 days)
    pinTrending: '#C0C0C0', // Silver - trending posts (high catch count)
    userLocation: '#CF2CF6', // Pink - user's location puck

    // Text
    textPrimary: '#ffffff', // White
    textSecondary: '#e5e5e7', // Light gray
    textTertiary: '#98989f', // Medium gray
    inverseTextPrimary: '#000000', // Black text for light backgrounds

    // Borders
    border: '#2c2c2e',

    // Other
    imageBackground: '#000000',
    modalOverlay: 'rgba(0, 0, 0, 0.95)',
    modalDark: '#1c1c1e',
    white: '#ffffff',
    error: '#FF3B30',

    // Icon states
    iconInactive: '#98989f',
    iconActive: '#007AFF', // Same as primary for consistency
}
