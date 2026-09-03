import { useToast } from '@/components/ui/Toast'
import Constants from 'expo-constants'
import { PRIVACY_POLICY_URL, openLegalUrl } from '@/constants/legal'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function SettingsScreen() {
    const {
        user,
        logout,
        deleteAccount,
        dataContributionEnabled,
        toggleDataContribution,
        passportPublic,
        togglePassportPublic,
        notificationSettings,
        toggleNotificationSetting,
    } = useAuth()
    const { showToast } = useToast()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const [deleting, setDeleting] = useState(false)

    // Toggles revert optimistic state and rethrow on save failure — surface
    // it so a snapped-back switch doesn't read as a flaky UI
    const handleToggleNotification = (
        type: 'notifyOnCatch' | 'notifyOnFollow',
        enabled: boolean
    ) => {
        toggleNotificationSetting(type, enabled).catch(() =>
            showToast(
                'error',
                "Couldn't save setting",
                'Check your connection and try again.'
            )
        )
    }

    const handleToggleDataContribution = (enabled: boolean) => {
        toggleDataContribution(enabled).catch(() =>
            showToast(
                'error',
                "Couldn't save setting",
                'Check your connection and try again.'
            )
        )
    }

    const handleTogglePassportPublic = (enabled: boolean) => {
        togglePassportPublic(enabled).catch(() =>
            showToast(
                'error',
                "Couldn't save setting",
                'Check your connection and try again.'
            )
        )
    }

    const handleDeleteAccount = () => {
        Alert.alert(
            'Delete Account',
            'This will permanently delete all your data including posts, catches, lists, and account information. This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                        Alert.alert(
                            'Are you absolutely sure?',
                            'All your data will be permanently deleted. This action is irreversible.',
                            [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                    text: 'Delete Forever',
                                    style: 'destructive',
                                    onPress: async () => {
                                        setDeleting(true)
                                        try {
                                            // Deletes server-side data then
                                            // signs out locally, which routes
                                            // back to /login
                                            await deleteAccount()
                                        } catch (error: any) {
                                            setDeleting(false)
                                            showToast(
                                                'error',
                                                'Delete Failed',
                                                error.message ||
                                                    'Please try again.'
                                            )
                                        }
                                    },
                                },
                            ]
                        )
                    },
                },
            ]
        )
    }

    const handleLogout = () => {
        Alert.alert('Logout', 'Are you sure you want to logout?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Logout',
                style: 'default',
                onPress: async () => {
                    try {
                        await logout()
                    } catch (error: any) {
                        showToast('error', 'Logout Failed', error.message)
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
                    Settings
                </Text>
                <View style={styles.placeholder} />
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.section}>
                    <Text
                        style={styles.sectionTitle}
                        accessibilityRole="header"
                    >
                        Privacy & Data
                    </Text>
                    <View style={styles.settingItem}>
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>
                                Improve Catch AI
                            </Text>
                            <Text style={styles.settingDescription}>
                                Allow Catch to use your matches to train our
                                view verification model. Photos are anonymized.
                            </Text>
                        </View>
                        <Switch
                            value={dataContributionEnabled}
                            onValueChange={handleToggleDataContribution}
                            trackColor={{
                                false: colors.border,
                                true: colors.primary,
                            }}
                            thumbColor={colors.inverseTextPrimary}
                            accessibilityLabel="Improve Catch AI"
                            accessibilityRole="switch"
                            accessibilityState={{
                                checked: dataContributionEnabled,
                            }}
                        />
                    </View>

                    <View style={[styles.settingItem, { marginTop: 12 }]}>
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>
                                Public Passport
                            </Text>
                            <Text style={styles.settingDescription}>
                                Let other players see the city stamps in your
                                passport. Your exact locations are never
                                shared.
                            </Text>
                        </View>
                        <Switch
                            value={passportPublic}
                            onValueChange={handleTogglePassportPublic}
                            trackColor={{
                                false: colors.border,
                                true: colors.primary,
                            }}
                            thumbColor={colors.inverseTextPrimary}
                            accessibilityLabel="Public Passport"
                            accessibilityRole="switch"
                            accessibilityState={{
                                checked: passportPublic,
                            }}
                        />
                    </View>
                </View>

                {/* Notifications Section */}
                <View style={styles.section}>
                    <Text
                        style={styles.sectionTitle}
                        accessibilityRole="header"
                    >
                        Notifications
                    </Text>

                    <View style={styles.settingItem}>
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>New Catches</Text>
                            <Text style={styles.settingDescription}>
                                Get notified when someone stands where you
                                stood and catches your shot.
                            </Text>
                        </View>
                        <Switch
                            value={notificationSettings.notifyOnCatch}
                            onValueChange={(val) =>
                                handleToggleNotification('notifyOnCatch', val)
                            }
                            trackColor={{
                                false: colors.border,
                                true: colors.primary,
                            }}
                            thumbColor={colors.inverseTextPrimary}
                            accessibilityLabel="New Catches notifications"
                            accessibilityRole="switch"
                            accessibilityState={{
                                checked: notificationSettings.notifyOnCatch,
                            }}
                        />
                    </View>

                    <View style={[styles.settingItem, { marginTop: 12 }]}>
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>
                                New Followers
                            </Text>
                            <Text style={styles.settingDescription}>
                                Get notified when someone follows you.
                            </Text>
                        </View>
                        <Switch
                            value={notificationSettings.notifyOnFollow}
                            onValueChange={(val) =>
                                handleToggleNotification('notifyOnFollow', val)
                            }
                            trackColor={{
                                false: colors.border,
                                true: colors.primary,
                            }}
                            thumbColor={colors.inverseTextPrimary}
                            accessibilityLabel="New Followers notifications"
                            accessibilityRole="switch"
                            accessibilityState={{
                                checked: notificationSettings.notifyOnFollow,
                            }}
                        />
                    </View>
                </View>

                {/* Legal Section */}
                <View style={styles.section}>
                    <Text
                        style={styles.sectionTitle}
                        accessibilityRole="header"
                    >
                        Legal
                    </Text>
                    <TouchableOpacity
                        style={styles.settingItem}
                        onPress={() => openLegalUrl(PRIVACY_POLICY_URL)}
                        accessibilityLabel="Privacy Policy"
                        accessibilityRole="link"
                        accessibilityHint="Opens the privacy policy in your browser"
                    >
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>
                                Privacy Policy
                            </Text>
                        </View>
                        <Ionicons
                            name="open-outline"
                            size={20}
                            color={colors.textTertiary}
                        />
                    </TouchableOpacity>
                </View>

                {/* Account Section */}
                <View style={styles.section}>
                    <Text
                        style={styles.sectionTitle}
                        accessibilityRole="header"
                    >
                        Account
                    </Text>
                    {user?.email ? (
                        <View style={styles.settingItem}>
                            <View style={styles.settingTextContainer}>
                                <Text style={styles.settingLabel}>
                                    Signed in as
                                </Text>
                                <Text style={styles.settingDescription}>
                                    {user.email}
                                </Text>
                            </View>
                        </View>
                    ) : null}
                    <TouchableOpacity
                        style={styles.settingItem}
                        onPress={() => router.push('/blocked-users' as any)}
                        accessibilityLabel="Blocked Users"
                        accessibilityRole="button"
                        accessibilityHint="View and unblock blocked users"
                    >
                        <View style={styles.settingTextContainer}>
                            <Text style={styles.settingLabel}>
                                Blocked Users
                            </Text>
                            <Text style={styles.settingDescription}>
                                See and unblock people you&apos;ve blocked
                            </Text>
                        </View>
                        <Ionicons
                            name="chevron-forward"
                            size={20}
                            color={colors.textTertiary}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[
                            styles.settingItem,
                            { borderColor: colors.danger },
                        ]}
                        onPress={handleDeleteAccount}
                        disabled={deleting}
                        accessibilityLabel="Delete Account"
                        accessibilityRole="button"
                        accessibilityHint="Permanently delete your account and all data"
                        accessibilityState={{ disabled: deleting }}
                    >
                        <View style={styles.settingTextContainer}>
                            <Text
                                style={[
                                    styles.settingLabel,
                                    { color: colors.danger },
                                ]}
                            >
                                Delete Account
                            </Text>
                            <Text style={styles.settingDescription}>
                                Permanently delete all your data
                            </Text>
                        </View>
                        {deleting ? (
                            <ActivityIndicator color={colors.danger} />
                        ) : (
                            <Ionicons
                                name="trash-outline"
                                size={20}
                                color={colors.danger}
                            />
                        )}
                    </TouchableOpacity>
                </View>

                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={handleLogout}
                    accessibilityLabel="Logout"
                    accessibilityRole="button"
                >
                    <Ionicons
                        name="log-out-outline"
                        size={20}
                        color={colors.textPrimary}
                    />
                    <Text style={styles.logoutButtonText}>Logout</Text>
                </TouchableOpacity>

                <Text style={styles.versionText}>
                    Catch v{Constants.expoConfig?.version || '?'}
                </Text>
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    versionText: {
        textAlign: 'center',
        fontSize: 12,
        color: colors.textTertiary,
        paddingVertical: 24,
    },
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
