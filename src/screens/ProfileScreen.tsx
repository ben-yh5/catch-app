import { useAuth } from '@/src/context/AuthContext';
import { db } from '@/src/services/firebase';
import { colors } from '@/src/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { collection, doc, DocumentData, documentId, getDoc, getDocs, limit, orderBy, query, QueryDocumentSnapshot, startAfter, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Post {
  id: string;
  authorId: string;
  authorUsername: string;
  photoURL: string;
  caption: string;
  location: {
    latitude: number;
    longitude: number;
  } | null;
  catchCount: number;
  parentPostId: string | null;
  isOriginal: boolean;
  createdAt: any;
}

const { width } = Dimensions.get('window');
const ITEM_SIZE = (width - 3) / 2; // 2 columns with 1px gap
const POSTS_PER_PAGE = 20;

type ViewMode = 'posts' | 'bookmarks';

export default function ProfileScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState<string>('');
  const [totalCatches, setTotalCatches] = useState<number>(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [bookmarkedPosts, setBookmarkedPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [hasMoreBookmarks, setHasMoreBookmarks] = useState(true);
  const [lastPostDoc, setLastPostDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('posts');

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    if (!user) return;

    try {
      // Fetch user document for username, totalCatches, and bookmarkedPosts
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      let bookmarkedPostIds: string[] = [];

      if (userDoc.exists()) {
        const userData = userDoc.data();
        setUsername(userData.username || 'Unknown');
        setTotalCatches(userData.totalCatches || 0);
        bookmarkedPostIds = userData.bookmarkedPosts || [];
      }

      // Fetch user's posts (paginated)
      const postsQuery = query(
        collection(db, 'posts'),
        where('authorId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(POSTS_PER_PAGE)
      );

      const querySnapshot = await getDocs(postsQuery);
      const fetchedPosts: Post[] = [];

      querySnapshot.forEach((doc) => {
        fetchedPosts.push({
          id: doc.id,
          ...doc.data(),
        } as Post);
      });

      setPosts(fetchedPosts);

      // Update pagination state for posts
      const lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
      setLastPostDoc(lastVisible || null);
      setHasMorePosts(fetchedPosts.length === POSTS_PER_PAGE);

      // Fetch bookmarked posts
      if (bookmarkedPostIds.length > 0) {
        // Firestore 'in' operator supports max 30 items, so we need to batch if more
        const batchSize = 30;
        const batches = [];

        for (let i = 0; i < bookmarkedPostIds.length; i += batchSize) {
          const batch = bookmarkedPostIds.slice(i, i + batchSize);
          batches.push(batch);
        }

        const allBookmarkedPosts: Post[] = [];

        for (const batch of batches) {
          const bookmarksQuery = query(
            collection(db, 'posts'),
            where(documentId(), 'in', batch)
          );

          const bookmarksSnapshot = await getDocs(bookmarksQuery);
          bookmarksSnapshot.forEach((doc) => {
            allBookmarkedPosts.push({
              id: doc.id,
              ...doc.data(),
            } as Post);
          });
        }

        setBookmarkedPosts(allBookmarkedPosts);
      } else {
        setBookmarkedPosts([]);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMorePosts = async () => {
    if (!user || loadingMore || !hasMorePosts || !lastPostDoc) return;

    setLoadingMore(true);

    try {
      const postsQuery = query(
        collection(db, 'posts'),
        where('authorId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        startAfter(lastPostDoc),
        limit(POSTS_PER_PAGE)
      );

      const querySnapshot = await getDocs(postsQuery);
      const fetchedPosts: Post[] = [];

      querySnapshot.forEach((doc) => {
        fetchedPosts.push({
          id: doc.id,
          ...doc.data(),
        } as Post);
      });

      setPosts(prev => [...prev, ...fetchedPosts]);

      // Update pagination state
      const lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
      setLastPostDoc(lastVisible || null);
      setHasMorePosts(fetchedPosts.length === POSTS_PER_PAGE);
    } catch (error) {
      console.error('Error loading more posts:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleEndReached = () => {
    if (viewMode === 'posts' && hasMorePosts) {
      loadMorePosts();
    }
    // Note: Bookmarks don't need pagination since we load all at once
  };

  const handlePostPress = (post: Post) => {
    console.log('Post tapped:', post.id);
  };

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
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const displayedPosts = viewMode === 'posts' ? posts : bookmarkedPosts;

  return (
    <View style={styles.container}>
      <FlatList
        data={displayedPosts}
        renderItem={renderPost}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={[styles.listContent, { paddingTop: insets.top + 56 }]}
        ListHeaderComponent={
          <View style={styles.profileInfo}>
            <View style={styles.statsContainer}>
              <Text style={styles.username}>@{username}</Text>
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{posts.length}</Text>
                  <Text style={styles.statLabel}>Posts</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{totalCatches}</Text>
                  <Text style={styles.statLabel}>Catches</Text>
                </View>
              </View>
            </View>

            <View style={styles.toggleContainer}>
              <TouchableOpacity
                style={[styles.toggleButton, viewMode === 'posts' && styles.toggleButtonActive]}
                onPress={() => setViewMode('posts')}
              >
                <Ionicons
                  name="grid"
                  size={20}
                  color={viewMode === 'posts' ? colors.primary : colors.textTertiary}
                />
                <Text style={[styles.toggleText, viewMode === 'posts' && styles.toggleTextActive]}>
                  Posts
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.toggleButton, viewMode === 'bookmarks' && styles.toggleButtonActive]}
                onPress={() => setViewMode('bookmarks')}
              >
                <Ionicons
                  name="bookmark"
                  size={20}
                  color={viewMode === 'bookmarks' ? colors.primary : colors.textTertiary}
                />
                <Text style={[styles.toggleText, viewMode === 'bookmarks' && styles.toggleTextActive]}>
                  Bookmarks
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons
              name={viewMode === 'posts' ? 'images-outline' : 'bookmark-outline'}
              size={60}
              color="#ccc"
            />
            <Text style={styles.emptyText}>
              {viewMode === 'posts' ? 'No posts yet' : 'No bookmarked posts'}
            </Text>
          </View>
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore && viewMode === 'posts' ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        columnWrapperStyle={displayedPosts.length > 0 ? styles.row : undefined}
      />

      <View style={[styles.profileHeader, { paddingTop: insets.top }]}>
        <View style={styles.placeholder} />
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity
          onPress={() => router.push('/settings' as any)}
          style={styles.settingsButton}
        >
          <Ionicons name="settings-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  profileHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    zIndex: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  settingsButton: {
    padding: 4,
  },
  placeholder: {
    width: 32,
  },
  listContent: {
    paddingBottom: 20,
  },
  profileInfo: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 1,
  },
  statsContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    color: colors.textPrimary,
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
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 14,
    color: colors.textTertiary,
    marginTop: 4,
  },
  toggleContainer: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 20,
    gap: 8,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.card,
    gap: 8,
  },
  toggleButtonActive: {
    backgroundColor: colors.cardElevated,
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  toggleTextActive: {
    color: colors.primary,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textTertiary,
    marginTop: 12,
  },
  row: {
    gap: 1,
  },
  postItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    backgroundColor: colors.imageBackground,
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});
