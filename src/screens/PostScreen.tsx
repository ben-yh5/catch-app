import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, doc, getDoc } from 'firebase/firestore';
import { storage, db } from '@/src/services/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { colors } from '@/src/theme/colors';

interface LocationData {
  latitude: number;
  longitude: number;
}

export default function PostScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState<LocationData | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();
  const { user } = useAuth();

  const handleOpenCamera = async () => {
    if (!permission) {
      // Camera permissions are still loading
      return;
    }

    if (!permission.granted) {
      // Request permission
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Please enable camera permissions in settings to take photos.'
        );
        return;
      }
    }

    setShowCamera(true);
  };

  const getLocationFromExif = async (exifData: any): Promise<LocationData | null> => {
    try {
      // Check if photo has GPS data in EXIF
      if (exifData && exifData.GPSLatitude && exifData.GPSLongitude) {
        return {
          latitude: exifData.GPSLatitude,
          longitude: exifData.GPSLongitude,
        };
      }
      return null;
    } catch (error) {
      console.log('No EXIF data available:', error);
      return null;
    }
  };

  const getDeviceLocation = async (): Promise<LocationData | null> => {
    try {
      // Request location permission
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert(
          'Location Permission Required',
          'Location is needed to tag your post. You can still post without it.'
        );
        return null;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
    } catch (error) {
      console.error('Error getting device location:', error);
      Alert.alert('Location Error', 'Could not get your current location.');
      return null;
    }
  };

  const handleTakePhoto = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          exif: true, // Request EXIF data
        });

        if (photo) {
          await processPhoto(photo.uri, photo.exif);
        }
      } catch (error) {
        console.error('Error taking photo:', error);
        Alert.alert('Error', 'Failed to take photo. Please try again.');
        setLoadingLocation(false);
      }
    }
  };

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        exif: true,
      });

      if (!result.canceled && result.assets[0]) {
        await processPhoto(result.assets[0].uri, result.assets[0].exif);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const compressImage = async (uri: string): Promise<string> => {
    try {
      console.log('Compressing image...');
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1080 } }], // Resize to max 1080px width
        {
          compress: 0.7, // 70% quality
          format: ImageManipulator.SaveFormat.JPEG
        }
      );
      console.log('Image compressed successfully');
      return compressed.uri;
    } catch (error) {
      console.error('Error compressing image:', error);
      return uri; // Return original if compression fails
    }
  };

  const processPhoto = async (uri: string, exifData: any) => {
    setShowCamera(false);
    setLoadingLocation(true);

    // Compress image before setting it
    const compressedUri = await compressImage(uri);
    setCapturedImage(compressedUri);

    // Try to get location from EXIF first
    let photoLocation = await getLocationFromExif(exifData);

    // If no EXIF location, get device location
    if (!photoLocation) {
      photoLocation = await getDeviceLocation();
    }

    setLocation(photoLocation);
    setLoadingLocation(false);

    if (photoLocation) {
      console.log('Location extracted:', photoLocation);
    } else {
      console.log('No location available');
    }
  };

  const handleFlipCamera = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const handlePost = async () => {
    if (!user || !capturedImage) {
      Alert.alert('Error', 'User not authenticated or no image captured');
      return;
    }

    console.log('Starting post upload...');
    console.log('User ID:', user.uid);
    console.log('Image URI:', capturedImage);

    setUploading(true);

    try {
      // Get user's username from Firestore
      console.log('Fetching username from Firestore...');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const username = userDoc.exists() ? userDoc.data().username : 'Anonymous';
      console.log('Username:', username);

      // Convert image URI to blob
      console.log('Converting image to blob...');
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      console.log('Blob size:', blob.size, 'bytes');

      // Create unique filename with timestamp
      const timestamp = Date.now();
      const filename = `posts/${user.uid}/${timestamp}.jpg`;
      const storageRef = ref(storage, filename);
      console.log('Uploading to Storage path:', filename);

      // Upload image to Firebase Storage
      console.log('Starting upload to Firebase Storage...');
      const uploadResult = await uploadBytes(storageRef, blob);
      console.log('Upload complete:', uploadResult);

      // Get download URL
      console.log('Getting download URL...');
      const photoURL = await getDownloadURL(storageRef);
      console.log('Download URL:', photoURL);

      // Create post document in Firestore
      const postData = {
        authorId: user.uid,
        authorUsername: username,
        photoURL: photoURL,
        caption: caption || '',
        location: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
        } : null,
        catchCount: 0,
        parentPostId: null,
        isOriginal: true,
        createdAt: new Date(),
      };

      console.log('Creating Firestore document...', postData);
      const docRef = await addDoc(collection(db, 'posts'), postData);
      console.log('Post created with ID:', docRef.id);

      // Show success message
      const locationText = location
        ? `Location: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
        : 'No location';

      if (Platform.OS === 'web') {
        window.alert(`Post Created!\n\nPost ID: ${docRef.id}\nCaption: ${caption || '(no caption)'}\n${locationText}`);
      } else {
        Alert.alert(
          'Success!',
          `Your post has been created!\n\nPost ID: ${docRef.id}\n${caption || '(no caption)'}\n${locationText}`
        );
      }

      // Reset state
      setCapturedImage(null);
      setCaption('');
      setLocation(null);
      setUploading(false);

      // Navigate to home
      router.push('/(tabs)');

    } catch (error: any) {
      console.error('❌ ERROR posting:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      console.error('Full error:', JSON.stringify(error, null, 2));
      setUploading(false);

      if (Platform.OS === 'web') {
        window.alert(`Failed to create post: ${error.code || 'Unknown'}\n${error.message}`);
      } else {
        Alert.alert('Error', `Failed to create post:\n\n${error.code || 'Unknown'}\n${error.message}`);
      }
    }
  };

  const handleCancel = () => {
    setCapturedImage(null);
    setCaption('');
    setLocation(null);
    setShowCamera(false);
  };

  // Camera View
  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
        >
          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={styles.cameraButton}
              onPress={() => setShowCamera(false)}
            >
              <Ionicons name="close" size={32} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.captureButton}
              onPress={handleTakePhoto}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cameraButton}
              onPress={handleFlipCamera}
            >
              <Ionicons name="camera-reverse" size={32} color="#fff" />
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  // Preview View
  if (capturedImage) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView contentContainerStyle={styles.previewContainer}>
          <Text style={styles.previewTitle}>Preview Your Post</Text>

          <Image source={{ uri: capturedImage }} style={styles.previewImage} />

          {/* Location Display */}
          <View style={styles.locationContainer}>
            {loadingLocation ? (
              <View style={styles.locationLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.locationLoadingText}>Getting location...</Text>
              </View>
            ) : location ? (
              <View style={styles.locationInfo}>
                <Ionicons name="location" size={18} color={colors.primary} />
                <Text style={styles.locationText}>
                  {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                </Text>
              </View>
            ) : (
              <View style={styles.locationInfo}>
                <Ionicons name="location-outline" size={18} color={colors.textTertiary} />
                <Text style={styles.noLocationText}>No location available</Text>
              </View>
            )}
          </View>

          <TextInput
            style={styles.captionInput}
            placeholder="Add a caption or hint..."
            placeholderTextColor={colors.textTertiary}
            value={caption}
            onChangeText={setCaption}
            multiline
            maxLength={200}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.cancelButton]}
              onPress={handleCancel}
              disabled={uploading}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.postButton,
                (loadingLocation || uploading) && styles.postButtonDisabled,
              ]}
              onPress={handlePost}
              disabled={loadingLocation || uploading}
            >
              {uploading ? (
                <View style={styles.uploadingContainer}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.postButtonText}>Uploading...</Text>
                </View>
              ) : (
                <Text style={styles.postButtonText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Default View - Camera Button
  return (
    <View style={styles.container}>
      <Ionicons name="camera" size={80} color="#ccc" style={styles.icon} />
      <Text style={styles.title}>Create a Post</Text>
      <Text style={styles.subtitle}>Share a photo with the community</Text>

      {Platform.OS === 'web' ? (
        <TouchableOpacity style={styles.openCameraButton} onPress={handlePickImage}>
          <Ionicons name="images" size={24} color="#fff" />
          <Text style={styles.openCameraButtonText}>Choose Image</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity style={styles.openCameraButton} onPress={handleOpenCamera}>
            <Ionicons name="camera" size={24} color="#fff" />
            <Text style={styles.openCameraButtonText}>Open Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.pickImageButton} onPress={handlePickImage}>
            <Ionicons name="images" size={20} color="#007AFF" />
            <Text style={styles.pickImageButtonText}>Choose from Library</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 20,
  },
  icon: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textTertiary,
    marginBottom: 30,
    textAlign: 'center',
  },
  openCameraButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    gap: 10,
    marginBottom: 15,
  },
  openCameraButtonText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  pickImageButton: {
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickImageButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    flex: 1,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingBottom: 50,
  },
  cameraButton: {
    padding: 15,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  captureButtonInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#000',
  },
  previewContainer: {
    padding: 20,
    alignItems: 'center',
  },
  previewTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    marginTop: 20,
    color: colors.textPrimary,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 10,
    marginBottom: 15,
  },
  locationContainer: {
    width: '100%',
    marginBottom: 15,
  },
  locationLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: colors.card,
    borderRadius: 8,
    gap: 10,
  },
  locationLoadingText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: colors.card,
    borderRadius: 8,
    gap: 8,
  },
  locationText: {
    fontSize: 14,
    color: colors.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  noLocationText: {
    fontSize: 14,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  captionInput: {
    width: '100%',
    backgroundColor: colors.card,
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 15,
    width: '100%',
  },
  actionButton: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  postButton: {
    backgroundColor: colors.primary,
  },
  postButtonDisabled: {
    backgroundColor: colors.cardElevated,
    opacity: 0.6,
  },
  postButtonText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  uploadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
