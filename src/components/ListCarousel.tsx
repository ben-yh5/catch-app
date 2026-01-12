import React, { useEffect, useRef } from 'react'
import {
    Dimensions,
    FlatList,
    StyleSheet,
    View,
    ViewToken,
} from 'react-native'
import CompactPostCard from './CompactPostCard'

const { width } = Dimensions.get('window')
const CARD_WIDTH = width
const SPACING = 0
const SNAP_INTERVAL = CARD_WIDTH + SPACING * 2

interface ListCarouselProps {
    posts: any[]
    onPostSnap: (post: any) => void
    onPostPress: (post: any) => void
    selectedPostId?: string | null
}

export default function ListCarousel({
    posts,
    onPostSnap,
    onPostPress,
    selectedPostId,
}: ListCarouselProps) {
    const flatListRef = useRef<FlatList>(null)

    // Scroll to selected post when it changes (e.g. from map pin click)
    useEffect(() => {
        if (selectedPostId && posts.length > 0) {
            const index = posts.findIndex((p) => p.id === selectedPostId)
            if (index !== -1) {
                flatListRef.current?.scrollToIndex({
                    index,
                    animated: true,
                    viewPosition: 0.5,
                })
            }
        }
    }, [selectedPostId, posts])

    const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        if (viewableItems.length > 0) {
            const centerItem = viewableItems[0].item
            onPostSnap(centerItem)
        }
    }).current

    const renderItem = ({ item }: { item: any }) => (
        <View style={styles.cardContainer}>
            <CompactPostCard
                post={item}
                onPress={() => onPostPress(item)}
            // No "jump to location" button needed in carousel as it's already focused
            />
        </View>
    )

    return (
        <View style={styles.container}>
            <FlatList
                ref={flatListRef}
                data={posts}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={SNAP_INTERVAL}
                decelerationRate="fast"
                contentContainerStyle={styles.contentContainer}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={{
                    itemVisiblePercentThreshold: 50,
                }}
                getItemLayout={(data, index) => ({
                    length: SNAP_INTERVAL,
                    offset: SNAP_INTERVAL * index,
                    index,
                })}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 40,
        left: 0,
        right: 0,
        height: 180, // Adjust based on CompactPostCard height
    },
    contentContainer: {
        paddingHorizontal: (width - CARD_WIDTH) / 2 - SPACING,
    },
    cardContainer: {
        width: CARD_WIDTH,
        marginHorizontal: SPACING,
    },
})
