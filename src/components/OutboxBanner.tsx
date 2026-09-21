/**
 * OutboxBanner — surfaces the offline-capture queue (docs/OFFLINE_OUTBOX.md).
 *
 * Renders nothing when the outbox is empty. Queued shots get one quiet
 * status line (uploading happens automatically); failed records each get a
 * row with the reason and explicit Retry / Discard actions — a failed shot
 * is never silently dropped, the user decides.
 */

import { useOutbox } from '@/context/OutboxContext'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

export default function OutboxBanner() {
    const { records, queuedCount, failedCount, flushing, discard, retry } =
        useOutbox()

    if (queuedCount === 0 && failedCount === 0) return null

    const failed = records.filter((r) => r.status === 'failed')

    const confirmDiscard = (id: string, kind: string) => {
        Alert.alert(
            'Discard this photo?',
            `The ${kind === 'catch' ? 'catch attempt' : 'shot'} will be deleted permanently.`,
            [
                { text: 'Keep', style: 'cancel' },
                {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => discard(id),
                },
            ]
        )
    }

    return (
        <View style={styles.container}>
            {queuedCount > 0 && (
                <View style={styles.row} accessibilityRole="text">
                    <Ionicons
                        name={flushing ? 'cloud-upload-outline' : 'cloud-offline-outline'}
                        size={18}
                        color={colors.textSecondary}
                    />
                    <Text style={styles.queuedText}>
                        {flushing
                            ? `Uploading ${queuedCount} ${queuedCount === 1 ? 'shot' : 'shots'} from your outbox…`
                            : `${queuedCount} ${queuedCount === 1 ? 'shot' : 'shots'} in your outbox — posting when you're back online`}
                    </Text>
                </View>
            )}
            {failed.map((record) => (
                <View key={record.id} style={styles.failedRow}>
                    <Image
                        source={{ uri: record.imageUri }}
                        style={styles.thumb}
                        contentFit="cover"
                        accessibilityLabel="Queued photo"
                    />
                    <View style={styles.failedBody}>
                        <Text style={styles.failedTitle}>
                            {record.kind === 'catch'
                                ? "Catch didn't count"
                                : "Shot couldn't be posted"}
                        </Text>
                        {!!record.failureReason && (
                            <Text style={styles.failedReason} numberOfLines={3}>
                                {record.failureReason}
                            </Text>
                        )}
                        <View style={styles.actions}>
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={() => retry(record.id)}
                                accessibilityRole="button"
                                accessibilityLabel="Retry upload"
                            >
                                <Text style={styles.actionText}>Retry</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={() =>
                                    confirmDiscard(record.id, record.kind)
                                }
                                accessibilityRole="button"
                                accessibilityLabel="Discard photo"
                            >
                                <Text
                                    style={[
                                        styles.actionText,
                                        styles.discardText,
                                    ]}
                                >
                                    Discard
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            ))}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: 12,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    queuedText: {
        flex: 1,
        color: colors.textSecondary,
        fontSize: 13,
    },
    failedRow: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
    },
    thumb: {
        width: 48,
        height: 48,
        borderRadius: 8,
        backgroundColor: colors.imageBackground,
    },
    failedBody: {
        flex: 1,
    },
    failedTitle: {
        color: colors.textPrimary,
        fontSize: 14,
        fontWeight: '600',
    },
    failedReason: {
        color: colors.textTertiary,
        fontSize: 12,
        marginTop: 2,
    },
    actions: {
        flexDirection: 'row',
        gap: 16,
        marginTop: 6,
    },
    actionButton: {
        paddingVertical: 4,
    },
    actionText: {
        color: colors.primary,
        fontSize: 13,
        fontWeight: '600',
    },
    discardText: {
        color: colors.danger,
    },
})
