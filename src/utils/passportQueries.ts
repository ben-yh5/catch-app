/**
 * Passport data queries
 *
 * Own passport reads user_coverage/{uid}.cities directly (owner-only
 * rule); other users' passports go through the getPassport callable, which
 * returns only the cities map — never the cells5/cells6 geohash arrays
 * that share the doc — and honors `passportPublic`.
 *
 * Separate from coverageQueries.ts on purpose: that module session-caches
 * the cells for map rendering, while passport data should be fresh on open.
 */

import { db, functions } from '@/services/firebase'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'

export interface CityStamp {
    key: string
    country: string
    city: string
    posted: number
    caught: number
    pioneers: number
    lastActivity: Date | null
}

export interface PassportData {
    cities: CityStamp[]
    countryCount: number
    cityCount: number
    pioneerCount: number
}

function shapeCities(raw: Record<string, any>): PassportData {
    const cities: CityStamp[] = Object.entries(raw).map(([key, value]) => ({
        key,
        country: value.country,
        city: value.city,
        posted: value.posted || 0,
        caught: value.caught || 0,
        pioneers: value.pioneers || 0,
        lastActivity: value.lastActivity?.toDate?.() ?? null,
    }))

    cities.sort((a, b) => b.caught + b.posted - (a.caught + a.posted))

    return {
        cities,
        countryCount: new Set(cities.map((c) => c.country)).size,
        cityCount: cities.length,
        pioneerCount: cities.reduce((sum, c) => sum + c.pioneers, 0),
    }
}

/**
 * Fetch your own city stamps, sorted by activity (most caught+posted
 * first). Rules only allow reading your own user_coverage doc.
 */
export async function getPassportData(userId: string): Promise<PassportData> {
    const snap = await getDoc(doc(db, 'user_coverage', userId))
    return shapeCities(snap.exists() ? snap.data().cities || {} : {})
}

/**
 * Fetch another user's city stamps via the getPassport callable.
 * Throws with code 'functions/permission-denied' when the owner has set
 * their passport private.
 */
export async function getPublicPassportData(
    userId: string
): Promise<PassportData> {
    const getPassportFn = httpsCallable(functions, 'getPassport')
    const result = await getPassportFn({ userId })
    const cities: any[] = (result.data as any)?.cities || []
    return shapeCities(
        Object.fromEntries(cities.map((c) => [c.key, c]))
    )
}
