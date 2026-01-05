import React, { useEffect, useState } from 'react'
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    StyleSheet,
    Animated,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'expo-router'
import { getOrCreateSavedList, addPostToList, removePostFromList, getListsContainingPost } from '@/utils/listUtils'
import { colors } from '@/theme/colors'
import AsyncStorage from '@react-native-async-storage/async-storage'

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

interface ListSelectionBottomSheetProps {
    visible: boolean
    onClose: () => void
    postId: string
    onSaveStateChange?: (isSaved: boolean) => void
}

const LAST_USED_LIST_KEY = '@last_used_list_id'

export default function ListSelectionBottomSheet({
    visible,
    onClose,
    postId,
    onSaveStateChange,
}: ListSelectionBottomSheetProps) {
    const { user } = useAuth()
    const router = useRouter()
    const [lists, setLists] = useState<List[]>([])
    const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(false)
    const [updating, setUpdating] = useState<string | null>(null)
    const slideAnim = React.useRef(new Animated.Value(0)).current

    useEffect(() => {
        if (visible) {
            Animated.spring(slideAnim, {
                toValue: 1,
                useNativeDriver: true,
                tension: 65,
                friction: 11,
            }).start()

            if (user) {
                fetchUserLists()
            }
        } else {
            slideAnim.setValue(0)
        }
    }, [visible, user, slideAnim])

    const fetchUserLists = async () => {
        if (!user) return

        setLoading(true)
        try {
            // Get or create the default "My List"
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username = userDoc.exists() ? userDoc.data().username : 'Unknown'
            await getOrCreateSavedList(user.uid, username)

            // Fetch all user's lists
            const listsQuery = query(
                collection(db, 'lists'),
                where('creatorId', '==', user.uid)
            )

            const snapshot = await getDocs(listsQuery)
            const fetchedLists: List[] = []

            snapshot.forEach((doc) => {
                fetchedLists.push({
                    id: doc.id,
                    ...doc.data(),
                } as List)
            })

            // Sort: My List first, then others by updatedAt
            const myList = fetchedLists.find(l => l.isSavedList)
            const otherLists = fetchedLists
                .filter(l => !l.isSavedList)
                .sort((a, b) => b.updatedAt?.toMillis?.() - a.updatedAt?.toMillis?.())

            const sortedLists = myList ? [myList, ...otherLists] : otherLists
            setLists(sortedLists)

            // Get lists containing this post
            const listsWithPost = await getListsContainingPost(user.uid, postId)
            setSelectedListIds(new Set(listsWithPost))

            // Auto-select "My List" (private list) if post is not in any list
            if (listsWithPost.length === 0 && sortedLists.length > 0) {
                // Always default to "My List" (the private list)
                const defaultList = myList || sortedLists[0]
                if (defaultList) {
                    // Actually add to the database (not just UI)
                    await handleToggleList(defaultList.id, false)
                }
            }
        } catch (error) {
            console.error('Error fetching lists:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleToggleList = async (listId: string, skipUpdate = false) => {
        if (updating && !skipUpdate) return

        const isSelected = selectedListIds.has(listId)

        // Optimistic update
        const newSelected = new Set(selectedListIds)
        if (isSelected) {
            newSelected.delete(listId)
        } else {
            newSelected.add(listId)
        }
        setSelectedListIds(newSelected)

        if (!skipUpdate) {
            setUpdating(listId)
            try {
                if (isSelected) {
                    await removePostFromList(listId, postId)
                } else {
                    await addPostToList(listId, postId)
                    // Save as last used list
                    await AsyncStorage.setItem(LAST_USED_LIST_KEY, listId)
                }

                // Update lists to reflect new post count
                setLists(prev => prev.map(list => {
                    if (list.id === listId) {
                        const postIds = isSelected
                            ? list.postIds.filter(id => id !== postId)
                            : [...list.postIds, postId]
                        return { ...list, postIds }
                    }
                    return list
                }))
            } catch (error) {
                console.error('Error toggling list:', error)
                // Revert on error
                setSelectedListIds(selectedListIds)
            } finally {
                setUpdating(null)
            }
        }

        // Always notify parent of save state change (even during auto-select)
        const isSaved = newSelected.size > 0
        onSaveStateChange?.(isSaved)
    }

    const renderListItem = ({ item }: { item: List }) => {
        const isSelected = selectedListIds.has(item.id)
        const isUpdating = updating === item.id

        return (
            <TouchableOpacity
                style={styles.listItem}
                onPress={() => handleToggleList(item.id)}
                disabled={isUpdating}
            >
                <View style={styles.listItemLeft}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                        {isSelected && <Ionicons name="checkmark" size={18} color={colors.white} />}
                    </View>
                    <View style={styles.listItemInfo}>
                        <View style={styles.listItemHeader}>
                            <Ionicons
                                name={!item.isPublic ? 'lock-closed' : 'list'}
                                size={16}
                                color={colors.textSecondary}
                                style={{ marginRight: 6 }}
                            />
                            <Text style={styles.listItemName}>{item.name}</Text>
                        </View>
                        <Text style={styles.listItemMeta}>
                            {item.postIds.length} {item.postIds.length === 1 ? 'shot' : 'shots'}
                        </Text>
                    </View>
                </View>
                {isUpdating && <ActivityIndicator size="small" color={colors.primary} />}
            </TouchableOpacity>
        )
    }

    const translateY = slideAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [600, 0],
    })

    return (
        <Modal
            visible={visible}
            animationType="fade"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onClose}
                />
                <Animated.View
                    style={[
                        styles.bottomSheetContainer,
                        {
                            transform: [{ translateY }],
                        },
                    ]}
                >
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>Save to list</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color={colors.textPrimary} />
                        </TouchableOpacity>
                    </View>

                    {loading ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color={colors.primary} />
                        </View>
                    ) : (
                        <FlatList
                            data={lists}
                            renderItem={renderListItem}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.listContainer}
                            showsVerticalScrollIndicator={false}
                        />
                    )}
                </Animated.View>
            </View>
        </Modal>
    )
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    bottomSheetContainer: {
        backgroundColor: colors.card,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        height: '70%',
        maxHeight: '80%',
        paddingBottom: 34, // Safe area bottom
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    closeButton: {
        padding: 4,
    },
    loadingContainer: {
        padding: 40,
        alignItems: 'center',
    },
    listContainer: {
        padding: 16,
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginBottom: 8,
        backgroundColor: colors.cardElevated,
        borderRadius: 12,
    },
    listItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: colors.textTertiary,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    checkboxSelected: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    listItemInfo: {
        flex: 1,
    },
    listItemHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    listItemName: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.textPrimary,
    },
    listItemMeta: {
        fontSize: 13,
        color: colors.textTertiary,
    },
})
