import { getCatchRecency } from '../catchRecency'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-21T12:00:00Z').getTime()

const root = (catchCount: number, lastCaughtAt?: number | Date) => ({
    isOriginal: true,
    catchCount,
    lastCaughtAt,
})

describe('getCatchRecency', () => {
    it('returns null for catches — the thread story belongs to the root', () => {
        expect(
            getCatchRecency(
                { isOriginal: false, catchCount: 0, lastCaughtAt: undefined },
                NOW
            )
        ).toBeNull()
    })

    it('never caught → the standing invitation, gray', () => {
        expect(getCatchRecency(root(0), NOW)).toEqual({
            text: 'not yet caught',
            caught: false,
            state: 'never',
        })
    })

    it('caught but no timestamp (legacy docs) → states the fact without freshness', () => {
        expect(getCatchRecency(root(3), NOW)).toEqual({
            text: 'caught before',
            caught: false,
            state: 'legacy',
        })
    })

    it('fresh catches carry the caught ink', () => {
        expect(getCatchRecency(root(1, new Date(NOW - 2 * 60 * 60 * 1000)), NOW))
            .toEqual({ text: 'caught today', caught: true, state: 'fresh' })
        expect(getCatchRecency(root(1, new Date(NOW - 1 * DAY)), NOW)).toEqual({
            text: 'caught yesterday',
            caught: true,
            state: 'fresh',
        })
        expect(getCatchRecency(root(1, new Date(NOW - 4 * DAY)), NOW)).toEqual({
            text: 'caught 4 days ago',
            caught: true,
            state: 'fresh',
        })
        expect(getCatchRecency(root(1, new Date(NOW - 8 * DAY)), NOW)).toEqual({
            text: 'caught last week',
            caught: true,
            state: 'fresh',
        })
        expect(getCatchRecency(root(1, new Date(NOW - 22 * DAY)), NOW)).toEqual({
            text: 'caught 3 weeks ago',
            caught: true,
            state: 'fresh',
        })
    })

    it('stale (past the lost-place threshold) → month, gray, no penalty framing', () => {
        // ~80 days before 2026-09-21 lands in early July 2026
        expect(getCatchRecency(root(2, new Date(NOW - 80 * DAY)), NOW)).toEqual(
            { text: 'last caught in July', caught: false, state: 'stale' }
        )
    })

    it('stale in a previous year names the year', () => {
        expect(
            getCatchRecency(root(2, new Date('2025-06-10T00:00:00Z')), NOW)
        ).toEqual({ text: 'last caught in June 2025', caught: false, state: 'stale' })
    })

    it('accepts Firestore Timestamp-shaped values and epoch millis', () => {
        const ts = { toMillis: () => NOW - DAY }
        expect(getCatchRecency(root(1, ts as any), NOW)).toEqual({
            text: 'caught yesterday',
            caught: true,
            state: 'fresh',
        })
        expect(getCatchRecency(root(1, (NOW - DAY) as any), NOW)).toEqual({
            text: 'caught yesterday',
            caught: true,
            state: 'fresh',
        })
    })
})
