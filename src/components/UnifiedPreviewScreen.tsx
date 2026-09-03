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
import CatchIssuesPanel, { CatchIssue } from './CatchIssuesPanel'
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
    issues?: CatchIssue[]
    onRetake?: () => void
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
    issues = [],
    onRetake,
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

    // A retake-required issue blocks confirm until a new photo is taken;
    // other issues (e.g. too far away) leave it enabled for another try
    const retakeRequired = issues.some((issue) => issue.requiresRetake)

    // Determine button state
    const buttonDisabled = loading || loadingLocation || retakeRequired
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

            {(issues.length > 0 ||
                (isPost && similarPost && !nudgeDismissed && onCatchInstead)) && (
                <View
                    style={[
                        styles.nudgeOverlay,
                        { bottom: insets.bottom + 10 },
                    ]}
                >
                    {issues.length > 0 && (
                        <CatchIssuesPanel
                            issues={issues}
                            onRetake={onRetake}
                            onTryAgain={loading ? undefined : handleConfirm}
                        />
                    )}
                    {isPost &&
                        similarPost &&
                        !nudgeDismissed &&
                        onCatchInstead && (
                            <View style={issues.length > 0 && styles.nudgeGap}>
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
    nudgeGap: {
        marginTop: 10,
    },
})
