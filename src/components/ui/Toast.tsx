import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React, {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
} from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, {
    FadeInUp,
    FadeOutUp,
    LinearTransition,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// --- Types ---

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastMessage {
    id: number
    type: ToastType
    title: string
    message?: string
    duration?: number
}

interface ToastContextValue {
    showToast: (
        type: ToastType,
        title: string,
        message?: string,
        duration?: number
    ) => void
}

// --- Config ---

const TOAST_COLORS: Record<ToastType, string> = {
    success: colors.success,
    error: colors.error,
    warning: colors.warning,
    info: colors.info,
}

const TOAST_ICONS: Record<ToastType, keyof typeof Ionicons.glyphMap> = {
    success: 'checkmark-circle',
    error: 'close-circle',
    warning: 'warning',
    info: 'information-circle',
}

const DEFAULT_DURATION = 3000

// --- Context ---

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
    const context = useContext(ToastContext)
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider')
    }
    return context
}

// --- Toast Item ---

function ToastItem({
    toast,
    onDismiss,
}: {
    toast: ToastMessage
    onDismiss: (id: number) => void
}) {
    const accentColor = TOAST_COLORS[toast.type]
    const iconName = TOAST_ICONS[toast.type]

    return (
        <Animated.View
            entering={FadeInUp.duration(250)}
            exiting={FadeOutUp.duration(200)}
            layout={LinearTransition.duration(200)}
        >
            <TouchableOpacity
                style={[styles.toast, { borderLeftColor: accentColor }]}
                activeOpacity={0.9}
                onPress={() => onDismiss(toast.id)}
                accessibilityRole="alert"
                accessibilityLabel={`${toast.type}: ${toast.title}${toast.message ? `. ${toast.message}` : ''}`}
                accessibilityHint="Tap to dismiss"
            >
                <Ionicons name={iconName} size={20} color={accentColor} />
                <View style={styles.toastTextContainer}>
                    <Text style={styles.toastTitle} numberOfLines={1}>
                        {toast.title}
                    </Text>
                    {toast.message && (
                        <Text style={styles.toastMessage} numberOfLines={2}>
                            {toast.message}
                        </Text>
                    )}
                </View>
            </TouchableOpacity>
        </Animated.View>
    )
}

// --- Provider ---

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastMessage[]>([])
    const nextId = useRef(0)
    const timerRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(
        new Map()
    )
    const insets = useSafeAreaInsets()

    const dismiss = useCallback((id: number) => {
        const timer = timerRefs.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timerRefs.current.delete(id)
        }
        setToasts((prev) => prev.filter((t) => t.id !== id))
    }, [])

    const showToast = useCallback(
        (
            type: ToastType,
            title: string,
            message?: string,
            duration?: number
        ) => {
            const id = nextId.current++
            const ms = duration ?? DEFAULT_DURATION

            const toast: ToastMessage = {
                id,
                type,
                title,
                message,
                duration: ms,
            }

            setToasts((prev) => {
                // Keep max 2 toasts visible
                const updated = prev.length >= 2 ? prev.slice(1) : prev
                return [...updated, toast]
            })

            const timer = setTimeout(() => {
                dismiss(id)
            }, ms)
            timerRefs.current.set(id, timer)
        },
        [dismiss]
    )

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <View
                style={[styles.container, { top: insets.top + 8 }]}
                pointerEvents="box-none"
            >
                {toasts.map((toast) => (
                    <ToastItem
                        key={toast.id}
                        toast={toast}
                        onDismiss={dismiss}
                    />
                ))}
            </View>
        </ToastContext.Provider>
    )
}

// --- Styles ---

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: 99999,
        gap: 8,
    },
    toast: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.card,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 10,
        borderLeftWidth: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    toastTextContainer: {
        flex: 1,
    },
    toastTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    toastMessage: {
        fontSize: 13,
        color: colors.textSecondary,
        marginTop: 2,
        lineHeight: 17,
    },
})
