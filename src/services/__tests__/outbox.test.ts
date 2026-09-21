/**
 * Outbox service tests — enqueue durability, flush write sequence, and the
 * permanent-vs-retryable failure split (docs/OFFLINE_OUTBOX.md).
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import {
    enqueueOutbox,
    flushOutbox,
    getOutbox,
    retryOutboxRecord,
} from '../outbox'

jest.mock('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///docs/',
    getInfoAsync: jest.fn(async () => ({ exists: true })),
    makeDirectoryAsync: jest.fn(async () => {}),
    copyAsync: jest.fn(async () => {}),
    deleteAsync: jest.fn(async () => {}),
}))

jest.mock('@/services/firebase', () => ({ db: {}, storage: {} }))

const mockAddDoc = jest.fn()
const mockGetDoc = jest.fn()
jest.mock('firebase/firestore', () => ({
    addDoc: (...args: any[]) => mockAddDoc(...args),
    getDoc: (...args: any[]) => mockGetDoc(...args),
    collection: jest.fn((_db, name) => ({ name })),
    doc: jest.fn(),
}))

jest.mock('firebase/storage', () => ({
    ref: jest.fn(),
}))

const mockUpload = jest.fn()
jest.mock('@/utils/uploadImage', () => ({
    uploadImageWithProgress: (...args: any[]) => mockUpload(...args),
}))

const mockValidateCatch = jest.fn()
jest.mock('@/utils/catchValidation', () => ({
    validateCatch: (...args: any[]) => mockValidateCatch(...args),
}))

const mockAddPostToList = jest.fn()
jest.mock('@/utils/listUtils', () => ({
    addPostToList: (...args: any[]) => mockAddPostToList(...args),
}))

jest.mock('geofire-common', () => ({
    geohashForLocation: jest.fn(() => 'geohash123'),
}))

const baseInput = {
    userId: 'user-1',
    kind: 'original' as const,
    imageUri: 'file:///cache/shot.jpg',
    latitude: 48.85,
    longitude: 2.35,
    heading: 120,
    pitch: -5,
    capturedAt: 1700000000000,
    caption: 'hello',
    listIds: [] as string[],
}

const events = () => ({
    onPosted: jest.fn(),
    onCaught: jest.fn(),
    onFailed: jest.fn(),
})

beforeEach(async () => {
    jest.clearAllMocks()
    await AsyncStorage.clear()
    global.fetch = jest.fn(async () => ({
        blob: async () => new Blob(),
    })) as any
    mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ username: 'ben' }),
    })
    mockUpload.mockResolvedValue('https://cdn/photo.jpg')
    mockAddDoc.mockResolvedValue({ id: 'new-post-id' })
})

describe('enqueueOutbox', () => {
    it('copies the photo into durable storage and persists a queued record', async () => {
        const records = await enqueueOutbox(baseInput)

        expect(FileSystem.copyAsync).toHaveBeenCalledWith({
            from: 'file:///cache/shot.jpg',
            to: expect.stringContaining('file:///docs/outbox/'),
        })
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
            userId: 'user-1',
            kind: 'original',
            status: 'queued',
            latitude: 48.85,
            capturedAt: 1700000000000,
            attempts: 0,
        })
        // Survives a reload
        expect(await getOutbox()).toHaveLength(1)
    })

    it('propagates a failed copy instead of pretending the shot was saved', async () => {
        jest.mocked(FileSystem.copyAsync).mockRejectedValueOnce(
            new Error('disk full')
        )
        await expect(enqueueOutbox(baseInput)).rejects.toThrow('disk full')
        expect(await getOutbox()).toHaveLength(0)
    })
})

describe('flushOutbox', () => {
    it('uploads an original, removes the record, and reports onPosted', async () => {
        await enqueueOutbox(baseInput)
        const handlers = events()

        const remaining = await flushOutbox('user-1', handlers)

        // posts doc then post_locations doc, same as the online path
        expect(mockAddDoc).toHaveBeenCalledTimes(2)
        const postPayload = mockAddDoc.mock.calls[0][1]
        expect(postPayload).toMatchObject({
            authorId: 'user-1',
            authorUsername: 'ben',
            isOriginal: true,
            parentPostId: null,
            rootPostId: null,
            hasLocation: true,
        })
        // capturedAt keeps shutter time; createdAt is flush time
        expect(postPayload.capturedAt.getTime()).toBe(1700000000000)
        const locationPayload = mockAddDoc.mock.calls[1][1]
        expect(locationPayload).toMatchObject({
            postId: 'new-post-id',
            latitude: 48.85,
            longitude: 2.35,
            geohash: 'geohash123',
        })
        expect(handlers.onPosted).toHaveBeenCalled()
        expect(remaining).toHaveLength(0)
        expect(FileSystem.deleteAsync).toHaveBeenCalled()
    })

    it('runs validateCatch before uploading a catch and threads the root id', async () => {
        mockValidateCatch.mockResolvedValue({ isValid: true, distance: 10 })
        await enqueueOutbox({
            ...baseInput,
            kind: 'catch',
            rootPostId: 'root-1',
        })
        const handlers = events()

        await flushOutbox('user-1', handlers)

        expect(mockValidateCatch).toHaveBeenCalledWith('root-1', 48.85, 2.35)
        expect(mockAddDoc.mock.calls[0][1]).toMatchObject({
            isOriginal: false,
            parentPostId: 'root-1',
            rootPostId: 'root-1',
        })
        expect(handlers.onCaught).toHaveBeenCalledWith(
            expect.objectContaining({ rootPostId: 'root-1' }),
            'new-post-id'
        )
    })

    it('marks a too-far catch failed with a reason and keeps the record', async () => {
        mockValidateCatch.mockResolvedValue({
            isValid: false,
            distance: 250,
            requiredDistance: 100,
        })
        await enqueueOutbox({
            ...baseInput,
            kind: 'catch',
            rootPostId: 'root-1',
        })
        const handlers = events()

        const remaining = await flushOutbox('user-1', handlers)

        expect(mockAddDoc).not.toHaveBeenCalled()
        expect(remaining).toHaveLength(1)
        expect(remaining[0].status).toBe('failed')
        expect(remaining[0].failureReason).toContain('250 m')
        expect(handlers.onFailed).toHaveBeenCalled()
        // Photo is kept for the user to inspect/discard
        expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
    })

    it('keeps a record queued and stops the flush on a retryable error', async () => {
        mockUpload.mockRejectedValue(new Error('network request failed'))
        await enqueueOutbox(baseInput)
        await enqueueOutbox({ ...baseInput, caption: 'second' })
        const handlers = events()

        const remaining = await flushOutbox('user-1', handlers)

        expect(remaining).toHaveLength(2)
        expect(remaining[0].status).toBe('queued')
        expect(remaining[0].attempts).toBe(1)
        // Second record untouched — flush stopped at the first failure
        expect(remaining[1].attempts).toBe(0)
        expect(handlers.onFailed).not.toHaveBeenCalled()
    })

    it("only flushes the given user's records", async () => {
        await enqueueOutbox({ ...baseInput, userId: 'someone-else' })
        const handlers = events()

        const remaining = await flushOutbox('user-1', handlers)

        expect(mockAddDoc).not.toHaveBeenCalled()
        expect(remaining).toHaveLength(1)
    })
})

describe('retryOutboxRecord', () => {
    it('re-arms a failed record', async () => {
        mockValidateCatch.mockResolvedValue({
            isValid: false,
            distance: 250,
            requiredDistance: 100,
        })
        await enqueueOutbox({
            ...baseInput,
            kind: 'catch',
            rootPostId: 'root-1',
        })
        const flushed = await flushOutbox('user-1', events())
        expect(flushed[0].status).toBe('failed')

        const records = await retryOutboxRecord(flushed[0].id)
        expect(records[0]).toMatchObject({
            status: 'queued',
            attempts: 0,
            failureReason: undefined,
        })
    })
})
