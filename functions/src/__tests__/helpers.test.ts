// Test checkRateLimit and verifyAppCheck indirectly through getPostLocation,
// a simple callable that exercises both helpers.

const mockRateLimitGet = jest.fn()
const mockRateLimitSet = jest.fn().mockResolvedValue(undefined)
const mockDocGet = jest.fn()
const mockDoc = jest.fn().mockReturnValue({ get: mockDocGet })
const mockWhere = jest
    .fn()
    .mockReturnValue({ limit: jest.fn().mockReturnValue({ get: jest.fn() }) })
const mockCollection = jest.fn((name: string) => {
    if (name === 'rate_limits') {
        return { doc: () => ({ get: mockRateLimitGet, set: mockRateLimitSet }) }
    }
    return { doc: mockDoc, where: mockWhere }
})

jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: Object.assign(() => ({ collection: mockCollection }), {
        FieldValue: {
            serverTimestamp: jest.fn(),
            arrayUnion: jest.fn(),
            arrayRemove: jest.fn(),
            increment: jest.fn(),
        },
    }),
}))

import { getPostLocation } from '../index'

const run = (getPostLocation as any).run as (
    data: any,
    context: any
) => Promise<any>

describe('verifyAppCheck (warn mode)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockRateLimitGet.mockResolvedValue({ data: () => ({}) })
    })

    it('allows requests with valid app context', async () => {
        const context = { auth: { uid: 'user1' }, app: { appId: 'valid' } }

        // Gets past auth + app check, fails at input validation
        await expect(run({}, context)).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })

    it('allows requests without app context in warn mode', async () => {
        const context = { auth: { uid: 'user1' }, app: undefined }

        // Still gets past app check in warn mode
        await expect(run({}, context)).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })
})

describe('checkRateLimit', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('allows requests under the limit', async () => {
        mockRateLimitGet.mockResolvedValue({
            data: () => ({ getPostLocation_ts: [Date.now() - 5000] }),
        })

        const context = { auth: { uid: 'user1' }, app: { appId: 'test' } }

        // Gets past rate limit, fails at validation
        await expect(run({}, context)).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })

    it('blocks requests that exceed the limit', async () => {
        const now = Date.now()
        const timestamps = Array.from({ length: 30 }, (_, i) => now - i * 1000)
        mockRateLimitGet.mockResolvedValue({
            data: () => ({ getPostLocation_ts: timestamps }),
        })

        const context = { auth: { uid: 'user1' }, app: { appId: 'test' } }

        await expect(run({ postId: 'p1' }, context)).rejects.toMatchObject({
            code: 'resource-exhausted',
        })
    })

    it('fails open when Firestore errors', async () => {
        mockRateLimitGet.mockRejectedValue(new Error('Firestore unavailable'))

        const context = { auth: { uid: 'user1' }, app: { appId: 'test' } }

        // Proceeds past rate limit despite error
        await expect(run({}, context)).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })

    it('prunes old timestamps outside the window', async () => {
        const now = Date.now()
        const timestamps = [
            now - 120000, // 2 min ago (pruned)
            now - 90000, // 1.5 min ago (pruned)
            now - 5000, // 5s ago (kept)
        ]
        mockRateLimitGet.mockResolvedValue({
            data: () => ({ getPostLocation_ts: timestamps }),
        })

        const context = { auth: { uid: 'user1' }, app: { appId: 'test' } }

        await expect(run({}, context)).rejects.toMatchObject({
            code: 'invalid-argument',
        })

        // Verify pruned timestamps written back
        expect(mockRateLimitSet).toHaveBeenCalledWith(
            expect.objectContaining({ getPostLocation_ts: expect.any(Array) }),
            { merge: true }
        )
        const written = mockRateLimitSet.mock.calls[0][0].getPostLocation_ts
        // 1 recent + 1 new = 2 (old ones pruned)
        expect(written.length).toBe(2)
    })
})
