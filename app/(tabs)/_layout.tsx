import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import type { ColorValue } from 'react-native'
import {
    Badge,
    Icon,
    Label,
    NativeTabs,
    VectorIcon,
} from 'expo-router/unstable-native-tabs'
import OnboardingModal from '@/components/OnboardingModal'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'

const ICON_SIZE = 28

// VectorIcon requests its family's image at a hardcoded 24px — wrap Ionicons
// so every request comes back at ICON_SIZE instead. iOS renders the image at
// intrinsic size; Android's Material bar clamps icons to 24dp regardless.
const sizedIonicons = {
    getImageSource: (
        name: keyof typeof Ionicons.glyphMap,
        _size: number,
        color: ColorValue
    ) => Ionicons.getImageSource(name, ICON_SIZE, color),
}

// Native UITabBarController / BottomNavigationView instead of the JS tab bar —
// tab switches happen on the native side so they stay responsive even when the
// JS thread is busy. Styled Instagram-style: icons only, no labels, no
// selection indicator, so nothing shifts when a tab is pressed.
// API is unstable in expo-router 6 (expo-router/unstable-native-tabs).
export default function TabLayout() {
    const { unreadCount } = useAuth()

    return (
        <>
            {/* First-run intro — shows once, over whichever tab loads first */}
            <OnboardingModal />
            <NativeTabs
                tintColor={colors.primary}
                // App is dark-only but the native bar follows system
                // appearance — pin it dark so it can't render light chrome
                backgroundColor={colors.background}
                // Android: icons stay centered with no label sliding in on
                // select (the "moves upward when pressed" behavior)
                labelVisibilityMode="unlabeled"
                // Android: no Material pill behind the selected icon
                disableIndicator
            >
                <NativeTabs.Trigger name="index">
                    <Label hidden />
                    <Icon
                        src={
                            <VectorIcon
                                family={sizedIonicons}
                                name="compass"
                            />
                        }
                    />
                    <Badge hidden={unreadCount === 0}>
                        {unreadCount > 0 ? String(unreadCount) : undefined}
                    </Badge>
                </NativeTabs.Trigger>
                <NativeTabs.Trigger name="map">
                    <Label hidden />
                    <Icon
                        src={<VectorIcon family={sizedIonicons} name="map" />}
                    />
                </NativeTabs.Trigger>
                <NativeTabs.Trigger name="post">
                    <Label hidden />
                    <Icon
                        src={
                            <VectorIcon
                                family={sizedIonicons}
                                name="add-circle"
                            />
                        }
                    />
                </NativeTabs.Trigger>
                <NativeTabs.Trigger name="lists">
                    <Label hidden />
                    <Icon
                        src={<VectorIcon family={sizedIonicons} name="list" />}
                    />
                </NativeTabs.Trigger>
                <NativeTabs.Trigger name="profile">
                    <Label hidden />
                    <Icon
                        src={
                            <VectorIcon
                                family={sizedIonicons}
                                name="person"
                            />
                        }
                    />
                </NativeTabs.Trigger>
            </NativeTabs>
        </>
    )
}
