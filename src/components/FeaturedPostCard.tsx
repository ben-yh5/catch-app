import CatchRecencyLine from '@/components/ui/CatchRecencyLine'
import CaughtBadge from '@/components/ui/CaughtBadge'
import SaveBookmark from '@/components/ui/SaveBookmark'
import { colors } from '@/theme/colors'
import { Image } from 'expo-image'
import React from 'react'
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ViewStyle,
} from 'react-native'

interface FeaturedPostCardProps {
    post: {
        id: string
        photoURL: string
        authorId: string
        authorUsername: string
        caption?: string
        catchCount: number
        mediumURL?: string
        isOriginal: boolean
        lastCaughtAt?: any // Firestore Timestamp
    }
    onPress: () => void
    size: number
    isOwnPost?: boolean
    containerStyle?: ViewStyle
}

/**
 * FeaturedPostCard - Specialized card variant used in Explore sections and carousels
 */
export default function FeaturedPostCard({
    post,
    onPress,
    size,
    isOwnPost,
    containerStyle,
}: FeaturedPostCardProps) {
    return (
        <TouchableOpacity
            style={[styles.card, { width: size }, containerStyle]}
            onPress={onPress}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={`Shot by @${post.authorUsername}${post.caption ? `, ${post.caption}` : ''}, ${post.catchCount} ${post.catchCount === 1 ? 'catch' : 'catches'}`}
            accessibilityHint="View shot"
        >
            <Image
                source={{ uri: post.mediumURL || post.photoURL }}
                style={{ width: size, height: size }}
                contentFit="cover"
                cachePolicy="memory-disk"
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
                containerStyle={{
                    position: 'absolute',
                    left: 8,
                    top: size - 34, // 8px above the square image's bottom
                    zIndex: 1,
                }}
            />

            <View style={styles.cardInfo}>
                <View style={styles.textContainer}>
                    {post.caption && (
                        <Text
                            style={styles.cardTitle}
                            numberOfLines={2}
                            ellipsizeMode="tail"
                        >
                            {post.caption}
                        </Text>
                    )}
                    <Text style={styles.username} numberOfLines={1}>
                        @{post.authorUsername}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.card,
        borderRadius: 2,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    cardInfo: {
        padding: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    textContainer: {
        flex: 1,
        marginRight: 8,
    },
    cardTitle: {
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
})
