import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { MAX_INSTANCES } from '../lib/constants'

/**
 * HTTPS Callable Function: Returns a user's passport city stamps.
 *
 * Exists because user_coverage docs cannot be opened to client reads:
 * they also carry cells5/cells6 — precision-5/6 geohash cells of everywhere
 * the user has posted or caught — which is far finer-grained location
 * history than the city stamps. Only the cities map crosses the wire here,
 * and lastActivity is omitted (it can hint at current travel).
 *
 * Respects the owner's `passportPublic` setting (default public; only an
 * explicit false blocks). Owners always see their own passport, though the
 * client reads its own doc directly and doesn't normally call this.
 *
 * @param data.userId - The user whose passport to fetch
 * @returns { cities: Array<{ key, country, city, posted, caught, pioneers }> }
 */
export const getPassport = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to view passports'
            )
        }

        const targetUserId = data?.userId
        if (typeof targetUserId !== 'string' || targetUserId.length === 0) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'userId is required'
            )
        }

        const db = admin.firestore()

        if (targetUserId !== context.auth.uid) {
            const targetUser = await db
                .collection('users')
                .doc(targetUserId)
                .get()
            if (!targetUser.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'User not found'
                )
            }
            if (targetUser.data()?.passportPublic === false) {
                throw new functions.https.HttpsError(
                    'permission-denied',
                    'This passport is private'
                )
            }
        }

        const coverage = await db
            .collection('user_coverage')
            .doc(targetUserId)
            .get()
        const rawCities: Record<string, any> = coverage.exists
            ? coverage.data()?.cities || {}
            : {}

        const cities = Object.entries(rawCities).map(([key, value]) => ({
            key,
            country: value.country,
            city: value.city,
            posted: value.posted || 0,
            caught: value.caught || 0,
            pioneers: value.pioneers || 0,
        }))

        return { cities }
    })
