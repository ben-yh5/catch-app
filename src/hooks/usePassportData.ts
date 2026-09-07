/**
 * usePassportData - Loads a user's passport city stamps.
 *
 * Shared by the profile Passport tab (PassportView) and the full-screen
 * book (/passport route). Own passports read user_coverage directly;
 * others' go through the getPassport callable, which honors their
 * passportPublic setting — a denial surfaces as `isPrivate`, not an
 * error.
 */

import {
    getPassportData,
    getPublicPassportData,
    PassportData,
} from '@/utils/passportQueries'
import { useCallback, useEffect, useState } from 'react'

export function usePassportData(
    userId: string | undefined,
    isOwnProfile: boolean
) {
    const [passport, setPassport] = useState<PassportData | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(false)
    const [isPrivate, setIsPrivate] = useState(false)

    const load = useCallback(async () => {
        if (!userId) return
        setLoading(true)
        setLoadError(false)
        setIsPrivate(false)
        try {
            const data = isOwnProfile
                ? await getPassportData(userId)
                : await getPublicPassportData(userId)
            setPassport(data)
        } catch (e: any) {
            if (e?.code === 'functions/permission-denied') {
                setIsPrivate(true)
            } else {
                console.error('Error loading passport:', e)
                setLoadError(true)
            }
        } finally {
            setLoading(false)
        }
    }, [userId, isOwnProfile])

    useEffect(() => {
        load()
    }, [load])

    return { passport, loading, loadError, isPrivate, reload: load }
}
