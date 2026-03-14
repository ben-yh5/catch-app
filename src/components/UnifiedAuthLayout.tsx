import { colors } from '@/theme/colors'
import React from 'react'
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface UnifiedAuthLayoutProps {
    title: string
    subtitle: string
    children: React.ReactNode
}

export default function UnifiedAuthLayout({
    title,
    subtitle,
    children,
}: UnifiedAuthLayoutProps) {
    const insets = useSafeAreaInsets()

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <ScrollView
                contentContainerStyle={[
                    styles.scrollContent,
                    { paddingTop: insets.top + 40 },
                ]}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.header}>
                    <Text style={styles.title} accessibilityRole="header">
                        {title}
                    </Text>
                    <Text style={styles.subtitle}>{subtitle}</Text>
                </View>

                <View style={styles.formContainer}>{children}</View>
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
        flexGrow: 1,
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 40,
    },
    header: {
        alignItems: 'center',
        marginBottom: 40,
    },
    title: {
        fontSize: 48,
        fontWeight: 'bold',
        color: colors.textPrimary,
        marginBottom: 10,
    },
    subtitle: {
        fontSize: 18,
        color: colors.textTertiary,
        textAlign: 'center',
    },
    formContainer: {
        width: '100%',
        maxWidth: 400,
    },
})
