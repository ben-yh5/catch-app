import { colors } from '@/theme/colors';
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

const SHIMMER_DURATION = 1000;
const COLOR_LOW = colors.border; // #2c2c2e
const COLOR_HIGH = '#3a3a3c';

// --- Base Skeleton Block ---

interface SkeletonProps {
    width: number | `${number}%`;
    height: number;
    borderRadius?: number;
    style?: ViewStyle;
}

export function Skeleton({ width, height, borderRadius = 8, style }: SkeletonProps) {
    const opacity = useSharedValue(0.5);

    useEffect(() => {
        opacity.value = withRepeat(
            withTiming(1, { duration: SHIMMER_DURATION }),
            -1,
            true
        );
    }, []);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    return (
        <Animated.View
            style={[
                {
                    width,
                    height,
                    borderRadius,
                    backgroundColor: COLOR_HIGH,
                },
                animatedStyle,
                style,
            ]}
        />
    );
}

// --- Composite Skeletons ---

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/** Skeleton for ExploreSection horizontal cards (240x240 + info bar) */
export function ExploreSectionSkeleton() {
    return (
        <View style={compositeStyles.sectionContainer}>
            {[1, 2, 3].map((i) => (
                <View key={i} style={compositeStyles.featuredCard}>
                    <Skeleton width={240} height={240} borderRadius={0} />
                    <View style={compositeStyles.featuredCardInfo}>
                        <Skeleton width={120} height={12} borderRadius={4} />
                        <Skeleton width={60} height={10} borderRadius={4} />
                    </View>
                </View>
            ))}
        </View>
    );
}

/** Skeleton for the full Explore page initial load */
export function ExploreSkeleton() {
    return (
        <View style={compositeStyles.exploreContainer}>
            {/* Search bar placeholder */}
            <View style={compositeStyles.searchBarPlaceholder}>
                <Skeleton width="100%" height={44} borderRadius={10} />
            </View>

            {/* Featured Lists section */}
            <View style={compositeStyles.section}>
                <View style={compositeStyles.sectionHeader}>
                    <Skeleton width={140} height={20} borderRadius={4} />
                </View>
                <View style={compositeStyles.sectionContainer}>
                    {[1, 2].map((i) => (
                        <View key={i} style={compositeStyles.listCard}>
                            <Skeleton width={200} height={200} borderRadius={0} />
                            <View style={compositeStyles.listCardInfo}>
                                <Skeleton width={120} height={14} borderRadius={4} />
                                <Skeleton width={80} height={10} borderRadius={4} style={{ marginTop: 6 }} />
                            </View>
                        </View>
                    ))}
                </View>
            </View>

            {/* Trending section */}
            <View style={compositeStyles.section}>
                <View style={compositeStyles.sectionHeader}>
                    <Skeleton width={120} height={20} borderRadius={4} />
                </View>
                <ExploreSectionSkeleton />
            </View>

            {/* New section */}
            <View style={compositeStyles.section}>
                <View style={compositeStyles.sectionHeader}>
                    <Skeleton width={80} height={20} borderRadius={4} />
                </View>
                <ExploreSectionSkeleton />
            </View>
        </View>
    );
}

/** Skeleton for "For You" recommended post cards */
export function RecommendedPostSkeleton() {
    const cardWidth = SCREEN_WIDTH - 32;
    const imageHeight = cardWidth * 0.75;

    return (
        <View style={compositeStyles.recommendedCard}>
            <Skeleton width={cardWidth} height={imageHeight} borderRadius={0} />
            <View style={compositeStyles.recommendedContent}>
                <Skeleton width={60} height={18} borderRadius={10} />
                <Skeleton width={cardWidth * 0.7} height={14} borderRadius={4} style={{ marginTop: 8 }} />
                <Skeleton width={100} height={12} borderRadius={4} style={{ marginTop: 6 }} />
            </View>
        </View>
    );
}

/** Skeleton for CompactPostCard (120x120 image + text) */
export function CompactPostCardSkeleton() {
    return (
        <View style={compositeStyles.compactCard}>
            <Skeleton width={120} height={120} borderRadius={0} />
            <View style={compositeStyles.compactContent}>
                <View style={compositeStyles.compactHeader}>
                    <Skeleton width={100} height={14} borderRadius={4} />
                    <Skeleton width={40} height={14} borderRadius={8} />
                </View>
                <Skeleton width="80%" height={12} borderRadius={4} style={{ marginTop: 8 }} />
                <Skeleton width="50%" height={12} borderRadius={4} style={{ marginTop: 4 }} />
                <View style={{ flex: 1 }} />
                <Skeleton width={70} height={10} borderRadius={4} />
            </View>
        </View>
    );
}

/** Skeleton for ThreadModal (header + square image + footer) */
export function ThreadModalSkeleton() {
    const cardWidth = SCREEN_WIDTH - 20;

    return (
        <View style={compositeStyles.threadModalContainer}>
            <View style={compositeStyles.threadCard}>
                {/* Header */}
                <View style={compositeStyles.threadHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Skeleton width={24} height={24} borderRadius={12} />
                        <Skeleton width={100} height={16} borderRadius={4} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        <Skeleton width={40} height={20} borderRadius={10} />
                        <Skeleton width={22} height={22} borderRadius={4} />
                    </View>
                </View>
                {/* Image */}
                <Skeleton width={cardWidth} height={cardWidth} borderRadius={0} />
                {/* Footer */}
                <View style={compositeStyles.threadFooter}>
                    <Skeleton width="60%" height={14} borderRadius={4} />
                    <Skeleton width={80} height={10} borderRadius={4} style={{ marginTop: 8 }} />
                    <View style={compositeStyles.threadDivider} />
                    <Skeleton width="100%" height={48} borderRadius={12} style={{ marginTop: 4 }} />
                </View>
            </View>
        </View>
    );
}

/** Skeleton for ListsScreen list items */
export function ListItemSkeleton() {
    return (
        <View style={compositeStyles.listItem}>
            <Skeleton width={24} height={24} borderRadius={4} />
            <View style={compositeStyles.listItemText}>
                <Skeleton width={140} height={16} borderRadius={4} />
                <Skeleton width={80} height={12} borderRadius={4} style={{ marginTop: 6 }} />
            </View>
        </View>
    );
}

/** Skeleton for ListsScreen tab content */
export function ListsTabSkeleton() {
    return (
        <View style={compositeStyles.listsTabContainer}>
            {[1, 2, 3, 4].map((i) => (
                <ListItemSkeleton key={i} />
            ))}
        </View>
    );
}

/** Skeleton for ListDetailScreen (header + post list) */
export function ListDetailSkeleton() {
    return (
        <View>
            {/* Header skeleton */}
            <View style={compositeStyles.listDetailHeader}>
                <Skeleton width={24} height={24} borderRadius={4} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Skeleton width={160} height={20} borderRadius={4} />
                    <Skeleton width={100} height={12} borderRadius={4} style={{ marginTop: 8 }} />
                </View>
            </View>
            {/* Post list skeleton */}
            {[1, 2, 3].map((i) => (
                <CompactPostCardSkeleton key={i} />
            ))}
        </View>
    );
}

/** Skeleton for profile header (username + stats + tabs) */
export function ProfileSkeleton() {
    return (
        <View style={compositeStyles.profileContainer}>
            <Skeleton width={140} height={24} borderRadius={4} />
            <View style={compositeStyles.profileStats}>
                {[1, 2, 3].map((i) => (
                    <View key={i} style={compositeStyles.profileStatItem}>
                        <Skeleton width={40} height={20} borderRadius={4} />
                        <Skeleton width={60} height={12} borderRadius={4} style={{ marginTop: 4 }} />
                    </View>
                ))}
            </View>
            {/* Tab bar skeleton */}
            <View style={compositeStyles.profileTabs}>
                <Skeleton width={60} height={16} borderRadius={4} />
                <Skeleton width={60} height={16} borderRadius={4} />
            </View>
        </View>
    );
}

const compositeStyles = StyleSheet.create({
    // Explore
    exploreContainer: {
        paddingBottom: 20,
    },
    searchBarPlaceholder: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
    },
    section: {
        marginBottom: 24,
        marginTop: 16,
    },
    sectionHeader: {
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    sectionContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        gap: 12,
    },
    featuredCard: {
        width: 240,
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    featuredCardInfo: {
        padding: 12,
        gap: 6,
    },
    listCard: {
        width: 200,
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    listCardInfo: {
        padding: 12,
    },

    // Recommended Post
    recommendedCard: {
        marginHorizontal: 16,
        marginVertical: 8,
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    recommendedContent: {
        padding: 12,
    },

    // CompactPostCard
    compactCard: {
        flexDirection: 'row',
        backgroundColor: colors.card,
        borderRadius: 16,
        marginHorizontal: 16,
        marginVertical: 8,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
    },
    compactContent: {
        flex: 1,
        padding: 12,
    },
    compactHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },

    // ThreadModal
    threadModalContainer: {
        flex: 1,
        padding: 10,
    },
    threadCard: {
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
    },
    threadHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
    },
    threadFooter: {
        padding: 12,
    },
    threadDivider: {
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        marginVertical: 12,
    },

    // ListItem
    listItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: colors.card,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    listItemText: {
        flex: 1,
        marginLeft: 12,
    },
    listsTabContainer: {
        padding: 16,
    },

    // ListDetail
    listDetailHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },

    // Profile
    profileContainer: {
        padding: 20,
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        marginBottom: 1,
    },
    profileStats: {
        flexDirection: 'row',
        gap: 40,
        marginTop: 16,
    },
    profileStatItem: {
        alignItems: 'center',
    },
    profileTabs: {
        flexDirection: 'row',
        gap: 60,
        marginTop: 24,
        paddingBottom: 12,
    },
});
