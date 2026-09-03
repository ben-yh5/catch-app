import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import React, { useCallback, useState } from 'react'
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'

interface LocationResult {
    id: string
    text: string // Primary name (e.g. "Starbucks")
    place_name: string // Full address
    center: [number, number]
    bbox?: [number, number, number, number]
    place_type: string[]
}

interface LocationSearchBarProps {
    onLocationSelect: (location: LocationResult) => void
    containerStyle?: any
    inputContainerStyle?: any
    userLocation?: { longitude: number; latitude: number } | null
}

export default function LocationSearchBar({
    onLocationSelect,
    containerStyle,
    inputContainerStyle,
    userLocation,
}: LocationSearchBarProps) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<LocationResult[]>([])
    const [loading, setLoading] = useState(false)
    const [showResults, setShowResults] = useState(false)
    const [searchTimeout, setSearchTimeout] = useState<any>(null)

    const searchPlaces = useCallback(
        async (text: string) => {
            setQuery(text)

            // Clear previous timeout
            if (searchTimeout) {
                clearTimeout(searchTimeout)
            }

            if (text.length < 3) {
                setResults([])
                setShowResults(false)
                return
            }

            // Debounce API call
            const timeout = setTimeout(async () => {
                try {
                    setLoading(true)
                    setShowResults(true)
                    const accessToken =
                        process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN
                    // Explicitly include 'poi' and 'address' and other types to ensure broad search capability, and limit to 10
                    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json?access_token=${accessToken}&limit=10&types=poi,address,place,locality,neighborhood,district,region,country`

                    // Add proximity bias if location is available
                    if (userLocation) {
                        url += `&proximity=${userLocation.longitude},${userLocation.latitude}`
                    }

                    console.log('Searching Mapbox with URL:', url)
                    const response = await fetch(url)
                    const data = await response.json()
                    if (data.features) {
                        setResults(data.features)
                    }
                } catch (error) {
                    console.error('Error searching places:', error)
                } finally {
                    setLoading(false)
                }
            }, 500) // 500ms debounce

            setSearchTimeout(timeout)
        },
        [userLocation, searchTimeout]
    )

    const handleSelect = (item: LocationResult) => {
        setQuery(item.text)
        setShowResults(false)
        onLocationSelect(item)
        setQuery('')
    }

    const clearSearch = () => {
        setQuery('')
        setResults([])
        setShowResults(false)
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
                    placeholder="Search cities and places..."
                    placeholderTextColor={colors.textTertiary}
                    value={query}
                    onChangeText={searchPlaces}
                    returnKeyType="search"
                    accessibilityLabel="Search locations"
                    accessibilityHint="Search for places and addresses"
                />
                {loading && (
                    <ActivityIndicator
                        size="small"
                        color={colors.primary}
                        style={styles.loader}
                        accessibilityLabel="Searching"
                    />
                )}
                {query.length > 0 && (
                    <TouchableOpacity
                        onPress={clearSearch}
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

            {showResults && results.length > 0 && (
                <View style={styles.resultsContainer}>
                    <FlatList
                        data={results}
                        keyExtractor={(item) => item.id}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={styles.resultItem}
                                onPress={() => handleSelect(item)}
                                accessibilityRole="button"
                                accessibilityLabel={`${item.text}, ${item.place_name}`}
                            >
                                <Ionicons
                                    name="location-outline"
                                    size={20}
                                    color={colors.textSecondary}
                                    style={styles.resultIcon}
                                />
                                <View style={styles.resultTextContainer}>
                                    <Text
                                        style={styles.resultTitle}
                                        numberOfLines={1}
                                    >
                                        {item.text}
                                    </Text>
                                    <Text
                                        style={styles.resultSubtitle}
                                        numberOfLines={1}
                                    >
                                        {item.place_name}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        )}
                    />
                </View>
            )}
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
        backgroundColor: colors.cardBackground, // Default, can be overridden via styles if we passed a prop, but currently we don't.
        // We will modify the component to accept specific styles for inputContainer later if needed,
        // or we can rely on the fact that we might want it opaque inside the glass?
        // Actually, for glassmorphism, we usually want these to be semi-transparent.
        // Let's keep it simple for now and just remove the positioning.
        borderRadius: 24,
        paddingHorizontal: 12,
        paddingVertical: 10,
        // Remove shadows if inside a glass container? Or keep them?
        // Let's keep them for now.
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
    resultsContainer: {
        marginTop: 8,
        backgroundColor: colors.cardBackground,
        borderRadius: 12,
        maxHeight: 200,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 5,
        borderWidth: 1,
        borderColor: colors.border,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    resultIcon: {
        marginRight: 12,
    },
    resultTextContainer: {
        flex: 1,
    },
    resultTitle: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.textPrimary,
    },
    resultSubtitle: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },
})
