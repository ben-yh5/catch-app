import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import { MAX_INSTANCES } from '../lib/constants'

/**
 * HTTPS Callable Function: Atomically sets up a username for a new user
 *
 * Prevents TOCTOU race condition where two users could claim the same username.
 * Uses a `usernames` collection as a uniqueness index with document ID = lowercase username.
 * Runs inside a Firestore transaction so check + create is atomic.
 *
 * @param data.username - The desired username
 * @returns Object with success status
 */
export const setupUsername = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to set up username'
            )
        }

        // Server-side mirror of the client's verify-email gate: password
        // accounts must verify their email before claiming a (permanent,
        // unique) username. Google/Apple tokens arrive pre-verified.
        if (
            context.auth.token.firebase?.sign_in_provider === 'password' &&
            context.auth.token.email_verified !== true
        ) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Verify your email address before setting up your account'
            )
        }

        const { username } = data

        if (!username || typeof username !== 'string') {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Username is required'
            )
        }

        // Server-side format validation (mirrors client-side rules)
        const trimmed = username.trim()
        if (trimmed.length < 3 || trimmed.length > 20) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Username must be 3-20 characters'
            )
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Username can only contain letters, numbers, underscores, and hyphens'
            )
        }

        const db = admin.firestore()
        const uid = context.auth.uid
        const usernameLower = trimmed.toLowerCase()

        try {
            await db.runTransaction(async (transaction) => {
                // Check if user already has a document (prevent double setup)
                const userRef = db.collection('users').doc(uid)
                const userDoc = await transaction.get(userRef)
                if (userDoc.exists) {
                    throw new functions.https.HttpsError(
                        'already-exists',
                        'User account already set up'
                    )
                }

                // Check username uniqueness via the usernames index
                const usernameRef = db
                    .collection('usernames')
                    .doc(usernameLower)
                const usernameDoc = await transaction.get(usernameRef)
                if (usernameDoc.exists) {
                    throw new functions.https.HttpsError(
                        'already-exists',
                        'Username is already taken'
                    )
                }

                // Atomically claim the username and create the user document
                transaction.set(usernameRef, { uid })
                transaction.set(userRef, {
                    username: trimmed,
                    email: context.auth!.token.email || '',
                    totalPosts: 0,
                    totalCatches: 0,
                    followers: [],
                    following: [],
                    pushToken: null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                })
            })

            return { success: true }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) {
                throw error
            }
            functions.logger.error('Error setting up username:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to set up username'
            )
        }
    })

/**
 * HTTPS Callable Function: Atomically follows a user
 *
 * Updates both the current user's `following` array and the target user's `followers` array
 * in a single transaction, ensuring consistency. Also prevents self-follow.
 *
 * @param data.targetUserId - The user ID to follow
 * @returns Object with success status
 */
export const followUser = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to follow a user'
            )
        }

        const { targetUserId } = data
        const currentUserId = context.auth.uid

        if (!targetUserId || typeof targetUserId !== 'string') {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Target user ID is required'
            )
        }

        if (targetUserId === currentUserId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Cannot follow yourself'
            )
        }

        const db = admin.firestore()

        try {
            await db.runTransaction(async (transaction) => {
                const currentUserRef = db.collection('users').doc(currentUserId)
                const targetUserRef = db.collection('users').doc(targetUserId)

                const [currentUserDoc, targetUserDoc] = await Promise.all([
                    transaction.get(currentUserRef),
                    transaction.get(targetUserRef),
                ])

                if (!currentUserDoc.exists) {
                    throw new functions.https.HttpsError(
                        'not-found',
                        'Your user account was not found'
                    )
                }
                if (!targetUserDoc.exists) {
                    throw new functions.https.HttpsError(
                        'not-found',
                        'Target user not found'
                    )
                }

                // arrayUnion is idempotent — always write both sides to self-heal any inconsistency
                transaction.update(currentUserRef, {
                    following:
                        admin.firestore.FieldValue.arrayUnion(targetUserId),
                })
                transaction.update(targetUserRef, {
                    followers:
                        admin.firestore.FieldValue.arrayUnion(currentUserId),
                })
            })

            return { success: true }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) {
                throw error
            }
            functions.logger.error('Error following user:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to follow user'
            )
        }
    })

/**
 * HTTPS Callable Function: Atomically unfollows a user
 *
 * Updates both the current user's `following` array and the target user's `followers` array
 * in a single transaction, ensuring consistency.
 *
 * @param data.targetUserId - The user ID to unfollow
 * @returns Object with success status
 */
export const unfollowUser = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to unfollow a user'
            )
        }

        const { targetUserId } = data
        const currentUserId = context.auth.uid

        if (!targetUserId || typeof targetUserId !== 'string') {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Target user ID is required'
            )
        }

        const db = admin.firestore()

        try {
            await db.runTransaction(async (transaction) => {
                const currentUserRef = db.collection('users').doc(currentUserId)
                const targetUserRef = db.collection('users').doc(targetUserId)

                const [currentUserDoc, targetUserDoc] = await Promise.all([
                    transaction.get(currentUserRef),
                    transaction.get(targetUserRef),
                ])

                if (!currentUserDoc.exists) {
                    throw new functions.https.HttpsError(
                        'not-found',
                        'Your user account was not found'
                    )
                }
                if (!targetUserDoc.exists) {
                    throw new functions.https.HttpsError(
                        'not-found',
                        'Target user not found'
                    )
                }

                // arrayRemove is idempotent — always write both sides to self-heal any inconsistency
                transaction.update(currentUserRef, {
                    following:
                        admin.firestore.FieldValue.arrayRemove(targetUserId),
                })
                transaction.update(targetUserRef, {
                    followers:
                        admin.firestore.FieldValue.arrayRemove(currentUserId),
                })
            })

            return { success: true }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) {
                throw error
            }
            functions.logger.error('Error unfollowing user:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to unfollow user'
            )
        }
    })

// ─── Report User ────────────────────────────────────────────────────────────

export const reportUser = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to report a user'
            )
        }

        const { targetUserId, reason, details } = data
        const reporterId = context.auth.uid

        functions.logger.info('[reportUser] Received data:', {
            targetUserId,
            reason,
            details: typeof details,
            reporterId,
        })

        if (!targetUserId || typeof targetUserId !== 'string') {
            functions.logger.warn(
                '[reportUser] Invalid targetUserId:',
                targetUserId
            )
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Target user ID is required'
            )
        }

        if (targetUserId === reporterId) {
            functions.logger.warn('[reportUser] Self-report attempt')
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Cannot report yourself'
            )
        }

        const VALID_REASONS = [
            'harassment',
            'spam',
            'impersonation',
            'inappropriate_content',
            'other',
        ]
        if (!reason || !VALID_REASONS.includes(reason)) {
            functions.logger.warn('[reportUser] Invalid reason:', reason)
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Invalid report reason'
            )
        }

        const sanitizedDetails =
            typeof details === 'string' ? details.trim().slice(0, 500) : ''

        try {
            const db = admin.firestore()

            const targetDoc = await db
                .collection('users')
                .doc(targetUserId)
                .get()
            if (!targetDoc.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'User not found'
                )
            }

            const existingReport = await db
                .collection('reports')
                .where('reporterId', '==', reporterId)
                .where('targetUserId', '==', targetUserId)
                .where('targetType', '==', 'user')
                .limit(1)
                .get()

            if (!existingReport.empty) {
                throw new functions.https.HttpsError(
                    'already-exists',
                    'You have already reported this user'
                )
            }

            await db.collection('reports').add({
                reporterId,
                targetUserId,
                targetType: 'user',
                reason,
                details: sanitizedDetails,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })

            functions.logger.info(
                `[reportUser] User ${reporterId} reported user ${targetUserId} for ${reason}`
            )
            return { success: true }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) {
                throw error
            }
            functions.logger.error('Error reporting user:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to submit report'
            )
        }
    })

/**
 * HTTPS Callable Function: Reports a post for objectionable content
 *
 * Mirrors reportUser but targets a specific post. The report records both the
 * post and its author so moderation can act on either. One report per
 * reporter per post.
 *
 * @param data.targetPostId - The post ID to report
 * @param data.reason - One of the valid report reasons
 * @param data.details - Optional free-text details (max 500 chars)
 * @returns Object with success status
 */
export const reportPost = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to report a post'
            )
        }

        const { targetPostId, reason, details } = data
        const reporterId = context.auth.uid

        if (!targetPostId || typeof targetPostId !== 'string') {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Target post ID is required'
            )
        }

        const VALID_REASONS = [
            'harassment',
            'spam',
            'impersonation',
            'inappropriate_content',
            'other',
        ]
        if (!reason || !VALID_REASONS.includes(reason)) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Invalid report reason'
            )
        }

        const sanitizedDetails =
            typeof details === 'string' ? details.trim().slice(0, 500) : ''

        try {
            const db = admin.firestore()

            const postDoc = await db
                .collection('posts')
                .doc(targetPostId)
                .get()
            if (!postDoc.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'Post not found'
                )
            }

            const postAuthorId = postDoc.data()?.authorId
            if (postAuthorId === reporterId) {
                throw new functions.https.HttpsError(
                    'invalid-argument',
                    'Cannot report your own post'
                )
            }

            const existingReport = await db
                .collection('reports')
                .where('reporterId', '==', reporterId)
                .where('targetPostId', '==', targetPostId)
                .where('targetType', '==', 'post')
                .limit(1)
                .get()

            if (!existingReport.empty) {
                throw new functions.https.HttpsError(
                    'already-exists',
                    'You have already reported this post'
                )
            }

            await db.collection('reports').add({
                reporterId,
                targetPostId,
                targetUserId: postAuthorId ?? null,
                targetType: 'post',
                reason,
                details: sanitizedDetails,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            })

            functions.logger.info(
                `[reportPost] User ${reporterId} reported post ${targetPostId} for ${reason}`
            )
            return { success: true }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) {
                throw error
            }
            functions.logger.error('Error reporting post:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to submit report'
            )
        }
    })

/**
 * HTTPS Callable Function: Blocks a user
 *
 * Adds the target to the caller's `blockedUsers` array and severs any
 * follow relationship in both directions, all in one transaction.
 * `blockedUsers` is only writable through this function (client-side rules
 * block it), and blocking is one-sided: the target is not notified and
 * their doc doesn't record who blocked them.
 *
 * @param data.targetUserId - The user ID to block
 * @returns Object with success status
 */
export const blockUser = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to block a user'
            )
        }

        const { targetUserId } = data
        const currentUserId = context.auth.uid

        if (!targetUserId || typeof targetUserId !== 'string') {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Target user ID is required'
            )
        }

        if (targetUserId === currentUserId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Cannot block yourself'
            )
        }

        const db = admin.firestore()

        try {
            await db.runTransaction(async (transaction) => {
                const currentUserRef = db.collection('users').doc(currentUserId)
                const targetUserRef = db.collection('users').doc(targetUserId)

                const [currentUserDoc, targetUserDoc] = await Promise.all([
                    transaction.get(currentUserRef),
                    transaction.get(targetUserRef),
                ])

                if (!currentUserDoc.exists) {
                    throw new functions.https.HttpsError(
                        'not-found',
                        'Your user account was not found'
                    )
                }
                if (!targetUserDoc.exists) {
                    throw new functions.https.HttpsError(
                        'not-found',
                        'Target user not found'
                    )
                }

                transaction.update(currentUserRef, {
                    blockedUsers:
                        admin.firestore.FieldValue.arrayUnion(targetUserId),
                    following:
                        admin.firestore.FieldValue.arrayRemove(targetUserId),
                    followers:
                        admin.firestore.FieldValue.arrayRemove(targetUserId),
                })
                transaction.update(targetUserRef, {
                    following:
                        admin.firestore.FieldValue.arrayRemove(currentUserId),
                    followers:
                        admin.firestore.FieldValue.arrayRemove(currentUserId),
                })
            })

            functions.logger.info(
                `[blockUser] ${currentUserId} blocked ${targetUserId}`
            )
            return { success: true }
        } catch (error: any) {
            if (error instanceof functions.https.HttpsError) {
                throw error
            }
            functions.logger.error('Error blocking user:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to block user'
            )
        }
    })

/**
 * HTTPS Callable Function: Unblocks a user
 *
 * Removes the target from the caller's `blockedUsers` array. Follow
 * relationships are NOT restored — the user can re-follow manually.
 *
 * @param data.targetUserId - The user ID to unblock
 * @returns Object with success status
 */
export const unblockUser = functions
    .runWith({ maxInstances: MAX_INSTANCES.DEFAULT })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to unblock a user'
            )
        }

        const { targetUserId } = data
        const currentUserId = context.auth.uid

        if (!targetUserId || typeof targetUserId !== 'string') {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Target user ID is required'
            )
        }

        try {
            await admin
                .firestore()
                .collection('users')
                .doc(currentUserId)
                .update({
                    blockedUsers:
                        admin.firestore.FieldValue.arrayRemove(targetUserId),
                })

            functions.logger.info(
                `[unblockUser] ${currentUserId} unblocked ${targetUserId}`
            )
            return { success: true }
        } catch (error: any) {
            functions.logger.error('Error unblocking user:', error)
            throw new functions.https.HttpsError(
                'internal',
                'Failed to unblock user'
            )
        }
    })

// ─── Account Deletion ───────────────────────────────────────────────────────

/**
 * HTTPS Callable Function: Permanently deletes a user's account and all associated data
 *
 * Deletion order:
 * 1. All user's posts (triggers onPostDeleted for thread promotion, cleanup)
 * 2. Remove from other users' followers/following arrays
 * 3. User's lists
 * 4. Notifications subcollection
 * 5. user_recommendations, usernames index, training_pairs
 * 6. Storage files
 * 7. User document
 * 8. Firebase Auth account (last)
 */
export const deleteAccount = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '512MB',
        maxInstances: MAX_INSTANCES.DEFAULT,
    })
    .https.onCall(async (_data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Must be logged in to delete account'
            )
        }

        const userId = context.auth.uid
        const db = admin.firestore()
        const bucket = admin.storage().bucket()

        functions.logger.info(
            `[deleteAccount] Starting account deletion for user ${userId}`
        )

        // Data-deletion steps are individually caught so one failure doesn't
        // skip the rest, but every failure is recorded — the irreversible
        // steps (user doc + Auth account) only run if ALL data steps
        // succeeded. Otherwise we throw so the still-authenticated client can
        // retry; completed steps are idempotent.
        const failedSteps: string[] = []

        // Read user doc first to get username for cleanup later
        let username: string | null = null
        try {
            const userDoc = await db.collection('users').doc(userId).get()
            if (userDoc.exists) {
                username = userDoc.data()?.username?.toLowerCase() || null
            }
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error reading user doc:',
                error
            )
            // Without the username we can't free the usernames/{name} index
            failedSteps.push('read-user-doc')
        }

        // 1. Delete all user's posts (onPostDeleted handles thread promotion, location cleanup, list removal)
        try {
            const postsQuery = await db
                .collection('posts')
                .where('authorId', '==', userId)
                .get()

            functions.logger.info(
                `[deleteAccount] Deleting ${postsQuery.size} posts`
            )
            for (const postDoc of postsQuery.docs) {
                await postDoc.ref.delete()
            }
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error deleting posts:',
                error
            )
            failedSteps.push('posts')
        }

        // 2. Remove from other users' followers arrays
        try {
            const followersQuery = await db
                .collection('users')
                .where('followers', 'array-contains', userId)
                .get()

            if (!followersQuery.empty) {
                const batches: admin.firestore.WriteBatch[] = [db.batch()]
                let opCount = 0
                for (const doc of followersQuery.docs) {
                    if (opCount >= 500) {
                        batches.push(db.batch())
                        opCount = 0
                    }
                    batches[batches.length - 1].update(doc.ref, {
                        followers:
                            admin.firestore.FieldValue.arrayRemove(userId),
                    })
                    opCount++
                }
                for (const batch of batches) {
                    await batch.commit()
                }
                functions.logger.info(
                    `[deleteAccount] Removed from ${followersQuery.size} users' followers`
                )
            }
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error cleaning followers:',
                error
            )
            failedSteps.push('followers')
        }

        // 3. Remove from other users' following arrays
        try {
            const followingQuery = await db
                .collection('users')
                .where('following', 'array-contains', userId)
                .get()

            if (!followingQuery.empty) {
                const batches: admin.firestore.WriteBatch[] = [db.batch()]
                let opCount = 0
                for (const doc of followingQuery.docs) {
                    if (opCount >= 500) {
                        batches.push(db.batch())
                        opCount = 0
                    }
                    batches[batches.length - 1].update(doc.ref, {
                        following:
                            admin.firestore.FieldValue.arrayRemove(userId),
                    })
                    opCount++
                }
                for (const batch of batches) {
                    await batch.commit()
                }
                functions.logger.info(
                    `[deleteAccount] Removed from ${followingQuery.size} users' following`
                )
            }
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error cleaning following:',
                error
            )
            failedSteps.push('following')
        }

        // 4. Delete user's lists
        try {
            const listsQuery = await db
                .collection('lists')
                .where('userId', '==', userId)
                .get()

            if (!listsQuery.empty) {
                const batches: admin.firestore.WriteBatch[] = [db.batch()]
                let opCount = 0
                for (const doc of listsQuery.docs) {
                    if (opCount >= 500) {
                        batches.push(db.batch())
                        opCount = 0
                    }
                    batches[batches.length - 1].delete(doc.ref)
                    opCount++
                }
                for (const batch of batches) {
                    await batch.commit()
                }
                functions.logger.info(
                    `[deleteAccount] Deleted ${listsQuery.size} lists`
                )
            }
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error deleting lists:',
                error
            )
            failedSteps.push('lists')
        }

        // 5. Delete notifications subcollection
        try {
            const notifsQuery = await db
                .collection('users')
                .doc(userId)
                .collection('notifications')
                .get()

            if (!notifsQuery.empty) {
                const batches: admin.firestore.WriteBatch[] = [db.batch()]
                let opCount = 0
                for (const doc of notifsQuery.docs) {
                    if (opCount >= 500) {
                        batches.push(db.batch())
                        opCount = 0
                    }
                    batches[batches.length - 1].delete(doc.ref)
                    opCount++
                }
                for (const batch of batches) {
                    await batch.commit()
                }
                functions.logger.info(
                    `[deleteAccount] Deleted ${notifsQuery.size} notifications`
                )
            }
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error deleting notifications:',
                error
            )
            failedSteps.push('notifications')
        }

        // 6. Delete user_recommendations, username index
        try {
            await db.collection('user_recommendations').doc(userId).delete()
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error deleting recommendations:',
                error
            )
            failedSteps.push('recommendations')
        }

        if (username) {
            try {
                await db.collection('usernames').doc(username).delete()
                functions.logger.info(
                    `[deleteAccount] Deleted username index: ${username}`
                )
            } catch (error) {
                functions.logger.error(
                    '[deleteAccount] Error deleting username index:',
                    error
                )
                failedSteps.push('username-index')
            }
        }

        // 7. Delete training_pairs contributed by this user
        try {
            const trainingQuery = await db
                .collection('training_pairs')
                .where('userId', '==', userId)
                .get()

            if (!trainingQuery.empty) {
                const batches: admin.firestore.WriteBatch[] = [db.batch()]
                let opCount = 0
                for (const doc of trainingQuery.docs) {
                    if (opCount >= 500) {
                        batches.push(db.batch())
                        opCount = 0
                    }
                    batches[batches.length - 1].delete(doc.ref)
                    opCount++
                }
                for (const batch of batches) {
                    await batch.commit()
                }
                functions.logger.info(
                    `[deleteAccount] Deleted ${trainingQuery.size} training pairs`
                )
            }
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error deleting training pairs:',
                error
            )
            failedSteps.push('training-pairs')
        }

        // 8. Delete Storage files
        try {
            await bucket.deleteFiles({ prefix: `posts/${userId}/` })
            functions.logger.info(
                `[deleteAccount] Deleted Storage files for posts/${userId}/`
            )
        } catch (error) {
            functions.logger.error(
                '[deleteAccount] Error deleting storage files:',
                error
            )
            failedSteps.push('storage')
        }

        // Fail fast before the point of no return: deleting the user doc and
        // Auth account with data steps failed would orphan that data forever
        // (the user could never re-authenticate to retry). Throw instead —
        // the client stays signed in and can retry; completed steps are
        // idempotent.
        if (failedSteps.length > 0) {
            functions.logger.error(
                `[deleteAccount] Aborting before irreversible steps — failed: ${failedSteps.join(', ')}`
            )
            throw new functions.https.HttpsError(
                'internal',
                `Account data cleanup failed (${failedSteps.join(', ')}). Nothing irreversible was done — please try again.`
            )
        }

        // 9. Delete user document
        await db.collection('users').doc(userId).delete()
        functions.logger.info(`[deleteAccount] Deleted user document`)

        // 10. Delete Firebase Auth account (must be last)
        await admin.auth().deleteUser(userId)
        functions.logger.info(`[deleteAccount] Deleted Firebase Auth account`)

        functions.logger.info(
            `[deleteAccount] Account deletion complete for user ${userId}`
        )
        return { success: true }
    })
