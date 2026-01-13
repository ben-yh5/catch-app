import { colors } from '@/theme/colors'
import * as Haptics from 'expo-haptics'
import React from 'react'
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    TouchableOpacityProps,
    ViewStyle,
} from 'react-native'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface AppButtonProps extends TouchableOpacityProps {
    variant?: ButtonVariant
    size?: ButtonSize
    title: string
    loading?: boolean
    block?: boolean
    icon?: React.ReactNode
}

export default function AppButton({
    variant = 'primary',
    size = 'md',
    title,
    loading = false,
    block = false,
    icon,
    style,
    disabled,
    onPress,
    ...props
}: AppButtonProps) {
    const handlePress = (e: any) => {
        if (loading || disabled) return

        // Haptic feedback based on variant
        if (variant === 'primary' || variant === 'danger') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        }

        onPress?.(e)
    }

    const getBackgroundColor = () => {
        if (disabled) return colors.cardElevated
        switch (variant) {
            case 'primary':
                return colors.primary
            case 'secondary':
                return colors.secondary
            case 'danger':
                return colors.danger
            case 'outline':
            case 'ghost':
                return 'transparent'
            default:
                return colors.primary
        }
    }

    const getTextColor = () => {
        if (disabled) return colors.textTertiary
        switch (variant) {
            case 'primary':
            case 'secondary':
            case 'danger':
                return '#FFFFFF'
            case 'outline':
            case 'ghost':
                return colors.primary
            default:
                return '#FFFFFF'
        }
    }

    const getBorderColor = () => {
        if (disabled) return 'transparent'
        switch (variant) {
            case 'outline':
                return colors.primary
            default:
                return 'transparent'
        }
    }

    const getHeight = () => {
        switch (size) {
            case 'sm':
                return 36
            case 'lg':
                return 56
            case 'md':
            default:
                return 48
        }
    }

    const getFontSize = () => {
        switch (size) {
            case 'sm':
                return 14
            case 'lg':
                return 18
            case 'md':
            default:
                return 16
        }
    }

    const baseStyles: ViewStyle = {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: getBackgroundColor(),
        borderColor: getBorderColor(),
        borderWidth: variant === 'outline' ? 1.5 : 0,
        height: getHeight(),
        opacity: disabled ? 0.7 : 1,
        width: block ? '100%' : undefined,
        paddingHorizontal: size === 'sm' ? 16 : 24,
    }

    return (
        <TouchableOpacity
            style={[baseStyles, style]}
            onPress={handlePress}
            disabled={disabled || loading}
            activeOpacity={0.7}
            {...props}
        >
            {loading ? (
                <ActivityIndicator
                    color={getTextColor()}
                    size={size === 'sm' ? 'small' : 'small'}
                />
            ) : (
                <>
                    {icon}
                    <Text
                        style={[
                            styles.text,
                            {
                                color: getTextColor(),
                                fontSize: getFontSize(),
                                marginLeft: icon ? 8 : 0,
                                fontWeight: '600',
                            },
                        ]}
                    >
                        {title}
                    </Text>
                </>
            )}
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    text: {
        textAlign: 'center',
    },
})
