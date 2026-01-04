import React, { useCallback, useEffect, useState } from 'react'
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { collection, query, where, getDocs, orderBy, deleteDoc, doc } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useAuth } from '@/context/AuthContext'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { colors } from '@/theme/colors'

interface List {
    id: string
    name: string
    description: string
    creatorId: string
    creatorUsername: string
    postIds: string[]
    isPublic: boolean
    isSavedList?: boolean
    createdAt: any
    updatedAt: any
}

export default function ListsScreen() {
    const { user } = useAuth()
    const insets = useSafeAreaInsets()
    const router = useRouter()
    const [lists, setLists] = useState<List[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [activeTab, setActiveTab] = useState<'my' | 'community'>('my')

    const fetchMyLists = async () => {
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

            // Sort to put Saved list first
            const savedList = fetchedLists.find(l => l.isSavedList || l.name === 'Saved')
            const otherLists = fetchedLists.filter(l => !l.isSavedList && l.name !== 'Saved')

            const sortedLists = savedList ? [savedList, ...otherLists] : otherLists

            setLists(sortedLists)
        } catch (error) {
            console.error('Error fetching lists:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchCommunityLists = async () => {
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

            setLists(fetchedLists)
        } catch (error) {
            console.error('Error fetching community lists:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchLists = useCallback(() => {
        if (activeTab === 'my') {
            fetchMyLists()
        } else {
            fetchCommunityLists()
        }
    }, [activeTab, user])

    useEffect(() => {
        fetchLists()
    }, [fetchLists])

    const handleRefresh = async () => {
        setRefreshing(true)
        await fetchLists()
        setRefreshing(false)
    }

    const handleDeleteList = (listId: string, listName: string) => {
        Alert.alert(
            'Delete List',
            `Are you sure you want to delete "${listName}"?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteDoc(doc(db, 'lists', listId))
                            setLists((prev) => prev.filter((list) => list.id !== listId))
                        } catch (error) {
                            console.error('Error deleting list:', error)
                            Alert.alert('Error', 'Failed to delete list')
                        }
                    },
                },
            ]
        )
    }

    const renderListItem = ({ item }: { item: List }) => {
        const isPrivate = !item.isPublic

        return (
            <TouchableOpacity
                style={styles.listItem}
                onPress={() => router.push(`/list-detail?listId=${item.id}` as any)}
            >
                <View style={styles.listContent}>
                    <View style={styles.listHeader}>
                        <Ionicons
                            name={isPrivate ? 'lock-closed' : 'list'}
                            size={24}
                            color="#007AFF"
                        />
                        <View style={styles.listInfo}>
                            <Text style={styles.listName}>{item.name}</Text>
                            {item.description ? (
                                <Text style={styles.listDescription} numberOfLines={2}>
                                    {item.description}
                                </Text>
                            ) : null}
                            <Text style={styles.listMeta}>
                                {item.postIds.length} {item.postIds.length === 1 ? 'shot' : 'shots'}
                                {activeTab === 'community' ? ` • @${item.creatorUsername}` : ''}
                            </Text>
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        )
    }

    const renderEmptyState = () => (
        <View style={styles.emptyContainer}>
            <Ionicons name="list-outline" size={64} color={colors.textTertiary} />
            <Text style={styles.emptyText}>
                {activeTab === 'my' ? 'No Lists Yet' : 'No Community Lists'}
            </Text>
            {activeTab === 'my' && (
                <Text style={styles.emptySubtext}>
                    Create your first list to organize locations
                </Text>
            )}
        </View>
    )

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={styles.title}>Lists</Text>
            </View>

            {/* Tab Switcher */}
            <View style={styles.tabContainer}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'my' && styles.activeTab]}
                    onPress={() => {
                        setActiveTab('my')
                        setLoading(true)
                    }}
                >
                    <Text style={[styles.tabText, activeTab === 'my' && styles.activeTabText]}>
                        My Lists
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'community' && styles.activeTab]}
                    onPress={() => {
                        setActiveTab('community')
                        setLoading(true)
                    }}
                >
                    <Text
                        style={[styles.tabText, activeTab === 'community' && styles.activeTabText]}
                    >
                        Community
                    </Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#007AFF" />
                </View>
            ) : (
                <FlatList
                    data={lists}
                    renderItem={renderListItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContainer}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                    }
                    ListEmptyComponent={renderEmptyState}
                />
            )}

            {/* FAB - only show on "My Lists" tab */}
            {activeTab === 'my' && (
                <TouchableOpacity
                    style={[styles.fab, { bottom: insets.bottom + 80 }]}
                    onPress={() => router.push('/create-list')}
                >
                    <Ionicons name="add" size={32} color="#fff" />
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
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContainer: {
        padding: 16,
        flexGrow: 1,
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
    deleteButton: {
        padding: 8,
        marginLeft: 8,
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
