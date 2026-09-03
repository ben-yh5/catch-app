/**
 * CatchIssuesPanel - Persistent list of validation problems on the preview
 * screen, with recovery actions.
 *
 * Replaces transient rejection toasts: every failed check from the last
 * attempt stays visible until the user retakes the photo or resolves the
 * problem, instead of revealing one failure per attempt for 3 seconds.
 */

import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import {
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'

export interface CatchIssue {
    title: string
    message: string
    /** A new photo is needed — the confirm button stays disabled until retake */
    requiresRetake?: boolean
    /** Show an "Open Settings" button (permission problems) */
    action?: 'settings'
}

interface CatchIssuesPanelProps {
    issues: CatchIssue[]
    onRetake?: () => void
    /** Shown when no issue requires a retake (e.g. walk closer, then retry) */
    onTryAgain?: () => void
}

export default function CatchIssuesPanel({
    issues,
    onRetake,
    onTryAgain,
}: CatchIssuesPanelProps) {
    if (issues.length === 0) return null

    const needsRetake = issues.some((i) => i.requiresRetake)
    const needsSettings = issues.some((i) => i.action === 'settings')

    return (
        <View style={styles.container} accessibilityRole="alert">
            {issues.map((issue, index) => (
                <View
                    key={`${issue.title}-${index}`}
                    style={[styles.issueRow, index > 0 && styles.issueRowGap]}
                >
                    <Ionicons
                        name="warning"
                        size={18}
                        color={colors.pinLostPlace}
                        style={styles.issueIcon}
                    />
                    <View style={styles.issueTextContainer}>
                        <Text style={styles.issueTitle}>{issue.title}</Text>
                        <Text style={styles.issueMessage}>{issue.message}</Text>
                    </View>
                </View>
            ))}

            <View style={styles.actions}>
                {onRetake && (
                    <TouchableOpacity
                        style={[
                            styles.actionButton,
                            needsRetake
                                ? styles.actionButtonPrimary
                                : styles.actionButtonSecondary,
                        ]}
                        onPress={onRetake}
                        accessibilityLabel="Retake photo"
                        accessibilityRole="button"
                    >
                        <Ionicons
                            name="camera-reverse-outline"
                            size={18}
                            color={
                                needsRetake ? colors.white : colors.primary
                            }
                        />
                        <Text
                            style={[
                                styles.actionText,
                                needsRetake
                                    ? styles.actionTextPrimary
                                    : styles.actionTextSecondary,
                            ]}
                        >
                            Retake Photo
                        </Text>
                    </TouchableOpacity>
                )}
                {!needsRetake && onTryAgain && (
                    <TouchableOpacity
                        style={[styles.actionButton, styles.actionButtonPrimary]}
                        onPress={onTryAgain}
                        accessibilityLabel="Try again"
                        accessibilityRole="button"
                    >
                        <Ionicons
                            name="refresh"
                            size={18}
                            color={colors.white}
                        />
                        <Text
                            style={[styles.actionText, styles.actionTextPrimary]}
                        >
                            Try Again
                        </Text>
                    </TouchableOpacity>
                )}
                {needsSettings && (
                    <TouchableOpacity
                        style={[
                            styles.actionButton,
                            styles.actionButtonSecondary,
                        ]}
                        onPress={() => Linking.openSettings()}
                        accessibilityLabel="Open settings"
                        accessibilityRole="button"
                        accessibilityHint="Opens system settings for this app"
                    >
                        <Ionicons
                            name="settings-outline"
                            size={18}
                            color={colors.primary}
                        />
                        <Text
                            style={[
                                styles.actionText,
                                styles.actionTextSecondary,
                            ]}
                        >
                            Open Settings
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.cardElevated,
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.pinLostPlace + '66',
    },
    issueRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    issueRowGap: {
        marginTop: 10,
    },
    issueIcon: {
        marginTop: 1,
    },
    issueTextContainer: {
        flex: 1,
        gap: 2,
    },
    issueTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    issueMessage: {
        fontSize: 13,
        color: colors.textSecondary,
        lineHeight: 18,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 12,
    },
    actionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: 10,
    },
    actionButtonPrimary: {
        backgroundColor: colors.primary,
    },
    actionButtonSecondary: {
        borderWidth: 1,
        borderColor: colors.primary,
    },
    actionText: {
        fontSize: 14,
        fontWeight: '600',
    },
    actionTextPrimary: {
        color: colors.white,
    },
    actionTextSecondary: {
        color: colors.primary,
    },
})
