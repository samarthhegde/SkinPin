import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Button,
  Easing,
  Image,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { CameraView, FlashMode, useCameraPermissions } from 'expo-camera';
import { PinchGestureHandler, PinchGestureHandlerGestureEvent, State } from 'react-native-gesture-handler';
import { getGeminiExplanation } from '@/lib/gemini';
import { LocalAgentOutput, runLocalAgentPipeline } from '@/lib/agents';
import { analyzeSkinPhotoWithTflite, initializeTfliteBridge } from '@/lib/tfliteBridge';
import { assessPhotoQuality, assessPhotoQualityFromBase64, PhotoQualityAssessment } from '@/lib/photoQuality';

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
  const [geminiExplanation, setGeminiExplanation] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [sensitiveMode, setSensitiveMode] = useState(true);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off');
  const [zoomFactor, setZoomFactor] = useState(1);
  const [baseZoomFactor, setBaseZoomFactor] = useState(1);
  const [photoQuality, setPhotoQuality] = useState<PhotoQualityAssessment | null>(null);
  const [isCheckingQuality, setIsCheckingQuality] = useState(false);
  const [liveQuality, setLiveQuality] = useState<PhotoQualityAssessment | null>(null);
  const [isLiveQualityRunning, setIsLiveQualityRunning] = useState(false);
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const speechEnabled = useMemo(() => speechRecognitionModule !== null, []);
  const flipRotation = useRef(new Animated.Value(0)).current;
  const cameraTransition = useRef(new Animated.Value(0)).current;
  const liveQualityBusyRef = useRef(false);
  const lastPinchAtRef = useRef(0);
  const [isPinching, setIsPinching] = useState(false);
  const MAX_ZOOM_FACTOR = 4;
  const isSceneDark = Boolean(liveQuality?.tips.some((tip) => tip.toLowerCase().includes('dark')));
  const computedFlash: FlashMode =
    cameraFacing !== 'back' ? 'off' : flashMode === 'on' ? 'on' : flashMode === 'auto' ? 'auto' : 'off';
  const torchEnabled =
    cameraFacing === 'back' && (flashMode === 'on' || (flashMode === 'auto' && isSceneDark));

  // CameraView zoom ranges 0..1, where 0 is no zoom. Keep smooth gesture range below 1.0x
  // in UI but avoid forcing extra camera updates there.
  const effectiveZoomFactor = Math.max(1, zoomFactor);
  const cameraZoom = Math.max(0, Math.min(1, (effectiveZoomFactor - 1) / (MAX_ZOOM_FACTOR - 1)));

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

  const takePhoto = async () => {
    if (!cameraRef) return;
    const photo = await cameraRef.takePictureAsync();
    setPhotoUri(photo.uri);
    setIsCheckingQuality(true);
    const quality = await assessPhotoQuality(photo.uri);
    setPhotoQuality(quality);
    setIsCheckingQuality(false);
    setAgentOutput(null);
    setGeminiExplanation(null);
  };

  const animateFlipControl = () => {
    flipRotation.setValue(0);
    Animated.timing(flipRotation, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const animateCameraSwitch = () => {
    cameraTransition.setValue(0);
    Animated.timing(cameraTransition, {
      toValue: 1,
      duration: 420,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const handleFlipCamera = () => {
    setIsSwitchingCamera(true);
    animateFlipControl();
    animateCameraSwitch();
    setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    setTimeout(() => {
      setIsSwitchingCamera(false);
      lastPinchAtRef.current = Date.now();
    }, 480);
  };

  const onPinchGestureEvent = (event: PinchGestureHandlerGestureEvent) => {
    const nextZoom = Math.max(0.5, Math.min(MAX_ZOOM_FACTOR, baseZoomFactor * event.nativeEvent.scale));
    setZoomFactor(nextZoom);
  };

  const onPinchStateChange = (event: PinchGestureHandlerGestureEvent) => {
    if (event.nativeEvent.state === State.ACTIVE) {
      setIsPinching(true);
      return;
    }
    if (event.nativeEvent.oldState === State.ACTIVE) {
      setBaseZoomFactor(zoomFactor);
      lastPinchAtRef.current = Date.now();
    }
    setIsPinching(false);
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

    await initializeTfliteBridge();
    const modelPrediction = await analyzeSkinPhotoWithTflite(photoUri);
    const output = runLocalAgentPipeline(symptoms, modelPrediction);
    setAgentOutput(output);

    const geminiText = await getGeminiExplanation({
      symptoms,
      condition: output.consensus.condition,
      confidence: output.consensus.confidence,
      urgency: output.consensus.urgency,
      whenToSeeDoctor: output.consensus.whenToSeeDoctor,
    });
    setGeminiExplanation(geminiText);
    setIsAnalyzing(false);
  };

  const resetSession = () => {
    setPhotoUri(null);
    setSymptoms('');
    setPhotoQuality(null);
    setAgentOutput(null);
    setGeminiExplanation(null);
    stopVoiceInput();
  };

  useEffect(() => {
    if (!permission?.granted || photoUri || !cameraRef) return;
    let mounted = true;
    const interval = setInterval(async () => {
      if (isSwitchingCamera) return;
      if (isPinching) return;
      if (Date.now() - lastPinchAtRef.current < 1400) return;
      if (!mounted || !cameraRef || liveQualityBusyRef.current) return;
      liveQualityBusyRef.current = true;
      setIsLiveQualityRunning(true);
      try {
        const frame = await cameraRef.takePictureAsync({
          quality: 0.08,
          base64: true,
          skipProcessing: true,
        });
        if (mounted && frame.base64) {
          setLiveQuality(assessPhotoQualityFromBase64(frame.base64));
        }
      } catch {
        if (mounted) {
          setLiveQuality({
            summary: 'warning',
            tips: ['Live quality unavailable. Keep image well lit and steady.'],
          });
        }
      } finally {
        liveQualityBusyRef.current = false;
        if (mounted) setIsLiveQualityRunning(false);
      }
    }, 4200);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [permission?.granted, photoUri, cameraRef, isPinching, isSwitchingCamera]);

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

  const flipSpin = flipRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const cameraOverlayOpacity = cameraTransition.interpolate({
    inputRange: [0, 0.25, 0.75, 1],
    outputRange: [0, 0.22, 0.22, 0],
  });
  const cameraOverlayScale = cameraTransition.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.985, 1],
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F3F4F6' }}>
      {photoUri ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 36 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 10 }}>
            <Text style={{ fontSize: 24, fontWeight: '800' }}>PrivateCare</Text>
            <Text style={{ color: '#374151' }}>
              Local-first skin analysis. No cloud upload in Sensitive Mode.
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

            <View
              style={{
                borderRadius: 10,
                backgroundColor: photoQuality?.summary === 'good' ? '#ECFDF5' : '#FEF3C7',
                borderWidth: 1,
                borderColor: photoQuality?.summary === 'good' ? '#10B981' : '#F59E0B',
                padding: 10,
                gap: 4,
              }}>
              <Text style={{ fontWeight: '700' }}>Photo Quality</Text>
              {isCheckingQuality ? (
                <Text style={{ color: '#374151' }}>Checking image quality...</Text>
              ) : (
                (photoQuality?.tips ?? ['Take a photo to get quality feedback.']).map((tip) => (
                  <Text key={tip}>- {tip}</Text>
                ))
              )}
            </View>

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
              <Text style={{ fontWeight: '600' }}>Sensitive Mode</Text>
              <Switch value={sensitiveMode} onValueChange={setSensitiveMode} />
            </View>
            <Text style={{ fontSize: 12, color: '#4B5563' }}>
              {sensitiveMode
                ? 'Session data is memory-only and can be cleared immediately.'
                : 'Normal mode keeps the session in app memory until reset.'}
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

              {geminiExplanation ? (
                <View style={{ marginTop: 8, gap: 6 }}>
                  <Text style={{ fontWeight: '700' }}>Gemini Explanation</Text>
                  <Text>{geminiExplanation}</Text>
                </View>
              ) : (
                <Text style={{ marginTop: 8, color: '#4B5563' }}>
                  Add EXPO_PUBLIC_GEMINI_API_KEY in env to enable LLM explanation.
                </Text>
              )}

              <Text style={{ marginTop: 6, fontSize: 12, color: '#4B5563' }}>
                Prototype only, not a medical diagnosis.
              </Text>
            </View>
          ) : null}

          <View style={{ marginHorizontal: 16, marginTop: 12, gap: 10 }}>
            <Button
              title="Retake Photo"
              onPress={() => {
                setPhotoUri(null);
                setPhotoQuality(null);
              }}
            />
            <Button
              title={sensitiveMode ? 'Clear Session (Sensitive Mode)' : 'Clear Session Data'}
              onPress={resetSession}
            />
          </View>
        </ScrollView>
      ) : (
        <PinchGestureHandler onGestureEvent={onPinchGestureEvent} onHandlerStateChange={onPinchStateChange}>
          <View style={{ flex: 1 }}>
            <CameraView
              style={{ flex: 1 }}
              ref={setCameraRef}
              facing={cameraFacing}
              zoom={cameraZoom}
              flash={computedFlash}
              enableTorch={torchEnabled}>
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: '#000000',
                  opacity: cameraOverlayOpacity,
                  transform: [{ scale: cameraOverlayScale }],
                  zIndex: 5,
                }}
              />
              <View style={{ flex: 1, justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 32 }}>
                <View style={{ alignItems: 'flex-end', marginTop: 20 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable
                      onPress={() =>
                        setFlashMode((prev) =>
                          prev === 'off' ? 'on' : prev === 'on' ? 'auto' : 'off'
                        )
                      }
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 999,
                        backgroundColor: 'rgba(17, 24, 39, 0.65)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <MaterialIcons
                        name={flashMode === 'auto' ? 'flash-auto' : flashMode === 'on' ? 'flash-on' : 'flash-off'}
                        size={20}
                        color="#FFFFFF"
                      />
                    </Pressable>
                    <Pressable
                      onPress={handleFlipCamera}
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 999,
                        backgroundColor: 'rgba(17, 24, 39, 0.65)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Animated.View style={{ transform: [{ rotate: flipSpin }] }}>
                        <MaterialIcons name="flip-camera-ios" size={22} color="#FFFFFF" />
                      </Animated.View>
                    </Pressable>
                  </View>
                </View>

                <View
                  style={{
                    alignSelf: 'center',
                    marginTop: 12,
                    backgroundColor: 'rgba(17, 24, 39, 0.55)',
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                    {isSwitchingCamera
                      ? 'Switching camera...'
                      : isLiveQualityRunning
                      ? 'Checking quality...'
                      : torchEnabled
                        ? 'Flash assist enabled'
                        : (liveQuality?.tips?.[0] ?? 'Picture looks great.')}
                  </Text>
                </View>

                <View style={{ alignItems: 'center', gap: 10, marginBottom: 8 }}>
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
                  <Text style={{ color: '#E5E7EB', fontSize: 12 }}>
                    Pinch to zoom ({zoomFactor.toFixed(1)}x)
                  </Text>
                </View>
              </View>
            </CameraView>
          </View>
        </PinchGestureHandler>
      )}
    </View>
  );
}
