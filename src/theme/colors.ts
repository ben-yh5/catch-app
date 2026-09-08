/**
 * Color Theme — monochrome with ink (Sept 2026 restyle).
 *
 * The UI is grayscale: white chrome on near-black surfaces. The ONLY
 * color in the app is stamp ink — blue = posted, pink = caught — and it
 * appears solely where it carries that meaning (map pins, stamps,
 * caught badges, coverage wash). Color is meaning, never decoration.
 * Danger red survives for destructive actions only.
 */

/** The act inks — the only color in the app. Blue is the invitation
 * (posted), pink is the prestige ink (caught, the verified act). */
export const ink = {
    posted: '#5A93D4',
    caught: '#C468E0',
} as const

export const colors = {
    // Backgrounds
    background: '#0a0a0a', // Near black
    card: '#1c1c1e', // Dark gray
    cardBackground: '#1c1c1e', // Alias for card
    cardElevated: '#2c2c2e', // Slightly lighter gray for badges/buttons
    surface: '#1c1c1e', // Standard surface color

    // Chrome accents — monochrome. Anything interactive/active is white
    // ink, not blue. Pair `primary` backgrounds with inverseTextPrimary.
    primary: '#ececee', // White ink - primary actions, active states
    secondary: ink.caught, // SEMANTIC: caught state only, never decoration
    accent: ink.caught, // SEMANTIC: caught state only
    danger: '#FF3B30', // iOS red - delete/destructive actions

    // Caught State Indicators
    caughtBadge: ink.caught, // Pink badge background (caught semantic)
    caughtBadgeText: '#ffffff', // White text on badge

    // Map Pin Colors
    pinDefault: ink.posted, // Blue ink - uncaught posts
    pinCaught: ink.caught, // Pink ink - caught by user
    pinSelected: ink.caught, // Pink ink - currently selected
    pinLostPlace: '#C9A94F', // Muted gold - lost places (currently unused on map)
    userLocation: '#ececee', // White - user's location puck (not act-semantic)

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

    // Status (toasts, banners) — monochrome: outcome is carried by copy
    // and icon, not hue. Only danger/error keep red.
    success: '#ececee',
    warning: '#ececee',
    info: '#ececee',

    // Icon states
    iconInactive: '#98989f',
    iconActive: '#ececee', // Same as primary for consistency
}
