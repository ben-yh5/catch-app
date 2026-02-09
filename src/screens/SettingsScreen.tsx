import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React from 'react'
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function SettingsScreen() {
    const {
        logout,
        dataContributionEnabled,
        toggleDataContribution,
        notificationSettings,
        toggleNotificationSetting
    } = useAuth()
    const router = useRouter()
    const insets = useSafeAreaInsets()

    const handleLogout = () => {
        Alert.alert('Logout', 'Are you sure you want to logout?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Logout',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await logout()
                    } catch (error: any) {
                        Alert.alert('Error', error.message)
                    }
                },
            },
        ])
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                >
                    <Ionicons
                        name="arrow-back"
                        size={24}
                        color={colors.textPrimary}
                    />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Settings</Text>
                <View style={styles.placeholder} />
            </View>

            <View style={styles.content}>
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Privacy & Data</Text>
                    <View style={styles.settingItem}>
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>Improve Catch AI</Text>
                            <Text style={styles.settingDescription}>
                                Allow Catch to use your matches to train our view verification model. Photos are anonymized.
                            </Text>
                        </View>
                        <Switch
                            value={dataContributionEnabled}
                            onValueChange={toggleDataContribution}
                            trackColor={{ false: colors.border, true: colors.primary }}
                            thumbColor={colors.inverseTextPrimary}
                        />
                    </View>
                </View>

                {/* Notifications Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Notifications</Text>

                    <View style={styles.settingItem}>
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>New Catches</Text>
                            <Text style={styles.settingDescription}>
                                Get notified when someone catches your shots and you earn royalties.
                            </Text>
                        </View>
                        <Switch
                            value={notificationSettings.notifyOnCatch}
                            onValueChange={(val) => toggleNotificationSetting('notifyOnCatch', val)}
                            trackColor={{ false: colors.border, true: colors.primary }}
                            thumbColor={colors.inverseTextPrimary}
                        />
                    </View>

                    <View style={[styles.settingItem, { marginTop: 12 }]}>
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>New Followers</Text>
                            <Text style={styles.settingDescription}>
                                Get notified when someone follows you.
                            </Text>
                        </View>
                        <Switch
                            value={notificationSettings.notifyOnFollow}
                            onValueChange={(val) => toggleNotificationSetting('notifyOnFollow', val)}
                            trackColor={{ false: colors.border, true: colors.primary }}
                            thumbColor={colors.inverseTextPrimary}
                        />
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={handleLogout}
                >
                    <Ionicons
                        name="log-out-outline"
                        size={20}
                        color={colors.textPrimary}
                    />
                    <Text style={styles.logoutButtonText}>Logout</Text>
                </TouchableOpacity>
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
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    placeholder: {
        width: 32,
    },
    content: {
        flex: 1,
        padding: 20,
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.secondary,
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 10,
        gap: 8,
    },
    logoutButtonText: {
        color: colors.textPrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    section: {
        marginBottom: 30,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textTertiary,
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    settingItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.surface,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    settingTextContainer: {
        flex: 1,
        paddingRight: 16,
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
        marginBottom: 4,
    },
    settingDescription: {
        fontSize: 13,
        color: colors.textSecondary,
        lineHeight: 18,
    },
})
