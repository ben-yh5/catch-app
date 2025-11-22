import UnifiedProfileView from '@/components/UnifiedProfileView'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import React from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

export default function ProfileScreen() {
    const { user } = useAuth()

    if (!user) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        )
    }

    return <UnifiedProfileView userId={user.uid} isOwnProfile={true} />
}

const styles = StyleSheet.create({
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
})
