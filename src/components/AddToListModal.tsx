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
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'expo-router'

interface List {
    id: string
    name: string
    description: string
    creatorId: string
    creatorUsername: string
    postIds: string[]
    isPublic: boolean
    createdAt: any
    updatedAt: any
}

interface AddToListModalProps {
    visible: boolean
    onClose: () => void
    postId: string
}

export default function AddToListModal({ visible, onClose, postId }: AddToListModalProps) {
    const { user } = useAuth()
    const router = useRouter()
    const [lists, setLists] = useState<List[]>([])
    const [loading, setLoading] = useState(false)
    const [addingToList, setAddingToList] = useState<string | null>(null)

    useEffect(() => {
        if (visible) {
            fetchUserLists()
        }
    }, [visible])

    const fetchUserLists = async () => {
        if (!user) return

        setLoading(true)
        try {
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

            setLists(fetchedLists)
        } catch (error) {
            console.error('Error fetching lists:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleAddToList = async (listId: string) => {
        setAddingToList(listId)
        try {
            await updateDoc(doc(db, 'lists', listId), {
                postIds: arrayUnion(postId),
                updatedAt: new Date(),
            })

            Alert.alert('Success', 'Post added to list')
            onClose()
        } catch (error) {
            console.error('Error adding to list:', error)
            Alert.alert('Error', 'Failed to add post to list')
        } finally {
            setAddingToList(null)
        }
    }

    const renderListItem = ({ item }: { item: List }) => {
        const isPostInList = item.postIds.includes(postId)
        const isAdding = addingToList === item.id

        return (
            <TouchableOpacity
                style={styles.listItem}
                onPress={() => {
                    if (!isPostInList) {
                        handleAddToList(item.id)
                    }
                }}
                disabled={isPostInList || isAdding}
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
                    <Text style={styles.addedText}>Added</Text>
                ) : (
                    <Ionicons name="add-circle-outline" size={24} color="#007AFF" />
                )}
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
                        <Text style={styles.headerTitle}>Add to List</Text>
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
                            <FlatList
                                data={lists}
                                renderItem={renderListItem}
                                keyExtractor={(item) => item.id}
                                contentContainerStyle={styles.listContainer}
                                ListEmptyComponent={renderEmptyState}
                            />

                            {lists.length > 0 && (
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
                            )}
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
        padding: 14,
        borderRadius: 8,
        gap: 8,
    },
    newListButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#007AFF',
    },
})
