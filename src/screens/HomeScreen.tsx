import { useAuth } from '@/context/AuthContext';
import { usePost } from '@/context/PostContext';
import { db } from '@/services/firebase';
import { colors } from '@/theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import PostDetailModal from '@/components/PostDetailModal';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, DocumentData, getDoc, getDocs, limit, orderBy, query, QueryDocumentSnapshot, startAfter, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    Image,
    Platform,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Post {
  id: string;
  authorId: string;
  authorUsername: string;
  photoURL: string;
  caption: string;
  hasLocation: boolean; // Changed from location object to boolean flag
  catchCount: number;
  parentPostId: string | null;
  isOriginal: boolean;
  createdAt: any;
}

const { width } = Dimensions.get('window');

const POSTS_PER_PAGE = 20;

export default function HomeScreen() {
  const { user } = useAuth();
  const { shouldRefresh } = usePost();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [bookmarkedPosts, setBookmarkedPosts] = useState<string[]>([]);
  const [showOptionsMenu, setShowOptionsMenu] = useState<string | null>(null); // Store post ID of open menu
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const fetchBookmarks = async () => {
    if (!user) return;
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        setBookmarkedPosts(userDoc.data().bookmarkedPosts || []);
      }
    } catch (error) {
      console.error('Error fetching bookmarks:', error);
    }
  };

  const fetchPosts = async (loadMore = false) => {
    if (loadMore && (!hasMore || loadingMore)) return;

    try {
      console.log(loadMore ? 'Loading more posts...' : 'Fetching initial posts...');

      if (loadMore) {
        setLoadingMore(true);
      }

      let postsQuery;
      if (loadMore && lastDoc) {
        postsQuery = query(
          collection(db, 'posts'),
          orderBy('catchCount', 'desc'),
          startAfter(lastDoc),
          limit(POSTS_PER_PAGE)
        );
      } else {
        postsQuery = query(
          collection(db, 'posts'),
          orderBy('catchCount', 'desc'),
          limit(POSTS_PER_PAGE)
        );
      }

      const querySnapshot = await getDocs(postsQuery);
      const fetchedPosts: Post[] = [];

      querySnapshot.forEach((doc) => {
        fetchedPosts.push({
          id: doc.id,
          ...doc.data(),
        } as Post);
      });

      console.log(`Fetched ${fetchedPosts.length} posts`);

      // Update last document for pagination
      const lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
      setLastDoc(lastVisible || null);

      // Check if there are more posts
      setHasMore(fetchedPosts.length === POSTS_PER_PAGE);

      if (loadMore) {
        // Deduplicate posts when loading more
        setPosts(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newPosts = fetchedPosts.filter(p => !existingIds.has(p.id));
          return [...prev, ...newPosts];
        });
      } else {
        setPosts(fetchedPosts);
        // Fetch bookmarks on initial load
        await fetchBookmarks();
      }
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  useEffect(() => {
    // Refresh posts when a new post is created
    if (shouldRefresh) {
      setHasMore(true);
      setLastDoc(null);
      fetchPosts(false);
    }
  }, [shouldRefresh]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setHasMore(true);
    setLastDoc(null);
    fetchPosts(false);
  }, []);

  const loadMorePosts = useCallback(() => {
    if (!loading && !loadingMore && hasMore) {
      fetchPosts(true);
    }
  }, [loading, loadingMore, hasMore, lastDoc]);

  const toggleBookmark = async (postId: string) => {
    if (!user) return;

    const isBookmarked = bookmarkedPosts.includes(postId);

    // Optimistic update
    if (isBookmarked) {
      setBookmarkedPosts(bookmarkedPosts.filter(id => id !== postId));
    } else {
      setBookmarkedPosts([...bookmarkedPosts, postId]);
    }

    try {
      const userRef = doc(db, 'users', user.uid);
      if (isBookmarked) {
        await updateDoc(userRef, {
          bookmarkedPosts: arrayRemove(postId)
        });
      } else {
        await updateDoc(userRef, {
          bookmarkedPosts: arrayUnion(postId)
        });
      }
    } catch (error) {
      console.error('Error toggling bookmark:', error);
      // Revert optimistic update on error
      if (isBookmarked) {
        setBookmarkedPosts([...bookmarkedPosts, postId]);
      } else {
        setBookmarkedPosts(bookmarkedPosts.filter(id => id !== postId));
      }
    }
  };

  const handleShare = async (postId: string) => {
    setShowOptionsMenu(null);
    // TODO: Implement share functionality
    if (Platform.OS === 'web') {
      window.alert('Share functionality coming soon!');
    } else {
      Alert.alert('Share', 'Share functionality coming soon!');
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!user) return;

    setShowOptionsMenu(null);

    const postToDelete = posts.find(p => p.id === postId);

    const confirmDelete = Platform.OS === 'web'
      ? window.confirm('Are you sure you want to delete this post?')
      : await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Delete Post',
            'Are you sure you want to delete this post?',
            [
              { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
              { text: 'Delete', onPress: () => resolve(true), style: 'destructive' }
            ]
          );
        });

    if (!confirmDelete) return;

    try {
      // Delete post from Firestore
      await deleteDoc(doc(db, 'posts', postId));

      // Update local state
      setPosts(posts.filter(post => post.id !== postId));

      if (Platform.OS === 'web') {
        window.alert('Post deleted successfully');
      } else {
        Alert.alert('Success', 'Post deleted successfully');
      }
    } catch (error) {
      console.error('Error deleting post:', error);
      if (Platform.OS === 'web') {
        window.alert('Error deleting post. Please try again.');
      } else {
        Alert.alert('Error', 'Error deleting post. Please try again.');
      }
    }
  };

  const renderPost = ({ item }: { item: Post }) => {
    const isBookmarked = bookmarkedPosts.includes(item.id);

    return (
      <Pressable
        style={styles.postCard}
        onPress={() => {
          if (showOptionsMenu === item.id) {
            setShowOptionsMenu(null);
          }
        }}
      >
        <View style={styles.postHeader}>
          <TouchableOpacity
            onPress={() => {
              setShowOptionsMenu(null);
              router.push({
                pathname: '/user-profile',
                params: { userId: item.authorId }
              });
            }}
          >
            <Text style={styles.username}>@{item.authorUsername}</Text>
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <View style={styles.catchBadge}>
              <Ionicons name="trophy" size={16} color={colors.secondary} />
              <Text style={styles.catchCount}>{item.catchCount}</Text>
            </View>
            <TouchableOpacity
              onPress={() => toggleBookmark(item.id)}
              style={styles.bookmarkButton}
            >
              <Ionicons
                name={isBookmarked ? "bookmark" : "bookmark-outline"}
                size={22}
                color={isBookmarked ? colors.iconActive : colors.iconInactive}
              />
            </TouchableOpacity>
            <View style={{ zIndex: 10 }}>
              <TouchableOpacity
                onPress={() => setShowOptionsMenu(showOptionsMenu === item.id ? null : item.id)}
                style={styles.bookmarkButton}
              >
                <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
              </TouchableOpacity>

              {showOptionsMenu === item.id && (
                <View style={styles.optionsMenu}>
                  <TouchableOpacity
                    style={styles.optionsMenuItem}
                    onPress={() => handleShare(item.id)}
                  >
                    <Text style={styles.optionsMenuText}>Share</Text>
                  </TouchableOpacity>
                  {item.authorId === user?.uid && (
                    <TouchableOpacity
                      style={[styles.optionsMenuItem, styles.optionsMenuItemLast]}
                      onPress={() => handleDeletePost(item.id)}
                    >
                      <Text style={[styles.optionsMenuText, styles.optionsMenuTextDanger]}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => {
            setShowOptionsMenu(null);
            setSelectedPost(item);
            setModalVisible(true);
          }}
          activeOpacity={0.9}
        >
          <Image
            source={{ uri: item.photoURL }}
            style={styles.postImage}
            resizeMode="cover"
          />
        </TouchableOpacity>

        {item.caption ? (
          <Text style={styles.caption}>{item.caption}</Text>
        ) : null}
      </Pressable>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading posts...</Text>
      </View>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={() => showOptionsMenu && setShowOptionsMenu(null)}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top, backgroundColor: colors.background }} />
        <FlatList
          data={posts}
          renderItem={renderPost}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="images-outline" size={80} color="#ccc" />
              <Text style={styles.emptyTitle}>No Posts Yet</Text>
              <Text style={styles.emptySubtitle}>
                Be the first to share a photo!
              </Text>
            </View>
          }
          onEndReached={loadMorePosts}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.footerText}>Loading more posts...</Text>
              </View>
            ) : !hasMore && posts.length > 0 ? (
              <View style={styles.footerLoader}>
                <Text style={styles.footerText}>No more posts</Text>
              </View>
            ) : null
          }
        />

        <PostDetailModal
          visible={modalVisible}
          post={selectedPost}
          onClose={() => {
            setModalVisible(false);
            setSelectedPost(null);
          }}
          onPostUpdate={(updatedPost) => {
            setPosts(posts.map(p => p.id === updatedPost.id ? updatedPost : p));
          }}
          onPostDelete={(postId) => {
            setPosts(posts.filter(p => p.id !== postId));
          }}
        />
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: colors.textTertiary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 16,
    color: colors.textTertiary,
    marginTop: 10,
    textAlign: 'center',
  },
  listContent: {
    padding: 10,
    backgroundColor: colors.background,
  },
  postCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: 15,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  catchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  catchCount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
  },
  bookmarkButton: {
    padding: 4,
  },
  postImage: {
    width: '100%',
    height: width - 20,
    backgroundColor: colors.imageBackground,
  },
  caption: {
    padding: 12,
    paddingTop: 4,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 5,
  },
  locationText: {
    fontSize: 13,
    color: colors.primary,
    fontFamily: 'monospace',
  },
  optionsMenu: {
    position: 'absolute',
    top: 35,
    right: 0,
    backgroundColor: colors.cardElevated,
    borderRadius: 8,
    minWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
    overflow: 'hidden',
    zIndex: 1000,
  },
  optionsMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  optionsMenuItemLast: {
    borderBottomWidth: 0,
  },
  optionsMenuText: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  optionsMenuTextDanger: {
    color: '#ff4444',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
});
