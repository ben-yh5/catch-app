
import { Buffer } from 'buffer';
import * as ImageManipulator from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

/**
 * Helper to decode image to raw pixel data
 */
const decodeImage = async (uri: string, width: number, height: number) => {
    // Resize to target size for processing
    const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width, height } }],
        { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 1.0 }
    );

    if (!result.base64) {
        throw new Error('Could not get base64 data');
    }

    const rawData = Buffer.from(result.base64, 'base64');
    return jpeg.decode(rawData, { useTArray: true });
}

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
        const { data, width, height } = await decodeImage(uri, 50, 50);

        // Calculate average brightness
        let totalBrightness = 0;
        const pixelCount = width * height;

        // Data is in RGBA format
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

        return avgBrightness >= threshold;

    } catch (error) {
        console.error('Error checking brightness:', error);
        return true; // Fail open on error
    }
}

/**
 * Checks if an image is blurry using the Variance of Laplacian method.
 * 
 * Strategy:
 * 1. Resize to 256x256 (good trade-off for speed/detail)
 * 2. Convert to Grayscale
 * 3. Convolve with 3x3 Laplacian kernel
 * 4. Calculate Variance of the response
 * 
 * @param uri - Image URI
 * @param threshold - Variance threshold. Below this = blurry. Default 2000.
 */
export const checkBlur = async (uri: string, threshold: number = 1000): Promise<boolean> => {
    try {
        const SIZE = 256;
        const { data, width, height } = await decodeImage(uri, SIZE, SIZE);

        // 1. Convert to Grayscale
        const grayData = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const offset = i * 4;
            const r = data[offset];
            const g = data[offset + 1];
            const b = data[offset + 2];
            grayData[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        }

        // 2. Laplacian Kernel (3x3)
        // [ 0,  1, 0 ]
        // [ 1, -4, 1 ]
        // [ 0,  1, 0 ]
        let mean = 0;
        let m2 = 0;
        let count = 0;

        // Iterate over valid pixels (exclude border 1px)
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;

                // Convolve
                // Center: -4
                // Neighbors: +1
                const val =
                    grayData[idx - width] + // Top
                    grayData[idx + width] + // Bottom
                    grayData[idx - 1] +     // Left
                    grayData[idx + 1] +     // Right
                    (grayData[idx] * -4);   // Center

                // Online/Welford's algorithm or simple variance
                // Since we iterate once, let's just sum and sumSq
                // But simple variance is fine here.
                // Welford's algorithm for variance to prevent overflow/precision issues
                count++;
                const delta = val - mean;
                mean += delta / count;
                const delta2 = val - mean;
                m2 += delta * delta2;
            }
        }

        const variance = m2 / (count - 1);

        console.log(`[ImageValidation] Blur Variance: ${variance.toFixed(2)} (Threshold: ${threshold})`);

        return variance >= threshold;

    } catch (error) {
        console.error('Error checking blur:', error);
        return true; // Fail open
    }
}
