import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

/**
 * Helper function to send push notifications via Firebase Cloud Messaging
 *
 * Supports both Android (FCM) and iOS (APNs) with platform-specific options
 *
 * @param pushToken - Device push token from user document
 * @param title - Notification title
 * @param body - Notification message body
 * @param data - Optional data payload for deep linking and custom handling
 */
export async function sendPushNotification(
    pushToken: string,
    title: string,
    body: string,
    data?: any
) {
    try {
        const message: admin.messaging.Message = {
            notification: {
                title,
                body,
            },
            data: data || {},
            token: pushToken,
            android: {
                priority: 'high',
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                    },
                },
            },
        }

        const result = await admin.messaging().send(message)
        functions.logger.info('Push notification sent:', result)
        return result
    } catch (error) {
        functions.logger.error('Error sending push notification:', error)
        throw error
    }
}
