import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React, { useEffect, useState } from 'react'
import {
    ActivityIndicator,
    StyleProp,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
    ViewStyle,
} from 'react-native'

interface ExploreSearchBarProps {
    onSubmit: (query: string) => void
    onClear: () => void
    loading?: boolean
    containerStyle?: StyleProp<ViewStyle>
    inputContainerStyle?: StyleProp<ViewStyle>
    initialQuery?: string
}

export default function ExploreSearchBar({
    onSubmit,
    onClear,
    loading,
    containerStyle,
    inputContainerStyle,
    initialQuery,
}: ExploreSearchBarProps) {
    const [query, setQuery] = useState(initialQuery || '')

    useEffect(() => {
        if (initialQuery !== undefined) {
            setQuery(initialQuery)
        }
    }, [initialQuery])

    const handleSubmit = () => {
        const trimmed = query.trim()
        if (trimmed.length >= 2) {
            onSubmit(trimmed)
            setQuery('')
        }
    }

    const handleClear = () => {
        setQuery('')
        onClear()
    }

    return (
        <View style={[styles.container, containerStyle]}>
            <View style={[styles.inputContainer, inputContainerStyle]}>
                <Ionicons
                    name="search"
                    size={20}
                    color={colors.textTertiary}
                    style={styles.icon}
                />
                <TextInput
                    style={styles.input}
                    placeholder="Search for anything..."
                    placeholderTextColor={colors.textTertiary}
                    value={query}
                    onChangeText={setQuery}
                    onSubmitEditing={handleSubmit}
                    returnKeyType="search"
                    autoCorrect={false}
                    accessibilityLabel="Search"
                    accessibilityHint="Search for posts and locations"
                />
                {loading && (
                    <ActivityIndicator
                        size="small"
                        color={colors.primary}
                        style={styles.loader}
                        accessibilityLabel="Searching"
                    />
                )}
                {query.length > 0 && !loading && (
                    <TouchableOpacity
                        onPress={handleClear}
                        style={styles.clearButton}
                        accessibilityLabel="Clear search"
                        accessibilityRole="button"
                    >
                        <Ionicons
                            name="close-circle"
                            size={18}
                            color={colors.textTertiary}
                        />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        zIndex: 100,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.cardBackground,
        borderRadius: 24,
        paddingHorizontal: 12,
        paddingVertical: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        borderWidth: 1,
        borderColor: colors.border,
    },
    icon: {
        marginRight: 8,
    },
    input: {
        flex: 1,
        fontSize: 16,
        color: colors.textPrimary,
        padding: 0,
    },
    loader: {
        marginLeft: 8,
    },
    clearButton: {
        marginLeft: 8,
    },
})
