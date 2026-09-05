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
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
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
    /**
     * Upload progress 0–1 while the image is transferring, null otherwise.
     * While `loading` is true a full-screen overlay blocks ALL navigation
     * (including the tab bar) so an in-flight upload can't be orphaned by
     * tapping away.
     */
    uploadProgress?: number | null
    /**
     * Clearance for the confirm button / nudge overlay when rendered inside
     * the (tabs) navigator (pass useTabBarInset()). Omit in modals — they
     * get their own full-height window.
     */
    bottomInset?: number
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
    uploadProgress = null,
    bottomInset = 0,
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
                    {
                        paddingTop: insets.top + 10,
                        paddingBottom: 40 + bottomInset,
                    },
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
                        // bottomInset already includes the system inset
                        // when set (tab bar clearance), so don't add both
                        { bottom: (bottomInset || insets.bottom) + 10 },
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

            {/* Full-screen upload blocker: an RN Modal covers the tab bar,
                so tapping away mid-upload can't orphan the post */}
            <Modal visible={loading} transparent animationType="fade">
                <View style={styles.uploadOverlay}>
                    <View style={styles.uploadCard}>
                        {uploadProgress !== null ? (
                            <>
                                <View style={styles.progressTrack}>
                                    <View
                                        style={[
                                            styles.progressFill,
                                            {
                                                width: `${Math.round(uploadProgress * 100)}%`,
                                            },
                                        ]}
                                    />
                                </View>
                                <Text style={styles.uploadText}>
                                    Uploading… {Math.round(uploadProgress * 100)}
                                    %
                                </Text>
                            </>
                        ) : (
                            <>
                                <ActivityIndicator
                                    size="large"
                                    color={colors.primary}
                                />
                                <Text style={styles.uploadText}>
                                    {loadingText}
                                </Text>
                            </>
                        )}
                        <Text style={styles.uploadHint}>
                            Keep the app open until this finishes
                        </Text>
                    </View>
                </View>
            </Modal>
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
    uploadOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    uploadCard: {
        width: '80%',
        maxWidth: 320,
        backgroundColor: colors.cardElevated,
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        gap: 12,
    },
    progressTrack: {
        width: '100%',
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.border,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 3,
        backgroundColor: colors.primary,
    },
    uploadText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    uploadHint: {
        fontSize: 12,
        color: colors.textTertiary,
    },
})
