const mockTransactionGet = jest.fn()
const mockTransactionSet = jest.fn()
const mockRunTransaction = jest.fn(async (fn: any) => {
    return fn({ get: mockTransactionGet, set: mockTransactionSet })
})

const mockDoc = jest.fn()
const mockCollection = jest.fn(() => ({ doc: mockDoc }))

jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    firestore: Object.assign(
        () => ({
            collection: mockCollection,
            runTransaction: mockRunTransaction,
        }),
        {
            FieldValue: {
                serverTimestamp: () => 'SERVER_TIMESTAMP',
                arrayUnion: jest.fn(),
                arrayRemove: jest.fn(),
                increment: jest.fn(),
            },
        }
    ),
}))

import { makeContext, makeUnauthContext } from './setup'
import { setupUsername } from '../index'

const run = (setupUsername as any).run as (
    data: any,
    context: any
) => Promise<any>

describe('setupUsername', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('rejects unauthenticated calls', async () => {
        await expect(
            run({ username: 'testuser' }, makeUnauthContext())
        ).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    it('rejects missing username', async () => {
        await expect(run({}, makeContext('user1'))).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })

    it('rejects non-string username', async () => {
        await expect(
            run({ username: 123 }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('rejects username shorter than 3 characters', async () => {
        await expect(
            run({ username: 'ab' }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('rejects username longer than 20 characters', async () => {
        await expect(
            run({ username: 'a'.repeat(21) }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('rejects username with special characters', async () => {
        await expect(
            run({ username: 'user name!' }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('allows valid characters (letters, numbers, underscore, hyphen)', async () => {
        const userRef = { id: 'users/user1' }
        const usernameRef = { id: 'usernames/test_user-1' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? userRef : usernameRef
        )
        mockTransactionGet.mockResolvedValue({ exists: false })

        const result = await run(
            { username: 'Test_User-1' },
            makeContext('user1')
        )
        expect(result).toEqual({ success: true })
    })

    it('rejects already-taken username', async () => {
        const userRef = { id: 'users/user1' }
        const usernameRef = { id: 'usernames/taken' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? userRef : usernameRef
        )
        mockTransactionGet.mockImplementation((ref: any) => {
            if (ref === userRef) return Promise.resolve({ exists: false })
            return Promise.resolve({ exists: true })
        })

        await expect(
            run({ username: 'taken' }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'already-exists' })
    })

    it('rejects if user doc already exists (double setup)', async () => {
        const userRef = { id: 'users/user1' }
        const usernameRef = { id: 'usernames/newuser' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? userRef : usernameRef
        )
        mockTransactionGet.mockImplementation((ref: any) => {
            if (ref === userRef) return Promise.resolve({ exists: true })
            return Promise.resolve({ exists: false })
        })

        await expect(
            run({ username: 'newuser' }, makeContext('user1'))
        ).rejects.toMatchObject({ code: 'already-exists' })
    })

    it('creates both username index and user doc atomically', async () => {
        const userRef = { id: 'users/user1' }
        const usernameRef = { id: 'usernames/myname' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? userRef : usernameRef
        )
        mockTransactionGet.mockResolvedValue({ exists: false })

        await run({ username: 'MyName' }, makeContext('user1'))

        expect(mockTransactionSet).toHaveBeenCalledTimes(2)
        expect(mockTransactionSet).toHaveBeenCalledWith(usernameRef, {
            uid: 'user1',
        })
        expect(mockTransactionSet).toHaveBeenCalledWith(
            userRef,
            expect.objectContaining({
                username: 'MyName',
                totalPosts: 0,
                totalCatches: 0,
                contribution: 0,
                followers: [],
                following: [],
            })
        )
    })

    it('lowercases username for the uniqueness index', async () => {
        const userRef = { id: 'users/user1' }
        const usernameRef = { id: 'usernames/myname' }
        mockDoc.mockImplementation((id: string) =>
            id === 'user1' ? userRef : usernameRef
        )
        mockTransactionGet.mockResolvedValue({ exists: false })

        await run({ username: 'MyName' }, makeContext('user1'))

        expect(mockCollection).toHaveBeenCalledWith('usernames')
        expect(mockDoc).toHaveBeenCalledWith('myname')
    })
})
