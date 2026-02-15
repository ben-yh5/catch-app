/**
 * Image Processing Utility
 *
 * Handles image manipulation for posts and catches:
 * - Crops captured photos to match the camera preview's visible square guide
 * - Accounts for "cover" scaling that hides edges of the 4:3 sensor feed
 * - Resizes to 1080x1080px for consistent uploads
 * - Compresses JPEGs to reduce storage costs
 */

import * as ImageManipulator from 'expo-image-manipulator'
import { Dimensions, Image } from 'react-native'

const { width: screenWidth, height: screenHeight } = Dimensions.get('window')

/**
 * Crops a captured photo to a square matching what was visible in the camera
 * preview's square guide, then resizes to 1080x1080.
 *
 * The camera preview fills the screen via "cover" scaling, which crops the
 * sides of the 4:3 sensor feed on tall screens. takePictureAsync() returns the
 * full sensor output though, so we must replicate that crop here.
 */
export async function cropToSquare(uri: string): Promise<string> {
    try {
        const { width: photoWidth, height: photoHeight } = await new Promise<{
            width: number
            height: number
        }>((resolve, reject) => {
            Image.getSize(
                uri,
                (width: number, height: number) => resolve({ width, height }),
                reject
            )
        })

        // The camera preview uses "cover" scaling to fill the screen.
        // Compute the same scale factor to find what was actually visible.
        const coverScale = Math.max(
            screenWidth / photoWidth,
            screenHeight / photoHeight
        )

        // The square guide on screen is screenWidth x screenWidth.
        // Convert to photo-pixel coordinates.
        const cropSize = Math.min(
            Math.round(screenWidth / coverScale),
            Math.min(photoWidth, photoHeight)
        )

        const originX = Math.round((photoWidth - cropSize) / 2)
        const originY = Math.round((photoHeight - cropSize) / 2)

        const result = await ImageManipulator.manipulateAsync(
            uri,
            [
                {
                    crop: {
                        originX,
                        originY,
                        width: cropSize,
                        height: cropSize,
                    },
                },
                { resize: { width: 1080, height: 1080 } },
            ],
            {
                compress: 0.7,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        )
        return result.uri
    } catch (error) {
        console.error('Error processing image:', error)
        // Final fallback: just resize whatever we have
        const result = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 1080 } }],
            {
                compress: 0.7,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        )
        return result.uri
    }
}
