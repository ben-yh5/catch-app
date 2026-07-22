/**
 * Training Data Service
 *
 * Handles the collection and uploading of image pairs (Original + Catch)
 * for training the View Verification AI model.
 *
 * Only uploads data if the user has opted-in via Settings ("Improve Catch AI").
 * Uploads land in the `training_data/` Storage prefix and a `training_pairs`
 * Firestore collection; the offline training pipeline that consumes this data
 * (download, manual verification, fine-tuning) lives in the separate
 * catch-ml-training repo, not in this app repo.
 */

import { db, storage } from '@/services/firebase'
import { addDoc, collection } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'

export interface ImageMetadata {
    latitude: number
    longitude: number
    heading?: number // Compass heading (0-360)
    pitch?: number // Device tilt (-90 to 90)
    date: Date
}

export type TrainingLabel = 'POSITIVE' | 'HARD_NEGATIVE'

/**
 * Uploads a pair of images (Original and Catch) to the training dataset.
 * This should be called in the background after a successful catch or modification.
 *
 * @param originalId The ID of the original post
 * @param catchId The ID of the catch post (if created)
 * @param originalImageUri Local URI or Remote URL of original image
 * @param catchImageUri Local URI of the new catch image
 * @param originalMeta Metadata for the original image
 * @param catchMeta Metadata for the new catch image
 * @param label Classification label ('POSITIVE' for successful catches)
 * @param userId ID of the user contributing the data
 */
export const uploadTrainingPair = async (
    originalId: string,
    catchId: string | null,
    originalImageUri: string,
    catchImageUri: string,
    originalMeta: ImageMetadata,
    catchMeta: ImageMetadata,
    label: TrainingLabel,
    userId: string
): Promise<void> => {
    try {
        const pairId = `${originalId}_${Date.now()}`
        const storageBasePath = `training_data/${pairId}`

        // Upload images to training bucket
        // We do NOT wait for or need the download URL for the app to function.
        // Reading it back fails if the rules are "private".
        // We just upload blindly.
        const uploadImage = async (
            uri: string,
            path: string
        ): Promise<string> => {
            const response = await fetch(uri)
            const blob = await response.blob()
            const storageRef = ref(storage, path)
            const metadata = { contentType: 'image/jpeg' }
            await uploadBytes(storageRef, blob, metadata)
            // Return the storage path or a placeholder, we won't read it back here
            return path
        }

        const [originalPath, catchPath] = await Promise.all([
            uploadImage(originalImageUri, `${storageBasePath}/original.jpg`),
            uploadImage(catchImageUri, `${storageBasePath}/catch.jpg`),
        ])

        // Save metadata record
        await addDoc(collection(db, 'training_pairs'), {
            pairId,
            userId,
            originalId,
            catchId, // might be null if it was a failed attempt (Hard Negative)
            label,
            originalStoragePath: originalPath,
            catchStoragePath: catchPath,
            originalMeta: {
                ...originalMeta,
                date: originalMeta.date.toISOString(),
            },
            catchMeta: {
                ...catchMeta,
                date: catchMeta.date.toISOString(),
            },
            createdAt: new Date().toISOString(),
            status: 'unverified', // ready for auto-training pipeline
        })

        console.log(`[TrainingData] Successfully uploaded pair ${pairId}`)
    } catch (error) {
        // Silent fail - we don't want to interrupt the user experience for data collection
        console.warn('[TrainingData] Failed to upload training pair:', error)
    }
}
