import * as admin from 'firebase-admin'

/**
 * Increment coverage cell counts for a post's geohash and update user coverage.
 * Called during onPostCreated for both originals and catches.
 */
export async function updateCoverageCells(
    db: admin.firestore.Firestore,
    geohash: string,
    authorId: string
): Promise<void> {
    const gh5 = geohash.substring(0, 5)
    const gh6 = geohash.substring(0, 6)

    const batch = db.batch()

    batch.set(
        db.collection('geohash_cells').doc(`p5_${gh5}`),
        {
            geohash: gh5,
            precision: 5,
            postCount: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    )

    batch.set(
        db.collection('geohash_cells').doc(`p6_${gh6}`),
        {
            geohash: gh6,
            precision: 6,
            postCount: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    )

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
 * Decrement coverage cell counts for a post's geohash.
 * Called during onPostDeleted. Does not affect user_coverage (coverage is permanent).
 */
export async function decrementCoverageCells(
    db: admin.firestore.Firestore,
    geohash: string
): Promise<void> {
    const gh5 = geohash.substring(0, 5)
    const gh6 = geohash.substring(0, 6)

    const batch = db.batch()

    batch.set(
        db.collection('geohash_cells').doc(`p5_${gh5}`),
        {
            postCount: admin.firestore.FieldValue.increment(-1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    )

    batch.set(
        db.collection('geohash_cells').doc(`p6_${gh6}`),
        {
            postCount: admin.firestore.FieldValue.increment(-1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
    )

    await batch.commit()
}
