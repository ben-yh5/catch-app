import { useAuth } from '@/context/AuthContext';
import { usePost } from '@/context/PostContext';
import { db, storage } from '@/services/firebase';
import { colors } from '@/theme/colors';
import { validateCatch } from '@/utils/catchValidation';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { addDoc, arrayRemove, arrayUnion, collection, doc, DocumentData, getDoc, getDocs, increment, limit, orderBy, query, QueryDocumentSnapshot, startAfter, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    FlatList,
    Image,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
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
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  // Catch flow states
  const [catchMode, setCatchMode] = useState(false);
  const [catchPhoto, setCatchPhoto] = useState<string | null>(null);
  const [catchLocation, setCatchLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [fetchingLocation, setFetchingLocation] = useState(false);

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
        setPosts(prev => [...prev, ...fetchedPosts]);
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

  const handleCatchPress = async () => {
    // Request camera permissions
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        if (Platform.OS === 'web') {
          window.alert('Camera permission is required to catch this location.');
        } else {
          Alert.alert('Permission Required', 'Camera permission is required to catch this location.');
        }
        return;
      }
    }

    // On web, use image picker as camera is not supported
    if (Platform.OS === 'web') {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await handleCatchPhoto(result.assets[0].uri);
      }
    } else {
      // On native, show camera
      setCatchMode(true);
    }
  };

  const handleCatchPhoto = async (photoUri: string) => {
    setCatchPhoto(photoUri);

    // Check if original post exists
    if (!selectedPost) {
      if (Platform.OS === 'web') {
        window.alert('Post not found. Please try again.');
      } else {
        Alert.alert('Error', 'Post not found. Please try again.');
      }
      return;
    }

    // Get current GPS location
    setFetchingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission denied');
        setFetchingLocation(false);
        if (Platform.OS === 'web') {
          window.alert('Location permission is required to validate your catch.');
        } else {
          Alert.alert('Permission Required', 'Location permission is required to validate your catch.');
        }
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const coords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      setCatchLocation(coords);
      console.log('Validating catch at:', coords);

      // Validate location server-side (coordinates of target post never sent to client)
      const validation = await validateCatch(
        selectedPost.id,
        coords.latitude,
        coords.longitude
      );

      console.log(`Validation result: ${validation.isValid}, Distance: ${validation.distance}m`);

      setFetchingLocation(false);

      if (!validation.isValid) {
        if (Platform.OS === 'web') {
          window.alert(
            `You're too far away!\n\nYou're ${validation.distance}m away.\nMust be within ${validation.requiredDistance}m.`
          );
        } else {
          Alert.alert(
            'Too Far Away',
            `You're ${validation.distance}m away. Must be within ${validation.requiredDistance}m to catch this location.`
          );
        }
      } else {
        // Success! Create the catch post
        await createCatchPost(photoUri, coords);
      }
    } catch (error: any) {
      console.error('Error validating catch:', error);
      setFetchingLocation(false);

      // Handle specific Firebase errors
      if (error.code === 'functions/not-found') {
        if (Platform.OS === 'web') {
          window.alert('This post no longer exists or has no location data.');
        } else {
          Alert.alert('Error', 'This post no longer exists or has no location data.');
        }
      } else if (error.code === 'functions/unauthenticated') {
        if (Platform.OS === 'web') {
          window.alert('You must be logged in to catch posts.');
        } else {
          Alert.alert('Authentication Required', 'You must be logged in to catch posts.');
        }
      } else {
        if (Platform.OS === 'web') {
          window.alert('Error validating your location. Please try again.');
        } else {
          Alert.alert('Error', 'Error validating your location. Please try again.');
        }
      }
    }
  };

  const takeCatchPicture = async () => {
    if (cameraRef) {
      const photo = await cameraRef.takePictureAsync();
      setCatchMode(false);
      setModalVisible(false);
      await handleCatchPhoto(photo.uri);
    }
  };

  const createCatchPost = async (
    photoUri: string,
    location: { latitude: number; longitude: number }
  ) => {
    if (!user || !selectedPost) return;

    setUploading(true);

    try {
      // Convert photo URI to blob
      const response = await fetch(photoUri);
      const blob = await response.blob();

      // Upload to Firebase Storage
      const timestamp = Date.now();
      const storageRef = ref(storage, `posts/${user.uid}/${timestamp}.jpg`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);

      // Get user data for username
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const username = userDoc.exists() ? userDoc.data().username : 'Unknown';

      // Create catch post document
      const catchPostRef = await addDoc(collection(db, 'posts'), {
        authorId: user.uid,
        authorUsername: username,
        photoURL: downloadURL,
        caption: `Caught @${selectedPost.authorUsername}'s location!`,
        hasLocation: true,
        catchCount: 0,
        isOriginal: false,
        parentPostId: selectedPost.id,
        createdAt: new Date(),
      });

      // Store location in private collection
      await addDoc(collection(db, 'post_locations'), {
        postId: catchPostRef.id,
        latitude: location.latitude,
        longitude: location.longitude,
        createdAt: new Date(),
      });

      // Increment parent post's catchCount
      const parentPostRef = doc(db, 'posts', selectedPost.id);
      await updateDoc(parentPostRef, {
        catchCount: increment(1),
      });

      // Increment user's totalCatches
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        totalCatches: increment(1),
      });

      // Update local state
      setPosts(posts.map(post =>
        post.id === selectedPost.id
          ? { ...post, catchCount: post.catchCount + 1 }
          : post
      ));

      // Show success message
      if (Platform.OS === 'web') {
        window.alert('Great catch! Your post has been created.');
      } else {
        Alert.alert('Success', 'Great catch! Your post has been created.');
      }

      // Close modal and refresh feed
      setModalVisible(false);
      setCatchPhoto(null);
      setCatchLocation(null);
      await fetchPosts();
    } catch (error) {
      console.error('Error creating catch post:', error);
      if (Platform.OS === 'web') {
        window.alert('Error creating catch post. Please try again.');
      } else {
        Alert.alert('Error', 'Error creating catch post. Please try again.');
      }
    } finally {
      setUploading(false);
    }
  };

  const renderPost = ({ item }: { item: Post }) => {
    const isBookmarked = bookmarkedPosts.includes(item.id);

    return (
      <View style={styles.postCard}>
        <View style={styles.postHeader}>
          <TouchableOpacity
            onPress={() => router.push({
              pathname: '/user-profile',
              params: { userId: item.authorId }
            })}
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
          </View>
        </View>

        <TouchableOpacity
          onPress={() => {
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

        {item.hasLocation ? (
          <View style={styles.locationContainer}>
            <Ionicons name="location" size={14} color={colors.primary} />
            <Text style={styles.locationText}>Location available</Text>
          </View>
        ) : null}
      </View>
    );
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'Unknown date';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
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
    <>
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

      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          setModalVisible(false);
          setCatchMode(false);
        }}
      >
        <View style={styles.modalOverlay}>
          {catchMode ? (
            // Camera view for catching
            <View style={styles.cameraContainer}>
              <CameraView
                style={styles.camera}
                facing="back"
                ref={(ref) => setCameraRef(ref)}
              >
                <View style={styles.cameraControls}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      setCatchMode(false);
                      setModalVisible(false);
                    }}
                  >
                    <Ionicons name="close" size={32} color="#fff" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.captureButton}
                    onPress={takeCatchPicture}
                  >
                    <View style={styles.captureButtonInner} />
                  </TouchableOpacity>
                </View>
              </CameraView>
            </View>
          ) : (
            // Photo detail modal
            <View style={styles.modalContent}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setModalVisible(false)}
              >
                <Ionicons name="close" size={32} color="#fff" />
              </TouchableOpacity>

              {selectedPost && (
                <ScrollView
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <Image
                    source={{ uri: selectedPost.photoURL }}
                    style={styles.modalImage}
                    resizeMode="contain"
                  />

                  <View style={styles.modalDetails} pointerEvents="box-none">
                    <View style={styles.modalHeader}>
                      <Text style={styles.modalUsername}>@{selectedPost.authorUsername}</Text>
                      <View style={styles.modalCatchBadge}>
                        <Ionicons name="trophy" size={18} color={colors.secondary} />
                        <Text style={styles.modalCatchCount}>{selectedPost.catchCount}</Text>
                      </View>
                    </View>

                    {selectedPost.caption ? (
                      <Text style={styles.modalCaption}>{selectedPost.caption}</Text>
                    ) : null}

                    <View style={styles.modalMetadata}>
                      <View style={styles.metadataRow}>
                        <Ionicons name="calendar-outline" size={16} color={colors.textTertiary} />
                        <Text style={styles.metadataText}>{formatDate(selectedPost.createdAt)}</Text>
                      </View>
                    </View>

                    {selectedPost.authorId !== user?.uid && (
                      <>
                        <Text style={styles.catchSubtitle}>Recreate this photo at the same location!</Text>
                        <TouchableOpacity
                          style={[
                            styles.catchButton,
                            (uploading || fetchingLocation) && styles.catchButtonDisabled
                          ]}
                          onPress={handleCatchPress}
                          disabled={uploading || fetchingLocation}
                        >
                          {uploading ? (
                            <>
                              <ActivityIndicator size="small" color="#fff" />
                              <Text style={styles.catchButtonText}>Uploading...</Text>
                            </>
                          ) : fetchingLocation ? (
                            <>
                              <ActivityIndicator size="small" color="#fff" />
                              <Text style={styles.catchButtonText}>Getting location...</Text>
                            </>
                          ) : (
                            <>
                              <Ionicons name="camera" size={20} color="#fff" />
                              <Text style={styles.catchButtonText}>Catch This Location</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </ScrollView>
              )}
            </View>
          )}
        </View>
      </Modal>
    </>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.modalOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  modalImage: {
    width: width,
    height: width,
    backgroundColor: colors.imageBackground,
  },
  modalDetails: {
    backgroundColor: colors.modalDark,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalUsername: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalCatchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 5,
  },
  modalCatchCount: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.secondary,
  },
  modalCaption: {
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 16,
  },
  modalMetadata: {
    gap: 8,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metadataText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  catchSubtitle: {
    fontSize: 14,
    color: colors.textTertiary,
    marginTop: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  catchButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 20,
    gap: 8,
  },
  catchButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  catchButtonDisabled: {
    opacity: 0.6,
  },
  cameraContainer: {
    flex: 1,
    width: '100%',
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
    padding: 20,
  },
  cancelButton: {
    alignSelf: 'flex-start',
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
  },
  captureButton: {
    alignSelf: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
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
