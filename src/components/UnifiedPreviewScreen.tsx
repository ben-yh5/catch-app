import React, { useState } from 'react'
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    ActivityIndicator,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/theme/colors'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

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

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <ScrollView
                contentContainerStyle={[
                    styles.scrollContent,
                    { paddingTop: insets.top + 20 },
                ]}
            >
                {/* Title for both modes */}
                <Text style={styles.title}>
                    {isPost ? 'Preview Your Post' : 'Preview Your Catch'}
                </Text>

                {/* Main captured image - 1:1 square */}
                <View style={styles.imageContainer}>
                    <Image
                        source={{ uri: imageUri }}
                        style={styles.previewImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={200}
                    />
                </View>

                {/* Original photo for catch mode - same size as caught image */}
                {isCatch && originalPhotoUrl && (
                    <View style={styles.comparisonContainer}>
                        <Text style={styles.comparisonLabel}>
                            Original Photo:
                        </Text>
                        <View style={styles.imageContainer}>
                            <Image
                                source={{ uri: originalPhotoUrl }}
                                style={styles.previewImage}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                transition={200}
                            />
                        </View>
                    </View>
                )}

                {/* Location display for both modes */}
                <View style={styles.locationContainer}>
                    {loadingLocation ? (
                        <View style={styles.locationLoading}>
                            <ActivityIndicator
                                size="small"
                                color={colors.primary}
                            />
                            <Text style={styles.locationLoadingText}>
                                Getting location...
                            </Text>
                        </View>
                    ) : hasLocation ? (
                        <View style={styles.locationInfo}>
                            <Ionicons
                                name="location"
                                size={18}
                                color={colors.primary}
                            />
                            <Text style={styles.locationText}>
                                Location captured
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.locationInfo}>
                            <Ionicons
                                name="location-outline"
                                size={18}
                                color={colors.textTertiary}
                            />
                            <Text style={styles.noLocationText}>
                                No location available
                            </Text>
                        </View>
                    )}
                </View>

                {/* Caption input for both modes */}
                <TextInput
                    style={styles.captionInput}
                    placeholder={
                        isPost
                            ? 'Add a caption or hint...'
                            : 'Add a caption (optional)...'
                    }
                    placeholderTextColor={colors.textTertiary}
                    value={caption}
                    onChangeText={setCaption}
                    multiline
                    maxLength={200}
                />

                {/* Catch mode info */}
                {isCatch && (
                    <Text style={styles.catchInfo}>
                        Your catch photo will be posted to your profile
                    </Text>
                )}

                {/* Action buttons */}
                <View style={styles.buttonRow}>
                    <TouchableOpacity
                        style={[styles.actionButton, styles.cancelButton]}
                        onPress={onCancel}
                        disabled={loading}
                    >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.actionButton,
                            styles.confirmButton,
                            loading && styles.confirmButtonDisabled,
                        ]}
                        onPress={handleConfirm}
                        disabled={loading || (isPost && loadingLocation)}
                    >
                        {loading ? (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="small" color="#fff" />
                                <Text style={styles.confirmButtonText}>
                                    {loadingText}
                                </Text>
                            </View>
                        ) : (
                            <Text style={styles.confirmButtonText}>
                                {isPost ? 'Post' : 'Confirm Catch'}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
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
        padding: 20,
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
        color: colors.textPrimary,
    },
    imageContainer: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: colors.imageBackground,
        marginBottom: 15,
    },
    previewImage: {
        width: '100%',
        height: '100%',
    },
    comparisonContainer: {
        width: '100%',
        marginBottom: 15,
    },
    comparisonLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textSecondary,
        marginBottom: 8,
        textAlign: 'center',
    },
    locationContainer: {
        width: '100%',
        marginBottom: 15,
    },
    locationLoading: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        backgroundColor: colors.card,
        borderRadius: 8,
        gap: 10,
    },
    locationLoadingText: {
        fontSize: 14,
        color: colors.textTertiary,
    },
    locationInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        backgroundColor: colors.card,
        borderRadius: 8,
        gap: 8,
    },
    locationText: {
        fontSize: 14,
        color: colors.primary,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    noLocationText: {
        fontSize: 14,
        color: colors.textTertiary,
        fontStyle: 'italic',
    },
    captionInput: {
        width: '100%',
        backgroundColor: colors.card,
        padding: 15,
        borderRadius: 10,
        fontSize: 16,
        minHeight: 100,
        textAlignVertical: 'top',
        marginBottom: 20,
        borderWidth: 1,
        borderColor: colors.border,
        color: colors.textPrimary,
    },
    catchInfo: {
        fontSize: 14,
        color: colors.textTertiary,
        textAlign: 'center',
        marginBottom: 20,
        fontStyle: 'italic',
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 15,
        width: '100%',
    },
    actionButton: {
        flex: 1,
        paddingVertical: 15,
        borderRadius: 10,
        alignItems: 'center',
    },
    cancelButton: {
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
    },
    cancelButtonText: {
        color: colors.textPrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    confirmButton: {
        backgroundColor: colors.primary,
    },
    confirmButtonDisabled: {
        backgroundColor: colors.cardElevated,
        opacity: 0.6,
    },
    confirmButtonText: {
        color: colors.textPrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    loadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
})
