import * as admin from 'firebase-admin'

/**
 * Increment coverage cell counts for a post's geohash and update user coverage.
 * Called during onPostCreated for both originals and catches.
 *
 * `postCount` counts every shot (originals + catches); `originalCount`
 * counts originals only — it drives the map's cluster bubbles, which must
 * match the number of pins a player finds after zooming in.
 */
export async function updateCoverageCells(
    db: admin.firestore.Firestore,
    geohash: string,
    authorId: string,
    isOriginal: boolean
): Promise<void> {
    const gh5 = geohash.substring(0, 5)
    const gh6 = geohash.substring(0, 6)

    const cellUpdate = (gh: string, precision: number) => {
        const update: Record<string, unknown> = {
            geohash: gh,
            precision,
            postCount: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }
        if (isOriginal) {
            update.originalCount = admin.firestore.FieldValue.increment(1)
        }
        return update
    }

    const batch = db.batch()

    batch.set(db.collection('geohash_cells').doc(`p5_${gh5}`), cellUpdate(gh5, 5), {
        merge: true,
    })

    batch.set(db.collection('geohash_cells').doc(`p6_${gh6}`), cellUpdate(gh6, 6), {
        merge: true,
    })

    batch.set(
        db.collection('user_coverage').doc(authorId),
        {
            cells5: admin.firestore.FieldValue.arrayUnion(gh5),
            cells6: admin.firestore.FieldValue.arrayUnion(gh6),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    )

    await batch.commit()
}

/**
 * Build the map key for a passport city entry. Firestore field names may not
 * contain `~ * / [ ]`, and geocoded place names occasionally do.
 */
export function passportCityKey(country: string, city: string): string {
    const clean = (s: string) => s.replace(/[~*/[\]]/g, '-')
    return `${clean(country)}|${clean(city)}`
}

/**
 * Record passport city activity on user_coverage/{userId}.cities.
 * Called during onPostCreated (best-effort) — posted/pioneers for originals,
 * caught for catches. Like the coverage cells above, passport stamps are
 * permanent: onPostDeleted does not decrement them (deleting a post doesn't
 * un-visit the place). backfillCoverage rebuilds them from surviving posts.
 */
export async function recordPassportCity(
    db: admin.firestore.Firestore,
    userId: string,
    entry: {
        country: string
        city: string
        posted?: number
        caught?: number
        pioneers?: number
    }
): Promise<void> {
    const stats: Record<string, unknown> = {
        country: entry.country,
        city: entry.city,
        lastActivity: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (entry.posted) {
        stats.posted = admin.firestore.FieldValue.increment(entry.posted)
    }
    if (entry.caught) {
        stats.caught = admin.firestore.FieldValue.increment(entry.caught)
    }
    if (entry.pioneers) {
        stats.pioneers = admin.firestore.FieldValue.increment(entry.pioneers)
    }

    await db
        .collection('user_coverage')
        .doc(userId)
        .set(
            { cities: { [passportCityKey(entry.country, entry.city)]: stats } },
            { merge: true }
        )
}

/**
 * Decrement coverage cell counts for a post's geohash.
 * Called during onPostDeleted. Does not affect user_coverage (coverage is permanent).
 */
export async function decrementCoverageCells(
    db: admin.firestore.Firestore,
    geohash: string,
    wasOriginal: boolean
): Promise<void> {
    const gh5 = geohash.substring(0, 5)
    const gh6 = geohash.substring(0, 6)

    const cellUpdate: Record<string, unknown> = {
        postCount: admin.firestore.FieldValue.increment(-1),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (wasOriginal) {
        cellUpdate.originalCount = admin.firestore.FieldValue.increment(-1)
    }

    const batch = db.batch()

    batch.set(db.collection('geohash_cells').doc(`p5_${gh5}`), cellUpdate, {
        merge: true,
    })

    batch.set(db.collection('geohash_cells').doc(`p6_${gh6}`), cellUpdate, {
        merge: true,
    })

    await batch.commit()
}
