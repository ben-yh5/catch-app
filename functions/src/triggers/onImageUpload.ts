import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import sharp = require('sharp')
import { MAX_INSTANCES } from '../lib/constants'

/**
 * Cloud Function: Automatic Image Resizing
 *
 * Triggered when a new image is uploaded to Firebase Storage.
 * Generates:
 * 1. Thumbnail (200x200) - suffixed with '_thumb'
 * 2. Medium (600x600) - suffixed with '_medium'
 *
 * Updates the Firestore document with the new URLs.
 */
export const onImageUpload = functions
    .runWith({ memory: '1GB', maxInstances: MAX_INSTANCES.DEFAULT })
    .storage.object()
    .onFinalize(async (object) => {
        const fileBucket = object.bucket
        const filePath = object.name
        const contentType = object.contentType

        // Exit if this is triggered on a file that is not an image.
        if (!contentType || !contentType.startsWith('image/')) {
            functions.logger.log('This is not an image.')
            return
        }

        // Exit if the image is already a thumbnail.
        if (
            !filePath ||
            filePath.includes('_thumb') ||
            filePath.includes('_medium')
        ) {
            functions.logger.log('Already a resized image.')
            return
        }

        // Only process images in the 'posts' folder
        if (!filePath.startsWith('posts/')) {
            functions.logger.log('Not a post image.')
            return
        }

        const fileName = path.basename(filePath)
        const bucket = admin.storage().bucket(fileBucket)
        const tempFilePath = path.join(os.tmpdir(), fileName)

        // Create temp working directory
        const workingDir = path.join(os.tmpdir(), 'thumbs')
        await fs.ensureDir(workingDir)

        const thumbName = fileName.replace(/(\.[\w\d_-]+)$/i, '_thumb$1')
        const thumbPath = path.join(workingDir, thumbName)
        const mediumName = fileName.replace(/(\.[\w\d_-]+)$/i, '_medium$1')
        const mediumPath = path.join(workingDir, mediumName)

        // Storage destinations
        const thumbStoragePath = path.join(path.dirname(filePath), thumbName)
        const mediumStoragePath = path.join(path.dirname(filePath), mediumName)

        try {
            // 1. Download file
            await bucket.file(filePath).download({ destination: tempFilePath })
            functions.logger.log('Image downloaded locally to', tempFilePath)

            // 2. Generate Thumbnail (200x200)
            await sharp(tempFilePath)
                .resize(200, 200, { fit: 'cover' })
                .toFile(thumbPath)

            // 3. Generate Medium (600x600)
            await sharp(tempFilePath)
                .resize(600, 600, { fit: 'cover' })
                .toFile(mediumPath)

            // 4. Upload resized images
            await bucket.upload(thumbPath, {
                destination: thumbStoragePath,
                metadata: {
                    contentType: contentType,
                    cacheControl: 'public, max-age=31536000', // Cache for 1 year
                },
            })

            await bucket.upload(mediumPath, {
                destination: mediumStoragePath,
                metadata: {
                    contentType: contentType,
                    cacheControl: 'public, max-age=31536000',
                },
            })

            functions.logger.log('Thumbnails created and uploaded.')

            // 5. Update Firestore
            // We know the structure is posts/{userId}/{filename}
            // But the document ID is not the filename. We need to find the post document that references this image.
            // Wait, normally we store the image path or URL in the doc.
            // In useCatchFlow.ts:
            // const filename = `posts/${user.uid}/catch_${Date.now()}.jpg`;
            // const postData = { ... photoURL ... }

            // Since we don't have the postId cleanly in the filename, we have to query for it.
            // This is a bit inefficient (O(N) query for the specific URL).
            // Strategy:
            // A better approach would be to have the filename include the postId, but that requires client changes.
            // For now, let's query posts where photoURL contains the filename.
            // Or better, query by exact photoURL.

            // Reconstruct the photoURL to query

            // Note: The client uses getDownloadURL from firebase SDK, which returns a tokenized URL.
            // We can't easily guess that token.
            // However, we can construct the storage path "gs://bucket/posts/..." or the http url without token.
            // Let's search by the storage path if possible, but the client stores the full HTTP URL.

            // Alternative: The client stores the data.
            // Let's try to parse the userId from the path 'posts/{userId}/{filename}'
            // And then we can update the post. But we don't know *which* post ID it is.
            // One user might have many posts.

            // QUICK FIX: Query 'posts' collection where 'photoURL' contains the encoded filename.
            // The filename in URL is URL-encoded.

            // Actually, searching by substring is not possible in Firestore.
            // We need to match the exact field.

            // Let's try to query by just 'authorId' (which we have from path) and sort by 'createdAt' desc.
            // The most recent post by this user is likely the one.
            // But this is race-condition prone.

            // REVISED STRATEGY:
            // Since we are "patching" the system, we can't easily query by URL due to tokens.
            // BUT, the client calls `getDownloadURL` *after* upload.
            // The *safest* way to do this without changing the upload flow too much is to have the client
            // save the storage path, OR we accept that we might need to scan.

            // Actually, if we look at `useCatchFlow.ts` again:
            // const filename = `posts/${user.uid}/catch_${Date.now()}.jpg`;
            // ...
            // const postData = { ... photoURL, ... }

            // If we can't reliably find the doc, we might have to skip the Firestore update here and let the client do it?
            // No, client controls upload.

            // WAIT. We can use the fact that the filename is unique.
            // If we store `storagePath` in the post doc, it would be easy.
            // Existing posts don't have `storagePath`.

            // Workaround: We will simply iterate over the user's recent posts (limit 5) and check if `photoURL` contains the filename.
            // Filenames are unique timestamps so this is safe.

            const pathParts = filePath.split('/')
            const userId = pathParts[1] // posts/{userId}/{filename}

            const postsRef = admin.firestore().collection('posts')
            const snapshot = await postsRef
                .where('authorId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(10) // Check last 10 posts
                .get()

            let matchDoc = null

            // The photoURL in Firestore is a download URL:
            // https://firebasestorage.googleapis.com/.../posts%2FUSERID%2Ffilename.jpg?alt=media&token=...
            // The filename in the URL is URL-encoded.
            const encodedFilename = encodeURIComponent(fileName)

            for (const doc of snapshot.docs) {
                const data = doc.data()
                if (data.photoURL && data.photoURL.includes(encodedFilename)) {
                    matchDoc = doc
                    break
                }
            }

            if (matchDoc) {
                // Construct the public URLs for the new files
                // We need to get the download URL.
                // `getSignedUrl` is one way, but standard Firebase access is via `getDownloadURL` (public w/ token).
                // For public read access (if rules allow), we can just construct the URL.
                // Our rules allow read if authenticated.

                // To be consistent with how the client gets URLs (with tokens), we should ask the bucket.
                const thumbFile = bucket.file(thumbStoragePath)
                const mediumFile = bucket.file(mediumStoragePath)

                // We need to make the file public or get a token.
                // Since we want these to be permanently accessible, let's look at how we can get a persistent URL.
                // `file.getSignedUrl` with far future expiration is a common pattern for backend generation.

                const [thumbUrl] = await thumbFile.getSignedUrl({
                    action: 'read',
                    expires: '03-01-2500',
                })

                const [mediumUrl] = await mediumFile.getSignedUrl({
                    action: 'read',
                    expires: '03-01-2500',
                })

                await matchDoc.ref.update({
                    thumbnailURL: thumbUrl,
                    mediumURL: mediumUrl,
                })

                functions.logger.log(
                    `Updated post ${matchDoc.id} with new URLs`
                )
            } else {
                functions.logger.warn(
                    `Could not find post for image ${fileName}`
                )
            }
        } catch (err) {
            functions.logger.error('Error resizing image', err)
        } finally {
            // Cleanup temp files
            await fs.remove(workingDir)
            await fs.remove(tempFilePath)
        }
    })
