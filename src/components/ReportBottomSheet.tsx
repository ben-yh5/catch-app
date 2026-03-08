import { useToast } from '@/components/ui/Toast'
import { functions } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { httpsCallable } from 'firebase/functions'
import React, { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Animated,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'

interface ReportBottomSheetProps {
    visible: boolean
    onClose: () => void
    targetUserId: string
    targetUsername: string
}

const REPORT_REASONS = [
    { key: 'harassment', label: 'Harassment or bullying', icon: 'hand-left-outline' as const },
    { key: 'spam', label: 'Spam or scam', icon: 'megaphone-outline' as const },
    { key: 'impersonation', label: 'Impersonation', icon: 'person-outline' as const },
    { key: 'inappropriate_content', label: 'Inappropriate content', icon: 'warning-outline' as const },
    { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' as const },
]

export default function ReportBottomSheet({
    visible,
    onClose,
    targetUserId,
    targetUsername,
}: ReportBottomSheetProps) {
    const { showToast } = useToast()
    const [step, setStep] = useState<'reason' | 'details'>('reason')
    const [selectedReason, setSelectedReason] = useState<string | null>(null)
    const [details, setDetails] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const slideAnim = React.useRef(new Animated.Value(0)).current

    useEffect(() => {
        if (visible) {
            Animated.spring(slideAnim, {
                toValue: 1,
                useNativeDriver: true,
                tension: 65,
                friction: 11,
            }).start()
        } else {
            slideAnim.setValue(0)
            setStep('reason')
            setSelectedReason(null)
            setDetails('')
            setSubmitting(false)
        }
    }, [visible, slideAnim])

    const handleSelectReason = (reasonKey: string) => {
        setSelectedReason(reasonKey)
        setStep('details')
    }

    const handleSubmit = async () => {
        if (!selectedReason || submitting) return

        setSubmitting(true)
        try {
            const reportUserFn = httpsCallable(functions, 'reportUser')
            await reportUserFn({
                targetUserId,
                reason: selectedReason,
                details: details.trim(),
            })
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            showToast('success', 'Report Submitted', 'Thank you for helping keep Catch safe.')
            onClose()
        } catch (error: any) {
            console.error('[ReportBottomSheet] Error:', error?.code, error?.message)
            const code = error?.code
            if (code === 'functions/already-exists') {
                showToast('warning', 'Already Reported', 'You have already reported this user.')
            } else if (code === 'functions/resource-exhausted') {
                showToast('warning', 'Please Wait', 'Too many reports submitted. Try again later.')
            } else {
                showToast('error', 'Report Failed', error?.message || 'Please try again.')
            }
        } finally {
            setSubmitting(false)
        }
    }

    const selectedReasonData = REPORT_REASONS.find(r => r.key === selectedReason)

    const translateY = slideAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [600, 0],
    })

    return (
        <Modal
            visible={visible}
            animationType="fade"
            transparent={true}
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView
                style={styles.overlay}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onClose}
                />
                <Animated.View
                    style={[
                        styles.bottomSheetContainer,
                        { transform: [{ translateY }] },
                    ]}
                >
                    <View style={styles.header}>
                        {step === 'details' ? (
                            <TouchableOpacity
                                onPress={() => setStep('reason')}
                                style={styles.backButton}
                                accessibilityLabel="Go back"
                                accessibilityRole="button"
                            >
                                <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
                            </TouchableOpacity>
                        ) : (
                            <View style={{ width: 32 }} />
                        )}
                        <Text style={styles.headerTitle}>
                            Report @{targetUsername}
                        </Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            accessibilityLabel="Close"
                            accessibilityRole="button"
                        >
                            <Ionicons name="close" size={24} color={colors.textPrimary} />
                        </TouchableOpacity>
                    </View>

                    {step === 'reason' ? (
                        <ScrollView
                            contentContainerStyle={styles.listContainer}
                            showsVerticalScrollIndicator={false}
                        >
                            <Text style={styles.sectionLabel}>
                                Why are you reporting this user?
                            </Text>
                            {REPORT_REASONS.map((reason) => (
                                <TouchableOpacity
                                    key={reason.key}
                                    style={styles.reasonItem}
                                    onPress={() => handleSelectReason(reason.key)}
                                    accessibilityRole="button"
                                    accessibilityLabel={reason.label}
                                >
                                    <Ionicons
                                        name={reason.icon}
                                        size={20}
                                        color={colors.textSecondary}
                                        style={styles.reasonIcon}
                                    />
                                    <Text style={styles.reasonLabel}>{reason.label}</Text>
                                    <Ionicons
                                        name="chevron-forward"
                                        size={18}
                                        color={colors.textTertiary}
                                    />
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    ) : (
                        <ScrollView
                            contentContainerStyle={styles.detailsContainer}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >
                            {selectedReasonData && (
                                <View style={styles.selectedReasonPill}>
                                    <Ionicons
                                        name={selectedReasonData.icon}
                                        size={16}
                                        color={colors.textSecondary}
                                    />
                                    <Text style={styles.selectedReasonText}>
                                        {selectedReasonData.label}
                                    </Text>
                                </View>
                            )}

                            <TextInput
                                style={styles.textInput}
                                placeholder="Add details (optional)"
                                placeholderTextColor={colors.textTertiary}
                                multiline
                                maxLength={500}
                                value={details}
                                onChangeText={setDetails}
                                textAlignVertical="top"
                                accessibilityLabel="Report details"
                                accessibilityHint="Add optional details about this report"
                            />
                            <Text style={styles.charCount}>
                                {details.length}/500
                            </Text>

                            <TouchableOpacity
                                style={[
                                    styles.submitButton,
                                    submitting && styles.submitButtonDisabled,
                                ]}
                                onPress={handleSubmit}
                                disabled={submitting}
                                accessibilityRole="button"
                                accessibilityLabel={submitting ? 'Submitting report' : 'Submit Report'}
                                accessibilityState={{ disabled: submitting }}
                            >
                                {submitting ? (
                                    <ActivityIndicator size="small" color={colors.white} />
                                ) : (
                                    <Text style={styles.submitButtonText}>Submit Report</Text>
                                )}
                            </TouchableOpacity>
                        </ScrollView>
                    )}
                </Animated.View>
            </KeyboardAvoidingView>
        </Modal>
    )
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    bottomSheetContainer: {
        backgroundColor: colors.card,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '70%',
        paddingBottom: 34,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
        flex: 1,
        textAlign: 'center',
    },
    closeButton: {
        padding: 4,
        width: 32,
        alignItems: 'flex-end',
    },
    backButton: {
        padding: 4,
        width: 32,
    },
    listContainer: {
        padding: 16,
    },
    sectionLabel: {
        fontSize: 15,
        color: colors.textSecondary,
        marginBottom: 12,
        paddingHorizontal: 4,
    },
    reasonItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        marginBottom: 8,
        backgroundColor: colors.cardElevated,
        borderRadius: 12,
    },
    reasonIcon: {
        marginRight: 12,
    },
    reasonLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.textPrimary,
        flex: 1,
    },
    detailsContainer: {
        padding: 16,
    },
    selectedReasonPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.cardElevated,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        marginBottom: 16,
        alignSelf: 'flex-start',
        gap: 8,
    },
    selectedReasonText: {
        fontSize: 14,
        color: colors.textSecondary,
    },
    textInput: {
        backgroundColor: colors.cardElevated,
        borderRadius: 12,
        padding: 14,
        fontSize: 16,
        color: colors.textPrimary,
        minHeight: 100,
    },
    charCount: {
        fontSize: 12,
        color: colors.textTertiary,
        textAlign: 'right',
        marginTop: 4,
        marginBottom: 16,
    },
    submitButton: {
        backgroundColor: colors.danger,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    submitButtonDisabled: {
        opacity: 0.6,
    },
    submitButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.white,
    },
})
