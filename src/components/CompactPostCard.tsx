import { colors } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface CompactPostCardProps {
    post: {
        id: string;
        photoURL: string;
        authorUsername: string;
        caption?: string;
        catchCount: number;
        createdAt: any;
        latitude?: number;
        longitude?: number;
    };
    onPress: () => void;
    onJumpToLocation?: () => void;
}

export default function CompactPostCard({ post, onPress, onJumpToLocation }: CompactPostCardProps) {
    const formatDate = (timestamp: any) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
            <Image
                source={{ uri: post.photoURL }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                priority="normal"
            />

            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.username}>@{post.authorUsername}</Text>
                    <View style={styles.catchBadge}>
                        <Text style={styles.catchIcon}>🏆</Text>
                        <Text style={styles.catchCount}>{post.catchCount}</Text>
                    </View>
                </View>

                {post.caption ? (
                    <Text style={styles.caption} numberOfLines={2} ellipsizeMode="tail">
                        {post.caption}
                    </Text>
                ) : null}

                <View style={styles.footer}>
                    <Text style={styles.date}>{formatDate(post.createdAt)}</Text>

                    {onJumpToLocation && (
                        <TouchableOpacity
                            style={styles.locationButton}
                            onPress={(e) => {
                                e.stopPropagation();
                                onJumpToLocation();
                            }}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="navigate-outline" size={16} color={colors.primary} />
                            <Text style={styles.locationButtonText}>Go to location</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        backgroundColor: colors.card,
        borderRadius: 12,
        marginHorizontal: 12,
        marginVertical: 6,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    image: {
        width: 160,
        height: 160,
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
        marginBottom: 4,
    },
    username: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    catchBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: colors.background,
        borderRadius: 12,
    },
    catchIcon: {
        fontSize: 12,
    },
    catchCount: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    caption: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 18,
        flex: 1,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 4,
    },
    date: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    locationButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: colors.background,
        borderRadius: 8,
    },
    locationButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primary,
    },
});
