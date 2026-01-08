import { Tabs } from 'expo-router'
import React from 'react'
import { Ionicons } from '@expo/vector-icons'
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated'
import { colors } from '@/theme/colors'

const AnimatedIcon = ({ name, color, focused }: { name: any, color: string, focused: boolean }) => {
    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    scale: withSpring(focused ? 1.1 : 1, {
                        damping: 15,
                        stiffness: 150,
                    })
                }
            ]
        }
    })

    return (
        <Animated.View style={animatedStyle}>
            <Ionicons name={name} size={28} color={color} />
        </Animated.View>
    )
}

export default function TabLayout() {
    return (
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
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon name="compass" color={color} focused={focused} />
                    ),
                }}
            />
            <Tabs.Screen
                name="map"
                options={{
                    title: 'Map',
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon name="map" color={color} focused={focused} />
                    ),
                }}
            />
            <Tabs.Screen
                name="post"
                options={{
                    title: 'Post',
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon name="add-circle" color={color} focused={focused} />
                    ),
                }}
            />
            <Tabs.Screen
                name="lists"
                options={{
                    title: 'Lists',
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon name="list" color={color} focused={focused} />
                    ),
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    title: 'Profile',
                    tabBarIcon: ({ color, focused }) => (
                        <AnimatedIcon name="person" color={color} focused={focused} />
                    ),
                }}
            />
        </Tabs>
    )
}
