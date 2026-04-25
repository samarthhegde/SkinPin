import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { LocalAgentOutput, runLocalAgentPipeline } from '@/lib/agents';
import { analyzeSkinPhotoWithMelange, initializeMelangeBridge } from '@/lib/melangeBridge';
import type { VisionModelPrediction as MelangePrediction } from '@/lib/melangeBridge';
import { analyzeSkinPhotoWithTflite, initializeTfliteBridge } from '@/lib/tfliteBridge';
import type { VisionModelPrediction as TflitePrediction } from '@/lib/tfliteBridge';

type VisionModelPrediction = MelangePrediction | TflitePrediction;

let speechRecognitionModule: any = null;
try {
  // Dynamically loaded to avoid crashing Expo Go if native module is unavailable.
  // In that case, the app still works with text-only symptom input.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const speechPkg = require('expo-speech-recognition');
  speechRecognitionModule = speechPkg.ExpoSpeechRecognitionModule;
} catch {
  speechRecognitionModule = null;
}

function urgencyColor(urgency: 'monitor' | 'soon' | 'urgent'): string {
  if (urgency === 'urgent') return '#B91C1C';
  if (urgency === 'soon') return '#B45309';
  return '#166534';
}

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [symptoms, setSymptoms] = useState('');
  const [agentOutput, setAgentOutput] = useState<LocalAgentOutput | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const [inferenceBackend, setInferenceBackend] = useState<'melange' | 'tflite' | 'none'>('none');
  const speechEnabled = useMemo(() => speechRecognitionModule !== null, []);
  const router = useRouter();

  useEffect(() => {
    if (!speechRecognitionModule) return;

    const resultSub = speechRecognitionModule.addListener('result', (event: any) => {
      const topResult = event?.results?.[0]?.transcript;
      if (topResult) {
        setSymptoms((prev) => `${prev}${prev ? ' ' : ''}${topResult}`.trim());
      }
    });
    const errorSub = speechRecognitionModule.addListener('error', () => setIsListening(false));
    const endSub = speechRecognitionModule.addListener('end', () => setIsListening(false));

    return () => {
      resultSub?.remove?.();
      errorSub?.remove?.();
      endSub?.remove?.();
    };
  }, []);

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
    router.push({ pathname: '/symptoms', params: { photoUri: photo.uri } });
  };

  const startVoiceInput = async () => {
    if (!speechRecognitionModule) return;
    const permissions = await speechRecognitionModule.requestPermissionsAsync();
    if (!permissions.granted) return;
    setIsListening(true);
    speechRecognitionModule.start({
      lang: 'en-US',
      interimResults: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
    });
  };

  const stopVoiceInput = () => {
    if (!speechRecognitionModule) return;
    speechRecognitionModule.stop();
    setIsListening(false);
  };

  const runLocalAnalysis = async () => {
    if (!photoUri) return;
    setIsAnalyzing(true);

    let modelPrediction: VisionModelPrediction | null = null;

    const melangeReady = await initializeMelangeBridge();
    if (melangeReady) {
      modelPrediction = await analyzeSkinPhotoWithMelange(photoUri);
    }

    if (!modelPrediction) {
      await initializeTfliteBridge();
      modelPrediction = await analyzeSkinPhotoWithTflite(photoUri);
    }

    setInferenceBackend(modelPrediction?.source ?? 'none');
    const output = runLocalAgentPipeline(symptoms, modelPrediction);
    setAgentOutput(output);
    setIsAnalyzing(false);
  };

  const resetSession = () => {
    setPhotoUri(null);
    setSymptoms('');
    setAgentOutput(null);
    setInferenceBackend('none');
    stopVoiceInput();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F3F4F6' }}>
      {photoUri ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 36 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 10 }}>
            <Text style={{ fontSize: 24, fontWeight: '800' }}>PrivateCare</Text>
            <Text style={{ color: '#374151' }}>
              Local-only skin analysis. Photos stay on this device.
            </Text>
          </View>

          <View
            style={{
              marginHorizontal: 16,
              marginTop: 14,
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              padding: 14,
              gap: 10,
            }}>
            <Text style={{ fontWeight: '700' }}>Captured Image</Text>
            <Image source={{ uri: photoUri }} style={{ width: 120, height: 120, borderRadius: 10 }} />

            <Text style={{ fontSize: 12, color: '#4B5563' }}>
              Sensitive Mode is always ON in this build: no cloud upload, local processing only.
            </Text>
          </View>

          <View
            style={{
              marginHorizontal: 16,
              marginTop: 12,
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              padding: 14,
              gap: 10,
            }}>
            <Text style={{ fontWeight: '700' }}>Symptoms and Duration</Text>
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

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={isListening ? stopVoiceInput : startVoiceInput}
                  disabled={!speechEnabled}
                  style={{
                    backgroundColor: !speechEnabled ? '#9CA3AF' : isListening ? '#DC2626' : '#1D4ED8',
                    borderRadius: 10,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}>
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                    {!speechEnabled
                      ? 'Voice (Dev Build Required)'
                      : isListening
                        ? 'Stop Voice Input'
                        : 'Speak Symptoms'}
                  </Text>
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={runLocalAnalysis}
                  style={{
                    backgroundColor: '#111827',
                    borderRadius: 10,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}>
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Analyze</Text>
                </Pressable>
              </View>
            </View>
            {isListening ? <Text style={{ color: '#1D4ED8' }}>Listening...</Text> : null}
            {!speechEnabled ? (
              <Text style={{ color: '#6B7280', fontSize: 12 }}>
                Voice input requires a development build with native speech module.
              </Text>
            ) : null}
          </View>

          {isAnalyzing ? (
            <View style={{ marginTop: 16, alignItems: 'center' }}>
              <ActivityIndicator size="large" />
              <Text style={{ marginTop: 8, color: '#4B5563' }}>Running multi-agent analysis...</Text>
            </View>
          ) : null}

          {agentOutput ? (
            <View
              style={{
                marginHorizontal: 16,
                marginTop: 12,
                borderRadius: 14,
                backgroundColor: '#FFFFFF',
                padding: 14,
                gap: 8,
              }}>
              <Text style={{ fontSize: 18, fontWeight: '800' }}>AI Consensus</Text>
              <Text style={{ fontWeight: '700' }}>Condition: {agentOutput.consensus.condition}</Text>
              <Text>Confidence: {(agentOutput.consensus.confidence * 100).toFixed(0)}%</Text>
              <Text>
                Inference backend:{' '}
                {inferenceBackend === 'none' ? 'unavailable (symptom-only fallback)' : inferenceBackend}
              </Text>
              <Text style={{ color: urgencyColor(agentOutput.consensus.urgency), fontWeight: '700' }}>
                Urgency: {agentOutput.consensus.urgency.toUpperCase()}
              </Text>
              <Text>When to see doctor: {agentOutput.consensus.whenToSeeDoctor}</Text>

              <View style={{ marginTop: 8, gap: 6 }}>
                <Text style={{ fontWeight: '700' }}>Agent Trace</Text>
                {agentOutput.trace.map((item) => (
                  <Text key={item.agent}>
                    - {item.agent}: {item.message}
                  </Text>
                ))}
              </View>

              <Text style={{ marginTop: 6, fontSize: 12, color: '#4B5563' }}>
                Prototype only, not a medical diagnosis.
              </Text>
            </View>
          ) : null}

          <View style={{ marginHorizontal: 16, marginTop: 12, gap: 10 }}>
            <Button title="Retake Photo" onPress={() => setPhotoUri(null)} />
            <Button title="Clear Session (Sensitive Mode)" onPress={resetSession} />
          </View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <CameraView style={{ flex: 1 }} ref={setCameraRef} facing={cameraFacing} />
          <View
            pointerEvents="box-none"
            style={{ position: 'absolute', inset: 0, justifyContent: 'space-between', padding: 24 }}>
            <View style={{ marginTop: 24 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '800' }}>PrivateCare</Text>
              <Text style={{ color: '#E5E7EB' }}>Capture a skin photo for local-first AI triage.</Text>
            </View>

            <View style={{ alignItems: 'center', gap: 14 }}>
              <Pressable
                onPress={takePhoto}
                style={{
                  width: 78,
                  height: 78,
                  borderRadius: 999,
                  backgroundColor: '#FFFFFF',
                  borderWidth: 6,
                  borderColor: '#D1D5DB',
                }}
              />
              <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Tap to Capture</Text>
            </View>

            <View style={{ gap: 10 }}>
              <Button
                title={`Flip Camera (${cameraFacing === 'back' ? 'Back' : 'Front'})`}
                onPress={() => setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'))}
              />
              <Button title="Take Photo" onPress={takePhoto} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
