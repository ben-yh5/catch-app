import { useAuth } from '@/context/AuthContext'
import { useTabBarInset } from '@/hooks/useTabBarInset'
import { colors } from '@/theme/colors'
import { smallTargetHitSlop } from '@/theme/tokens'
import { calculateDistance } from '@/utils/geospatialQueries'
import { Ionicons } from '@expo/vector-icons'
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet'
import React, { useMemo, useRef, useState } from 'react'
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
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
    /** List focus: back to wherever lists are listed (header arrow) */
    onBack?: () => void
    isListMode?: boolean
    /** List focus mode: unlocks the 100% snap point — the fully raised
     *  sheet IS the list view (list/map is a sheet position, not a
     *  navigation) */
    allowFullSnap?: boolean
    /** External handle so the screen (ViewToggle pill) can command snaps */
    sheetRef?: React.RefObject<BottomSheet | null>
    /** Reports snap index changes so the pill can mirror the position */
    onIndexChange?: (index: number) => void
    /** Owner-only list actions, shown in the list-mode header / rows */
    onEditList?: () => void
    onDeleteList?: () => void
    onRemovePost?: (postId: string) => void
    onReorderList?: () => void
    /** When set, rows with coordinates show a distance label */
    distanceFrom?: { latitude: number; longitude: number } | null
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
    onBack,
    isListMode,
    allowFullSnap,
    sheetRef,
    onIndexChange,
    onEditList,
    onDeleteList,
    onRemovePost,
    onReorderList,
    distanceFrom,
    zoomedOut,
}: MapBottomSheetProps) {
    const { user } = useAuth()
    // Map tab only — raise the sheet above the Android native tab bar the
    // screen extends behind (0 on iOS)
    const tabBarInset = useTabBarInset()
    const insets = useSafeAreaInsets()
    const internalRef = useRef<BottomSheet>(null)
    const bottomSheetRef = sheetRef ?? internalRef
    // Three detents for lists (Apple/Google Maps style): peek, mid (cards
    // + map together), and full — the list page. Browse/search/post focus
    // keep the peek/half pair.
    const snapPoints = useMemo(
        () => (allowFullSnap ? ['15%', '50%', '100%'] : ['15%', '50%']),
        [allowFullSnap]
    )
    const [sheetIndex, setSheetIndex] = useState(1)

    // Fully raised, the sheet must read as a plain page — no map peeking
    // anywhere: corners square off and the header pads itself below the
    // status bar as the sheet approaches the top snap. Swiping down
    // re-rounds the corners and reveals the map.
    const animatedIndex = useSharedValue(1)
    const fullSnapEnabled = allowFullSnap === true
    const statusBarPad = insets.top
    const animatedBackgroundStyle = useAnimatedStyle(() => {
        const radius = fullSnapEnabled
            ? interpolate(
                  animatedIndex.value,
                  [1.85, 2],
                  [20, 0],
                  Extrapolation.CLAMP
              )
            : 20
        return {
            borderTopLeftRadius: radius,
            borderTopRightRadius: radius,
        }
    })
    // Base 8 at sheet positions; at the top snap exactly the safe-area
    // inset, so the list header touches the screen top right below the
    // status bar / camera area with no extra gap
    const animatedHeaderStyle = useAnimatedStyle(() => {
        const pad = fullSnapEnabled
            ? interpolate(
                  animatedIndex.value,
                  [1.85, 2],
                  [4, statusBarPad],
                  Extrapolation.CLAMP
              )
            : 4
        return { paddingTop: pad }
    })

    const formatDistance = (meters: number) =>
        meters < 1000
            ? `${Math.round(meters)} m`
            : `${(meters / 1000).toFixed(1)} km`

    const renderItem = ({ item }: { item: any }) => (
        <View style={styles.postContainer}>
            <CompactPostCard
                post={item}
                onPress={() => onPostPress(item.id)}
                onJumpToLocation={
                    item.latitude && item.longitude
                        ? () => onJumpToLocation(item.latitude, item.longitude)
                        : undefined
                }
                highlighted={item.authorId === user?.uid}
                distanceLabel={
                    distanceFrom && item.latitude && item.longitude
                        ? formatDistance(
                              calculateDistance(
                                  distanceFrom.latitude,
                                  distanceFrom.longitude,
                                  item.latitude,
                                  item.longitude
                              )
                          )
                        : undefined
                }
            />
            {onRemovePost && (
                <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => onRemovePost(item.id)}
                    accessibilityLabel="Remove post from list"
                    accessibilityRole="button"
                    hitSlop={smallTargetHitSlop}
                >
                    <Ionicons
                        name="close-circle"
                        size={22}
                        color={colors.danger}
                    />
                </TouchableOpacity>
            )}
        </View>
    )

    const renderHeader = () => (
        <Animated.View style={[styles.header, animatedHeaderStyle]}>
            <View style={styles.handleContainer}>
                <View style={styles.handle} />
            </View>
            {isListMode ? (
                <View style={styles.listHeaderContainer}>
                    {onBack && (
                        <TouchableOpacity
                            onPress={onBack}
                            style={styles.backButton}
                            accessibilityLabel="Back to lists"
                            accessibilityRole="button"
                            hitSlop={smallTargetHitSlop}
                        >
                            <Ionicons
                                name="arrow-back"
                                size={20}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                    )}
                    <View style={styles.listTitleContainer}>
                        <Text style={styles.listTitle} numberOfLines={1}>
                            {title || 'List'}
                        </Text>
                        {subtitle && (
                            <Text style={styles.listSubtitle}>{subtitle}</Text>
                        )}
                    </View>
                    {onReorderList && (
                        <TouchableOpacity
                            onPress={onReorderList}
                            style={styles.iconButton}
                            accessibilityLabel="Reorder list"
                            accessibilityRole="button"
                            hitSlop={smallTargetHitSlop}
                        >
                            <Ionicons
                                name="swap-vertical"
                                size={16}
                                color={colors.primary}
                            />
                        </TouchableOpacity>
                    )}
                    {onEditList && (
                        <TouchableOpacity
                            onPress={onEditList}
                            style={styles.iconButton}
                            accessibilityLabel="Edit list"
                            accessibilityRole="button"
                            hitSlop={smallTargetHitSlop}
                        >
                            <Ionicons
                                name="pencil"
                                size={16}
                                color={colors.primary}
                            />
                        </TouchableOpacity>
                    )}
                    {onDeleteList && (
                        <TouchableOpacity
                            onPress={onDeleteList}
                            style={styles.iconButton}
                            accessibilityLabel="Delete list"
                            accessibilityRole="button"
                            hitSlop={smallTargetHitSlop}
                        >
                            <Ionicons
                                name="trash-outline"
                                size={16}
                                color={colors.danger}
                            />
                        </TouchableOpacity>
                    )}
                    {onClose && (
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.headerButton}
                            accessibilityLabel="Close"
                            accessibilityRole="button"
                        >
                            <Text style={styles.headerButtonText}>Close</Text>
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
        </Animated.View>
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
            onChange={(index) => {
                setSheetIndex(index)
                onIndexChange?.(index)
            }}
            enablePanDownToClose={false}
            enableDynamicSizing={false}
            bottomInset={tabBarInset}
            animatedIndex={animatedIndex}
            backgroundComponent={({ style }) => (
                <Animated.View
                    style={[
                        style,
                        styles.background,
                        animatedBackgroundStyle,
                    ]}
                />
            )}
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
        // paddingTop is animated (see animatedHeaderStyle)
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    handleContainer: {
        alignItems: 'center',
        paddingTop: 4,
        paddingBottom: 6,
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
    headerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: colors.card,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginLeft: 8,
    },
    headerButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primary,
    },
    iconButton: {
        backgroundColor: colors.card,
        borderRadius: 12,
        padding: 8,
        marginLeft: 8,
    },
    backButton: {
        padding: 4,
        marginRight: 10,
    },
    postContainer: {
        position: 'relative',
    },
    removeButton: {
        position: 'absolute',
        top: 2,
        right: 20,
        zIndex: 1,
    },
})

export default React.memo(MapBottomSheet)
