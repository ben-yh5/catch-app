import React, { useState } from 'react'
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { collection, addDoc, doc, updateDoc, getDoc } from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useAuth } from '@/context/AuthContext'
import { Ionicons } from '@expo/vector-icons'

export default function CreateListModal() {
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const { user } = useAuth()
    const params = useLocalSearchParams()
    const listId = params.listId as string | undefined
    const isEditing = !!listId

    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [loading, setLoading] = useState(false)
    const [isLoadingList, setIsLoadingList] = useState(isEditing)

    // Load existing list data if editing
    React.useEffect(() => {
        if (isEditing && listId) {
            const loadList = async () => {
                try {
                    const listDoc = await getDoc(doc(db, 'lists', listId))
                    if (listDoc.exists()) {
                        const data = listDoc.data()
                        setName(data.name || '')
                        setDescription(data.description || '')
                    }
                } catch (error) {
                    console.error('Error loading list:', error)
                    Alert.alert('Error', 'Failed to load list')
                } finally {
                    setIsLoadingList(false)
                }
            }
            loadList()
        }
    }, [isEditing, listId])

    const handleSave = async () => {
        if (!user) return

        // Validate name
        if (!name.trim()) {
            Alert.alert('Error', 'Please enter a list name')
            return
        }

        setLoading(true)
        try {
            // Get user's username
            const userDoc = await getDoc(doc(db, 'users', user.uid))
            const username = userDoc.data()?.username || 'Unknown'

            if (isEditing && listId) {
                // Update existing list
                await updateDoc(doc(db, 'lists', listId), {
                    name: name.trim(),
                    description: description.trim(),
                    updatedAt: new Date(),
                })
            } else {
                // Create new list
                await addDoc(collection(db, 'lists'), {
                    name: name.trim(),
                    description: description.trim(),
                    creatorId: user.uid,
                    creatorUsername: username,
                    postIds: [],
                    isPublic: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
            }

            router.back()
        } catch (error) {
            console.error('Error saving list:', error)
            Alert.alert('Error', 'Failed to save list. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    if (isLoadingList) {
        return (
            <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
                <ActivityIndicator size="large" color="#007AFF" />
            </View>
        )
    }

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.cancelButton}>
                    <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {isEditing ? 'Edit List' : 'Create List'}
                </Text>
                <TouchableOpacity
                    onPress={handleSave}
                    disabled={loading}
                    style={styles.saveButton}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#007AFF" />
                    ) : (
                        <Text style={styles.saveText}>Save</Text>
                    )}
                </TouchableOpacity>
            </View>

            <View style={styles.content}>
                <View style={styles.inputContainer}>
                    <Text style={styles.label}>List Name *</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="Enter list name"
                        value={name}
                        onChangeText={setName}
                        maxLength={50}
                        autoFocus={!isEditing}
                    />
                    <Text style={styles.charCount}>{name.length}/50</Text>
                </View>

                <View style={styles.inputContainer}>
                    <Text style={styles.label}>Description (Optional)</Text>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        placeholder="Describe your list"
                        value={description}
                        onChangeText={setDescription}
                        maxLength={200}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                    />
                    <Text style={styles.charCount}>{description.length}/200</Text>
                </View>

                <View style={styles.infoBox}>
                    <Ionicons name="information-circle" size={20} color="#666" />
                    <Text style={styles.infoText}>
                        Lists are public and can be viewed by anyone
                    </Text>
                </View>
            </View>
        </KeyboardAvoidingView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    cancelButton: {
        width: 70,
    },
    cancelText: {
        fontSize: 16,
        color: '#007AFF',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    saveButton: {
        width: 70,
        alignItems: 'flex-end',
    },
    saveText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#007AFF',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    inputContainer: {
        marginBottom: 24,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 8,
        color: '#333',
    },
    input: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        backgroundColor: '#fff',
    },
    textArea: {
        height: 100,
        paddingTop: 12,
    },
    charCount: {
        fontSize: 12,
        color: '#999',
        textAlign: 'right',
        marginTop: 4,
    },
    infoBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
        padding: 12,
        borderRadius: 8,
        marginTop: 8,
    },
    infoText: {
        fontSize: 14,
        color: '#666',
        marginLeft: 8,
        flex: 1,
    },
})
