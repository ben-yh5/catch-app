/**
 * NudgeCard - Shows a similar nearby post suggestion on the preview screen.
 *
 * When a user takes a photo near existing threads and the visual similarity
 * model detects a match, this card appears encouraging them to catch the
 * existing post instead of creating a duplicate.
 */

import { colors } from '@/theme/colors'
import { smallTargetHitSlop } from '@/theme/tokens'
import { Post } from '@/types'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface NudgeCardProps {
    post: Post
    onCatchInstead: (post: Post) => void
    onDismiss: () => void
    onNotAMatch: () => void
}

export default function NudgeCard({
    post,
    onCatchInstead,
    onDismiss,
    onNotAMatch,
}: NudgeCardProps) {
    return (
        <View style={styles.container}>
            <TouchableOpacity
                style={styles.dismissButton}
                onPress={onDismiss}
                accessibilityLabel="Dismiss suggestion"
                hitSlop={smallTargetHitSlop}
                accessibilityRole="button"
            >
                <Ionicons name="close" size={16} color={colors.textTertiary} />
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.content}
                onPress={() => onCatchInstead(post)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`This spot is already on the map — shot by @${post.authorUsername}`}
                accessibilityHint="Catch the existing shot instead of posting a duplicate"
            >
                <Image
                    source={{ uri: post.thumbnailURL || post.photoURL }}
                    style={styles.thumbnail}
                    contentFit="cover"
                    accessibilityLabel="Existing shot at this spot"
                />

                <View style={styles.info}>
                    <Text style={styles.title} numberOfLines={1}>
                        This spot is already on the map
                    </Text>
                    {post.caption ? (
                        <Text style={styles.caption} numberOfLines={1}>
                            {post.caption}
                        </Text>
                    ) : null}
                    <Text style={styles.subtitle}>
                        By @{post.authorUsername}
                    </Text>
                </View>

                <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                />
            </TouchableOpacity>

            <TouchableOpacity
                onPress={onNotAMatch}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel="Not the same place"
            >
                <Text style={styles.notAMatch}>Not the same place</Text>
            </TouchableOpacity>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.cardElevated,
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.pinLostPlace + '40',
    },
    dismissButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 1,
        padding: 4,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    thumbnail: {
        width: 50,
        height: 50,
        borderRadius: 8,
        backgroundColor: colors.imageBackground,
    },
    info: {
        flex: 1,
        gap: 2,
    },
    title: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    caption: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    subtitle: {
        fontSize: 11,
        color: colors.textTertiary,
    },
    notAMatch: {
        fontSize: 12,
        color: colors.textTertiary,
        marginTop: 10,
        textAlign: 'center',
        textDecorationLine: 'underline',
    },
})
