import { colors } from '@/theme/colors'
import React, { useRef, useState } from 'react'
import {
    Animated,
    StyleSheet,
    Text,
    TextInput,
    TextInputProps,
    View,
} from 'react-native'

interface AppInputProps extends TextInputProps {
    label?: string
    error?: string
    leftIcon?: React.ReactNode
    rightIcon?: React.ReactNode
}

export default function AppInput({
    label,
    error,
    leftIcon,
    rightIcon,
    style,
    onFocus,
    onBlur,
    ...props
}: AppInputProps) {
    const [isFocused, setIsFocused] = useState(false)
    const focusAnim = useRef(new Animated.Value(0)).current

    const handleFocus = (e: any) => {
        setIsFocused(true)
        Animated.timing(focusAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: false,
        }).start()
        onFocus?.(e)
    }

    const handleBlur = (e: any) => {
        setIsFocused(false)
        Animated.timing(focusAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
        }).start()
        onBlur?.(e)
    }

    const borderColor = focusAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.border, colors.primary],
    })

    const backgroundColor = focusAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.card, colors.cardElevated],
    })

    return (
        <View style={styles.container}>
            {label && <Text style={styles.label}>{label}</Text>}

            <Animated.View
                style={[
                    styles.inputContainer,
                    {
                        borderColor: error ? colors.danger : borderColor,
                        backgroundColor,
                    },
                ]}
            >
                {leftIcon && <View style={styles.leftIcon}>{leftIcon}</View>}

                <TextInput
                    style={[styles.input, style]}
                    placeholderTextColor={colors.textTertiary}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    accessibilityLabel={label || props.placeholder}
                    accessibilityHint={error || undefined}
                    {...props}
                />

                {rightIcon && <View style={styles.rightIcon}>{rightIcon}</View>}
            </Animated.View>

            {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 16,
        width: '100%',
    },
    label: {
        color: colors.textSecondary,
        fontSize: 14,
        marginBottom: 8,
        fontWeight: '500',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        height: 50,
        overflow: 'hidden',
    },
    input: {
        flex: 1,
        color: colors.textPrimary,
        fontSize: 16,
        paddingHorizontal: 16,
        height: '100%',
    },
    leftIcon: {
        paddingLeft: 16,
    },
    rightIcon: {
        paddingRight: 16,
    },
    errorText: {
        color: colors.danger,
        fontSize: 12,
        marginTop: 4,
        marginLeft: 4,
    },
})
