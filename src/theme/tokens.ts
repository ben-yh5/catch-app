/**
 * Design tokens — spacing, typography, and radii scales.
 *
 * Use these instead of per-file literals so sizes stay consistent and can
 * be tuned in one place. Colors live in colors.ts.
 */

export const spacing = {
    /** 4 — hairline gaps, icon padding */
    xs: 4,
    /** 8 — tight gaps between related elements */
    sm: 8,
    /** 12 — default gap inside cards */
    md: 12,
    /** 16 — screen padding, list item padding */
    lg: 16,
    /** 24 — section padding */
    xl: 24,
    /** 32 — large section separation */
    xxl: 32,
}

export const typography = {
    /** 11 — fine print, badges */
    caption: 11,
    /** 13 — secondary metadata */
    small: 13,
    /** 15 — body text */
    body: 15,
    /** 17 — emphasized body, buttons */
    bodyLarge: 17,
    /** 20 — card titles */
    title: 20,
    /** 24 — section headers */
    heading: 24,
    /** 28 — screen titles */
    screenTitle: 28,
    /** 34 — hero moments (reveal, onboarding) */
    hero: 34,
}

export const radii = {
    /** 8 — small chips, inputs */
    sm: 8,
    /** 12 — cards, buttons */
    md: 12,
    /** 16 — large cards, sheets */
    lg: 16,
    /** 24 — pills, fully rounded search bars */
    pill: 24,
}

/** Minimum touch target size (Apple HIG / Material) */
export const MIN_TOUCH_TARGET = 44

/**
 * hitSlop preset for icon buttons whose visual size is below 44px —
 * expands the touchable area without changing layout.
 */
export const smallTargetHitSlop = { top: 10, bottom: 10, left: 10, right: 10 }
