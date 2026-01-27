import { colors } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

interface CaughtBadgeProps {
    containerStyle?: ViewStyle;
    size?: number;
}

/**
 * CaughtBadge - Shared UI atom for the checkmark badge indicating a "caught" or owned post
 */
export default function CaughtBadge({ containerStyle, size = 20 }: CaughtBadgeProps) {
    return (
        <View style={[
            styles.container,
            { width: size, height: size, borderRadius: size / 2 },
            containerStyle
        ]}>
            <Ionicons name="checkmark" size={size * 0.6} color={colors.caughtBadgeText} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.caughtBadge,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
        elevation: 3,
    },
});
