import { useAuth } from '@/context/AuthContext'
import { useTabBarInset } from '@/hooks/useTabBarInset'
import { colors } from '@/theme/colors'
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet'
import React, { useMemo, useRef, useState } from 'react'
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import CompactPostCard from './CompactPostCard'

interface MapBottomSheetProps {
    posts: any[]
    loading: boolean
    /** Last fetch failed — show an error state instead of "no shots" */
    error?: boolean
    onRetry?: () => void
    onPostPress: (postId: string) => void
    onJumpToLocation: (latitude: number, longitude: number) => void
    selectedPostId?: string | null
    title?: string
    subtitle?: string
    /** Override the default empty copy (e.g. for search results) */
    emptyTitle?: string
    emptySubtitle?: string
    onClose?: () => void
    isListMode?: boolean
    /** Below pin zoom — no pin query runs, so a "0 shots" count would be a
     *  lie; the header explains the zoom state instead */
    zoomedOut?: boolean
}

function MapBottomSheet({
    posts,
    loading,
    error,
    onRetry,
    onPostPress,
    onJumpToLocation,
    selectedPostId,
    title,
    subtitle,
    emptyTitle,
    emptySubtitle,
    onClose,
    isListMode,
    zoomedOut,
}: MapBottomSheetProps) {
    const { user } = useAuth()
    // Map tab only — raise the sheet above the Android native tab bar the
    // screen extends behind (0 on iOS)
    const tabBarInset = useTabBarInset()
    const bottomSheetRef = useRef<BottomSheet>(null)
    const snapPoints = useMemo(() => ['15%', '50%'], [])
    const [sheetIndex, setSheetIndex] = useState(1)

    const renderItem = ({ item }: { item: any }) => (
        <CompactPostCard
            post={item}
            onPress={() => onPostPress(item.id)}
            onJumpToLocation={
                item.latitude && item.longitude
                    ? () => onJumpToLocation(item.latitude, item.longitude)
                    : undefined
            }
            highlighted={item.authorId === user?.uid}
        />
    )

    const renderHeader = () => (
        <View style={styles.header}>
            <View style={styles.handleContainer}>
                <View style={styles.handle} />
            </View>
            {isListMode ? (
                <View style={styles.listHeaderContainer}>
                    <View style={styles.listTitleContainer}>
                        <Text style={styles.listTitle} numberOfLines={1}>
                            {title || 'List'}
                        </Text>
                        {subtitle && (
                            <Text style={styles.listSubtitle}>{subtitle}</Text>
                        )}
                    </View>
                    {onClose && (
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            accessibilityLabel="Close"
                            accessibilityRole="button"
                        >
                            <Text style={styles.closeButtonText}>Close</Text>
                        </TouchableOpacity>
                    )}
                </View>
            ) : (
                <View style={styles.countContainer}>
                    <Text style={styles.countIcon}>📍</Text>
                    <Text style={styles.countText}>
                        {loading
                            ? 'Loading...'
                            : error && posts.length === 0
                              ? "Couldn't load shots"
                              : zoomedOut
                                ? 'Zoom in to see shots'
                                : `${posts.length} shot${posts.length !== 1 ? 's' : ''} in this area`}
                    </Text>
                </View>
            )}
        </View>
    )

    const renderEmpty = () => (
        <View style={styles.emptyContainer}>
            {loading ? (
                <ActivityIndicator size="large" color={colors.primary} />
            ) : error ? (
                <>
                    <Text style={styles.emptyIcon}>📡</Text>
                    <Text style={styles.emptyText}>
                        Couldn&apos;t load shots
                    </Text>
                    <Text style={styles.emptySubtext}>
                        Check your connection and try again
                    </Text>
                    {onRetry && (
                        <TouchableOpacity
                            style={styles.retryButton}
                            onPress={onRetry}
                            accessibilityLabel="Retry loading shots"
                            accessibilityRole="button"
                        >
                            <Text style={styles.retryButtonText}>Retry</Text>
                        </TouchableOpacity>
                    )}
                </>
            ) : (
                <>
                    <Text style={styles.emptyIcon}>🗺️</Text>
                    <Text style={styles.emptyText}>
                        {emptyTitle || 'No shots in this area'}
                    </Text>
                    <Text style={styles.emptySubtext}>
                        {emptySubtitle || 'Try zooming out or panning the map'}
                    </Text>
                </>
            )}
        </View>
    )

    return (
        <BottomSheet
            ref={bottomSheetRef}
            index={sheetIndex}
            snapPoints={snapPoints}
            onChange={setSheetIndex}
            enablePanDownToClose={false}
            enableDynamicSizing={false}
            bottomInset={tabBarInset}
            backgroundStyle={styles.background}
            handleIndicatorStyle={styles.handleIndicator}
        >
            {renderHeader()}
            <BottomSheetFlatList
                data={posts}
                renderItem={renderItem}
                keyExtractor={(item: any) => item.id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={renderEmpty}
                windowSize={5}
                maxToRenderPerBatch={10}
                removeClippedSubviews={true}
                initialNumToRender={6}
                showsVerticalScrollIndicator={false}
            />
        </BottomSheet>
    )
}

const styles = StyleSheet.create({
    background: {
        backgroundColor: colors.background,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
    },
    handleIndicator: {
        display: 'none',
    },
    header: {
        paddingTop: 8,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    handleContainer: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    handle: {
        width: 40,
        height: 4,
        backgroundColor: colors.textTertiary,
        borderRadius: 2,
    },
    countContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 16,
    },
    countIcon: {
        fontSize: 16,
    },
    countText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#FFFFFF', // White text
    },
    listContent: {
        paddingTop: 8,
        paddingBottom: 100,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    emptyIcon: {
        fontSize: 64,
        marginBottom: 16,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#FFFFFF', // White text
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#CCCCCC', // Light gray text
        textAlign: 'center',
        paddingHorizontal: 24,
    },
    retryButton: {
        marginTop: 16,
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: 16,
        paddingHorizontal: 24,
        paddingVertical: 8,
    },
    retryButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primary,
    },
    listHeaderContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 4,
    },
    listTitleContainer: {
        flex: 1,
    },
    listTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    listSubtitle: {
        fontSize: 13,
        color: colors.textTertiary,
        marginTop: 2,
    },
    closeButton: {
        padding: 4,
        backgroundColor: colors.card,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    closeButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primary,
    },
})

export default React.memo(MapBottomSheet)
