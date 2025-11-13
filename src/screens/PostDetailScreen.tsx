import { useAuth } from '@/context/AuthContext';
import { usePost } from '@/context/PostContext';
import { db, storage } from '@/services/firebase';
import { colors } from '@/theme/colors';
import { validateCatch } from '@/utils/catchValidation';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, increment, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Platform,
  Pressable,
  ScrollView,
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
  hasLocation: boolean;
  catchCount: number;
  parentPostId: string | null;
  isOriginal: boolean;
  createdAt: any;
}

const { width } = Dimensions.get('window');

export default function PostDetailScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { user } = useAuth();
  const { triggerRefresh } = usePost();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);

  // Catch flow states
  const [catchMode, setCatchMode] = useState(false);
  const [catchPhoto, setCatchPhoto] = useState<string | null>(null);
  const [catchLocation, setCatchLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [fetchingLocation, setFetchingLocation] = useState(false);

  useEffect(() => {
    fetchPost();
    fetchBookmarkStatus();
  }, [postId]);

  const fetchPost = async () => {
    if (!postId) return;

    try {
      const postDoc = await getDoc(doc(db, 'posts', postId));
      if (postDoc.exists()) {
        setPost({
          id: postDoc.id,
          ...postDoc.data(),
        } as Post);
      }
    } catch (error) {
      console.error('Error fetching post:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBookmarkStatus = async () => {
    if (!user || !postId) return;

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const bookmarkedPosts = userDoc.data().bookmarkedPosts || [];
        setBookmarked(bookmarkedPosts.includes(postId));
      }
    } catch (error) {
      console.error('Error fetching bookmark status:', error);
    }
  };

  const toggleBookmark = async () => {
    if (!user || !postId) return;

    const wasBookmarked = bookmarked;
    setBookmarked(!bookmarked);

    try {
      const userRef = doc(db, 'users', user.uid);
      if (wasBookmarked) {
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
      setBookmarked(wasBookmarked);
    }
  };

  const handleShare = async () => {
    setShowOptionsMenu(false);
    if (Platform.OS === 'web') {
      window.alert('Share functionality coming soon!');
    } else {
      Alert.alert('Share', 'Share functionality coming soon!');
    }
  };

  const handleDeletePost = async () => {
    if (!user || !post) return;

    setShowOptionsMenu(false);

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
      await deleteDoc(doc(db, 'posts', post.id));

      if (Platform.OS === 'web') {
        window.alert('Post deleted successfully');
      } else {
        Alert.alert('Success', 'Post deleted successfully');
      }

      triggerRefresh();
      router.back();
    } catch (error) {
      console.error('Error deleting post:', error);
      if (Platform.OS === 'web') {
        window.alert('Error deleting post. Please try again.');
      } else {
        Alert.alert('Error', 'Error deleting post. Please try again.');
      }
    }
  };

  const handleCatchPress = async () => {
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
      setCatchMode(true);
    }
  };

  const handleCatchPhoto = async (photoUri: string) => {
    setCatchPhoto(photoUri);

    if (!post) {
      if (Platform.OS === 'web') {
        window.alert('Post not found. Please try again.');
      } else {
        Alert.alert('Error', 'Post not found. Please try again.');
      }
      return;
    }

    setFetchingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
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

      const validation = await validateCatch(
        post.id,
        coords.latitude,
        coords.longitude
      );

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
        await createCatchPost(photoUri, coords);
      }
    } catch (error: any) {
      console.error('Error validating catch:', error);
      setFetchingLocation(false);

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
      await handleCatchPhoto(photo.uri);
    }
  };

  const createCatchPost = async (
    photoUri: string,
    location: { latitude: number; longitude: number }
  ) => {
    if (!user || !post) return;

    setUploading(true);

    try {
      const response = await fetch(photoUri);
      const blob = await response.blob();

      const timestamp = Date.now();
      const storageRef = ref(storage, `posts/${user.uid}/${timestamp}.jpg`);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);

      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const username = userDoc.exists() ? userDoc.data().username : 'Unknown';

      const catchPostRef = await addDoc(collection(db, 'posts'), {
        authorId: user.uid,
        authorUsername: username,
        photoURL: downloadURL,
        caption: `Caught @${post.authorUsername}'s location!`,
        hasLocation: true,
        catchCount: 0,
        isOriginal: false,
        parentPostId: post.id,
        createdAt: new Date(),
      });

      await addDoc(collection(db, 'post_locations'), {
        postId: catchPostRef.id,
        latitude: location.latitude,
        longitude: location.longitude,
        createdAt: new Date(),
      });

      const parentPostRef = doc(db, 'posts', post.id);
      await updateDoc(parentPostRef, {
        catchCount: increment(1),
      });

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        totalCatches: increment(1),
      });

      // Update local state
      setPost({ ...post, catchCount: post.catchCount + 1 });

      if (Platform.OS === 'web') {
        window.alert('Great catch! Your post has been created.');
      } else {
        Alert.alert('Success', 'Great catch! Your post has been created.');
      }

      setCatchPhoto(null);
      setCatchLocation(null);
      triggerRefresh();
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
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Post not found</Text>
      </View>
    );
  }

  if (catchMode) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          ref={(ref) => setCameraRef(ref)}
        >
          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setCatchMode(false)}
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
    );
  }

  return (
    <TouchableWithoutFeedback onPress={() => showOptionsMenu && setShowOptionsMenu(false)}>
      <View style={styles.container}>
        <Pressable
          style={styles.content}
          onPress={() => {
            if (showOptionsMenu) {
              setShowOptionsMenu(false);
            }
          }}
        >
          {/* Header bar */}
          <View style={[styles.headerBar, { paddingTop: insets.top }]}>
            <View style={styles.headerLeft}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => {
                  setShowOptionsMenu(false);
                  router.back();
                }}
              >
                <Ionicons name="arrow-back" size={28} color={colors.textPrimary} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowOptionsMenu(false);
                  router.push({
                    pathname: '/user-profile',
                    params: { userId: post.authorId }
                  });
                }}
              >
                <Text style={styles.headerUsername}>@{post.authorUsername}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.headerRight}>
              <View style={styles.headerBadge}>
                <Ionicons name="trophy" size={16} color={colors.secondary} />
                <Text style={styles.headerCatchCount}>{post.catchCount}</Text>
              </View>
              <TouchableOpacity
                onPress={toggleBookmark}
                style={styles.headerButton}
              >
                <Ionicons
                  name={bookmarked ? "bookmark" : "bookmark-outline"}
                  size={24}
                  color={bookmarked ? colors.iconActive : colors.iconInactive}
                />
              </TouchableOpacity>
              <View style={{ zIndex: 10 }}>
                <TouchableOpacity
                  onPress={() => setShowOptionsMenu(!showOptionsMenu)}
                  style={styles.headerButton}
                >
                  <Ionicons name="ellipsis-horizontal" size={24} color={colors.textPrimary} />
                </TouchableOpacity>

                {showOptionsMenu && (
                  <View style={styles.optionsMenu}>
                    <TouchableOpacity
                      style={styles.optionsMenuItem}
                      onPress={handleShare}
                    >
                      <Text style={styles.optionsMenuText}>Share</Text>
                    </TouchableOpacity>
                    {post.authorId === user?.uid && (
                      <TouchableOpacity
                        style={[styles.optionsMenuItem, styles.optionsMenuItemLast]}
                        onPress={handleDeletePost}
                      >
                        <Text style={[styles.optionsMenuText, styles.optionsMenuTextDanger]}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Image
              source={{ uri: post.photoURL }}
              style={styles.image}
              resizeMode="contain"
            />

            <View style={styles.details}>
              {post.caption ? (
                <Text style={styles.caption}>{post.caption}</Text>
              ) : null}

              <View style={styles.metadata}>
                <View style={styles.metadataRow}>
                  <Ionicons name="calendar-outline" size={16} color={colors.textTertiary} />
                  <Text style={styles.metadataText}>{formatDate(post.createdAt)}</Text>
                </View>
              </View>

              {post.authorId !== user?.uid && (
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
        </Pressable>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.modalOverlay,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  errorText: {
    fontSize: 16,
    color: colors.textTertiary,
  },
  content: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    padding: 4,
  },
  headerUsername: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginLeft: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  headerCatchCount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
  },
  headerButton: {
    padding: 4,
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
  scrollContent: {
    flexGrow: 1,
  },
  image: {
    width: width,
    height: width,
    backgroundColor: colors.imageBackground,
  },
  details: {
    backgroundColor: colors.modalDark,
    padding: 20,
  },
  caption: {
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 16,
  },
  metadata: {
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
});
