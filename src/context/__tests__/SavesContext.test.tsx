import { act, render } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'
import { SavesProvider, useSaves } from '../SavesContext'

let snapshotCallback: ((ids: Set<string>) => void) | null = null
const mockSavePost = jest.fn().mockResolvedValue(undefined)
const mockUnsavePost = jest.fn().mockResolvedValue(undefined)

jest.mock('@/services/saves', () => ({
    subscribeSaves: jest.fn((_uid: string, cb: (ids: Set<string>) => void) => {
        snapshotCallback = cb
        return jest.fn()
    }),
    savePost: (...args: unknown[]) => mockSavePost(...args),
    unsavePost: (...args: unknown[]) => mockUnsavePost(...args),
}))

jest.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { uid: 'user1' } }),
}))

let latest: ReturnType<typeof useSaves>
function Probe() {
    latest = useSaves()
    return <Text>probe</Text>
}

describe('SavesContext', () => {
    beforeEach(() => {
        snapshotCallback = null
        mockSavePost.mockClear()
        mockUnsavePost.mockClear()
    })

    it('is not ready before the first snapshot, then reflects it', () => {
        render(
            <SavesProvider>
                <Probe />
            </SavesProvider>
        )
        expect(latest.ready).toBe(false)
        expect(latest.isSaved('p1')).toBe(false)

        act(() => snapshotCallback!(new Set(['p1', 'p2'])))

        expect(latest.ready).toBe(true)
        expect(latest.isSaved('p1')).toBe(true)
        expect(latest.isSaved('p3')).toBe(false)
    })

    it('toggleSave saves unsaved posts and unsaves saved ones', async () => {
        render(
            <SavesProvider>
                <Probe />
            </SavesProvider>
        )
        act(() => snapshotCallback!(new Set(['saved-post'])))

        await act(async () => {
            await latest.toggleSave('new-post')
        })
        expect(mockSavePost).toHaveBeenCalledWith('user1', 'new-post')
        expect(mockUnsavePost).not.toHaveBeenCalled()

        await act(async () => {
            await latest.toggleSave('saved-post')
        })
        expect(mockUnsavePost).toHaveBeenCalledWith('user1', 'saved-post')
    })

    it('reads the live set, not a stale closure, after snapshot updates', async () => {
        render(
            <SavesProvider>
                <Probe />
            </SavesProvider>
        )
        act(() => snapshotCallback!(new Set()))
        // Snapshot later reports p1 saved (e.g. write landed)
        act(() => snapshotCallback!(new Set(['p1'])))

        await act(async () => {
            await latest.toggleSave('p1')
        })
        // Must unsave — a stale closure over the first (empty) set would save
        expect(mockUnsavePost).toHaveBeenCalledWith('user1', 'p1')
    })
})
