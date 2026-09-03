const mockGet = jest.fn()
const mockLimit = jest.fn().mockReturnValue({ get: mockGet })
const mockWhere: jest.Mock = jest.fn().mockReturnValue({
    where: (...args: any[]) => mockWhere(...args),
    limit: mockLimit,
    get: mockGet,
})
const mockDocGet = jest.fn()
const mockDocSet = jest.fn().mockResolvedValue(undefined)
const mockDoc = jest.fn().mockReturnValue({ get: mockDocGet, set: mockDocSet })
const mockCollection = jest
    .fn()
    .mockReturnValue({ doc: mockDoc, where: mockWhere })

jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: Object.assign(() => ({ collection: mockCollection }), {
        FieldValue: {
            serverTimestamp: jest.fn(),
            arrayUnion: jest.fn(),
            arrayRemove: jest.fn(),
            increment: jest.fn(),
        },
        Timestamp: {
            fromMillis: (ms: number) => ({ toMillis: () => ms }),
        },
    }),
}))

import { makeContext, makeUnauthContext } from './setup'
import { validateCatch } from '../index'

// In firebase-functions v4, onCall attaches the handler as .run(data, context)
const run = (validateCatch as any).run as (
    data: any,
    context: any
) => Promise<any>

describe('validateCatch', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('rejects unauthenticated calls', async () => {
        await expect(
            run({ postId: 'p1', userLat: 0, userLng: 0 }, makeUnauthContext())
        ).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    it('rejects missing postId', async () => {
        await expect(
            run({ userLat: 0, userLng: 0 }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('rejects missing coordinates', async () => {
        await expect(
            run({ postId: 'p1' }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('rejects when post not found', async () => {
        mockDocGet.mockResolvedValue({ exists: false })

        await expect(
            run({ postId: 'p1', userLat: 0, userLng: 0 }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'not-found' })
    })

    it('rejects self-catch', async () => {
        mockDocGet.mockResolvedValue({
            exists: true,
            data: () => ({ hasLocation: true, authorId: 'user1' }),
        })

        await expect(
            run({ postId: 'p1', userLat: 0, userLng: 0 }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    it('rejects duplicate catch', async () => {
        mockDocGet.mockResolvedValue({
            exists: true,
            data: () => ({
                hasLocation: true,
                authorId: 'otherUser',
                rootPostId: null,
            }),
        })
        mockGet.mockResolvedValue({ empty: false })

        await expect(
            run({ postId: 'p1', userLat: 0, userLng: 0 }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'already-exists' })
    })

    it('returns isValid=true when within catch radius', async () => {
        mockDocGet.mockResolvedValue({
            exists: true,
            data: () => ({
                hasLocation: true,
                authorId: 'otherUser',
                rootPostId: null,
            }),
        })

        let callCount = 0
        mockGet.mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve({ empty: true })
            return Promise.resolve({
                empty: false,
                docs: [
                    { data: () => ({ latitude: 40.7128, longitude: -74.006 }) },
                ],
            })
        })

        const result = await run(
            { postId: 'p1', userLat: 40.7128, userLng: -74.006 },
            makeContext('user1')
        )

        expect(result.isValid).toBe(true)
        expect(result.distance).toBe(0)
        expect(result.requiredDistance).toBe(100)

        // A valid catch issues a permit keyed on uid + rootPostId
        expect(mockCollection).toHaveBeenCalledWith('catch_permits')
        expect(mockDoc).toHaveBeenCalledWith('user1_p1')
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'user1', rootPostId: 'p1' })
        )
    })

    it('returns isValid=false when outside catch radius', async () => {
        mockDocGet.mockResolvedValue({
            exists: true,
            data: () => ({
                hasLocation: true,
                authorId: 'otherUser',
                rootPostId: null,
            }),
        })

        let callCount = 0
        mockGet.mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve({ empty: true })
            return Promise.resolve({
                empty: false,
                docs: [
                    { data: () => ({ latitude: 40.7228, longitude: -74.006 }) },
                ],
            })
        })

        const result = await run(
            { postId: 'p1', userLat: 40.7128, userLng: -74.006 },
            makeContext('user1')
        )

        expect(result.isValid).toBe(false)
        expect(result.distance).toBeGreaterThan(100)

        // No permit is issued when the user is out of range
        expect(mockDocSet).not.toHaveBeenCalled()
    })

    it('returns heading and pitch when available', async () => {
        mockDocGet.mockResolvedValue({
            exists: true,
            data: () => ({
                hasLocation: true,
                authorId: 'otherUser',
                rootPostId: null,
            }),
        })

        let callCount = 0
        mockGet.mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve({ empty: true })
            return Promise.resolve({
                empty: false,
                docs: [
                    {
                        data: () => ({
                            latitude: 40.7128,
                            longitude: -74.006,
                            heading: 90,
                            pitch: 45,
                        }),
                    },
                ],
            })
        })

        const result = await run(
            { postId: 'p1', userLat: 40.7128, userLng: -74.006 },
            makeContext('user1')
        )

        expect(result.heading).toBe(90)
        expect(result.pitch).toBe(45)
    })
})
