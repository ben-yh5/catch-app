import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { sendPushNotification } from '../lib/notifications'

/**
 * Firestore Trigger: Handles new follower notifications
 *
 * Detects when a user gains new followers by comparing before/after states
 * of the followers array, then sends a push notification for each new follower
 */
export const onUserFollowed = functions.firestore
    .document('users/{userId}')
    .onUpdate(async (change, context) => {
        const userId = context.params.userId
        const beforeData = change.before.data()
        const afterData = change.after.data()

        const beforeFollowers = beforeData.followers || []
        const afterFollowers = afterData.followers || []

        // Find new followers added to the array
        const newFollowers = afterFollowers.filter(
            (followerId: string) => !beforeFollowers.includes(followerId)
        )

        if (newFollowers.length === 0) {
            return
        }

        const db = admin.firestore()

        // Create notification docs for each new follower
        for (const followerId of newFollowers) {
            try {
                functions.logger.info(
                    `[onUserFollowed] Creating follow notification for user ${userId} from ${followerId}`
                )
                await db
                    .collection('users')
                    .doc(userId)
                    .collection('notifications')
                    .add({
                        type: 'follow',
                        fromUserId: followerId,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        read: false,
                    })
                functions.logger.info(
                    `[onUserFollowed] Successfully created follow notification`
                )
            } catch (e) {
                functions.logger.error(
                    `[onUserFollowed] Failed to create follow notification`,
                    e
                )
            }
        }

        const pushToken = afterData.pushToken
        if (!pushToken) {
            functions.logger.info(
                `User ${userId} has no push token, skipping notification`
            )
            return
        }

        for (const followerId of newFollowers) {
            try {
                const followerDoc = await admin
                    .firestore()
                    .collection('users')
                    .doc(followerId)
                    .get()

                if (!followerDoc.exists) {
                    functions.logger.warn(`Follower ${followerId} not found`)
                    continue
                }

                const followerData = followerDoc.data()
                const followerUsername = followerData?.username || 'Someone'

                await sendPushNotification(
                    pushToken,
                    'New Follower',
                    `@${followerUsername} started following you!`,
                    {
                        userId: followerId,
                        type: 'new_follower',
                    }
                )

                functions.logger.info(
                    `Sent follower notification to user ${userId} for follower ${followerId}`
                )
            } catch (error) {
                functions.logger.error(
                    `Error sending notification for follower ${followerId}:`,
                    error
                )
            }
        }
    })
