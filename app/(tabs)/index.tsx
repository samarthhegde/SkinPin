import { useState } from 'react';
import { Button, Image, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);

  if (!permission) {
    return <View style={{ flex: 1 }} />;
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ marginBottom: 12, textAlign: 'center' }}>
          PrivateCare needs camera access to analyze a photo locally.
        </Text>
        <Button title="Grant Camera Permission" onPress={requestPermission} />
      </View>
    );
  }

  const takePhoto = async () => {
    if (!cameraRef) return;
    const photo = await cameraRef.takePictureAsync();
    setPhotoUri(photo.uri);
  };

  return (
    <View style={{ flex: 1 }}>
      {photoUri ? (
        <View style={{ flex: 1 }}>
          <Image source={{ uri: photoUri }} style={{ flex: 1 }} />
          <View style={{ paddingHorizontal: 16, paddingVertical: 20, gap: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>PrivateCare</Text>
            <Text>Photo captured locally on your device.</Text>
            <Button title="Retake Photo" onPress={() => setPhotoUri(null)} />
          </View>
        </View>
      ) : (
        <CameraView style={{ flex: 1 }} ref={setCameraRef}>
          <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: 24 }}>
            <Button title="Take Photo" onPress={takePhoto} />
          </View>
        </CameraView>
      )}
    </View>
  );
}
