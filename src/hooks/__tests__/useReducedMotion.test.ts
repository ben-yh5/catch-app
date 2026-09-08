import { act, renderHook, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo } from 'react-native'
import { useReducedMotion } from '../useReducedMotion'

describe('useReducedMotion', () => {
    let changeHandler: ((enabled: boolean) => void) | null = null
    const removeMock = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        changeHandler = null
        jest.spyOn(
            AccessibilityInfo,
            'isReduceMotionEnabled'
        ).mockResolvedValue(false)
        jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(
            ((event: string, handler: any) => {
                if (event === 'reduceMotionChanged') changeHandler = handler
                return { remove: removeMock } as any
            }) as any
        )
    })

    it('defaults to false and reads the initial system value', async () => {
        jest.spyOn(
            AccessibilityInfo,
            'isReduceMotionEnabled'
        ).mockResolvedValue(true)

        const { result } = renderHook(() => useReducedMotion())
        expect(result.current).toBe(false)
        await waitFor(() => expect(result.current).toBe(true))
    })

    it('tracks setting changes after mount', async () => {
        const { result } = renderHook(() => useReducedMotion())
        await waitFor(() => expect(changeHandler).not.toBeNull())

        act(() => changeHandler!(true))
        expect(result.current).toBe(true)

        act(() => changeHandler!(false))
        expect(result.current).toBe(false)
    })

    it('removes the listener on unmount', async () => {
        const { unmount } = renderHook(() => useReducedMotion())
        await waitFor(() => expect(changeHandler).not.toBeNull())
        unmount()
        expect(removeMock).toHaveBeenCalled()
    })
})
