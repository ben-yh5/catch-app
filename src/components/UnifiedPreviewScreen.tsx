import React, { useState } from 'react'
import {
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native'
import { colors } from '@/theme/colors'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import PostCard from './PostCard'

interface UnifiedPreviewScreenProps {
    imageUri: string
    onConfirm: (caption?: string) => void
    onCancel: () => void
    mode: 'post' | 'catch'
    loading?: boolean
    loadingText?: string
    hasLocation?: boolean
    loadingLocation?: boolean
    originalPhotoUrl?: string // For catch mode - shows what they're trying to catch
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
    const [caption, setCaption] = useState('')
    const insets = useSafeAreaInsets()

    const handleConfirm = () => {
        onConfirm(caption)
    }

    const isPost = mode === 'post'
    const isCatch = mode === 'catch'

    // Determine button state
    const buttonDisabled = loading || (isPost && loadingLocation)
    const buttonLoading = loading

    let buttonText = isPost ? 'Post' : 'Catch This Location'
    let buttonLoadingText = loadingText

    if (isPost && loadingLocation) {
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
                    captionPlaceholder={isPost ? 'Add a caption or hint...' : 'Add a caption (optional)...'}
                    onCaptionChange={setCaption}
                    date={today}

                    // Progress bar - always show with 1 of 1 for consistency
                    showProgressBar={true}
                    totalItems={1}
                    currentIndex={0}

                    // Action button
                    actionButtonText={buttonText}
                    actionButtonIcon={isPost ? 'arrow-up' : 'camera'}
                    onActionPress={handleConfirm}
                    actionButtonDisabled={buttonDisabled}
                    actionButtonLoading={buttonLoading}
                    actionButtonLoadingText={buttonLoadingText}
                />
            </ScrollView>
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
    },
})
