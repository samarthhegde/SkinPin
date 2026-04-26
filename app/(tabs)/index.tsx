import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { CameraView, FlashMode, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Easing,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { GestureHandlerRootView, PinchGestureHandler, State } from 'react-native-gesture-handler';
import { WebView } from 'react-native-webview';

const { width: SW, height: SH } = Dimensions.get('window');
const CIRCLE_D = Math.min(SW, SH) * 0.75;
const CIRCLE_R = CIRCLE_D / 2;
const CX = SW / 2;
const CY = SH * 0.42;

const SKIN_MIN = 0.12;
const SKIN_GOOD = 0.28;
const SKIN_MAX = 0.82;
const BRIGHT_MIN = 40;
const BRIGHT_MAX = 220;

const ANALYZER_HTML = `<!DOCTYPE html><html><body style="margin:0;background:#000">
<canvas id="c" style="display:none"></canvas>
<script>
window.analyzeFrame = function(b64) {
  var img = new Image();
  img.onload = function() {
    var W = img.naturalWidth, H = img.naturalHeight;
    var c = document.getElementById('c');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var cx = W/2, cy = H/2, r = Math.min(W,H)*0.40;
    var x0 = Math.max(0, Math.floor(cx-r));
    var y0 = Math.max(0, Math.floor(cy-r));
    var rw = Math.min(W - x0, Math.ceil(r*2));
    var rh = Math.min(H - y0, Math.ceil(r*2));
    var iData = ctx.getImageData(x0, y0, rw, rh).data;
    var skin=0, total=0, brightSum=0, brightCount=0, step=5;
    var laplacianSum = 0, lapCount = 0;
    for(var dy=-r; dy<r; dy+=step) {
      for(var dx=-r; dx<r; dx+=step) {
        if(dx*dx+dy*dy > r*r) continue;
        var ix = Math.floor(dx+r), iy = Math.floor(dy+r);
        var i = (iy*rw+ix)*4;
        if(i < 0 || i+2 >= iData.length) continue;
        var R=iData[i], G=iData[i+1], B=iData[i+2];
        var lum = 0.299*R + 0.587*G + 0.114*B;
        brightSum += lum; brightCount++;
        var maxC = Math.max(R,G,B), minC = Math.min(R,G,B), spread = maxC-minC;
        var isSkin = (R>50 && G>25 && B>10 && R>G && R>B && (R-G)>7 && spread>8 && R<252 && !(R>200 && G>200 && B>200));
        if(isSkin) skin++;
        total++;
        if(Math.abs(dx) < r*0.5 && Math.abs(dy) < r*0.5) {
          var right = (iy*rw+Math.min(ix+step,rw-1))*4;
          var down  = (Math.min(iy+step,rh-1)*rw+ix)*4;
          if(right+2 < iData.length && down+2 < iData.length) {
            var lumR = 0.299*iData[right]+0.587*iData[right+1]+0.114*iData[right+2];
            var lumD = 0.299*iData[down]+0.587*iData[down+1]+0.114*iData[down+2];
            laplacianSum += Math.abs(2*lum - lumR - lumD);
            lapCount++;
          }
        }
      }
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({
      skinRatio: total > 0 ? skin/total : 0,
      brightness: brightCount > 0 ? brightSum/brightCount : 0,
      sharpness: lapCount > 0 ? laplacianSum/lapCount : 0
    }));
  };
  img.onerror = function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({skinRatio:0,brightness:0,sharpness:0}));
  };
  img.src = 'data:image/jpeg;base64,' + b64;
};
</script></body></html>`;

type DetectionState = 'idle' | 'too_far' | 'too_close' | 'dim' | 'bright' | 'blurry' | 'ready' | 'capturing';

function getDetectionState(skinRatio: number, brightness: number, sharpness: number): DetectionState {
  if (skinRatio === 0 && brightness === 0) return 'idle';
  if (brightness < BRIGHT_MIN) return 'dim';
  if (brightness > BRIGHT_MAX) return 'bright';
  if (skinRatio < SKIN_MIN) return 'too_far';
  if (skinRatio > SKIN_MAX) return 'too_close';
  if (sharpness < 1.5 && skinRatio > 0.1) return 'blurry';
  if (skinRatio >= SKIN_GOOD) return 'ready';
  return 'too_far';
}

const STATE_CONFIG: Record<DetectionState, { label: string; sub: string; color: string; progress: number }> = {
  idle:      { label: 'Place skin inside the circle',    sub: 'Any part of your body works',       color: '#FFFFFF', progress: 0   },
  too_far:   { label: 'Move closer',                     sub: 'Fill more of the circle with skin', color: '#FACC15', progress: 0.2 },
  too_close: { label: 'Move farther away',               sub: 'Back up a little',                  color: '#F97316', progress: 0.9 },
  dim:       { label: 'Too dark',                        sub: 'Move to a brighter area',           color: '#F97316', progress: 0   },
  bright:    { label: 'Too bright',                      sub: 'Reduce glare or move to shade',     color: '#F97316', progress: 0   },
  blurry:    { label: 'Hold still',                      sub: 'Keep the camera steady',            color: '#FACC15', progress: 0.5 },
  ready:     { label: 'Perfect \u2014 tap the button!',  sub: 'Skin detected',                     color: '#4ADE80', progress: 1   },
  capturing: { label: 'Capturing\u2026',                 sub: '',                                  color: '#4ADE80', progress: 1   },
};

export default function HomeScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [zoomFactor, setZoomFactor] = useState(1);
  const [baseZoomFactor, setBaseZoomFactor] = useState(1);
  const [detState, setDetState] = useState<DetectionState>('idle');
  const [isCapturing, setIsCapturing] = useState(false);

  const analyzerRef = useRef<WebView | null>(null);
  const busyRef = useRef(false);
  const lastPinchAt = useRef(0);
  const isSwitching = useRef(false);
  const pinchRef = useRef(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const MAX_ZOOM = 5;
  const cfg = STATE_CONFIG[detState];
  const skinReady = detState === 'ready';
  const torchEnabled = cameraFacing === 'back' && flashMode === 'on';
  const cameraZoom = Math.max(0, Math.min(1, (Math.max(1, zoomFactor) - 1) / (MAX_ZOOM - 1)));

  // Fade in on mount
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  // Animate ring progress (JS driver — interpolates border color)
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: cfg.progress,
      duration: 400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false, // must be false for color interpolation
    }).start();
  }, [cfg.progress]);

  // Pulse when ready
  useEffect(() => {
    if (skinReady) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.025, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [skinReady]);

  // Frame analysis loop
  useEffect(() => {
    if (!permission?.granted || !cameraRef) return;
    let mounted = true;
    const iv = setInterval(async () => {
      if (!mounted || busyRef.current || isSwitching.current || isCapturing) return;
      if (Date.now() - lastPinchAt.current < 800) return;
      busyRef.current = true;
      try {
        const frame = await cameraRef.takePictureAsync({ quality: 0.08, base64: true, skipProcessing: true });
        if (mounted && frame?.base64 && analyzerRef.current) {
          analyzerRef.current.injectJavaScript(`window.analyzeFrame('${frame.base64}'); true;`);
        }
      } catch { /* ignore */ } finally {
        busyRef.current = false;
      }
    }, 900);
    return () => { mounted = false; clearInterval(iv); };
  }, [permission?.granted, cameraRef, isCapturing]);

  const takePhoto = async () => {
    if (!cameraRef || isCapturing || !skinReady) return;
    setIsCapturing(true);
    setDetState('capturing');
    try {
      const photo = await cameraRef.takePictureAsync({ quality: 0.92 });
      router.push({ pathname: '/symptoms', params: { photoUri: photo.uri } });
    } catch {
      setIsCapturing(false);
      setDetState('idle');
    }
  };

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      router.push({ pathname: '/symptoms', params: { photoUri: result.assets[0].uri } });
    }
  };

  const handleFlip = () => {
    isSwitching.current = true;
    setCameraFacing(p => p === 'back' ? 'front' : 'back');
    setDetState('idle');
    setTimeout(() => { isSwitching.current = false; lastPinchAt.current = Date.now(); }, 600);
  };

  const onPinchEvent = (e: any) => {
    setZoomFactor(Math.max(1, Math.min(MAX_ZOOM, baseZoomFactor * e.nativeEvent.scale)));
  };
  const onPinchState = (e: any) => {
    if (e.nativeEvent.oldState === State.ACTIVE) {
      setBaseZoomFactor(zoomFactor);
      lastPinchAt.current = Date.now();
    }
  };

  const onWebViewMessage = (e: any) => {
    try {
      const { skinRatio, brightness, sharpness } = JSON.parse(e.nativeEvent.data);
      if (!isCapturing) {
        setDetState(getDetectionState(skinRatio ?? 0, brightness ?? 0, sharpness ?? 0));
      }
    } catch { /* ignore */ }
  };

  const ringBorderColor = progressAnim.interpolate({
    inputRange: [0, 0.15, 0.5, 1],
    outputRange: ['rgba(255,255,255,0.25)', '#FACC15', '#FACC15', '#4ADE80'],
  });

  if (!permission) return <View style={s.root} />;

  if (!permission.granted) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <View style={s.permIcon}>
          <MaterialIcons name="camera-alt" size={36} color="#fff" />
        </View>
        <Text style={s.permTitle}>Camera Access Required</Text>
        <Text style={s.permSub}>
          PrivateCare uses your camera to privately analyze your skin condition.
          Nothing leaves your device.
        </Text>
        <Pressable onPress={requestPermission} style={s.permBtn}>
          <Text style={s.permBtnText}>Allow Camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={s.root}>
      <Animated.View style={[s.root, { opacity: fadeAnim }]}>
        <PinchGestureHandler ref={pinchRef} onGestureEvent={onPinchEvent} onHandlerStateChange={onPinchState}>
          <View style={s.root}>
            <CameraView
              style={StyleSheet.absoluteFill}
              ref={setCameraRef}
              facing={cameraFacing}
              zoom={cameraZoom}
              flash={flashMode}
              enableTorch={torchEnabled}
            />



            {/* Animated ring — outer handles scale (native driver), inner handles color (JS driver) */}
            <Animated.View
              pointerEvents="none"
              style={[s.ringWrap, {
                top: CY - CIRCLE_R - 5,
                left: CX - CIRCLE_R - 5,
                width: CIRCLE_D + 10,
                height: CIRCLE_D + 10,
                borderRadius: (CIRCLE_D + 10) / 2,
                transform: [{ scale: pulseAnim }],
              }]}
            >
              <Animated.View style={[s.ring, {
                width: CIRCLE_D + 10,
                height: CIRCLE_D + 10,
                borderRadius: (CIRCLE_D + 10) / 2,
                borderColor: ringBorderColor,
              }]} />
            </Animated.View>

            {/* Subtle inner guide ring */}
            <View pointerEvents="none" style={[s.guideRing, {
              top: CY - CIRCLE_R,
              left: CX - CIRCLE_R,
              width: CIRCLE_D,
              height: CIRCLE_D,
              borderRadius: CIRCLE_R,
            }]} />

            {/* Status label below circle */}
            <View style={[s.statusCard, { top: CY + CIRCLE_R + 24 }]}>
              <Text style={[s.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
              {cfg.sub ? <Text style={s.statusSub}>{cfg.sub}</Text> : null}
            </View>

            {/* Top header */}
            <View style={s.header}>
              <Pressable onPress={() => router.push('/welcome')} style={[s.iconBtn, { width: 88 }]}>
                <MaterialIcons name="arrow-back" size={20} color="#fff" />
              </Pressable>
              <View style={s.headerCenter}>
                <Text style={s.headerTitle}>Skin Scan</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, width: 88, justifyContent: 'flex-end' }}>
                <Pressable
                  onPress={() => setFlashMode(p => p === 'off' ? 'on' : p === 'on' ? 'auto' : 'off')}
                  style={s.iconBtn}
                >
                  <MaterialIcons
                    name={flashMode === 'auto' ? 'flash-auto' : flashMode === 'on' ? 'flash-on' : 'flash-off'}
                    size={19} color="#fff"
                  />
                </Pressable>
                <Pressable onPress={handleFlip} style={s.iconBtn}>
                  <MaterialIcons name="flip-camera-ios" size={21} color="#fff" />
                </Pressable>
              </View>
            </View>

            {/* Bottom shutter + library */}
            <View style={s.bottomBar}>
              <View style={s.zoomPill}>
                <Text style={s.zoomText}>{Math.max(1, zoomFactor).toFixed(1)}&times;</Text>
              </View>
              <View style={s.shutterRow}>
                {/* Library picker (left) */}
                <Pressable onPress={pickFromLibrary} style={s.libraryBtn}>
                  <MaterialIcons name="photo-library" size={26} color="rgba(255,255,255,0.85)" />
                  <Text style={s.libraryLabel}>Library</Text>
                </Pressable>

                {/* Shutter (center) */}
                <Pressable
                  onPress={takePhoto}
                  disabled={!skinReady || isCapturing}
                  style={({ pressed }) => [s.shutterOuter, {
                    borderColor: skinReady || isCapturing ? '#4ADE80' : 'rgba(255,255,255,0.2)',
                    opacity: pressed ? 0.75 : 1,
                  }]}
                >
                  {isCapturing
                    ? <ActivityIndicator color="#4ADE80" size="small" />
                    : <View style={[s.shutterInner, {
                        backgroundColor: skinReady ? '#4ADE80' : 'rgba(255,255,255,0.15)',
                      }]} />
                  }
                </Pressable>

                {/* Spacer to balance layout */}
                <View style={s.libraryBtn} />
              </View>

              <Text style={[s.hintText, { color: skinReady ? '#4ADE80' : 'rgba(255,255,255,0.35)' }]}>
                {isCapturing ? 'Capturing\u2026' : skinReady ? 'Tap to capture' : 'Or pick from library'}
              </Text>
            </View>
          </View>
        </PinchGestureHandler>
      </Animated.View>

      {/* WebView wrapped in 0×0 clip so it never flashes a black/white box */}
      <View style={s.hiddenWVWrap}>
        <WebView
          ref={analyzerRef}
          source={{ html: ANALYZER_HTML }}
          style={s.hiddenWV}
          javaScriptEnabled
          scrollEnabled={false}
          onMessage={onWebViewMessage}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  mask: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)' },
  ringWrap: { position: 'absolute', backgroundColor: 'transparent' },
  ring: { position: 'absolute', borderWidth: 3.5, backgroundColor: 'transparent' },
  guideRing: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'transparent' },
  statusCard: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 32, gap: 5 },
  statusLabel: { fontSize: 18, fontWeight: '700', textAlign: 'center', letterSpacing: -0.3 },
  statusSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '500', textAlign: 'center' },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 58, paddingHorizontal: 20, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  headerSub: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '500', marginTop: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 50, paddingTop: 16, alignItems: 'center', gap: 14 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40, width: '100%', paddingHorizontal: 40 },
  libraryBtn: { width: 60, alignItems: 'center', gap: 4 },
  libraryLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
  zoomPill: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  zoomText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 3.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  shutterInner: { width: 58, height: 58, borderRadius: 29 },
  hintText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  hiddenWVWrap: { position: 'absolute', width: 0, height: 0, overflow: 'hidden' },
  hiddenWV: { width: 1, height: 1 },
  permIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(124,58,237,0.25)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  permTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  permSub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 32 },
  permBtn: { backgroundColor: '#7C3AED', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14 },
  permBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
