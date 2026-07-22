import * as functions from 'firebase-functions'

/**
 * Restricts a callable function to a fixed set of admin UIDs, configured via
 * the ADMIN_UIDS env var (comma-separated). Fails closed: an unset or empty
 * env var denies everyone rather than defaulting to open.
 */
export function requireAdmin(context: functions.https.CallableContext): void {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Must be authenticated'
        )
    }

    const adminUids = (process.env.ADMIN_UIDS || '')
        .split(',')
        .map((uid) => uid.trim())
        .filter(Boolean)

    if (!adminUids.includes(context.auth.uid)) {
        functions.logger.warn(
            `[requireAdmin] Denied non-admin caller: ${context.auth.uid}`
        )
        throw new functions.https.HttpsError(
            'permission-denied',
            'Admin access required'
        )
    }
}
