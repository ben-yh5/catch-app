/**
 * OutboxContext — owns the offline-capture queue (src/services/outbox.ts).
 *
 * Flush triggers: connectivity regained (expo-network listener), app
 * foregrounded, and sign-in/mount. Flush results surface as toasts here —
 * "posted from your outbox" on success, "didn't count" on permanent failure
 * (per docs/OFFLINE_OUTBOX.md, a failed record is never silently dropped:
 * it stays visible in the OutboxBanner with Retry/Discard).
 */

import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { usePost } from '@/context/PostContext'
import {
    discardOutboxRecord,
    enqueueOutbox,
    EnqueueOutboxInput,
    flushOutbox,
    getOutbox,
    OutboxRecord,
    retryOutboxRecord,
} from '@/services/outbox'
import * as Network from 'expo-network'
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { AppState } from 'react-native'
import { isOnlineState, isOffline } from '@/utils/network'

interface OutboxContextValue {
    /** Current user's records only */
    records: OutboxRecord[]
    queuedCount: number
    failedCount: number
    /** True while a flush is uploading */
    flushing: boolean
    enqueue: (input: Omit<EnqueueOutboxInput, 'userId'>) => Promise<void>
    discard: (id: string) => Promise<void>
    retry: (id: string) => Promise<void>
    flush: () => Promise<void>
}

const OutboxContext = createContext<OutboxContextValue | null>(null)

export function OutboxProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth()
    const { notifyPostEvent } = usePost()
    const { showToast } = useToast()
    const [allRecords, setAllRecords] = useState<OutboxRecord[]>([])
    const [flushing, setFlushing] = useState(false)
    // The flush closure is re-armed by listeners registered once — ref
    // indirection keeps the subscriptions stable across user/toast changes
    const flushRef = useRef<() => Promise<void>>(async () => {})

    const flush = useCallback(async () => {
        if (!user) return
        if (await isOffline()) return
        setFlushing(true)
        try {
            const updated = await flushOutbox(user.uid, {
                onPosted: () => {
                    showToast(
                        'success',
                        'Shot posted',
                        'A shot from your outbox was uploaded.'
                    )
                    notifyPostEvent('create', undefined, user.uid)
                },
                onCaught: (_record, newPostId) => {
                    showToast(
                        'success',
                        'Catch counted',
                        'A catch from your outbox was verified and posted.'
                    )
                    notifyPostEvent('catch', newPostId, user.uid)
                },
                onFailed: (record) => {
                    showToast(
                        'error',
                        record.kind === 'catch'
                            ? "A catch didn't count"
                            : "A shot couldn't be posted",
                        record.failureReason ??
                            'See your outbox for details.'
                    )
                },
            })
            setAllRecords(updated)
        } catch (error) {
            // Flush is opportunistic — a failure here leaves records queued
            // for the next trigger, nothing is lost
            console.warn('[Outbox] Flush error:', error)
        } finally {
            setFlushing(false)
        }
    }, [user, showToast, notifyPostEvent])
    flushRef.current = flush

    // Initial load + flush attempt whenever the signed-in user changes
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const records = await getOutbox()
            if (!cancelled) setAllRecords(records)
            if (user) flushRef.current()
        })()
        return () => {
            cancelled = true
        }
    }, [user])

    // Connectivity regained → flush
    useEffect(() => {
        const sub = Network.addNetworkStateListener((state) => {
            if (isOnlineState(state)) flushRef.current()
        })
        return () => sub.remove()
    }, [])

    // App foregrounded → flush (covers connectivity changes missed while
    // backgrounded, where listeners may not fire)
    useEffect(() => {
        const sub = AppState.addEventListener('change', (status) => {
            if (status === 'active') flushRef.current()
        })
        return () => sub.remove()
    }, [])

    const enqueue = useCallback(
        async (input: Omit<EnqueueOutboxInput, 'userId'>) => {
            if (!user) throw new Error('Not signed in')
            const updated = await enqueueOutbox({ ...input, userId: user.uid })
            setAllRecords(updated)
        },
        [user]
    )

    const discard = useCallback(async (id: string) => {
        setAllRecords(await discardOutboxRecord(id))
    }, [])

    const retry = useCallback(
        async (id: string) => {
            setAllRecords(await retryOutboxRecord(id))
            flushRef.current()
        },
        []
    )

    const value = useMemo<OutboxContextValue>(() => {
        const records = user
            ? allRecords.filter((r) => r.userId === user.uid)
            : []
        return {
            records,
            queuedCount: records.filter((r) => r.status === 'queued').length,
            failedCount: records.filter((r) => r.status === 'failed').length,
            flushing,
            enqueue,
            discard,
            retry,
            flush,
        }
    }, [allRecords, user, flushing, enqueue, discard, retry, flush])

    return (
        <OutboxContext.Provider value={value}>
            {children}
        </OutboxContext.Provider>
    )
}

export function useOutbox(): OutboxContextValue {
    const context = useContext(OutboxContext)
    if (!context) {
        throw new Error('useOutbox must be used within OutboxProvider')
    }
    return context
}
