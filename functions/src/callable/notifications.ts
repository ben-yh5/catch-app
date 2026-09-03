import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { MAX_INSTANCES } from '../lib/constants'

/**
 * HTTPS Callable Function: Marks all of the caller's notifications as read.
 *
 * Replaces the old client-side batch (which could only see the notifications
 * currently loaded on the device — capped at 100 by the client query) with a
 * server-side bulk update over the whole subcollection.
 *
 * @returns { updated: number } — how many notifications were marked read
 */
export const markAllNotificationsRead = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (_data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to mark notifications as read'
            )
        }

        const db = admin.firestore()
        const uid = context.auth.uid
        const BATCH_SIZE = 400 // stays under the 500-op batch limit

        let updated = 0
        // Loop until no unread remain — each pass queries fresh so
        // notifications arriving mid-run are picked up too
        while (true) {
            const snapshot = await db
                .collection('users')
                .doc(uid)
                .collection('notifications')
                .where('read', '==', false)
                .limit(BATCH_SIZE)
                .get()

            if (snapshot.empty) break

            const batch = db.batch()
            snapshot.docs.forEach((doc) => {
                batch.update(doc.ref, { read: true })
            })
            await batch.commit()
            updated += snapshot.size

            if (snapshot.size < BATCH_SIZE) break
        }

        return { updated }
    })
