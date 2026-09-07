import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/context/AuthContext'
import { db } from '@/services/firebase'
import { colors } from '@/theme/colors'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore'
import React, { useState } from 'react'
import {
    ActivityIndicator,
    BackHandler,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function CreateListModal() {
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const { user } = useAuth()
    const { showToast } = useToast()
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
                    showToast('error', "Couldn't load list", 'Check your connection and try again.')
                } finally {
                    setIsLoadingList(false)
                }
            }
            loadList()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditing, listId])

    // Handle hardware back button
    React.useEffect(() => {
        const backHandler = BackHandler.addEventListener(
            'hardwareBackPress',
            () => {
                router.back()
                return true
            }
        )

        return () => backHandler.remove()
    }, [router])

    const handleSave = async () => {
        if (!user) return

        // Validate name
        if (!name.trim()) {
            showToast('warning', 'Name required', 'Give your list a name first.')
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
            showToast('error', "Couldn't save list", 'Check your connection and try again.')
        } finally {
            setLoading(false)
        }
    }

    // While an existing list loads, render the form shell (fields disabled)
    // instead of a bare spinner — the modal slides up over real UI the same
    // frame instead of a blank screen
    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.cancelButton}
                >
                    <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {isEditing ? 'Edit List' : 'Create List'}
                </Text>
                <TouchableOpacity
                    onPress={handleSave}
                    disabled={loading || isLoadingList}
                    style={styles.saveButton}
                >
                    {loading || isLoadingList ? (
                        <ActivityIndicator
                            size="small"
                            color={colors.primary}
                        />
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
                        placeholderTextColor={colors.textTertiary}
                        value={name}
                        onChangeText={setName}
                        maxLength={50}
                        autoFocus={!isEditing}
                        editable={!isLoadingList}
                    />
                    <Text style={styles.charCount}>{name.length}/50</Text>
                </View>

                <View style={styles.inputContainer}>
                    <Text style={styles.label}>Description (Optional)</Text>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        placeholder="Describe your list"
                        placeholderTextColor={colors.textTertiary}
                        value={description}
                        onChangeText={setDescription}
                        maxLength={200}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        editable={!isLoadingList}
                    />
                    <Text style={styles.charCount}>
                        {description.length}/200
                    </Text>
                </View>

                <View style={styles.infoBox}>
                    <Ionicons
                        name="information-circle"
                        size={20}
                        color={colors.textSecondary}
                    />
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
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    cancelButton: {
        width: 70,
    },
    cancelText: {
        fontSize: 16,
        color: colors.primary,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textPrimary,
    },
    saveButton: {
        width: 70,
        alignItems: 'flex-end',
    },
    saveText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primary,
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
        color: colors.textPrimary,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        backgroundColor: colors.card,
        color: colors.textPrimary,
    },
    textArea: {
        height: 100,
        paddingTop: 12,
    },
    charCount: {
        fontSize: 12,
        color: colors.textTertiary,
        textAlign: 'right',
        marginTop: 4,
    },
    infoBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.cardElevated,
        padding: 12,
        borderRadius: 8,
        marginTop: 8,
    },
    infoText: {
        fontSize: 14,
        color: colors.textSecondary,
        marginLeft: 8,
        flex: 1,
    },
})
