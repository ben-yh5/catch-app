import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/**
 * Live-updating Reduce Motion flag. Prefer passing ReduceMotion.System in
 * reanimated animation configs where possible — this hook is for the
 * places where JS logic itself must branch (gating an auto-animation,
 * re-timing a haptic that normally syncs with a spring).
 *
 * Unlike reanimated's useReducedMotion, this tracks setting changes after
 * mount.
 */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false)

    useEffect(() => {
        let mounted = true
        AccessibilityInfo.isReduceMotionEnabled()
            .then((value) => {
                if (mounted) setReduced(value)
            })
            .catch(() => {})
        const sub = AccessibilityInfo.addEventListener(
            'reduceMotionChanged',
            setReduced
        )
        return () => {
            mounted = false
            sub.remove()
        }
    }, [])

    return reduced
}
