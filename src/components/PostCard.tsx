/**
 * PostCard - Reusable post display component
 *
 * A flexible component used throughout the app to display posts.
 * Supports multiple display modes:
 * - Feed card: Shows username, photo, caption, stats
 * - Preview: Shows photo with optional caption input
 * - Gallery: Swipeable photo gallery with timeline
 *
 * Used in:
 * - ExploreScreen: Feed display
 * - ProfileScreen: Grid/feed display
 * - ThreadModal: Full-screen gallery
 * - UnifiedPreviewScreen: Post/catch preview
 */

import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, { useRef, useState } from 'react'
import {
    ActivityIndicator,
    Dimensions,
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    ViewToken,
} from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

interface PostCardProps {
    username?: string
    onUsernamePress?: () => void
    onBackPress?: () => void
    showBackButton?: boolean
    catchCount?: number
    showCatchBadge?: boolean
    bookmarked?: boolean
    onBookmarkPress?: () => void
    showBookmark?: boolean
    showOptionsMenu?: boolean
    onOptionsPress?: () => void
    optionsMenuContent?: React.ReactNode
    // Badge in header (e.g., "Original", "Catch #1")
    headerBadgeText?: string

    // Image(s)
    images: string[]
    currentIndex?: number
    onIndexChange?: (index: number) => void
    // For catch preview - comparison slider mode
    comparisonMode?: boolean
    originalImageUrl?: string

    // Footer
    title?: string
    caption?: string
    date?: string
    // Input modes (for preview screens)
    titleInputMode?: boolean
    captionInputMode?: boolean
    titlePlaceholder?: string
    captionPlaceholder?: string
    onTitleChange?: (text: string) => void
    onCaptionChange?: (text: string) => void

    // Progress bar
    showProgressBar?: boolean
    totalItems?: number

    // Action button
    actionButtonText?: string
    actionButtonIcon?: string
    onActionPress?: () => void
    actionButtonDisabled?: boolean
    actionButtonLoading?: boolean
    actionButtonLoadingText?: string

    // Add to List
    onAddToListPress?: () => void
    selectedListCount?: number

    // Container style
    containerPadding?: number
}

export default function PostCard({
    // Header
    username,
    onUsernamePress,
    onBackPress,
    showBackButton = false,
    catchCount = 0,
    showCatchBadge = false,
    bookmarked = false,
    onBookmarkPress,
    showBookmark = false,
    showOptionsMenu = false,
    onOptionsPress,
    optionsMenuContent,
    headerBadgeText,

    // Image(s)
    images,
    currentIndex = 0,
    onIndexChange,
    comparisonMode = false,
    originalImageUrl,

    // Footer
    title,
    caption,
    date,
    titleInputMode = false,
    captionInputMode = false,
    titlePlaceholder = 'Add a title...',
    captionPlaceholder = 'Add a caption (optional)...',
    onTitleChange,
    onCaptionChange,

    // Progress bar
    showProgressBar = true,
    totalItems,

    // Action button
    actionButtonText,
    actionButtonIcon,
    onActionPress,
    actionButtonDisabled = false,
    actionButtonLoading = false,
    actionButtonLoadingText = 'Loading...',

    // Add to List
    onAddToListPress,
    selectedListCount = 0,

    // Container
    containerPadding = 10,
}: PostCardProps) {
    const [titleText, setTitleText] = useState('')
    const [captionText, setCaptionText] = useState('')
    const flatListRef = useRef<FlatList>(null)

    const cardWidth = SCREEN_WIDTH - containerPadding * 2
    const imageSize = cardWidth

    // Comparison slider state - start at 1/4 (showing 3/4 yours, 1/4 original)
    const sliderPosition = useSharedValue(0.25)

    const panGesture = Gesture.Pan()
        .onUpdate((event) => {
            const newPosition = event.x / imageSize
            sliderPosition.value = Math.max(0, Math.min(1, newPosition))
        })

    const sliderAnimatedStyle = useAnimatedStyle(() => ({
        left: sliderPosition.value * imageSize,
    }))

    const originalClipStyle = useAnimatedStyle(() => ({
        width: sliderPosition.value * imageSize,
    }))

    const onViewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            if (viewableItems.length > 0 && viewableItems[0].index !== null) {
                onIndexChange?.(viewableItems[0].index)
            }
        }
    ).current

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 50,
    }).current

    const getItemLayout = (_: any, index: number) => ({
        length: imageSize,
        offset: imageSize * index,
        index,
    })

    const handleTitleChange = (text: string) => {
        setTitleText(text)
        onTitleChange?.(text)
    }

    const handleCaptionChange = (text: string) => {
        setCaptionText(text)
        onCaptionChange?.(text)
    }

    const total = totalItems ?? images.length

    return (
        <View style={styles.postCard}>
            {/* Card Header */}
            <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                    {showBackButton && onBackPress && (
                        <TouchableOpacity
                            style={styles.backButtonInCard}
                            onPress={onBackPress}
                        >
                            <Ionicons
                                name="arrow-back"
                                size={24}
                                color={colors.textPrimary}
                            />
                        </TouchableOpacity>
                    )}
                    {username && (
                        <TouchableOpacity onPress={onUsernamePress} disabled={!onUsernamePress}>
                            <Text style={styles.cardUsername}>@{username}</Text>
                        </TouchableOpacity>
                    )}
                </View>
                <View style={styles.cardHeaderRight}>
                    {headerBadgeText && (
                        <View style={styles.headerBadge}>
                            <Text style={styles.headerBadgeText}>{headerBadgeText}</Text>
                        </View>
                    )}
                    {showCatchBadge && (
                        <View style={styles.catchBadge}>
                            <Ionicons name="trophy" size={16} color={colors.secondary} />
                            <Text style={styles.catchCount}>{catchCount}</Text>
                        </View>
                    )}
                    {showBookmark && (
                        <TouchableOpacity onPress={onBookmarkPress} style={styles.headerIconButton}>
                            <Ionicons
                                name={bookmarked ? 'bookmark' : 'bookmark-outline'}
                                size={22}
                                color={bookmarked ? colors.iconActive : colors.iconInactive}
                            />
                        </TouchableOpacity>
                    )}
                    {onOptionsPress && (
                        <View style={{ zIndex: 10 }}>
                            <TouchableOpacity onPress={onOptionsPress} style={styles.headerIconButton}>
                                <Ionicons
                                    name="ellipsis-horizontal"
                                    size={22}
                                    color={colors.textPrimary}
                                />
                            </TouchableOpacity>
                            {showOptionsMenu && optionsMenuContent}
                        </View>
                    )}
                </View>
            </View>

            {/* Image Section */}
            {comparisonMode && originalImageUrl ? (
                <GestureHandlerRootView style={{ width: imageSize, height: imageSize }}>
                    <GestureDetector gesture={panGesture}>
                        <View style={[styles.comparisonContainer, { width: imageSize, height: imageSize }]}>
                            {/* Your photo (bottom layer) */}
                            <Image
                                source={{ uri: images[0] }}
                                style={[styles.comparisonImage, { width: imageSize, height: imageSize }]}
                                contentFit="cover"
                            />
                            {/* Original photo (top layer, clipped) */}
                            <Animated.View style={[styles.originalImageClip, originalClipStyle, { height: imageSize }]}>
                                <Image
                                    source={{ uri: originalImageUrl }}
                                    style={[styles.comparisonImage, { width: imageSize, height: imageSize }]}
                                    contentFit="cover"
                                />
                            </Animated.View>
                            {/* Slider handle */}
                            <Animated.View style={[styles.sliderHandle, sliderAnimatedStyle]}>
                                <View style={styles.sliderLine} />
                                <View style={styles.sliderKnob}>
                                    <Ionicons name="swap-horizontal" size={20} color={colors.textPrimary} />
                                </View>
                            </Animated.View>
                            {/* Labels */}
                            <View style={styles.comparisonLabels}>
                                <Text style={styles.comparisonLabel}>Original</Text>
                                <Text style={styles.comparisonLabel}>Yours</Text>
                            </View>
                        </View>
                    </GestureDetector>
                </GestureHandlerRootView>
            ) : images.length > 1 ? (
                <FlatList
                    ref={flatListRef}
                    data={images}
                    renderItem={({ item }) => (
                        <View style={{ width: imageSize, height: imageSize }}>
                            <Image
                                source={{ uri: item }}
                                style={styles.galleryImage}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                transition={200}
                            />
                        </View>
                    )}
                    keyExtractor={(item, index) => `${item}-${index}`}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={viewabilityConfig}
                    getItemLayout={getItemLayout}
                    style={{ height: imageSize }}
                />
            ) : (
                <View style={{ width: imageSize, height: imageSize }}>
                    <Image
                        source={{ uri: images[0] }}
                        style={styles.galleryImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={200}
                    />
                </View>
            )}

            {/* Card Footer */}
            <View style={styles.cardFooter}>
                {/* Title and Caption section */}
                <View style={styles.captionSection}>
                    {titleInputMode ? (
                        <TextInput
                            style={styles.titleInput}
                            placeholder={titlePlaceholder}
                            placeholderTextColor={colors.textTertiary}
                            value={titleText}
                            onChangeText={handleTitleChange}
                            maxLength={60}
                        />
                    ) : title ? (
                        <Text style={styles.title} numberOfLines={1}>
                            {title}
                        </Text>
                    ) : null}

                    {captionInputMode ? (
                        <TextInput
                            style={styles.captionInput}
                            placeholder={captionPlaceholder}
                            placeholderTextColor={colors.textTertiary}
                            value={captionText}
                            onChangeText={handleCaptionChange}
                            maxLength={200}
                            multiline
                        />
                    ) : caption ? (
                        <Text style={styles.caption} numberOfLines={2}>
                            {caption}
                        </Text>
                    ) : null}

                    {date && <Text style={styles.dateText}>{date}</Text>}
                </View>

                {/* Divider */}
                <View style={styles.footerDivider} />

                {/* Actions section */}
                <View style={styles.actionsSection}>
                    {showProgressBar && (
                        <View style={styles.threadProgress}>
                            <View style={styles.progressBar}>
                                <View
                                    style={[
                                        styles.progressFill,
                                        { width: `${((currentIndex + 1) / total) * 100}%` },
                                    ]}
                                />
                            </View>
                            <Text style={styles.progressText}>
                                {currentIndex + 1} of {total}
                            </Text>
                        </View>
                    )}

                    {onAddToListPress && (
                        <TouchableOpacity
                            style={[
                                styles.actionButton,
                                {
                                    backgroundColor: selectedListCount > 0 ? colors.cardElevated : 'transparent',
                                    borderWidth: 1,
                                    borderColor: selectedListCount > 0 ? colors.primary : colors.border,
                                    marginBottom: 8,
                                }
                            ]}
                            onPress={onAddToListPress}
                        >
                            <Ionicons
                                name={selectedListCount > 0 ? 'bookmark' : 'bookmark-outline'}
                                size={20}
                                color={selectedListCount > 0 ? colors.primary : colors.textPrimary}
                            />
                            <Text
                                style={[
                                    styles.actionButtonText,
                                    {
                                        color: selectedListCount > 0 ? colors.primary : colors.textPrimary,
                                    },
                                ]}
                            >
                                {selectedListCount > 0
                                    ? `Saved to ${selectedListCount} list${selectedListCount === 1 ? '' : 's'}`
                                    : 'Add to List'}
                            </Text>
                        </TouchableOpacity>
                    )}

                    {actionButtonText && (
                        <TouchableOpacity
                            style={[
                                styles.actionButton,
                                actionButtonDisabled && styles.actionButtonDisabled,
                            ]}
                            onPress={onActionPress}
                            disabled={actionButtonDisabled}
                        >
                            {actionButtonLoading ? (
                                <>
                                    <ActivityIndicator size="small" color="#fff" />
                                    <Text style={styles.actionButtonText}>{actionButtonLoadingText}</Text>
                                </>
                            ) : (
                                <>
                                    {actionButtonIcon && (
                                        <Ionicons name={actionButtonIcon as any} size={20} color="#fff" />
                                    )}
                                    <Text style={styles.actionButtonText}>{actionButtonText}</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    postCard: {
        backgroundColor: colors.card,
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 3,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 12,
    },
    cardHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButtonInCard: {
        padding: 4,
        marginRight: 8,
    },
    cardUsername: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    cardHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerBadge: {
        backgroundColor: colors.cardElevated,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
    },
    headerBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primary,
    },
    catchBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.cardElevated,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
        gap: 5,
    },
    catchCount: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.secondary,
    },
    headerIconButton: {
        padding: 4,
    },
    // Image styles
    galleryImage: {
        width: '100%',
        height: '100%',
        backgroundColor: colors.imageBackground,
    },
    // Comparison slider styles
    comparisonContainer: {
        position: 'relative',
        overflow: 'hidden',
    },
    comparisonImage: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
    originalImageClip: {
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'hidden',
    },
    sliderHandle: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 4,
        marginLeft: -2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sliderLine: {
        position: 'absolute',
        width: 2,
        height: '100%',
        backgroundColor: colors.textPrimary,
    },
    sliderKnob: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.card,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 3,
    },
    comparisonLabels: {
        position: 'absolute',
        bottom: 10,
        left: 10,
        right: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    comparisonLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textPrimary,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    // Footer styles
    cardFooter: {
        padding: 12,
        paddingTop: 10,
    },
    captionSection: {
        minHeight: 40,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
        lineHeight: 24,
        marginBottom: 4,
    },
    titleInput: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
        padding: 0,
        marginBottom: 8,
    },
    caption: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 18,
    },
    captionInput: {
        fontSize: 14,
        color: colors.textPrimary,
        padding: 0,
        minHeight: 36,
    },
    dateText: {
        fontSize: 12,
        color: colors.textTertiary,
        marginTop: 6,
    },
    footerDivider: {
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        marginVertical: 12,
    },
    actionsSection: {
        gap: 12,
    },
    threadProgress: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    progressBar: {
        flex: 1,
        height: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: colors.primary,
        borderRadius: 2,
    },
    progressText: {
        fontSize: 12,
        color: colors.textTertiary,
        minWidth: 50,
    },
    actionButton: {
        backgroundColor: colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 12,
        gap: 8,
    },
    actionButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    actionButtonDisabled: {
        opacity: 0.6,
    },
})
