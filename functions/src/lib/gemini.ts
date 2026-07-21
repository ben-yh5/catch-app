import { GoogleGenerativeAI } from '@google/generative-ai'

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
