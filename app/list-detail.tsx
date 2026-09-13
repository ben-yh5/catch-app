import { Redirect, useLocalSearchParams } from 'expo-router'
import React from 'react'

/**
 * Retired route, kept as a redirect shell so old links keep working.
 * The list detail view now lives on the map tab as the fully raised
 * bottom sheet (list focus mode + ?view=list).
 */
export default function ListDetail() {
    const { listId } = useLocalSearchParams<{ listId: string }>()
    return (
        <Redirect href={`/(tabs)/map?listId=${listId ?? ''}&view=list` as any} />
    )
}
