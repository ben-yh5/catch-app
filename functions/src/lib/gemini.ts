import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * Auto-tracking alias for the current Flash model (vision tagging + query
 * expansion). A pinned version ('gemini-2.0-flash') was retired by Google
 * in 2026 and started returning 404s in production — the alias prevents a
 * model retirement from silently breaking enrichment again.
 */
export const GEMINI_FLASH_MODEL = 'gemini-flash-latest'

// Gemini SDK (lazy-init to avoid cold start cost when unused)
let genAI: GoogleGenerativeAI | null = null

export function getGenAI(): GoogleGenerativeAI {
    if (!genAI) {
        const key = process.env.GEMINI_API_KEY
        if (!key) throw new Error('GEMINI_API_KEY not set')
        genAI = new GoogleGenerativeAI(key)
    }
    return genAI
}
