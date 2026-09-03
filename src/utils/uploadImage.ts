import {
    getDownloadURL,
    StorageReference,
    uploadBytesResumable,
} from 'firebase/storage'

/**
 * Uploads a blob with progress reporting and returns its download URL.
 *
 * Uses uploadBytesResumable so callers can drive a real progress bar —
 * uploadBytes gives no feedback, which left users staring at an
 * indeterminate spinner (and abandoning uploads mid-flight).
 */
export async function uploadImageWithProgress(
    storageRef: StorageReference,
    blob: Blob,
    onProgress?: (fraction: number) => void
): Promise<string> {
    return new Promise((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob)
        task.on(
            'state_changed',
            (snapshot) => {
                if (snapshot.totalBytes > 0) {
                    onProgress?.(
                        snapshot.bytesTransferred / snapshot.totalBytes
                    )
                }
            },
            reject,
            () => {
                getDownloadURL(task.snapshot.ref).then(resolve, reject)
            }
        )
    })
}
