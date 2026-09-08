/**
 * The "document layer" — the visual language of Catch's travel-document
 * surfaces (passport book, stamps, payoff cards, postcards, postmarks).
 *
 * Deliberately minimal: system type at quiet weights, hairline rules,
 * muted ink. No custom typeface — distinctness comes from material and
 * restraint, not lettering.
 */

import { colors } from '@/theme/colors'

// The act inks — single-sourced from the theme (the only color in the
// monochrome app). Re-exported here so document surfaces keep reading
// from the document layer.
export { ink as documentInk } from '@/theme/colors'

// Applied once at the stamp container level — never per-text — so ring,
// rule, and lettering mute together like real ink.
export const INK_OPACITY = 0.7

export const HAIRLINE = 1

export const paper = {
    surface: colors.cardElevated,
    /** Dashed mid-page guide line */
    guide: 'rgba(255, 255, 255, 0.12)',
    /** Center spine crease — slightly stronger, it's structural */
    crease: 'rgba(255, 255, 255, 0.18)',
} as const

export const cover = {
    background: '#12233c',
    gold: '#c2a55c',
} as const

/** Off-white print stock — photos on document surfaces are mounted like
 * physical prints (thicker bottom edge), not shown as bare app images */
export const PRINT_PAPER = '#f2eee4'

// System font, restrained spacing. Stamp cities stay uppercase at the
// call sites because physical stamps are — the type itself is quiet.
export const documentType = {
    stampCity: {
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: 1,
    },
    stampDate: {
        fontSize: 10,
        fontWeight: '500',
        letterSpacing: 0.5,
    },
    label: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.5,
    },
} as const
