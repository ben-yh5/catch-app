import React from 'react'
import { View, StyleSheet } from 'react-native'
import { colors } from '@/theme/colors'

export const SkeletonBox = ({ width, height, style }: { width: number | string; height: number; style?: any }) => (
    <View style={[styles.skeleton, { width, height }, style]} />
)

export const FeaturedListSkeleton = () => (
    <View style={styles.listCard}>
        <View style={styles.listThumbnailGrid}>
            {[0, 1, 2, 3].map((index) => (
                <View key={index} style={styles.listThumbnailItem}>
                    <SkeletonBox width="100%" height={100} />
                </View>
            ))}
        </View>
        <View style={styles.listInfo}>
            <SkeletonBox width="80%" height={16} style={{ marginBottom: 6 }} />
            <SkeletonBox width="60%" height={12} style={{ marginBottom: 6 }} />
            <SkeletonBox width="40%" height={10} />
        </View>
    </View>
)

const styles = StyleSheet.create({
    skeleton: {
        backgroundColor: colors.cardElevated,
        borderRadius: 4,
    },
    listCard: {
        width: 200,
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        marginRight: 12,
    },
    listThumbnailGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        height: 200,
    },
    listThumbnailItem: {
        width: '50%',
        height: '50%',
    },
    listInfo: {
        padding: 12,
    },
})
