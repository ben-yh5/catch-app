import { useAuth } from '@/context/AuthContext';
import { colors } from '@/theme/colors';
import { Image } from 'expo-image';
import React from 'react';
import { Dimensions, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const { width } = Dimensions.get('window');
const CARD_SIZE = 240;
const CARD_MARGIN = 12;

interface ExploreSectionProps {
    title: string;
    emoji: string;
    posts: any[];
    onPostPress: (postId: string) => void;
    onSeeAllPress?: () => void;
    loading?: boolean;
}

export default function ExploreSection({
    title,
    emoji,
    posts,
    onPostPress,
    onSeeAllPress,
    loading = false,
}: ExploreSectionProps) {
    if (loading) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <View style={styles.titleContainer}>
                        <Text style={styles.emoji}>{emoji}</Text>
                        <Text style={styles.title}>{title}</Text>
                    </View>
                </View>
                <FlatList
                    horizontal
                    data={[1, 2, 3]}
                    keyExtractor={(item) => `skeleton-${item}`}
                    renderItem={() => <View style={[styles.card, styles.skeleton]} />}
                    contentContainerStyle={styles.listContent}
                    showsHorizontalScrollIndicator={false}
                />
            </View>
        );
    }

    if (!posts || posts.length === 0) {
        return null;
    }

    const { user } = useAuth();

    const renderPostCard = ({ item }: { item: any }) => (
        <TouchableOpacity
            style={[
                styles.card,
                item.authorId === user?.uid && { borderColor: colors.secondary, borderWidth: 2 }
            ]}
            onPress={() => onPostPress(item.id)}
            activeOpacity={0.9}
        >
            <Image
                source={{ uri: item.photoURL }}
                style={styles.cardImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                priority="normal"
            />
            <View style={styles.cardInfo}>
                <View style={styles.textContainer}>
                    {item.title && (
                        <Text style={styles.cardTitle} numberOfLines={1}>
                            {item.title}
                        </Text>
                    )}
                    <Text style={styles.username} numberOfLines={1}>
                        @{item.authorUsername}
                    </Text>
                </View>
                <View style={styles.catchBadge}>
                    <Text style={styles.catchIcon}>🏆</Text>
                    <Text style={styles.catchCount}>{item.catchCount}</Text>
                </View>
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.titleContainer}>
                    <Text style={styles.emoji}>{emoji}</Text>
                    <Text style={styles.title}>{title}</Text>
                </View>
                {onSeeAllPress && (
                    <TouchableOpacity onPress={onSeeAllPress} activeOpacity={0.7}>
                        <Text style={styles.seeAll}>See All →</Text>
                    </TouchableOpacity>
                )}
            </View>

            <FlatList
                horizontal
                data={posts}
                renderItem={renderPostCard}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                showsHorizontalScrollIndicator={false}
                snapToInterval={CARD_SIZE + CARD_MARGIN}
                decelerationRate="fast"
                pagingEnabled={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 24,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    emoji: {
        fontSize: 20,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    seeAll: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary,
    },
    listContent: {
        paddingHorizontal: 16,
        gap: CARD_MARGIN,
    },
    card: {
        width: CARD_SIZE,
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    cardImage: {
        width: CARD_SIZE,
        height: CARD_SIZE,
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
    catchBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        backgroundColor: colors.background,
        borderRadius: 10,
    },
    catchIcon: {
        fontSize: 10,
    },
    catchCount: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    skeleton: {
        backgroundColor: colors.border,
    },
});
