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
import React, { useState } from 'react'
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ListSelectionBottomSheet from './ListSelectionBottomSheet'
import PostCard from './PostCard'
interface UnifiedPreviewScreenProps {
    imageUri: string
    onConfirm: (title?: string, caption?: string, listIds?: Set<string>) => void
    onCancel: () => void
    mode: 'post' | 'catch'
    loading?: boolean
    loadingText?: string
    hasLocation?: boolean
    loadingLocation?: boolean
    originalPhotoUrl?: string
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
}: UnifiedPreviewScreenProps) {
    const [title, setTitle] = useState('')
    const [caption, setCaption] = useState('')
    const [showListSelection, setShowListSelection] = useState(false)
    const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set())
    const insets = useSafeAreaInsets()

    const handleConfirm = () => {
        onConfirm(title, caption, selectedListIds)
    }

    const isPost = mode === 'post'
    const isCatch = mode === 'catch'

    // Determine button state
    const buttonDisabled = loading || loadingLocation || (isPost && !title.trim())
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
                    titleInputMode={true}
                    captionInputMode={true}
                    titlePlaceholder={isPost ? "Add a title (required)..." : "Add a title (optional)..."}
                    captionPlaceholder="Add a caption (optional)..."
                    onTitleChange={setTitle}
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
})
