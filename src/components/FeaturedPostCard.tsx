import CatchBadge from '@/components/ui/CatchBadge';
import CaughtBadge from '@/components/ui/CaughtBadge';
import { colors } from '@/theme/colors';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';

interface FeaturedPostCardProps {
    post: {
        id: string;
        photoURL: string;
        authorId: string;
        authorUsername: string;
        caption?: string;
        catchCount: number;
        mediumURL?: string;
    };
    onPress: () => void;
    size: number;
    isOwnPost?: boolean;
    containerStyle?: ViewStyle;
}

/**
 * FeaturedPostCard - Specialized card variant used in Explore sections and carousels
 */
export default function FeaturedPostCard({
    post,
    onPress,
    size,
    isOwnPost,
    containerStyle
}: FeaturedPostCardProps) {
    return (
        <TouchableOpacity
            style={[styles.card, { width: size }, containerStyle]}
            onPress={onPress}
            activeOpacity={0.9}
        >
            <Image
                source={{ uri: post.mediumURL || post.photoURL }}
                style={{ width: size, height: size }}
                contentFit="cover"
                cachePolicy="memory-disk"
                priority="normal"
            />

            {isOwnPost && (
                <CaughtBadge containerStyle={styles.cornerBadge} />
            )}

            <View style={styles.cardInfo}>
                <View style={styles.textContainer}>
                    {post.caption && (
                        <Text style={styles.cardTitle} numberOfLines={2} ellipsizeMode="tail">
                            {post.caption}
                        </Text>
                    )}
                    <Text style={styles.username} numberOfLines={1}>
                        @{post.authorUsername}
                    </Text>
                </View>

                <CatchBadge
                    count={post.catchCount}
                    variant="dark"
                />
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.card,
        borderRadius: 12,
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
});
