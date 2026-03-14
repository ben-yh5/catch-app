import { useAuth } from '@/context/AuthContext';
import { colors } from '@/theme/colors';
import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import FeaturedPostCard from './FeaturedPostCard';
import { ExploreSectionSkeleton } from './ui/Skeleton';

const CARD_SIZE = 240;
const CARD_MARGIN = 12;

interface ExploreSectionProps {
    title: string;
    posts: any[];
    onPostPress: (postId: string) => void;
    onSeeAllPress?: () => void;
    loading?: boolean;
}

export default function ExploreSection({
    title,
    posts,
    onPostPress,
    onSeeAllPress,
    loading = false,
}: ExploreSectionProps) {
    const { user } = useAuth();

    if (loading) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <View style={styles.titleContainer}>
                        <Text style={styles.title}>{title}</Text>
                    </View>
                </View>
                <ExploreSectionSkeleton />
            </View>
        );
    }

    if (!posts || posts.length === 0) {
        return null;
    }

    const renderPostCard = ({ item }: { item: any }) => (
        <FeaturedPostCard
            post={item}
            onPress={() => onPostPress(item.id)}
            size={CARD_SIZE}
            isOwnPost={item.authorId === user?.uid}
        />
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.titleContainer}>
                    <Text style={styles.title} accessibilityRole="header">{title}</Text>
                </View>
                {onSeeAllPress && (
                    <TouchableOpacity
                        onPress={onSeeAllPress}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`See all ${title}`}
                    >
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
    cornerBadge: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: colors.caughtBadge,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
        elevation: 3,
    },
});
