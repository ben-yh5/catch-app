/**
 * UnifiedPreviewScreen - Photo preview and caption input for posts and catches
 *
 * After capturing a photo, users see this screen to:
 * - Preview their captured image
 * - Add an optional caption (max 200 characters)
 * - View location status (captured or not available)
 * - Confirm or cancel the post/catch
 *
 * Used by:
 * - PostScreen: Creating new posts
 * - ThreadModal: Confirming catches
 */

import { colors } from '@/theme/colors'
import { Post } from '@/types'
import React, { useState } from 'react'
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ListSelectionBottomSheet from './ListSelectionBottomSheet'
import NudgeCard from './NudgeCard'
import PostCard from './PostCard'
interface UnifiedPreviewScreenProps {
    imageUri: string
    onConfirm: (caption?: string, listIds?: Set<string>) => void
    onCancel: () => void
    mode: 'post' | 'catch'
    loading?: boolean
    loadingText?: string
    hasLocation?: boolean
    loadingLocation?: boolean
    originalPhotoUrl?: string
    similarPost?: Post | null
    onCatchInstead?: (post: Post) => void
    onNotAMatch?: () => void
}

export default function UnifiedPreviewScreen({
    imageUri,
    onConfirm,
    onCancel,
    mode,
    loading = false,
    loadingText = 'Processing...',
    hasLocation = false,
    loadingLocation = false,
    originalPhotoUrl,
    similarPost,
    onCatchInstead,
    onNotAMatch,
}: UnifiedPreviewScreenProps) {
    const [caption, setCaption] = useState('')
    const [showListSelection, setShowListSelection] = useState(false)
    const [selectedListIds, setSelectedListIds] = useState<Set<string>>(
        new Set()
    )
    const [nudgeDismissed, setNudgeDismissed] = useState(false)
    const insets = useSafeAreaInsets()

    const handleConfirm = () => {
        onConfirm(caption, selectedListIds)
    }

    const isPost = mode === 'post'
    const isCatch = mode === 'catch'

    // Determine button state
    const buttonDisabled = loading || loadingLocation
    const buttonLoading = loading

    let buttonText = isPost ? 'Post' : 'Catch This Shot'
    let buttonLoadingText = loadingText

    if ((isPost || isCatch) && loadingLocation) {
        buttonText = 'Fetching location...'
    }

    // Format today's date
    const today = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <ScrollView
                contentContainerStyle={[
                    styles.scrollContent,
                    { paddingTop: insets.top + 10 },
                ]}
                keyboardShouldPersistTaps="handled"
            >
                <PostCard
                    // Header
                    showBackButton={true}
                    onBackPress={onCancel}
                    headerBadgeText={isPost ? 'New Post' : 'New Catch'}
                    // Image
                    images={[imageUri]}
                    comparisonMode={isCatch && !!originalPhotoUrl}
                    originalImageUrl={originalPhotoUrl}
                    // Footer
                    captionInputMode={true}
                    captionPlaceholder="Add a caption (optional)..."
                    onCaptionChange={setCaption}
                    date={today}
                    // Progress bar - hide for single item preview
                    showProgressBar={false}
                    // Action button
                    actionButtonText={buttonText}
                    actionButtonIcon={isPost ? 'arrow-up' : 'camera'}
                    onActionPress={handleConfirm}
                    actionButtonDisabled={buttonDisabled}
                    actionButtonLoading={buttonLoading}
                    actionButtonLoadingText={buttonLoadingText}
                    // List Selection
                    onAddToListPress={() => setShowListSelection(true)}
                    selectedListCount={selectedListIds.size}
                />
            </ScrollView>

            {isPost && similarPost && !nudgeDismissed && onCatchInstead && (
                <View
                    style={[
                        styles.nudgeOverlay,
                        { bottom: insets.bottom + 10 },
                    ]}
                >
                    <NudgeCard
                        post={similarPost}
                        onCatchInstead={onCatchInstead}
                        onDismiss={() => setNudgeDismissed(true)}
                        onNotAMatch={() => {
                            setNudgeDismissed(true)
                            onNotAMatch?.()
                        }}
                    />
                </View>
            )}

            <ListSelectionBottomSheet
                visible={showListSelection}
                onClose={() => setShowListSelection(false)}
                initialSelectedIds={selectedListIds}
                onSelectionChange={setSelectedListIds}
            />
        </KeyboardAvoidingView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    scrollContent: {
        padding: 10,
        paddingBottom: 40,
    },
    nudgeOverlay: {
        position: 'absolute',
        left: 10,
        right: 10,
    },
})
