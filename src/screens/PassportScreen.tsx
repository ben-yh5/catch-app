/**
 * PassportScreen - Standalone route for your own passport
 *
 * The passport primarily lives as a tab on the profile
 * (UnifiedProfileView); this route exists for deep links and direct
 * navigation. Renders PassportView for the signed-in user.
 */

import PassportView from '@/components/PassportView'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/tokens'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React from 'react'
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function PassportScreen() {
    const { user } = useAuth()
    const router = useRouter()
    const insets = useSafeAreaInsets()

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                    accessibilityLabel="Go back"
                    accessibilityRole="button"
                >
                    <Ionicons
                        name="arrow-back"
                        size={24}
                        color={colors.textPrimary}
                    />
                </TouchableOpacity>
                <Text style={styles.headerTitle} accessibilityRole="header">
                    Passport
                </Text>
            </View>

            {user && (
                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + spacing.xl,
                    }}
                >
                    <PassportView userId={user.uid} isOwnProfile />
                </ScrollView>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
    },
    backButton: {
        padding: spacing.sm,
        marginRight: spacing.sm,
    },
    headerTitle: {
        flex: 1,
        fontSize: typography.heading,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
})
