import React, { useEffect, useState } from 'react'
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    StyleSheet,
    Alert,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'expo-router'
import { getOrCreateSavedList, addPostToList, removePostFromList } from '@/utils/listUtils'

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

interface AddToListModalProps {
    visible: boolean
    onClose: () => void
    postId: string
    onSaveStateChange?: (isSaved: boolean) => void
}

export default function AddToListModal({ visible, onClose, postId, onSaveStateChange }: AddToListModalProps) {
    const { user } = useAuth()
    const router = useRouter()
    const [lists, setLists] = useState<List[]>([])
    const [loading, setLoading] = useState(false)
    const [addingToList, setAddingToList] = useState<string | null>(null)
    const [savedList, setSavedList] = useState<List | null>(null)
    const [otherLists, setOtherLists] = useState<List[]>([])

    useEffect(() => {
        if (visible) {
            fetchUserLists()
        }
    }, [visible])

    const fetchUserLists = async () => {
        if (!user) return

        setLoading(true)
        try {
            // Get or create the Saved list
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username = userDoc.exists() ? userDoc.data().username : 'Unknown'
            const savedListId = await getOrCreateSavedList(user.uid, username)

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

            // Separate Saved list from others
            const saved = fetchedLists.find(l => l.isSavedList || l.name === 'Saved')
            const others = fetchedLists.filter(l => !l.isSavedList && l.name !== 'Saved')

            setSavedList(saved || null)
            setOtherLists(others)
            setLists(fetchedLists)
        } catch (error) {
            console.error('Error fetching lists:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleAddToList = async (listId: string, isSavedList: boolean = false) => {
        setAddingToList(listId)
        try {
            await addPostToList(listId, postId)

            // Update local state
            setLists(prev => prev.map(list =>
                list.id === listId
                    ? { ...list, postIds: [...list.postIds, postId] }
                    : list
            ))

            if (isSavedList && savedList) {
                setSavedList({ ...savedList, postIds: [...savedList.postIds, postId] })
                onSaveStateChange?.(true)
            }

            // Don't close modal for regular lists, only show feedback
            if (!isSavedList) {
                Alert.alert('Success', 'Post added to list')
            }
        } catch (error) {
            console.error('Error adding to list:', error)
            Alert.alert('Error', 'Failed to add post to list')
        } finally {
            setAddingToList(null)
        }
    }

    const handleRemoveFromList = async (listId: string, isSavedList: boolean = false) => {
        setAddingToList(listId)
        try {
            await removePostFromList(listId, postId)

            // Update local state
            setLists(prev => prev.map(list =>
                list.id === listId
                    ? { ...list, postIds: list.postIds.filter(id => id !== postId) }
                    : list
            ))

            if (isSavedList && savedList) {
                setSavedList({ ...savedList, postIds: savedList.postIds.filter(id => id !== postId) })
                onSaveStateChange?.(false)
            }
        } catch (error) {
            console.error('Error removing from list:', error)
            Alert.alert('Error', 'Failed to remove post from list')
        } finally {
            setAddingToList(null)
        }
    }

    const handleToggleSavedList = async () => {
        if (!savedList) return

        const isInSavedList = savedList.postIds.includes(postId)

        if (isInSavedList) {
            await handleRemoveFromList(savedList.id, true)
        } else {
            await handleAddToList(savedList.id, true)
        }
    }

    const renderListItem = ({ item }: { item: List }) => {
        const isPostInList = item.postIds.includes(postId)
        const isAdding = addingToList === item.id

        return (
            <TouchableOpacity
                style={styles.listItem}
                onPress={() => {
                    if (isPostInList) {
                        handleRemoveFromList(item.id)
                    } else {
                        handleAddToList(item.id)
                    }
                }}
                disabled={isAdding}
            >
                <View style={styles.listIconContainer}>
                    <Ionicons
                        name={isPostInList ? 'checkmark-circle' : 'list'}
                        size={24}
                        color={isPostInList ? '#4CAF50' : '#007AFF'}
                    />
                </View>
                <View style={styles.listInfo}>
                    <Text style={styles.listName}>{item.name}</Text>
                    <Text style={styles.listMeta}>
                        {item.postIds.length} {item.postIds.length === 1 ? 'post' : 'posts'}
                    </Text>
                </View>
                {isAdding ? (
                    <ActivityIndicator size="small" color="#007AFF" />
                ) : isPostInList ? (
                    <Ionicons name="checkmark" size={24} color="#4CAF50" />
                ) : (
                    <Ionicons name="add-circle-outline" size={24} color="#007AFF" />
                )}
            </TouchableOpacity>
        )
    }

    const renderSavedListButton = () => {
        if (!savedList) return null

        const isInSavedList = savedList.postIds.includes(postId)
        const isAdding = addingToList === savedList.id

        return (
            <TouchableOpacity
                style={[styles.savedListButton, isInSavedList && styles.savedListButtonActive]}
                onPress={handleToggleSavedList}
                disabled={isAdding}
            >
                <View style={styles.savedListContent}>
                    <View style={styles.savedListLeft}>
                        <Ionicons
                            name={isInSavedList ? 'bookmark' : 'bookmark-outline'}
                            size={28}
                            color={isInSavedList ? '#007AFF' : '#666'}
                        />
                        <View style={styles.savedListInfo}>
                            <Text style={styles.savedListName}>
                                {isInSavedList ? 'Saved' : 'Save Post'}
                            </Text>
                            <Text style={styles.savedListMeta}>
                                {savedList.postIds.length} {savedList.postIds.length === 1 ? 'post' : 'posts'}
                            </Text>
                        </View>
                    </View>
                    {isAdding ? (
                        <ActivityIndicator size="small" color="#007AFF" />
                    ) : (
                        <Ionicons
                            name={isInSavedList ? 'checkmark-circle' : 'add-circle'}
                            size={28}
                            color={isInSavedList ? '#4CAF50' : '#007AFF'}
                        />
                    )}
                </View>
            </TouchableOpacity>
        )
    }

    const renderEmptyState = () => (
        <View style={styles.emptyContainer}>
            <Ionicons name="list-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>No Lists Yet</Text>
            <TouchableOpacity
                style={styles.createButton}
                onPress={() => {
                    onClose()
                    router.push('/create-list')
                }}
            >
                <Text style={styles.createButtonText}>Create Your First List</Text>
            </TouchableOpacity>
        </View>
    )

    return (
        <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>Save Post</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={28} color="#000" />
                        </TouchableOpacity>
                    </View>

                    {loading ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color="#007AFF" />
                        </View>
                    ) : (
                        <>
                            {/* Quick Save Button */}
                            <View style={styles.quickSaveContainer}>
                                {renderSavedListButton()}
                            </View>

                            {/* Divider */}
                            {otherLists.length > 0 && (
                                <View style={styles.dividerContainer}>
                                    <View style={styles.dividerLine} />
                                    <Text style={styles.dividerText}>OR ADD TO LIST</Text>
                                    <View style={styles.dividerLine} />
                                </View>
                            )}

                            {/* Other Lists */}
                            <FlatList
                                data={otherLists}
                                renderItem={renderListItem}
                                keyExtractor={(item) => item.id}
                                contentContainerStyle={styles.listContainer}
                                ListEmptyComponent={
                                    otherLists.length === 0 ? (
                                        <View style={styles.emptyOtherLists}>
                                            <Text style={styles.emptyOtherListsText}>
                                                No custom lists yet
                                            </Text>
                                        </View>
                                    ) : null
                                }
                            />

                            {/* Create New List Button */}
                            <TouchableOpacity
                                style={styles.newListButton}
                                onPress={() => {
                                    onClose()
                                    router.push('/create-list')
                                }}
                            >
                                <Ionicons name="add" size={20} color="#007AFF" />
                                <Text style={styles.newListButtonText}>Create New List</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            </View>
        </Modal>
    )
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
        paddingBottom: 40,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
    },
    closeButton: {
        padding: 4,
    },
    loadingContainer: {
        padding: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContainer: {
        padding: 16,
        flexGrow: 1,
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f9f9f9',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    listIconContainer: {
        marginRight: 12,
    },
    listInfo: {
        flex: 1,
    },
    listName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    listMeta: {
        fontSize: 12,
        color: '#999',
    },
    addedText: {
        fontSize: 14,
        color: '#4CAF50',
        fontWeight: '500',
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#999',
        marginTop: 16,
        marginBottom: 20,
    },
    createButton: {
        backgroundColor: '#007AFF',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
    },
    createButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    newListButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f0f0f0',
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 16,
        padding: 14,
        borderRadius: 8,
        gap: 8,
    },
    newListButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#007AFF',
    },
    quickSaveContainer: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
    },
    savedListButton: {
        backgroundColor: '#f9f9f9',
        borderRadius: 12,
        padding: 16,
        borderWidth: 2,
        borderColor: '#e0e0e0',
    },
    savedListButtonActive: {
        borderColor: '#007AFF',
        backgroundColor: '#f0f7ff',
    },
    savedListContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    savedListLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    savedListInfo: {
        marginLeft: 12,
        flex: 1,
    },
    savedListName: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 2,
    },
    savedListMeta: {
        fontSize: 12,
        color: '#999',
    },
    dividerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 16,
        gap: 12,
    },
    dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: '#e0e0e0',
    },
    dividerText: {
        fontSize: 12,
        color: '#999',
        fontWeight: '600',
    },
    emptyOtherLists: {
        padding: 20,
        alignItems: 'center',
    },
    emptyOtherListsText: {
        fontSize: 14,
        color: '#999',
    },
})
