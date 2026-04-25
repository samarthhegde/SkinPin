import { useState } from 'react';
import { Button, Image, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

type Analysis = {
  condition: string;
  confidence: string;
  note: string;
};

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [symptoms, setSymptoms] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

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
    setAnalysis(null);
  };

  const runLocalAnalysis = () => {
    const normalized = symptoms.toLowerCase();

    let result: Analysis = {
      condition: 'Mild skin irritation',
      confidence: 'Medium',
      note: 'Monitor for 24-48 hours and avoid new skin products.',
    };

    if (normalized.includes('itch') || normalized.includes('itchy')) {
      result = {
        condition: 'Possible eczema or allergic reaction',
        confidence: 'Medium',
        note: 'Keep area clean and moisturized; seek care if worsening.',
      };
    }

    if (normalized.includes('pain') || normalized.includes('spreading')) {
      result = {
        condition: 'Possible inflammatory rash',
        confidence: 'Medium-High',
        note: 'Because symptoms include pain/spreading, consider urgent clinical review.',
      };
    }

    if (normalized.includes('fever')) {
      result = {
        condition: 'Potential infection risk',
        confidence: 'High',
        note: 'Fever with skin symptoms should be evaluated by a clinician quickly.',
      };
    }

    setAnalysis(result);
  };

  const resetSession = () => {
    setPhotoUri(null);
    setSymptoms('');
    setAnalysis(null);
  };

  return (
    <View style={{ flex: 1 }}>
      {photoUri ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <Image source={{ uri: photoUri }} style={{ width: '100%', height: 340 }} />
          <View style={{ paddingHorizontal: 16, paddingVertical: 20, gap: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>PrivateCare Local Scan</Text>
            <Text>Photo captured locally. Add symptoms for a quick on-device estimate.</Text>

            <TextInput
              value={symptoms}
              onChangeText={setSymptoms}
              placeholder="Example: itchy for 3 days, red, spreading"
              multiline
              style={{
                borderWidth: 1,
                borderColor: '#D1D5DB',
                borderRadius: 10,
                padding: 12,
                minHeight: 90,
                textAlignVertical: 'top',
                backgroundColor: '#FFFFFF',
              }}
            />

            <Button title="Analyze Locally" onPress={runLocalAnalysis} />

            {analysis ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: '#D1D5DB',
                  borderRadius: 10,
                  padding: 12,
                  gap: 6,
                  backgroundColor: '#F9FAFB',
                }}>
                <Text style={{ fontWeight: '700' }}>Possible Condition: {analysis.condition}</Text>
                <Text>Confidence: {analysis.confidence}</Text>
                <Text>Guidance: {analysis.note}</Text>
                <Text style={{ fontSize: 12, color: '#4B5563' }}>
                  Prototype output only. Not a medical diagnosis.
                </Text>
              </View>
            ) : null}

            <Button title="Retake Photo" onPress={() => setPhotoUri(null)} />
            <Button title="Clear Session Data" onPress={resetSession} />
          </View>
        </ScrollView>
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
