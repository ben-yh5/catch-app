/**
 * Color Theme
 *
 * Dark mode color palette for the Catch app.
 * Inspired by AllTrails with a focus on photo content.
 */

export const colors = {
    // Backgrounds
    background: '#0a0a0a', // Near black
    card: '#1c1c1e', // Dark gray
    cardBackground: '#1c1c1e', // Alias for card
    cardElevated: '#2c2c2e', // Slightly lighter gray for badges/buttons

    // Accents
    primary: '#007AFF', // iOS blue for primary actions
    secondary: '#CF2CF6', // Pink/purple for catches/trophies
    danger: '#FF3B30', // iOS red for delete/destructive actions

    // Text
    textPrimary: '#ffffff', // White
    textSecondary: '#e5e5e7', // Light gray
    textTertiary: '#98989f', // Medium gray

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
