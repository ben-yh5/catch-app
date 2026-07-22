import { Buffer } from 'buffer'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImageManipulator from 'expo-image-manipulator'
import decode from 'jpeg-js'
import {
    loadTensorflowModel,
    type TensorflowModel,
} from 'react-native-fast-tflite'

/**
 * Visual Matcher Utility
 *
 * Uses a simplified Siamese-style approach:
 * 1. Extract embedding vector (128d or 512d) from Image A using MobileNetV3 TFLite.
 * 2. Extract embedding vector from Image B.
 * 3. Calculate Cosine Similarity between vectors.
 */

let model: TensorflowModel | null = null

// The expected shape for MobileNetV3-Small (typically 224x224x3)
const INPUT_SIZE = 224

/**
 * Loads the TFLite model into memory if not already loaded.
 */
export const loadVerifierModel = async () => {
    if (model) return model

    try {
        // Model should be placed in assets/models/
        // This is a single-input encoder model (e.g., MobileNetV3-Small)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        model = await loadTensorflowModel(
            require('../../assets/models/view_encoder.tflite')
        )
        return model
    } catch (error) {
        console.error('[VisualMatcher] Failed to load TFLite model:', error)
        throw error
    }
}

/**
 * Converts an image URI to a Float32Array tensor (224x224x3)
 * 1. Resize to 224x224
 * 2. Read as base64
 * 3. Decode JPEG
 * 4. Normalize pixels (-1 to 1)
 */
const imageToTensor = async (uri: string): Promise<Float32Array> => {
    // 1. Resize & Crop to Square
    const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: INPUT_SIZE, height: INPUT_SIZE } }],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 1 }
    )

    // 2. Read file
    const base64 = await FileSystem.readAsStringAsync(result.uri, {
        encoding: 'base64',
    })
    const buffer = Buffer.from(base64, 'base64')

    // 3. Decode JPEG to RGBA
    const { data } = decode.decode(buffer, { useTArray: true })

    // 4. Convert RGBA to RGB Float32Array (normalized -1 to 1)
    const float32Data = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3)
    for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
        // MobileNetV3 expects [-1, 1] range: (value - 127.5) / 127.5
        float32Data[i * 3] = (data[i * 4] - 127.5) / 127.5 // R
        float32Data[i * 3 + 1] = (data[i * 4 + 1] - 127.5) / 127.5 // G
        float32Data[i * 3 + 2] = (data[i * 4 + 2] - 127.5) / 127.5 // B
    }

    return float32Data
}

/**
 * Calculate Cosine Similarity between two numeric vectors
 */
const calculateCosineSimilarity = (
    vecA: Float32Array,
    vecB: Float32Array
): number => {
    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i]
        normA += vecA[i] * vecA[i]
        normB += vecB[i] * vecB[i]
    }

    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Verifies if two images represent the same view.
 *
 * @param originalUri Image URI of the target view
 * @param catchUri Image URI of the user's attempt
 * @returns Similarity score (0.0 to 1.0)
 */
export const verifyViewSimilarity = async (
    originalUri: string,
    catchUri: string
): Promise<number> => {
    const tflite = await loadVerifierModel()

    // 1. Convert to Tensors
    const tensorA = await imageToTensor(originalUri)
    const tensorB = await imageToTensor(catchUri)

    // 2. Run inference SEQUENTIALLY
    // Mobile hardware buffers can sometimes be clobbered by parallel calls.
    // Use explicit copying to ensure we have fresh data.

    // Run A
    const resA = await tflite.run([tensorA])
    const vectorA = new Float32Array(resA[0] as Float32Array) // Explicit COPY to new buffer

    // Run B
    const resB = await tflite.run([tensorB])
    const vectorB = new Float32Array(resB[0] as Float32Array) // Explicit COPY to new buffer

    // 3. Compare vectors
    return calculateCosineSimilarity(vectorA, vectorB)
}

/** Nudge similarity threshold (lower than catch validation — loose matching for suggestions) */
export const NUDGE_SIMILARITY_THRESHOLD = 0.5

/**
 * Finds the most similar image from a list of candidates.
 * Used by the Nudge system to suggest existing posts to catch.
 *
 * @param capturedUri Local URI of the user's captured photo
 * @param candidateUris Remote URLs of nearby post images (use thumbnailURL for speed)
 * @returns Best match index and score, or null if none exceed threshold
 */
export const findMostSimilar = async (
    capturedUri: string,
    candidateUris: string[]
): Promise<{ index: number; score: number } | null> => {
    if (candidateUris.length === 0) return null

    try {
        const tflite = await loadVerifierModel()

        // Get embedding for captured image
        const capturedTensor = await imageToTensor(capturedUri)
        const capturedRes = await tflite.run([capturedTensor])
        const capturedVector = new Float32Array(capturedRes[0] as Float32Array)

        let bestIndex = -1
        let bestScore = 0

        // Compare against each candidate sequentially
        for (let i = 0; i < candidateUris.length; i++) {
            try {
                const candidateTensor = await imageToTensor(candidateUris[i])
                const candidateRes = await tflite.run([candidateTensor])
                const candidateVector = new Float32Array(
                    candidateRes[0] as Float32Array
                )

                const score = calculateCosineSimilarity(
                    capturedVector,
                    candidateVector
                )

                if (score > bestScore) {
                    bestScore = score
                    bestIndex = i
                }
            } catch (e) {
                console.warn(
                    `[VisualMatcher] Failed to process candidate ${i}:`,
                    e
                )
            }
        }

        if (bestIndex >= 0 && bestScore >= NUDGE_SIMILARITY_THRESHOLD) {
            return { index: bestIndex, score: bestScore }
        }

        return null
    } catch (error) {
        console.warn('[VisualMatcher] Nudge similarity check failed:', error)
        return null
    }
}
