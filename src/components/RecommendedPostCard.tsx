import CatchBadge from '@/components/ui/CatchBadge'
import CaughtBadge from '@/components/ui/CaughtBadge'
import { colors } from '@/theme/colors'
import { RecommendedPost } from '@/types'
import { Image } from 'expo-image'
import React from 'react'
import {
    Dimensions,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'

const SCREEN_WIDTH = Dimensions.get('window').width
const CARD_WIDTH = SCREEN_WIDTH - 32
const IMAGE_HEIGHT = CARD_WIDTH * 0.75

interface RecommendedPostCardProps {
    post: RecommendedPost
    onPress: () => void
    isOwnPost?: boolean
}

const REASON_COLORS: Record<string, { bg: string; text: string }> = {
    social: { bg: 'rgba(0, 122, 255, 0.15)', text: '#007AFF' },
    city_trending: { bg: 'rgba(255, 179, 0, 0.15)', text: '#FFB300' },
}

export default function RecommendedPostCard({
    post,
    onPress,
    isOwnPost,
}: RecommendedPostCardProps) {
    const reasonStyle = REASON_COLORS[post.reasonType] || REASON_COLORS.social

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onPress}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={`${post.reasonLabel}: Post by @${post.authorUsername}${post.caption ? `, ${post.caption}` : ''}`}
            accessibilityHint="View post"
        >
            <Image
                source={{ uri: post.mediumURL || post.photoURL }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                priority="normal"
                accessibilityLabel="Post photo"
            />

            {isOwnPost && <CaughtBadge containerStyle={styles.cornerBadge} />}

            <View style={styles.content}>
                <View
                    style={[
                        styles.reasonChip,
                        { backgroundColor: reasonStyle.bg },
                    ]}
                >
                    <Text
                        style={[styles.reasonText, { color: reasonStyle.text }]}
                    >
                        {post.reasonLabel}
                    </Text>
                </View>

                <View style={styles.infoRow}>
                    <View style={styles.textContainer}>
                        {post.caption ? (
                            <Text
                                style={styles.caption}
                                numberOfLines={2}
                                ellipsizeMode="tail"
                            >
                                {post.caption}
                            </Text>
                        ) : null}
                        <Text style={styles.username} numberOfLines={1}>
                            @{post.authorUsername}
                        </Text>
                    </View>

                    <CatchBadge count={post.catchCount} variant="dark" />
                </View>
            </View>
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 16,
        marginBottom: 16,
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    image: {
        width: CARD_WIDTH,
        height: IMAGE_HEIGHT,
    },
    cornerBadge: {
        position: 'absolute',
        top: 6,
        right: 6,
        zIndex: 1,
    },
    content: {
        padding: 12,
    },
    reasonChip: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        marginBottom: 8,
    },
    reasonText: {
        fontSize: 12,
        fontWeight: '600',
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    textContainer: {
        flex: 1,
        marginRight: 8,
    },
    caption: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.textPrimary,
        marginBottom: 2,
    },
    username: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textSecondary,
    },
})
