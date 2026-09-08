/**
 * PassportBook - True-book passport: page faces and leaf page turns.
 *
 * The open book is one spread — two page-sized faces meeting at the
 * center crease, each face with a faint dotted guide line and up
 * to two city stamps (2×2 per spread). Turning a page animates a real
 * leaf pivoting at the crease: front = outgoing page, back = incoming
 * page, faces swapping at edge-on. Swipe (drag follows the finger,
 * springs to commit or cancel) or tap the left/right page to turn. A
 * back-turn on the first spread closes the book (onCloseBook).
 *
 * CRITICAL — two rules learned the hard way on device:
 * 1. No 3D perspective transform at rest: RN hit-testing is unreliable
 *    under perspective transforms, so resting pages carry none.
 * 2. No React state change mid-gesture: on the new architecture a
 *    re-render of the responder's subtree kills the active
 *    PanResponder (moves stop arriving). Both leaves are therefore
 *    pre-mounted — the resting leaf IS the visible page — and dragging
 *    writes only to shared values; setSpreadIndex happens at turn
 *    completion, after the gesture has ended.
 *
 * Stamp jitter is deterministic (seeded from the city key): stamps may
 * overlap and bleed across the dotted line vertically, but each face
 * clips its own stamps, so ink never crosses the crease or page edge.
 *
 * Ink encodes how you know the city — pink if you've caught there (the
 * verified act, the prestige ink), blue if you've only posted. One stamp
 * per city regardless of activity volume: the passport records places,
 * not acts. Pages are unbounded — no totals, no empty pre-printed slots.
 */

import { StampFace, STAMP_INK, stampDate } from '@/components/PassportStamp'
import { colors } from '@/theme/colors'
import { INK_OPACITY, paper } from '@/theme/document'
import { radii, spacing } from '@/theme/tokens'
import { CityStamp } from '@/utils/passportQueries'
import React, { useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import Animated, {
    Easing,
    ReduceMotion,
    runOnJS,
    SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated'

const STAMPS_PER_FACE = 2
const ROW_FRACTIONS = [0.27, 0.73]
const EDGE_PAD = 4
const TURN_MS = 240
const COMMIT_THRESHOLD = 0.3
const TAP_SLOP = 8
// A drag must travel this far before its direction is trusted — the
// first move events are finger jitter and locking direction on them
// eats swipes (wrong-direction turn at progress 0, cancelled on release)
const DIR_SLOP = 6
// Drag distance (fraction of page width) for a full manual turn
const DRAG_RATIO = 1.1

type TurnDir = 'fwd' | 'back'

/** Small deterministic hash so each city's jitter is stable */
const hashKey = (s: string): number => {
    let h = 0
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0
    }
    return Math.abs(h)
}

const clamp = (v: number, min: number, max: number): number =>
    Math.min(Math.max(v, min), max)

const inkFor = (city: CityStamp): string =>
    city.caught > 0 ? STAMP_INK.caught : STAMP_INK.posted

const chunk = <T,>(items: T[], size: number): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size))
    }
    return out
}

interface PageFaceProps {
    face: CityStamp[] | undefined
    pageWidth: number
    pageHeight: number
}

/** One page face: paper, dotted guide line, stamps. Blank when no face. */
function PageFace({ face, pageWidth, pageHeight }: PageFaceProps) {
    const stampSize = Math.min(124, pageWidth - 24)
    const half = stampSize / 2
    return (
        <View
            style={[styles.pageFace, { width: pageWidth, height: pageHeight }]}
        >
            <View style={styles.dottedLine} />
            {face?.map((city, slot) => {
                const h = hashKey(city.key)
                const cx = clamp(
                    pageWidth / 2 + ((h % 21) - 10),
                    half + EDGE_PAD,
                    pageWidth - half - EDGE_PAD
                )
                const cy = clamp(
                    ROW_FRACTIONS[slot % ROW_FRACTIONS.length] * pageHeight +
                        (((h >> 5) % 37) - 18),
                    half + EDGE_PAD,
                    pageHeight - half - EDGE_PAD
                )
                return (
                    <View
                        key={city.key}
                        style={[
                            styles.stampAnchor,
                            {
                                left: cx - half,
                                top: cy - half,
                                transform: [
                                    {
                                        rotate: `${((h >> 10) % 9) - 4}deg`,
                                    },
                                ],
                            },
                        ]}
                    >
                        <StampFace
                            ink={inkFor(city)}
                            city={city.city.toUpperCase()}
                            dateText={
                                city.lastActivity
                                    ? stampDate(city.lastActivity)
                                    : undefined
                            }
                            size={stampSize}
                        />
                    </View>
                )
            })}
        </View>
    )
}

interface LeafProps {
    dir: TurnDir
    /** 0 = no turn, 1 = fwd turning, -1 = back turning */
    activeDir: SharedValue<number>
    progress: SharedValue<number>
    pageWidth: number
    pageHeight: number
    frontFace: CityStamp[] | undefined
    backFace: CityStamp[] | undefined
}

/**
 * A pre-mounted turning page. At rest (its direction inactive or
 * progress 0) it lies flat with NO transform — it IS the visible page.
 * While its direction is turning it pivots at the crease.
 */
function Leaf({
    dir,
    activeDir,
    progress,
    pageWidth,
    pageHeight,
    frontFace,
    backFace,
}: LeafProps) {
    const dirValue = dir === 'fwd' ? 1 : -1
    const containerStyle = useAnimatedStyle(() => {
        const active = activeDir.value === dirValue
        const p = active ? progress.value : 0
        // Lifted leaf must cover the resting one on the far side
        const zIndex = active ? 3 : 1
        if (p <= 0.001) {
            return { zIndex, transform: [] }
        }
        const angle = (dir === 'fwd' ? -180 : 180) * p
        const pivot = dir === 'fwd' ? -pageWidth / 2 : pageWidth / 2
        return {
            zIndex,
            transform: [
                { perspective: 1600 },
                { translateX: pivot },
                { rotateY: `${angle}deg` },
                { translateX: -pivot },
            ],
        }
    })
    const frontStyle = useAnimatedStyle(() => ({
        opacity:
            activeDir.value !== dirValue || progress.value < 0.5 ? 1 : 0,
    }))
    const backStyle = useAnimatedStyle(() => ({
        opacity:
            activeDir.value === dirValue && progress.value >= 0.5 ? 1 : 0,
    }))
    return (
        <Animated.View
            pointerEvents="none"
            style={[
                styles.leaf,
                {
                    width: pageWidth,
                    height: pageHeight,
                    left: dir === 'fwd' ? pageWidth : 0,
                },
                containerStyle,
            ]}
        >
            <Animated.View style={[StyleSheet.absoluteFill, frontStyle]}>
                <PageFace
                    face={frontFace}
                    pageWidth={pageWidth}
                    pageHeight={pageHeight}
                />
            </Animated.View>
            {/* Pre-mirrored so it reads correctly once the leaf lands */}
            <Animated.View
                style={[StyleSheet.absoluteFill, styles.leafBack, backStyle]}
            >
                <PageFace
                    face={backFace}
                    pageWidth={pageWidth}
                    pageHeight={pageHeight}
                />
            </Animated.View>
        </Animated.View>
    )
}

interface PassportBookProps {
    cities: CityStamp[]
    pageWidth: number
    pageHeight: number
    /** Back-turn past the first spread — the reader is shutting the book */
    onCloseBook?: () => void
}

export default function PassportBook({
    cities,
    pageWidth,
    pageHeight,
    onCloseBook,
}: PassportBookProps) {
    const spreadWidth = pageWidth * 2

    // Book order: oldest activity first, like pages filling front to back.
    // (lastActivity is the only date on the stamp data — a city hops back
    // when re-visited; a server-side firstActivity field would pin it.)
    const faces = useMemo(() => {
        const ordered = [...cities].sort(
            (a, b) =>
                (a.lastActivity?.getTime() ?? 0) -
                (b.lastActivity?.getTime() ?? 0)
        )
        return chunk(ordered, STAMPS_PER_FACE)
    }, [cities])
    const spreadCount = Math.max(1, Math.ceil(faces.length / 2))

    const [spreadIndex, setSpreadIndex] = useState(0)
    const canFwd = spreadIndex < spreadCount - 1
    const canBack = spreadIndex > 0

    const turnRef = useRef<TurnDir | null>(null)
    const settlingRef = useRef(false)
    const tapXRef = useRef(0)
    const spreadViewRef = useRef<View>(null)
    const spreadXRef = useRef(0)
    const activeDir = useSharedValue(0)
    const progress = useSharedValue(0)

    // Gesture-time control writes ONLY refs and shared values — never
    // React state — so the responder survives the whole drag
    const beginTurn = (dir: TurnDir): boolean => {
        if (turnRef.current || settlingRef.current) return false
        if (dir === 'fwd' && !canFwd) return false
        if (dir === 'back' && !canBack) return false
        progress.value = 0
        turnRef.current = dir
        activeDir.value = dir === 'fwd' ? 1 : -1
        return true
    }

    // React state changes only here — after the gesture is over. The
    // post-commit spread at progress 0 is pixel-identical to the leaf at
    // progress 1, so the swap is seamless.
    const completeTurn = (commit: boolean) => {
        const dir = turnRef.current
        if (commit && dir) {
            setSpreadIndex((i) => i + (dir === 'fwd' ? 1 : -1))
        }
        turnRef.current = null
        settlingRef.current = false
        activeDir.value = 0
        progress.value = 0
    }

    const settleTurn = (commit: boolean) => {
        if (!turnRef.current || settlingRef.current) return
        settlingRef.current = true
        const remaining = commit ? 1 - progress.value : progress.value
        const duration = Math.max(120, TURN_MS * remaining)
        progress.value = withTiming(
            commit ? 1 : 0,
            {
                duration,
                easing: Easing.out(Easing.cubic),
                reduceMotion: ReduceMotion.System,
            },
            () => {
                runOnJS(completeTurn)(commit)
            }
        )
    }

    // Ref indirection keeps the PanResponder (created once) reading fresh
    // state — same pattern as PostScreen's focus callbacks
    const moveRef = useRef<(dx: number) => void>(() => {})
    moveRef.current = (dx) => {
        if (settlingRef.current) return
        if (!turnRef.current) {
            // Wait until the drag direction is unambiguous
            if (Math.abs(dx) < DIR_SLOP) return
            if (!beginTurn(dx < 0 ? 'fwd' : 'back')) return
        }
        const raw = turnRef.current === 'fwd' ? -dx : dx
        progress.value = clamp(raw / (pageWidth * DRAG_RATIO), 0, 1)
    }
    const releaseRef = useRef<(dx: number, vx: number, dy: number) => void>(
        () => {}
    )
    releaseRef.current = (dx, vx, dy) => {
        if (turnRef.current) {
            const dir = turnRef.current
            // Wrong-direction rescue: the leaf never lifted but the drag
            // clearly went the other way — run the intended turn instead
            // of silently cancelling
            const oppositeIntent = dir === 'fwd' ? dx > TAP_SLOP : dx < -TAP_SLOP
            if (progress.value < 0.02 && oppositeIntent) {
                turnRef.current = null
                activeDir.value = 0
                const opposite: TurnDir = dir === 'fwd' ? 'back' : 'fwd'
                if (beginTurn(opposite)) {
                    settleTurn(true)
                } else if (opposite === 'back' && spreadIndex === 0) {
                    onCloseBook?.()
                }
                return
            }
            const flung = dir === 'fwd' ? vx < -0.3 : vx > 0.3
            settleTurn(progress.value > COMMIT_THRESHOLD || flung)
            return
        }
        // No turn ran (bounds, or moves never arrived — swipe still
        // resolves here as a full animated turn). A tap must be still in
        // BOTH axes — a vertical drag is not a page tap (matters inline,
        // where the tab content can scroll).
        const isTap = Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP
        if (!isTap && Math.abs(dy) > Math.abs(dx)) return
        const dir: TurnDir = isTap
            ? tapXRef.current > spreadWidth / 2
                ? 'fwd'
                : 'back'
            : dx < 0
              ? 'fwd'
              : 'back'
        if (beginTurn(dir)) {
            settleTurn(true)
            return
        }
        // A back intent on the first spread shuts the book
        if (dir === 'back' && spreadIndex === 0) {
            onCloseBook?.()
        }
    }
    const cancelRef = useRef<() => void>(() => {})
    cancelRef.current = () => {
        if (turnRef.current) settleTurn(false)
    }

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, g) =>
                Math.abs(g.dx) > TAP_SLOP && Math.abs(g.dx) > Math.abs(g.dy),
            onPanResponderGrant: (evt) => {
                // pageX minus the spread's window origin — locationX is
                // relative to whichever deep child was touched, not the
                // spread, so it can't determine the tapped side
                tapXRef.current = evt.nativeEvent.pageX - spreadXRef.current
            },
            onPanResponderMove: (_, g) => moveRef.current(g.dx),
            onPanResponderRelease: (_, g) =>
                releaseRef.current(g.dx, g.vx, g.dy),
            onPanResponderTerminate: () => cancelRef.current(),
        })
    ).current

    // Both leaves stay mounted; the resting leaf IS the visible page.
    // Beneath each sits the face it would reveal when lifted.
    const curLeft = faces[spreadIndex * 2]
    const curRight = faces[spreadIndex * 2 + 1]
    const prevLeft = faces[(spreadIndex - 1) * 2]
    const prevRight = faces[(spreadIndex - 1) * 2 + 1]
    const nextLeft = faces[(spreadIndex + 1) * 2]
    const nextRight = faces[(spreadIndex + 1) * 2 + 1]

    return (
        <View
            style={{ width: spreadWidth }}
            accessibilityLabel="Passport pages"
        >
            <View
                ref={spreadViewRef}
                onLayout={() => {
                    spreadViewRef.current?.measureInWindow((x) => {
                        spreadXRef.current = x
                    })
                }}
                style={[
                    styles.spread,
                    { width: spreadWidth, height: pageHeight },
                ]}
                {...panResponder.panHandlers}
            >
                <View style={styles.pagesRow}>
                    <PageFace
                        face={canBack ? prevLeft : curLeft}
                        pageWidth={pageWidth}
                        pageHeight={pageHeight}
                    />
                    <PageFace
                        face={canFwd ? nextRight : curRight}
                        pageWidth={pageWidth}
                        pageHeight={pageHeight}
                    />
                </View>
                {canBack && (
                    <Leaf
                        dir="back"
                        activeDir={activeDir}
                        progress={progress}
                        pageWidth={pageWidth}
                        pageHeight={pageHeight}
                        frontFace={curLeft}
                        backFace={prevRight}
                    />
                )}
                {canFwd && (
                    <Leaf
                        dir="fwd"
                        activeDir={activeDir}
                        progress={progress}
                        pageWidth={pageWidth}
                        pageHeight={pageHeight}
                        frontFace={curRight}
                        backFace={nextLeft}
                    />
                )}
                <View style={styles.crease} pointerEvents="none" />
            </View>
            {spreadCount > 1 && (
                <View style={styles.dots} pointerEvents="none">
                    {Array.from({ length: spreadCount }, (_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.dot,
                                i === spreadIndex && styles.dotActive,
                            ]}
                        />
                    ))}
                </View>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    spread: {
        borderRadius: radii.md,
        overflow: 'hidden',
        backgroundColor: paper.surface,
    },
    pagesRow: {
        flexDirection: 'row',
    },
    pageFace: {
        backgroundColor: paper.surface,
        overflow: 'hidden',
    },
    leaf: {
        position: 'absolute',
        top: 0,
    },
    leafBack: {
        transform: [{ rotateY: '180deg' }],
    },
    crease: {
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: 1,
        marginLeft: -0.5,
        backgroundColor: paper.crease,
        zIndex: 4,
    },
    dottedLine: {
        position: 'absolute',
        top: '50%',
        left: spacing.sm,
        right: spacing.sm,
        height: 1,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: paper.guide,
    },
    stampAnchor: {
        position: 'absolute',
        opacity: INK_OPACITY,
    },
    dots: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: spacing.sm,
        marginTop: spacing.lg,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.border,
    },
    dotActive: {
        backgroundColor: colors.textTertiary,
    },
})
