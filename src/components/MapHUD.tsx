import { BlurView } from 'expo-blur'
import React from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ExploreSearchBar from './ExploreSearchBar'
import FilterPills, { FilterType } from './FilterPills'

interface MapHUDProps {
    onSearch: (query: string) => void
    onSearchClear: () => void
    searchLoading?: boolean
    searchQuery?: string
    isSearchMode?: boolean
    activeFilter: FilterType
    onFilterChange: (filter: FilterType) => void
}

export default function MapHUD({
    onSearch,
    onSearchClear,
    searchLoading,
    searchQuery,
    isSearchMode,
    activeFilter,
    onFilterChange
}: MapHUDProps) {
    const insets = useSafeAreaInsets()

    return (
        <View style={[styles.container, { top: insets.top + 10 }]}>
            <View style={styles.islandContainer}>
                <BlurView
                    intensity={Platform.OS === 'ios' ? 80 : 100}
                    tint="systemMaterialDark"
                    style={styles.blurContainer}
                >
                    <View style={styles.contentContainer}>
                        <ExploreSearchBar
                            onSubmit={onSearch}
                            onClear={onSearchClear}
                            loading={searchLoading}
                            initialQuery={searchQuery}
                            containerStyle={styles.searchBarContainer}
                            inputContainerStyle={styles.searchInputContainer}
                        />

                        {!isSearchMode && (
                            <View style={styles.filterContainer}>
                                <FilterPills
                                    activeFilter={activeFilter}
                                    onFilterChange={onFilterChange}
                                />
                            </View>
                        )}
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
        backgroundColor: Platform.OS === 'android' ? 'rgba(30,30,30,0.9)' : 'transparent',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
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
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderWidth: 0,
    },
    filterContainer: {
        paddingHorizontal: 4,
    },
})
