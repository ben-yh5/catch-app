import * as ImageManipulator from 'expo-image-manipulator'
import { Image } from 'react-native'

/**
 * Processes an image captured with ratio="1:1" camera mode
 * Since the camera outputs a square image already, we just resize and compress
 */
export async function cropToSquare(uri: string): Promise<string> {
    try {
        // Get captured image dimensions
        const { width: imageWidth, height: imageHeight } = await new Promise<{
            width: number
            height: number
        }>((resolve, reject) => {
            Image.getSize(
                uri,
                (width: number, height: number) => resolve({ width, height }),
                reject
            )
        })

        // If image is already square (or very close), just resize
        const aspectRatio = imageWidth / imageHeight
        const isSquare = aspectRatio > 0.95 && aspectRatio < 1.05

        if (isSquare) {
            const result = await ImageManipulator.manipulateAsync(
                uri,
                [{ resize: { width: 1080, height: 1080 } }],
                {
                    compress: 0.7,
                    format: ImageManipulator.SaveFormat.JPEG,
                }
            )
            return result.uri
        }

        // Fallback: center crop to square if ratio="1:1" didn't work
        const size = Math.min(imageWidth, imageHeight)
        const originX = (imageWidth - size) / 2
        const originY = (imageHeight - size) / 2

        const result = await ImageManipulator.manipulateAsync(
            uri,
            [
                {
                    crop: {
                        originX: Math.round(originX),
                        originY: Math.round(originY),
                        width: Math.round(size),
                        height: Math.round(size),
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

/**
 * Prepares image for preview - simple resize
 */
export async function prepareImageForPreview(uri: string): Promise<string> {
    try {
        const resized = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 1080 } }],
            {
                compress: 0.8,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        )
        return resized.uri
    } catch (error) {
        console.error('Error preparing image:', error)
        return uri
    }
}
