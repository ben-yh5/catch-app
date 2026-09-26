import CatchRecencyLine from '@/components/ui/CatchRecencyLine'
import CaughtBadge from '@/components/ui/CaughtBadge'
import SaveBookmark from '@/components/ui/SaveBookmark'
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

const REASON_STYLE = { bg: 'rgba(255, 255, 255, 0.10)', text: '#c9c9ce' }

export default function RecommendedPostCard({
    post,
    onPress,
    isOwnPost,
}: RecommendedPostCardProps) {

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onPress}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={`${post.reasonLabel}: Shot by @${post.authorUsername}${post.caption ? `, ${post.caption}` : ''}`}
            accessibilityHint="View shot"
        >
            <Image
                source={{ uri: post.mediumURL || post.photoURL }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
                priority="normal"
                accessibilityLabel="Shot photo"
            />

            {isOwnPost && <CaughtBadge containerStyle={styles.cornerBadge} />}
            <SaveBookmark
                postId={post.id}
                containerStyle={styles.saveCorner}
            />

            {/* Catching is an event, not a tally (batch 5 minimal cut):
                scrim chip on the photo, only when a catch happened */}
            <CatchRecencyLine
                post={post}
                variant="chip"
                containerStyle={styles.recencyChip}
            />

            <View style={styles.content}>
                <View
                    style={[
                        styles.reasonChip,
                        { backgroundColor: REASON_STYLE.bg },
                    ]}
                >
                    <Text
                        style={[styles.reasonText, { color: REASON_STYLE.text }]}
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
        borderRadius: 2,
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
    saveCorner: {
        position: 'absolute',
        top: 6,
        left: 6,
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
    recencyChip: {
        position: 'absolute',
        left: 8,
        top: IMAGE_HEIGHT - 34, // 8px above the image's bottom edge
        zIndex: 1,
    },
})
