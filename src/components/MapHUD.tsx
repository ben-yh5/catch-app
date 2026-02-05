import { BlurView } from 'expo-blur'
import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import FilterPills, { FilterType } from './FilterPills'
import LocationSearchBar from './LocationSearchBar'

interface MapHUDProps {
    onLocationSelect: (location: any) => void
    userLocation: { longitude: number; latitude: number } | null
    activeFilter: FilterType
    onFilterChange: (filter: FilterType) => void
}

export default function MapHUD({
    onLocationSelect,
    userLocation,
    activeFilter,
    onFilterChange
}: MapHUDProps) {
    const insets = useSafeAreaInsets()

    return (
        <View style={[styles.container, { top: insets.top + 10 }]}>
            <View style={styles.islandContainer}>
                {/* 
                  BlurView provides the glass effect.
                  intensity={80} provides a nice strong blur.
                  tint="systemMaterial" adapts to light/dark mode on iOS.
                */}
                <BlurView
                    intensity={Platform.OS === 'ios' ? 80 : 100}
                    tint="systemMaterialDark"
                    style={styles.blurContainer}
                >
                    <View style={styles.contentContainer}>
                        <LocationSearchBar
                            onLocationSelect={onLocationSelect}
                            userLocation={userLocation}
                            containerStyle={styles.searchBarContainer}
                            inputContainerStyle={styles.searchInputContainer}
                        />

                        <View style={styles.filterContainer}>
                            <FilterPills
                                activeFilter={activeFilter}
                                onFilterChange={onFilterChange}
                            />
                        </View>
                    </View>
                </BlurView>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 16,
        right: 16,
        zIndex: 100,
        alignItems: 'center',
    },
    islandContainer: {
        width: '100%',
        borderRadius: 28,
        overflow: 'hidden',
        // Use a slightly dark semi-transparent bg for Android fallback, or transparent for iOS
        backgroundColor: Platform.OS === 'android' ? 'rgba(30,30,30,0.9)' : 'transparent',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)', // Lighter border for contrast in dark mode
    },
    blurContainer: {
        width: '100%',
        paddingVertical: 12,
        paddingHorizontal: 8,
    },
    contentContainer: {
        gap: 8,
    },
    searchBarContainer: {
        marginHorizontal: 4,
    },
    searchInputContainer: {
        // Use a semi-transparent black for dark mode alignment
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderWidth: 0,
    },
    filterContainer: {
        paddingHorizontal: 4,
    },
})
