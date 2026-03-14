import CatchBadge from '@/components/ui/CatchBadge'
import CaughtBadge from '@/components/ui/CaughtBadge'
import { colors } from '@/theme/colors'
import { Post } from '@/types'
import { formatPostDate } from '@/utils/dateUtils'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface CompactPostCardProps {
    post: Pick<
        Post,
        | 'id'
        | 'photoURL'
        | 'thumbnailURL'
        | 'authorUsername'
        | 'title'
        | 'caption'
        | 'catchCount'
        | 'createdAt'
        | 'latitude'
        | 'longitude'
    >
    onPress: () => void
    onJumpToLocation?: () => void
    highlighted?: boolean
}

export default function CompactPostCard({
    post,
    onPress,
    onJumpToLocation,
    highlighted = false,
}: CompactPostCardProps) {
    return (
        <TouchableOpacity
            style={styles.card}
            onPress={onPress}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={`Post by @${post.authorUsername}${post.caption ? `, ${post.caption}` : ''}`}
            accessibilityHint="View post details"
        >
            <View style={styles.imageContainer}>
                <Image
                    source={{ uri: post.thumbnailURL || post.photoURL }}
                    style={styles.image}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    priority="normal"
                    accessibilityLabel="Post photo"
                />
                {highlighted && (
                    <CaughtBadge
                        containerStyle={styles.caughtBadge}
                        size={20}
                    />
                )}
            </View>

            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.username} numberOfLines={1}>
                        @{post.authorUsername}
                    </Text>
                    <CatchBadge count={post.catchCount} />
                </View>

                {post.caption ? (
                    <Text
                        style={styles.caption}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                    >
                        {post.caption}
                    </Text>
                ) : (
                    <View style={{ flex: 1 }} />
                )}

                <View style={styles.footer}>
                    <Text style={styles.date}>
                        {formatPostDate(post.createdAt)}
                    </Text>

                    {onJumpToLocation && (
                        <TouchableOpacity
                            style={styles.locationButton}
                            onPress={(e) => {
                                e.stopPropagation()
                                onJumpToLocation()
                            }}
                            activeOpacity={0.7}
                            hitSlop={{
                                top: 10,
                                bottom: 10,
                                left: 10,
                                right: 10,
                            }}
                            accessibilityLabel="Jump to location"
                            accessibilityRole="button"
                        >
                            <Ionicons
                                name="location-sharp"
                                size={14}
                                color={colors.primary}
                            />
                            <Text style={styles.locationButtonText}>
                                Location
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        backgroundColor: colors.card,
        borderRadius: 16,
        marginHorizontal: 16,
        marginVertical: 8,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 3.84,
        elevation: 5,
    },
    imageContainer: {
        position: 'relative',
    },
    image: {
        width: 120,
        height: 120,
    },
    caughtBadge: {
        position: 'absolute',
        top: 6,
        right: 6,
        zIndex: 1,
    },
    content: {
        flex: 1,
        padding: 12,
        justifyContent: 'space-between',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    username: {
        fontSize: 15,
        fontWeight: '700',
        color: colors.textPrimary,
        flex: 1,
        marginRight: 8,
    },
    caption: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 20,
        flex: 1,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
    },
    date: {
        fontSize: 12,
        color: colors.textTertiary,
        fontWeight: '500',
    },
    locationButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: colors.cardElevated,
        borderRadius: 8,
    },
    locationButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primary,
    },
})
