import React, { useState, useEffect } from 'react'
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    Image,
    Dimensions,
    ActivityIndicator,
    TouchableOpacity,
} from 'react-native'
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc,
    orderBy,
} from 'firebase/firestore'
import { db } from '@/services/firebase'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

interface Post {
    id: string
    authorId: string
    authorUsername: string
    photoURL: string
    caption: string
    location: {
        latitude: number
        longitude: number
    } | null
    catchCount: number
    parentPostId: string | null
    isOriginal: boolean
    createdAt: any
}

const { width } = Dimensions.get('window')
const ITEM_SIZE = (width - 3) / 2 // 2 columns with 1px gap

export default function UserProfileScreen() {
    const { userId } = useLocalSearchParams<{ userId: string }>()
    const router = useRouter()
    const insets = useSafeAreaInsets()
    const [username, setUsername] = useState<string>('')
    const [totalCatches, setTotalCatches] = useState<number>(0)
    const [posts, setPosts] = useState<Post[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (userId) {
            fetchUserData()
        }
    }, [userId])

    const fetchUserData = async () => {
        if (!userId) return

        try {
            // Fetch user document for username and totalCatches
            const userDoc = await getDoc(doc(db, 'users', userId))
            if (userDoc.exists()) {
                const userData = userDoc.data()
                setUsername(userData.username || 'Unknown')
                setTotalCatches(userData.totalCatches || 0)
            }

            // Fetch user's posts
            const postsQuery = query(
                collection(db, 'posts'),
                where('authorId', '==', userId),
                orderBy('createdAt', 'desc')
            )

            const querySnapshot = await getDocs(postsQuery)
            const fetchedPosts: Post[] = []

            querySnapshot.forEach((doc) => {
                fetchedPosts.push({
                    id: doc.id,
                    ...doc.data(),
                } as Post)
            })

            setPosts(fetchedPosts)
        } catch (error) {
            console.error('Error fetching user data:', error)
        } finally {
            setLoading(false)
        }
    }

    const handlePostPress = (post: Post) => {
        console.log('Post tapped:', post.id)
    }

    const renderPost = ({ item }: { item: Post }) => (
        <TouchableOpacity
            style={styles.postItem}
            onPress={() => handlePostPress(item)}
            activeOpacity={0.8}
        >
            <Image
                source={{ uri: item.photoURL }}
                style={styles.postImage}
                resizeMode="cover"
            />
        </TouchableOpacity>
    )

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                >
                    <Ionicons name="chevron-back" size={28} color="#007AFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Profile</Text>
                <View style={styles.headerSpacer} />
            </View>

            <FlatList
                data={posts}
                renderItem={renderPost}
                keyExtractor={(item) => item.id}
                numColumns={2}
                ListHeaderComponent={
                    <View style={styles.profileInfo}>
                        <View style={styles.statsContainer}>
                            <Text style={styles.username}>@{username}</Text>
                            <View style={styles.statRow}>
                                <View style={styles.statItem}>
                                    <Text style={styles.statNumber}>
                                        {posts.length}
                                    </Text>
                                    <Text style={styles.statLabel}>Posts</Text>
                                </View>
                                <View style={styles.statItem}>
                                    <Text style={styles.statNumber}>
                                        {totalCatches}
                                    </Text>
                                    <Text style={styles.statLabel}>
                                        Catches
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </View>
                }
                contentContainerStyle={styles.listContent}
                columnWrapperStyle={styles.row}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    header: {
        backgroundColor: '#fff',
        paddingBottom: 16,
        paddingHorizontal: 20,
        justifyContent: 'flex-end',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e5e5',
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#000',
        flex: 1,
        textAlign: 'center',
        marginRight: 32, // Offset for back button
    },
    headerSpacer: {
        width: 36,
    },
    listContent: {
        paddingBottom: 20,
    },
    profileInfo: {
        padding: 20,
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e5e5',
        marginBottom: 1,
    },
    statsContainer: {
        alignItems: 'center',
    },
    username: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 16,
        color: '#000',
    },
    statRow: {
        flexDirection: 'row',
        gap: 40,
    },
    statItem: {
        alignItems: 'center',
    },
    statNumber: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#000',
    },
    statLabel: {
        fontSize: 14,
        color: '#666',
        marginTop: 4,
    },
    row: {
        gap: 1,
    },
    postItem: {
        width: ITEM_SIZE,
        height: ITEM_SIZE,
        backgroundColor: '#f0f0f0',
    },
    postImage: {
        width: '100%',
        height: '100%',
    },
})
