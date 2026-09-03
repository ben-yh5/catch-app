import { Tabs } from 'expo-router'
import React from 'react'
import { Ionicons } from '@expo/vector-icons'
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated'
import OnboardingModal from '@/components/OnboardingModal'
import { useAuth } from '@/context/AuthContext'
import { colors } from '@/theme/colors'

const AnimatedIcon = ({
    name,
    color,
    focused,
}: {
    name: any
    color: string
    focused: boolean
}) => {
    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    scale: withSpring(focused ? 1.1 : 1, {
                        damping: 15,
                        stiffness: 150,
                    }),
                },
            ],
        }
    })

    return (
        <Animated.View style={animatedStyle} accessible={false}>
            <Ionicons name={name} size={28} color={color} />
        </Animated.View>
    )
}

export default function TabLayout() {
    const { unreadCount } = useAuth()

    return (
        <>
            {/* First-run intro — shows once, over whichever tab loads first */}
            <OnboardingModal />
            <Tabs
            screenOptions={{
                tabBarActiveTintColor: colors.primary,
                headerShown: false,
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: 'Explore',
                    tabBarAccessibilityLabel:
                        unreadCount > 0
                            ? `Explore tab, ${unreadCount} unread notifications`
                            : 'Explore tab',
                    // Unread notifications are otherwise only visible inside
                    // the Explore header
                    tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon
                            name="compass"
                            color={color}
                            focused={focused}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="map"
                options={{
                    title: 'Map',
                    tabBarAccessibilityLabel: 'Map tab',
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon
                            name="map"
                            color={color}
                            focused={focused}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="post"
                options={{
                    title: 'Post',
                    tabBarAccessibilityLabel: 'Post tab',
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon
                            name="add-circle"
                            color={color}
                            focused={focused}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="lists"
                options={{
                    title: 'Lists',
                    tabBarAccessibilityLabel: 'Lists tab',
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon
                            name="list"
                            color={color}
                            focused={focused}
                        />
                    ),
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    title: 'Profile',
                    tabBarAccessibilityLabel: 'Profile tab',
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon
                            name="person"
                            color={color}
                            focused={focused}
                        />
                    ),
                }}
            />
            </Tabs>
        </>
    )
}
