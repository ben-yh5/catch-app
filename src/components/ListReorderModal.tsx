/**
 * ListReorderModal — owner-only reordering of a list's posts.
 *
 * Deliberately arrow-based (move up/down) rather than drag-to-reorder:
 * drag gestures inside the map's bottom sheet fight the sheet's own pan
 * responder, and a plain modal with explicit moves is verifiable without
 * device-tuning. Order is committed as a single postIds write on Save.
 */

import { colors } from '@/theme/colors'
import { smallTargetHitSlop } from '@/theme/tokens'
import { Post } from '@/types'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface ListReorderModalProps {
    visible: boolean
    posts: Post[]
    onClose: () => void
    onSave: (orderedPostIds: string[]) => Promise<void>
}

export default function ListReorderModal({
    visible,
    posts,
    onClose,
    onSave,
}: ListReorderModalProps) {
    const insets = useSafeAreaInsets()
    const [order, setOrder] = useState<Post[]>(posts)
    const [saving, setSaving] = useState(false)

    // Reset working order every time the modal opens
    useEffect(() => {
        if (visible) setOrder(posts)
    }, [visible, posts])

    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction
        if (target < 0 || target >= order.length) return
        const next = [...order]
        ;[next[index], next[target]] = [next[target], next[index]]
        setOrder(next)
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            await onSave(order.map((p) => p.id))
            onClose()
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            visible={visible}
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={onClose}
                        disabled={saving}
                        accessibilityLabel="Cancel reordering"
                        accessibilityRole="button"
                    >
                        <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={styles.title}>Reorder</Text>
                    <TouchableOpacity
                        onPress={handleSave}
                        disabled={saving}
                        accessibilityLabel="Save order"
                        accessibilityRole="button"
                    >
                        {saving ? (
                            <ActivityIndicator
                                size="small"
                                color={colors.primary}
                            />
                        ) : (
                            <Text style={styles.saveText}>Save</Text>
                        )}
                    </TouchableOpacity>
                </View>

                <FlatList
                    data={order}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 16,
                    }}
                    renderItem={({ item, index }) => (
                        <View style={styles.row}>
                            <Text style={styles.index}>{index + 1}</Text>
                            <Image
                                source={{
                                    uri: item.thumbnailURL || item.photoURL,
                                }}
                                style={styles.thumb}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                            />
                            <View style={styles.rowInfo}>
                                <Text
                                    style={styles.caption}
                                    numberOfLines={1}
                                >
                                    {item.caption || `@${item.authorUsername}`}
                                </Text>
                                <Text style={styles.author} numberOfLines={1}>
                                    @{item.authorUsername}
                                </Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => move(index, -1)}
                                disabled={index === 0}
                                style={styles.moveButton}
                                hitSlop={smallTargetHitSlop}
                                accessibilityLabel="Move up"
                                accessibilityRole="button"
                            >
                                <Ionicons
                                    name="chevron-up"
                                    size={22}
                                    color={
                                        index === 0
                                            ? colors.textTertiary
                                            : colors.primary
                                    }
                                />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => move(index, 1)}
                                disabled={index === order.length - 1}
                                style={styles.moveButton}
                                hitSlop={smallTargetHitSlop}
                                accessibilityLabel="Move down"
                                accessibilityRole="button"
                            >
                                <Ionicons
                                    name="chevron-down"
                                    size={22}
                                    color={
                                        index === order.length - 1
                                            ? colors.textTertiary
                                            : colors.primary
                                    }
                                />
                            </TouchableOpacity>
                        </View>
                    )}
                />
            </View>
        </Modal>
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
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    cancelText: {
        fontSize: 16,
        color: colors.primary,
    },
    saveText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primary,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 10,
    },
    index: {
        width: 22,
        fontSize: 14,
        fontWeight: '600',
        color: colors.textTertiary,
        textAlign: 'center',
    },
    thumb: {
        width: 44,
        height: 44,
        borderRadius: 4,
    },
    rowInfo: {
        flex: 1,
    },
    caption: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    author: {
        fontSize: 12,
        color: colors.textTertiary,
        marginTop: 2,
    },
    moveButton: {
        padding: 4,
    },
})
