/**
 * Offline outbox — capture now, post on reconnect.
 *
 * Coordinates + photo are already fixed at shutter press, so a shot taken
 * offline loses nothing by uploading later: the queued record carries the
 * shutter-time coords/heading/pitch/capturedAt, and only `createdAt` (submit
 * time) is stamped at flush. Design doc: docs/OFFLINE_OUTBOX.md.
 *
 * Storage layout:
 * - Photos: copied into `${documentDirectory}outbox/` (the cropped square in
 *   the cache directory can be purged by the OS; documents can't)
 * - Records: one JSON array under the AsyncStorage key `outbox:v1`
 *
 * Catches: `validateCatch` (and the 10-minute permit it issues) MUST run at
 * flush time, not capture time — the callable takes the stored shutter-time
 * coords, which is no trust change from the online path. The visual matcher
 * (the Judge) deliberately does NOT run at flush: it's a capture-time UX
 * filter whose remedy is "retake", which is impossible after the fact — the
 * server-side location gate is the authority. A catch that fails validation
 * at flush is marked `failed` with a reason and surfaced in the outbox UI —
 * never silently dropped.
 */

import { db, storage } from '@/services/firebase'
import { addPostToList } from '@/utils/listUtils'
import { uploadImageWithProgress } from '@/utils/uploadImage'
import { validateCatch } from '@/utils/catchValidation'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import { addDoc, collection, doc, getDoc } from 'firebase/firestore'
import { ref } from 'firebase/storage'
import { geohashForLocation } from 'geofire-common'

const STORAGE_KEY = 'outbox:v1'
const OUTBOX_DIR = `${FileSystem.documentDirectory}outbox/`

export type OutboxKind = 'original' | 'catch'
export type OutboxStatus = 'queued' | 'failed'

export interface OutboxRecord {
    id: string
    userId: string
    kind: OutboxKind
    status: OutboxStatus
    /** Human-readable reason, set when status === 'failed' */
    failureReason?: string
    /** file:// URI inside the outbox directory (cropped 1080 square) */
    imageUri: string
    latitude: number
    longitude: number
    heading: number | null
    pitch: number | null
    /** Shutter time, ms epoch — becomes the post's capturedAt */
    capturedAt: number
    /** Enqueue time, ms epoch — display only; createdAt is stamped at flush */
    queuedAt: number
    caption: string
    listIds: string[]
    /** Catch only */
    rootPostId?: string
    attempts: number
}

export interface EnqueueOutboxInput {
    userId: string
    kind: OutboxKind
    imageUri: string
    latitude: number
    longitude: number
    heading: number | null
    pitch: number | null
    capturedAt: number
    caption: string
    listIds: string[]
    rootPostId?: string
}

export interface OutboxFlushEvents {
    onPosted: (record: OutboxRecord) => void
    onCaught: (record: OutboxRecord, newPostId: string) => void
    onFailed: (record: OutboxRecord) => void
}

async function loadRecords(): Promise<OutboxRecord[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        // A corrupt queue is unrecoverable data — keep the raw value aside
        // for post-mortem instead of overwriting it silently
        console.error('[Outbox] Corrupt queue JSON; preserving as backup')
        await AsyncStorage.setItem(`${STORAGE_KEY}:corrupt`, raw)
        return []
    }
}

async function saveRecords(records: OutboxRecord[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

async function ensureDir(): Promise<void> {
    const info = await FileSystem.getInfoAsync(OUTBOX_DIR)
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(OUTBOX_DIR, {
            intermediates: true,
        })
    }
}

async function deleteImage(uri: string): Promise<void> {
    try {
        await FileSystem.deleteAsync(uri, { idempotent: true })
    } catch (error) {
        // Orphaned file, not orphaned data — log and move on
        console.warn('[Outbox] Could not delete queued image:', error)
    }
}

export async function getOutbox(): Promise<OutboxRecord[]> {
    return loadRecords()
}

/**
 * Copies the photo into durable storage and appends a queued record.
 * Throws if the copy or persist fails — the caller must tell the user the
 * shot was NOT saved rather than pretend it was.
 */
export async function enqueueOutbox(
    input: EnqueueOutboxInput
): Promise<OutboxRecord[]> {
    await ensureDir()
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const imageUri = `${OUTBOX_DIR}${id}.jpg`
    await FileSystem.copyAsync({ from: input.imageUri, to: imageUri })

    const record: OutboxRecord = {
        id,
        userId: input.userId,
        kind: input.kind,
        status: 'queued',
        imageUri,
        latitude: input.latitude,
        longitude: input.longitude,
        heading: input.heading,
        pitch: input.pitch,
        capturedAt: input.capturedAt,
        queuedAt: Date.now(),
        caption: input.caption,
        listIds: input.listIds,
        rootPostId: input.rootPostId,
        attempts: 0,
    }

    const records = await loadRecords()
    records.push(record)
    await saveRecords(records)
    return records
}

/** Removes a record and its photo. Irreversible — confirm in the UI first. */
export async function discardOutboxRecord(
    id: string
): Promise<OutboxRecord[]> {
    const records = await loadRecords()
    const record = records.find((r) => r.id === id)
    if (record) await deleteImage(record.imageUri)
    const remaining = records.filter((r) => r.id !== id)
    await saveRecords(remaining)
    return remaining
}

/** Re-arms a failed record so the next flush retries it. */
export async function retryOutboxRecord(id: string): Promise<OutboxRecord[]> {
    const records = await loadRecords()
    const record = records.find((r) => r.id === id)
    if (record && record.status === 'failed') {
        record.status = 'queued'
        record.failureReason = undefined
        record.attempts = 0
    }
    await saveRecords(records)
    return records
}

/**
 * Firebase error codes that retrying can never fix (bad request, gone target,
 * rules rejection). Everything else — network blips, unavailable, unknown —
 * stays queued: a stuck record the user can see beats a dropped photo.
 */
function isPermanentError(error: any): boolean {
    const code: string = error?.code ?? ''
    return [
        'functions/not-found',
        'functions/failed-precondition',
        'functions/invalid-argument',
        'functions/permission-denied',
        'functions/unauthenticated',
        'permission-denied',
        'storage/unauthorized',
    ].includes(code)
}

let flushing = false

/**
 * Uploads every queued record for `userId`, serially and oldest-first.
 *
 * Per record: a permanent failure marks it `failed` (surfaced via onFailed)
 * and the flush continues; a retryable failure stops the whole flush —
 * connectivity has almost certainly dropped again, and the remaining records
 * will be picked up by the next trigger.
 */
export async function flushOutbox(
    userId: string,
    events: OutboxFlushEvents
): Promise<OutboxRecord[]> {
    if (flushing) return loadRecords()
    flushing = true
    try {
        let records = await loadRecords()
        const mine = records.filter(
            (r) => r.userId === userId && r.status === 'queued'
        )
        if (mine.length === 0) return records

        // Fail fast: never persist a placeholder author on a post
        const userDoc = await getDoc(doc(db, 'users', userId))
        const username: string | undefined = userDoc.exists()
            ? userDoc.data().username
            : undefined
        if (!username) {
            console.warn('[Outbox] No username on user doc; flush deferred')
            return records
        }

        for (const record of mine) {
            try {
                const newPostId = await uploadRecord(record, username)
                await deleteImage(record.imageUri)
                records = records.filter((r) => r.id !== record.id)
                await saveRecords(records)
                if (record.kind === 'original') {
                    events.onPosted(record)
                } else {
                    events.onCaught(record, newPostId)
                }
            } catch (error: any) {
                console.error('[Outbox] Flush failed for', record.id, error)
                record.attempts += 1
                if (isPermanentError(error)) {
                    record.status = 'failed'
                    record.failureReason = flushFailureReason(record, error)
                    await saveRecords(records)
                    events.onFailed(record)
                } else {
                    // Retryable — persist the attempt count and stop; the
                    // next connectivity/foreground trigger resumes here
                    await saveRecords(records)
                    break
                }
            }
        }
        return records
    } finally {
        flushing = false
    }
}

function flushFailureReason(record: OutboxRecord, error: any): string {
    if (record.kind === 'catch') {
        if (error?.code === 'functions/not-found') {
            return 'The original shot was deleted before your catch could upload.'
        }
        const serverMessage: string | undefined = error?.message
        return serverMessage && !serverMessage.includes('INTERNAL')
            ? serverMessage
            : "This catch couldn't be verified when it uploaded."
    }
    return "This shot was rejected when it uploaded — it can't be posted."
}

/** Runs the same write sequence as the online submit paths. */
async function uploadRecord(
    record: OutboxRecord,
    username: string
): Promise<string> {
    if (record.kind === 'catch') {
        if (!record.rootPostId) {
            // Malformed record — permanent by construction
            const err: any = new Error('Queued catch has no root post')
            err.code = 'functions/invalid-argument'
            throw err
        }
        // Gate first: issues the 10-minute permit the posts `create` rule
        // requires, exactly like the online path
        const validation = await validateCatch(
            record.rootPostId,
            record.latitude,
            record.longitude
        )
        if (!validation.isValid) {
            const err: any = new Error(
                `You were ${validation.distance} m from this shot — catches must be within ${validation.requiredDistance} m.`
            )
            err.code = 'functions/failed-precondition'
            throw err
        }
    }

    const response = await fetch(record.imageUri)
    const blob = await response.blob()
    const prefix = record.kind === 'catch' ? 'catch_' : ''
    const filename = `posts/${record.userId}/${prefix}${Date.now()}.jpg`
    const photoURL = await uploadImageWithProgress(ref(storage, filename), blob)

    const postData = {
        authorId: record.userId,
        authorUsername: username,
        photoURL,
        caption: record.caption,
        hasLocation: true,
        catchCount: 0,
        parentPostId: record.rootPostId ?? null,
        rootPostId: record.rootPostId ?? null,
        isOriginal: record.kind === 'original',
        createdAt: new Date(),
        capturedAt: new Date(record.capturedAt),
    }
    const docRef = await addDoc(collection(db, 'posts'), postData)

    const geohash = geohashForLocation([record.latitude, record.longitude])
    await addDoc(collection(db, 'post_locations'), {
        postId: docRef.id,
        latitude: record.latitude,
        longitude: record.longitude,
        heading: record.heading,
        pitch: record.pitch,
        geohash,
        createdAt: new Date(),
    })

    // Lists are best-effort here as in the online paths — the post exists,
    // so a list failure must not fail the record
    if (record.listIds.length > 0) {
        try {
            await Promise.all(
                record.listIds.map((listId) =>
                    addPostToList(listId, docRef.id)
                )
            )
        } catch (error) {
            console.error('[Outbox] Adding flushed post to lists:', error)
        }
    }

    return docRef.id
}
