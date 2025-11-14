import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function MapScreen() {
    const insets = useSafeAreaInsets()

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <Text style={styles.headerTitle}>Map</Text>
            </View>
            <View style={styles.centerContainer}>
                <Ionicons
                    name="map-outline"
                    size={80}
                    color={colors.textTertiary}
                />
                <Text style={styles.comingSoonText}>Coming Soon</Text>
                <Text style={styles.descriptionText}>
                    Explore posts on an interactive map
                </Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.textPrimary,
        textAlign: 'center',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    comingSoonText: {
        fontSize: 24,
        fontWeight: '600',
        color: colors.textPrimary,
        marginTop: 20,
    },
    descriptionText: {
        fontSize: 16,
        color: colors.textTertiary,
        marginTop: 8,
        textAlign: 'center',
    },
})
