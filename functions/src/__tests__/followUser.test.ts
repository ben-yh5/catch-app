const mockTransactionGet = jest.fn()
const mockTransactionUpdate = jest.fn()
const mockRunTransaction = jest.fn(async (fn: any) => {
    return fn({ get: mockTransactionGet, update: mockTransactionUpdate })
})

const mockRateLimitGet = jest.fn().mockResolvedValue({ data: () => ({}) })
const mockRateLimitSet = jest.fn().mockResolvedValue(undefined)
const mockDoc = jest.fn((id: string) => ({ id: `users/${id}` }))
const mockCollection = jest.fn((name: string) => {
    if (name === 'rate_limits') {
        return { doc: () => ({ get: mockRateLimitGet, set: mockRateLimitSet }) }
    }
    return { doc: mockDoc }
})

jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: Object.assign(
        () => ({ collection: mockCollection, runTransaction: mockRunTransaction }),
        { FieldValue: { arrayUnion: jest.fn((v: any) => ({ _arrayUnion: v })), arrayRemove: jest.fn((v: any) => ({ _arrayRemove: v })), serverTimestamp: jest.fn(), increment: jest.fn() } }
    ),
}))

import { makeContext, makeUnauthContext } from './setup'
import { followUser, unfollowUser } from '../index'

const runFollow = (followUser as any).run as (data: any, context: any) => Promise<any>
const runUnfollow = (unfollowUser as any).run as (data: any, context: any) => Promise<any>

describe('followUser', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockRateLimitGet.mockResolvedValue({ data: () => ({}) })
    })

    it('rejects unauthenticated calls', async () => {
        await expect(
            runFollow({ targetUserId: 'user2' }, makeUnauthContext())
        ).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    it('rejects missing targetUserId', async () => {
        await expect(
            runFollow({}, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('rejects non-string targetUserId', async () => {
        await expect(
            runFollow({ targetUserId: 123 }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('rejects self-follow', async () => {
        await expect(
            runFollow({ targetUserId: 'user1' }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('rejects when current user not found', async () => {
        const currentRef = { id: 'users/user1' }
        const targetRef = { id: 'users/user2' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? currentRef : targetRef
        )
        mockTransactionGet.mockImplementation((ref: any) => {
            if (ref === currentRef) return Promise.resolve({ exists: false })
            return Promise.resolve({ exists: true })
        })

        await expect(
            runFollow({ targetUserId: 'user2' }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'not-found' })
    })

    it('rejects when target user not found', async () => {
        const currentRef = { id: 'users/user1' }
        const targetRef = { id: 'users/user2' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? currentRef : targetRef
        )
        mockTransactionGet.mockImplementation((ref: any) => {
            if (ref === currentRef) return Promise.resolve({ exists: true })
            return Promise.resolve({ exists: false })
        })

        await expect(
            runFollow({ targetUserId: 'user2' }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'not-found' })
    })

    it('updates both users arrays on success', async () => {
        const currentRef = { id: 'users/user1' }
        const targetRef = { id: 'users/user2' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? currentRef : targetRef
        )
        mockTransactionGet.mockResolvedValue({ exists: true })

        const result = await runFollow(
            { targetUserId: 'user2' },
            makeContext('user1')
        )

        expect(result).toEqual({ success: true })
        expect(mockTransactionUpdate).toHaveBeenCalledTimes(2)
        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            currentRef,
            expect.objectContaining({ following: expect.anything() })
        )
        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            targetRef,
            expect.objectContaining({ followers: expect.anything() })
        )
    })
})

describe('unfollowUser', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockRateLimitGet.mockResolvedValue({ data: () => ({}) })
    })

    it('rejects unauthenticated calls', async () => {
        await expect(
            runUnfollow({ targetUserId: 'user2' }, makeUnauthContext())
        ).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    it('rejects missing targetUserId', async () => {
        await expect(
            runUnfollow({}, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('updates both users arrays on success', async () => {
        const currentRef = { id: 'users/user1' }
        const targetRef = { id: 'users/user2' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? currentRef : targetRef
        )
        mockTransactionGet.mockResolvedValue({ exists: true })

        const result = await runUnfollow(
            { targetUserId: 'user2' },
            makeContext('user1')
        )

        expect(result).toEqual({ success: true })
        expect(mockTransactionUpdate).toHaveBeenCalledTimes(2)
    })
})
