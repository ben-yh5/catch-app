import CompactPostCard from '@/components/CompactPostCard'
import ThreadModal from '@/components/ThreadModal'
import { useAuth } from '@/context/AuthContext'
import { useSaves } from '@/context/SavesContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { List, Post } from '@/types'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import {
    collection,
    documentId,
    getDocs,
    orderBy,
    query,
    where,
} from 'firebase/firestore'
import ErrorState from '@/components/ui/ErrorState'
import { ListsTabSkeleton } from '@/components/ui/Skeleton'
import { useTabBarInset } from '@/hooks/useTabBarInset'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
    FlatList,
    RefreshControl,
    SectionList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import PagerView from 'react-native-pager-view'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type ListsTab = 'my' | 'community'
const TAB_ORDER: ListsTab[] = ['my', 'community']

// The "My" page mixes saved posts (sectioned by city) with curated lists
type MyRow = { kind: 'post'; post: Post } | { kind: 'list'; list: List }
interface MySection {
    title: string
    data: MyRow[]
}

export default function ListsScreen() {
    const { user } = useAuth()
    const insets = useSafeAreaInsets()
    const tabBarInset = useTabBarInset()
    const router = useRouter()
    const pagerRef = useRef<PagerView>(null)
    // Per-tab data so the two pager pages never share state — while a
    // page's data is still null it renders a skeleton instead of
    // mirroring the other tab's rows during the swipe
    const [myLists, setMyLists] = useState<List[] | null>(null)
    const [communityLists, setCommunityLists] = useState<List[] | null>(null)
    const [myError, setMyError] = useState(false)
    const [communityError, setCommunityError] = useState(false)
    const [activeTab, setActiveTab] = useState<ListsTab>('my')
    const [refreshing, setRefreshing] = useState(false)
    const [refreshEnabled, setRefreshEnabled] = useState(true)

    // Saved posts (the bookmark pile), newest save first
    const { savedIds } = useSaves()
    const [savedPosts, setSavedPosts] = useState<Post[] | null>(null)
    const [selectedPost, setSelectedPost] = useState<Post | null>(null)
    const [threadModalVisible, setThreadModalVisible] = useState(false)

    const fetchSaved = useCallback(async () => {
        if (!user) return
        try {
            const savesSnap = await getDocs(
                query(
                    collection(db, 'users', user.uid, 'saves'),
                    orderBy('savedAt', 'desc')
                )
            )
            const ids = savesSnap.docs.map((d) => d.id)

            const posts: Post[] = []
            for (let i = 0; i < ids.length; i += 30) {
                const chunk = ids.slice(i, i + 30)
                const postsSnap = await getDocs(
                    query(
                        collection(db, 'posts'),
                        where(documentId(), 'in', chunk)
                    )
                )
                postsSnap.forEach((d) =>
                    posts.push({ id: d.id, ...d.data() } as Post)
                )
            }
            // Restore savedAt ordering (the `in` query returns id order)
            const rank = new Map(ids.map((id, i) => [id, i]))
            posts.sort(
                (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
            )
            setSavedPosts(posts)
        } catch (error) {
            console.error('Error fetching saved posts:', error)
            // Saved section degrades to empty; lists still render
            setSavedPosts((prev) => prev ?? [])
        }
    }, [user])

    // Live-sync with bookmark toggles anywhere in the app
    useEffect(() => {
        fetchSaved()
    }, [fetchSaved, savedIds])

    const fetchMyLists = useCallback(async () => {
        if (!user) return

        try {
            const listsQuery = query(
                collection(db, 'lists'),
                where('creatorId', '==', user.uid),
                orderBy('updatedAt', 'desc')
            )

            const snapshot = await getDocs(listsQuery)
            const fetchedLists: List[] = []

            snapshot.forEach((doc) => {
                fetchedLists.push({
                    id: doc.id,
                    ...doc.data(),
                } as List)
            })

            setMyLists(fetchedLists)
            setMyError(false)
        } catch (error) {
            console.error('Error fetching lists:', error)
            setMyError(true)
        }
    }, [user])

    const fetchCommunityLists = useCallback(async () => {
        try {
            const listsQuery = query(
                collection(db, 'lists'),
                where('isPublic', '==', true),
                orderBy('createdAt', 'desc')
            )

            const snapshot = await getDocs(listsQuery)
            const fetchedLists: List[] = []

            snapshot.forEach((doc) => {
                fetchedLists.push({
                    id: doc.id,
                    ...doc.data(),
                } as List)
            })

            setCommunityLists(fetchedLists)
            setCommunityError(false)
        } catch (error) {
            console.error('Error fetching community lists:', error)
            setCommunityError(true)
        }
    }, [])

    // Refetch my lists on every focus so a list created elsewhere shows up
    // without pull-to-refresh; existing data stays on screen while the
    // refetch is in flight (no skeleton flash)
    useFocusEffect(
        useCallback(() => {
            fetchMyLists()
        }, [fetchMyLists])
    )

    // Prefetch the community page so swiping to it usually reveals real
    // content; the skeleton only shows if the fetch hasn't landed yet
    useEffect(() => {
        fetchCommunityLists()
    }, [fetchCommunityLists])

    const selectTab = (tab: ListsTab) => {
        setActiveTab(tab)
        pagerRef.current?.setPage(TAB_ORDER.indexOf(tab))
    }

    const handlePageSelected = (e: { nativeEvent: { position: number } }) => {
        const tab = TAB_ORDER[e.nativeEvent.position]
        if (tab && tab !== activeTab) {
            setActiveTab(tab)
        }
    }

    const handleRefresh = async () => {
        setRefreshing(true)
        if (activeTab === 'my') {
            await Promise.all([fetchMyLists(), fetchSaved()])
        } else {
            await fetchCommunityLists()
        }
        setRefreshing(false)
    }

    const renderListItem = (item: List, tab: ListsTab) => {
        return (
            <TouchableOpacity
                style={styles.listItem}
                onPress={() =>
                    // Lists live on the map: list focus mode with the sheet
                    // raised to full (?view=list) IS the list detail view —
                    // edit/delete/remove live in the sheet header, and the
                    // map is one drag below.
                    router.push(
                        `/(tabs)/map?listId=${item.id}&view=list` as any
                    )
                }
                accessibilityLabel={`${item.name}, ${item.postIds.length} ${item.postIds.length === 1 ? 'shot' : 'shots'}${tab === 'community' ? `, by @${item.creatorUsername}` : ''}`}
                accessibilityRole="button"
                accessibilityHint="Open this list"
            >
                <View style={styles.listContent}>
                    <View style={styles.listHeader}>
                        <Ionicons name="list" size={24} color={colors.primary} />
                        <View style={styles.listInfo}>
                            <Text style={styles.listName}>{item.name}</Text>
                            {item.description ? (
                                <Text
                                    style={styles.listDescription}
                                    numberOfLines={2}
                                >
                                    {item.description}
                                </Text>
                            ) : null}
                            <Text style={styles.listMeta}>
                                {item.postIds.length}{' '}
                                {item.postIds.length === 1 ? 'shot' : 'shots'}
                                {tab === 'community'
                                    ? ` • @${item.creatorUsername}`
                                    : ''}
                            </Text>
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        )
    }

    const renderEmptyState = (tab: ListsTab) => {
        const error = tab === 'my' ? myError : communityError
        const retry = tab === 'my' ? fetchMyLists : fetchCommunityLists
        if (error) {
            return (
                <ErrorState
                    message="Couldn't load lists"
                    onRetry={retry}
                    style={styles.errorState}
                />
            )
        }
        return (
            <View style={styles.emptyContainer}>
                <Ionicons
                    name="list-outline"
                    size={64}
                    color={colors.textTertiary}
                />
                <Text style={styles.emptyText}>
                    {tab === 'my' ? 'No Lists Yet' : 'No Community Lists'}
                </Text>
                {tab === 'my' && (
                    <>
                        <Text style={styles.emptySubtext}>
                            Create your first list to organize shots you want to
                            visit
                        </Text>
                        <TouchableOpacity
                            style={styles.emptyCreateButton}
                            onPress={() => router.push('/create-list')}
                            accessibilityLabel="Create a list"
                            accessibilityRole="button"
                        >
                            <Ionicons name="add" size={18} color="#fff" />
                            <Text style={styles.emptyCreateButtonText}>
                                Create a List
                            </Text>
                        </TouchableOpacity>
                    </>
                )}
            </View>
        )
    }

    // "My" page: saved shots sectioned by city (savedAt order), then lists
    const buildMySections = (): MySection[] => {
        const sections: MySection[] = []
        if (savedPosts && savedPosts.length > 0) {
            const byCity = new Map<string, Post[]>()
            for (const post of savedPosts) {
                const label = post.city
                    ? post.country
                        ? `${post.city}, ${post.country}`
                        : post.city
                    : post.country || 'Elsewhere'
                if (!byCity.has(label)) byCity.set(label, [])
                byCity.get(label)!.push(post)
            }
            for (const [label, posts] of byCity) {
                sections.push({
                    title: label,
                    data: posts.map((post) => ({ kind: 'post', post })),
                })
            }
        }
        if (myLists && myLists.length > 0) {
            sections.push({
                title: 'My Lists',
                data: myLists.map((list) => ({ kind: 'list', list })),
            })
        }
        return sections
    }

    const renderMyPage = () => {
        if (myLists === null && savedPosts === null) {
            if (myError) return renderEmptyState('my')
            return <ListsTabSkeleton />
        }

        return (
            <SectionList
                sections={buildMySections()}
                keyExtractor={(item) =>
                    item.kind === 'post'
                        ? `post-${item.post.id}`
                        : `list-${item.list.id}`
                }
                renderItem={({ item }) =>
                    item.kind === 'post' ? (
                        <CompactPostCard
                            post={item.post}
                            onPress={() => {
                                setSelectedPost(item.post)
                                setThreadModalVisible(true)
                            }}
                        />
                    ) : (
                        <View style={styles.listRowWrap}>
                            {renderListItem(item.list, 'my')}
                        </View>
                    )
                }
                renderSectionHeader={({ section }) => (
                    <Text style={styles.sectionHeader}>{section.title}</Text>
                )}
                ListHeaderComponent={
                    savedPosts && savedPosts.length > 0 ? (
                        <View style={styles.savedHeaderRow}>
                            <Text style={styles.savedCount}>
                                {savedPosts.length} saved{' '}
                                {savedPosts.length === 1 ? 'shot' : 'shots'}
                            </Text>
                            <TouchableOpacity
                                style={styles.mapButton}
                                onPress={() =>
                                    router.push(
                                        '/(tabs)/map?saved=1' as any
                                    )
                                }
                                accessibilityLabel="View saved shots on map"
                                accessibilityRole="button"
                            >
                                <Ionicons
                                    name="map"
                                    size={14}
                                    color={colors.primary}
                                />
                                <Text style={styles.mapButtonText}>Map</Text>
                            </TouchableOpacity>
                        </View>
                    ) : null
                }
                contentContainerStyle={[
                    styles.myListContainer,
                    { paddingBottom: 16 + tabBarInset },
                ]}
                contentInsetAdjustmentBehavior="automatic"
                stickySectionHeadersEnabled={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing && activeTab === 'my'}
                        onRefresh={handleRefresh}
                        enabled={refreshEnabled}
                    />
                }
                ListEmptyComponent={renderEmptyState('my')}
            />
        )
    }

    const renderListsPage = (tab: ListsTab) => {
        const data = tab === 'my' ? myLists : communityLists
        const error = tab === 'my' ? myError : communityError

        // Data never loaded: ghost skeleton while in flight, error state if
        // the fetch failed outright
        if (data === null) {
            if (error) {
                return renderEmptyState(tab)
            }
            return <ListsTabSkeleton />
        }

        return (
            <FlatList
                data={data}
                renderItem={({ item }) => renderListItem(item, tab)}
                keyExtractor={(item) => item.id}
                contentContainerStyle={[
                    styles.listContainer,
                    { paddingBottom: 16 + tabBarInset },
                ]}
                // Keep content clear of the native tab bar: iOS insets
                // natively, Android needs explicit padding (useTabBarInset)
                contentInsetAdjustmentBehavior="automatic"
                refreshControl={
                    // Always mounted — unmounting mid-swipe causes a
                    // relayout flash when the pager settles. `enabled` is
                    // Android-only, the one platform where a pager drag
                    // can trigger pull-to-refresh.
                    <RefreshControl
                        refreshing={refreshing && activeTab === tab}
                        onRefresh={handleRefresh}
                        enabled={refreshEnabled}
                    />
                }
                ListEmptyComponent={renderEmptyState(tab)}
            />
        )
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.title} accessibilityRole="header">
                    Lists
                </Text>
            </View>

            {/* Tab Switcher */}
            <View style={styles.tabContainer}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'my' && styles.activeTab]}
                    onPress={() => selectTab('my')}
                    accessibilityLabel="My Lists"
                    accessibilityRole="button"
                    accessibilityState={{ selected: activeTab === 'my' }}
                >
                    <Text
                        style={[
                            styles.tabText,
                            activeTab === 'my' && styles.activeTabText,
                        ]}
                    >
                        My Lists
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'community' && styles.activeTab,
                    ]}
                    onPress={() => selectTab('community')}
                    accessibilityLabel="Community"
                    accessibilityRole="button"
                    accessibilityState={{ selected: activeTab === 'community' }}
                >
                    <Text
                        style={[
                            styles.tabText,
                            activeTab === 'community' && styles.activeTabText,
                        ]}
                    >
                        Community
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Swipeable Pager */}
            <PagerView
                ref={pagerRef}
                style={styles.pagerView}
                initialPage={0}
                onPageSelected={handlePageSelected}
                onPageScrollStateChanged={(e) => {
                    // Disable pull-to-refresh while swiping
                    if (e.nativeEvent.pageScrollState === 'dragging') {
                        setRefreshEnabled(false)
                    } else if (e.nativeEvent.pageScrollState === 'idle') {
                        setRefreshEnabled(true)
                    }
                }}
            >
                <View key="my" style={styles.pageContainer}>
                    {renderMyPage()}
                </View>
                <View key="community" style={styles.pageContainer}>
                    {renderListsPage('community')}
                </View>
            </PagerView>

            {/* Thread modal for saved shots */}
            {selectedPost && (
                <ThreadModal
                    visible={threadModalVisible}
                    post={selectedPost}
                    initialPostId={selectedPost.id}
                    onClose={() => setThreadModalVisible(false)}
                />
            )}

            {/* FAB - only show on "My Lists" tab */}
            {activeTab === 'my' && (
                <TouchableOpacity
                    style={[
                        styles.fab,
                        // Android: clear the tab bar the screen extends
                        // behind; iOS: original tuning above the native bar
                        {
                            bottom: tabBarInset
                                ? tabBarInset + 16
                                : insets.bottom + 80,
                        },
                    ]}
                    onPress={() => router.push('/create-list')}
                    accessibilityLabel="Create new list"
                    accessibilityRole="button"
                    accessibilityHint="Create a new list to organize locations"
                >
                    <Ionicons name="add" size={32} color={colors.inverseTextPrimary} />
                </TouchableOpacity>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    tabContainer: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    activeTab: {
        borderBottomColor: colors.primary,
    },
    tabText: {
        fontSize: 16,
        color: colors.textTertiary,
    },
    activeTabText: {
        color: colors.primary,
        fontWeight: '600',
    },
    pagerView: {
        flex: 1,
    },
    pageContainer: {
        flex: 1,
    },
    listContainer: {
        padding: 16,
        flexGrow: 1,
    },
    // My page: CompactPostCard brings its own horizontal margins
    myListContainer: {
        paddingVertical: 8,
        flexGrow: 1,
    },
    listRowWrap: {
        paddingHorizontal: 16,
    },
    sectionHeader: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.textSecondary,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    savedHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    savedCount: {
        fontSize: 13,
        color: colors.textTertiary,
        fontWeight: '500',
    },
    mapButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    mapButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.primary,
    },
    listItem: {
        flexDirection: 'row',
        backgroundColor: colors.card,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
    },
    listContent: {
        flex: 1,
    },
    listHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    listInfo: {
        flex: 1,
        marginLeft: 12,
    },
    listName: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 4,
        color: colors.textPrimary,
    },
    listDescription: {
        fontSize: 14,
        color: colors.textSecondary,
        marginBottom: 6,
    },
    listMeta: {
        fontSize: 12,
        color: colors.textTertiary,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 100,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textTertiary,
        marginTop: 16,
    },
    emptySubtext: {
        fontSize: 14,
        color: colors.textTertiary,
        marginTop: 8,
        textAlign: 'center',
        paddingHorizontal: 32,
    },
    emptyCreateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.primary,
        borderRadius: 10,
        paddingHorizontal: 20,
        paddingVertical: 10,
        marginTop: 16,
    },
    emptyCreateButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.inverseTextPrimary,
    },
    errorState: {
        marginHorizontal: 16,
        marginTop: 40,
    },
    fab: {
        position: 'absolute',
        right: 20,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
})
