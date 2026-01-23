
import { Buffer } from 'buffer';
import * as ImageManipulator from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

/**
 * Checks the brightness of an image.
 * Returns true if the image is bright enough, false otherwise.
 * 
 * Strategy: Resize image to 50x50, decode, and calculate average luminance.
 * 
 * @param uri - The local URI of the image to check
 * @param threshold - Brightness threshold (0-255). Default 30.
 */
export const checkBrightness = async (uri: string, threshold: number = 30): Promise<boolean> => {
    try {
        // Resize to small size (50x50) to make processing fast
        const result = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 50, height: 50 } }],
            { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 1.0 }
        );

        if (!result.base64) {
            console.warn('Could not get base64 data for brightness check');
            return true; // Fail open
        }

        // Decode base64 to binary
        const rawData = Buffer.from(result.base64, 'base64');

        // Decode JPEG
        const { data, width, height } = jpeg.decode(rawData, { useTArray: true });

        // Calculate average brightness
        let totalBrightness = 0;
        const pixelCount = width * height;

        // Data is in RGBA format (or RGB?) jpeg-js usually returns RGBA
        // Loop through pixels
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Standard luminance formula: 0.299*R + 0.587*G + 0.114*B
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
            totalBrightness += brightness;
        }

        const avgBrightness = totalBrightness / pixelCount;

        console.log(`[ImageValidation] Brightness: ${avgBrightness.toFixed(2)} (Threshold: ${threshold})`);

        // Since we are checking if it's NOT too dark.
        // If avgBrightness < threshold, it is too dark.
        return avgBrightness >= threshold;

    } catch (error) {
        console.error('Error checking brightness:', error);
        return true; // Fail open on error
    }
}
