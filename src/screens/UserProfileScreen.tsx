import UnifiedProfileView from '@/components/UnifiedProfileView'
import { useLocalSearchParams } from 'expo-router'
import React from 'react'

export default function UserProfileScreen() {
    const { userId } = useLocalSearchParams<{ userId: string }>()

    if (!userId) {
        return null
    }

    return <UnifiedProfileView userId={userId} isOwnProfile={false} />
}
