import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useRef, useState } from 'react';

const PURPLE = '#7C3AED';
const LAVENDER_BG = '#F3EFFE';
const WHITE = '#FFFFFF';

// Body part → 3D coordinate on the mannequin {x, y, z}
// x: left(-)/right(+), y: up(+)/down(-), z: front(+)/back(-)
const BODY_PART_COORDS: Record<string, { x: number; y: number; z: number }> = {
  face:          { x: 0,    y: 1.55, z: 0.12 },
  head:          { x: 0,    y: 1.65, z: 0 },
  neck:          { x: 0,    y: 1.35, z: 0.08 },
  chest:         { x: 0,    y: 1.05, z: 0.2 },
  stomach:       { x: 0,    y: 0.7,  z: 0.2 },
  back:          { x: 0,    y: 1.0,  z: -0.2 },
  'left arm':    { x: -0.45, y: 1.0, z: 0 },
  'right arm':   { x: 0.45,  y: 1.0, z: 0 },
  'left hand':   { x: -0.55, y: 0.4, z: 0 },
  'right hand':  { x: 0.55,  y: 0.4, z: 0 },
  'left leg':    { x: -0.18, y: -0.4, z: 0 },
  'right leg':   { x: 0.18,  y: -0.4, z: 0 },
  'left foot':   { x: -0.18, y: -1.15, z: 0.1 },
  'right foot':  { x: 0.18,  y: -1.15, z: 0.1 },
  shoulder:      { x: 0.35,  y: 1.25, z: 0 },
  'left shoulder': { x: -0.35, y: 1.25, z: 0 },
  'right shoulder': { x: 0.35, y: 1.25, z: 0 },
  hip:           { x: 0,    y: 0.1,  z: 0.1 },
  knee:          { x: 0.15, y: -0.65, z: 0.12 },
};

function getCoords(bodyPart: string) {
  const key = bodyPart?.toLowerCase().trim();
  for (const [k, v] of Object.entries(BODY_PART_COORDS)) {
    if (key?.includes(k)) return v;
  }
  return { x: 0, y: 0.7, z: 0.2 }; // default: stomach
}

function buildHtml(rashX: number, rashY: number, rashZ: number, condition: string, urgency: string) {
  const dotColor = urgency === 'urgent' ? '#EF4444' : urgency === 'soon' ? '#F59E0B' : '#A78BFA';

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#F3EFFE; overflow:hidden; font-family: -apple-system, sans-serif; }
  canvas { display:block; }
  #ui { position:absolute; bottom:0; left:0; right:0; background:rgba(255,255,255,0.95);
        border-radius:20px 20px 0 0; padding:16px 20px 30px;
        box-shadow: 0 -4px 20px rgba(124,58,237,0.15); }
  #ui h3 { font-size:15px; font-weight:700; color:#4C1D95; margin-bottom:4px; }
  #ui p  { font-size:12px; color:#6B7280; margin-bottom:12px; }
  #slider-label { font-size:13px; color:#7C3AED; font-weight:600; margin-bottom:6px; }
  input[type=range] { width:100%; accent-color:#7C3AED; cursor:pointer; }
  #legend { display:flex; gap:12px; margin-top:10px; flex-wrap:wrap; }
  .legend-item { display:flex; align-items:center; gap:5px; font-size:11px; color:#374151; }
  .legend-dot { width:10px; height:10px; border-radius:50%; }
  #hint { font-size:11px; color:#9CA3AF; text-align:center; margin-top:8px; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="ui">
  <h3>📍 Rash Location — ${condition}</h3>
  <p>Drag to rotate • Pinch to zoom</p>
  <div id="slider-label">Projection: Now</div>
  <input type="range" id="timeline" min="0" max="3" step="1" value="0">
  <div id="legend">
    <div class="legend-item"><div class="legend-dot" style="background:${dotColor}"></div> Current rash</div>
    <div class="legend-item"><div class="legend-dot" style="background:#F97316;opacity:0.6"></div> 1 week spread</div>
    <div class="legend-item"><div class="legend-dot" style="background:#EF4444;opacity:0.4"></div> 1 month spread</div>
    <div class="legend-item"><div class="legend-dot" style="background:#991B1B;opacity:0.25"></div> 2 month spread</div>
  </div>
  <div id="hint">⬆ Drag the mannequin to rotate in 3D</div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
const W = window.innerWidth;
const H = window.innerHeight * 0.62;

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, alpha: true });
renderer.setSize(W, H);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xF3EFFE);

const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
camera.position.set(0, 0.3, 4.5);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(3, 5, 3);
scene.add(dir);
const fill = new THREE.DirectionalLight(0xC4B5FD, 0.3);
fill.position.set(-3, 2, -2);
scene.add(fill);

// ── Build mannequin from primitives ──
const skin = new THREE.MeshLambertMaterial({ color: 0xE8D5C4 });
const skinDark = new THREE.MeshLambertMaterial({ color: 0xD4C0AD });

function capsule(rx, ry, rz, height, mat) {
  const g = new THREE.CapsuleGeometry ? 
    new THREE.CapsuleGeometry(Math.max(rx,rz), height, 8, 16) :
    new THREE.CylinderGeometry(Math.max(rx,rz), Math.max(rx,rz), height, 16);
  return new THREE.Mesh(g, mat);
}

function sphere(r, mat) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), mat);
}

const body = new THREE.Group();

// Torso
const torso = capsule(0.22, 0.22, 0.22, 0.65, skin);
torso.position.set(0, 0.85, 0);
body.add(torso);

// Hips
const hips = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), skin);
hips.scale.set(1.2, 0.7, 0.9);
hips.position.set(0, 0.42, 0);
body.add(hips);

// Head
const head = sphere(0.18, skin);
head.position.set(0, 1.55, 0);
body.add(head);

// Neck
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.18, 12), skin);
neck.position.set(0, 1.33, 0);
body.add(neck);

// Left arm
const lUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.35, 12), skin);
lUpperArm.position.set(-0.35, 1.0, 0);
lUpperArm.rotation.z = 0.15;
body.add(lUpperArm);
const lForeArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 12), skin);
lForeArm.position.set(-0.45, 0.65, 0);
lForeArm.rotation.z = 0.1;
body.add(lForeArm);
const lHand = sphere(0.065, skin);
lHand.position.set(-0.52, 0.45, 0);
body.add(lHand);

// Right arm
const rUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.35, 12), skin);
rUpperArm.position.set(0.35, 1.0, 0);
rUpperArm.rotation.z = -0.15;
body.add(rUpperArm);
const rForeArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 12), skin);
rForeArm.position.set(0.45, 0.65, 0);
rForeArm.rotation.z = -0.1;
body.add(rForeArm);
const rHand = sphere(0.065, skin);
rHand.position.set(0.52, 0.45, 0);
body.add(rHand);

// Left leg
const lThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.45, 12), skin);
lThigh.position.set(-0.15, 0.1, 0);
body.add(lThigh);
const lShin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.42, 12), skin);
lShin.position.set(-0.15, -0.38, 0);
body.add(lShin);
const lFoot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.18), skin);
lFoot.position.set(-0.15, -0.64, 0.05);
body.add(lFoot);

// Right leg
const rThigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.45, 12), skin);
rThigh.position.set(0.15, 0.1, 0);
body.add(rThigh);
const rShin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.42, 12), skin);
rShin.position.set(0.15, -0.38, 0);
body.add(rShin);
const rFoot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.18), skin);
rFoot.position.set(0.15, -0.64, 0.05);
body.add(rFoot);

scene.add(body);

// ── Rash marker ──
const rashPos = new THREE.Vector3(${rashX}, ${rashY}, ${rashZ});

// Pulsing core dot
const rashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('${dotColor}'), transparent: true, opacity: 0.95 });
const rashDot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), rashMat);
rashDot.position.copy(rashPos);
body.add(rashDot);

// Spread rings (4 levels: 0=now, 1=1wk, 2=1mo, 3=2mo)
const ringColors = [0xF97316, 0xEF4444, 0x991B1B];
const ringRadii  = [0.09, 0.16, 0.25];
const ringOpacity = [0.55, 0.35, 0.2];
const rings = [];

ringColors.forEach((color, i) => {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(ringRadii[i] - 0.012, ringRadii[i], 32), mat);
  ring.position.copy(rashPos);
  ring.lookAt(camera.position);
  body.add(ring);
  rings.push({ mesh: ring, baseOpacity: ringOpacity[i], mat });
});

// Labels
const labels = ['Now', '+ 1 Week', '+ 1 Month', '+ 2 Months'];
const slider = document.getElementById('timeline');
const sliderLabel = document.getElementById('slider-label');

function updateProjection(val) {
  sliderLabel.textContent = 'Projection: ' + labels[val];
  rings.forEach((r, i) => {
    r.mat.opacity = val >= i + 1 ? r.baseOpacity : 0;
  });
}
slider.addEventListener('input', (e) => updateProjection(parseInt(e.target.value)));

// ── Orbit controls (touch + mouse) ──
let isDragging = false, lastX = 0, lastY = 0;
let rotX = 0.1, rotY = 0;
let pinchDist0 = 0, scale0 = 1, currentScale = 1;

const canvas = renderer.domElement;

canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
canvas.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('mousemove', e => {
  if (!isDragging) return;
  rotY += (e.clientX - lastX) * 0.012;
  rotX += (e.clientY - lastY) * 0.008;
  rotX = Math.max(-0.6, Math.min(0.6, rotX));
  lastX = e.clientX; lastY = e.clientY;
});

canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    isDragging = true;
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    isDragging = false;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchDist0 = Math.sqrt(dx*dx + dy*dy);
    scale0 = currentScale;
  }
}, { passive: true });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && isDragging) {
    rotY += (e.touches[0].clientX - lastX) * 0.014;
    rotX += (e.touches[0].clientY - lastY) * 0.009;
    rotX = Math.max(-0.6, Math.min(0.6, rotX));
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    currentScale = Math.max(0.5, Math.min(2.0, scale0 * (dist / pinchDist0)));
    camera.position.z = 4.5 / currentScale;
  }
}, { passive: false });

canvas.addEventListener('touchend', () => { isDragging = false; });

// ── Animate ──
let pulse = 0;
function animate() {
  requestAnimationFrame(animate);
  pulse += 0.05;
  rashDot.scale.setScalar(1 + 0.18 * Math.sin(pulse));

  body.rotation.y = rotY;
  body.rotation.x = rotX;

  // Keep rings facing camera
  rings.forEach(r => r.mesh.lookAt(camera.position));

  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>`;
}

export default function BodyMapScreen() {
  const router = useRouter();
  const { bodyPart, condition, urgency } = useLocalSearchParams<{
    bodyPart: string;
    condition: string;
    urgency: string;
  }>();

  const [loading, setLoading] = useState(true);
  const coords = getCoords(bodyPart || 'chest');
  const html = buildHtml(coords.x, coords.y, coords.z, condition || 'Skin condition', urgency || 'monitor');

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>3D Body Map</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Info pill */}
      <View style={styles.infoPill}>
        <Text style={styles.infoPillText}>
          📍 {bodyPart || 'Body'} · {condition || 'Condition'}
        </Text>
      </View>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={PURPLE} />
          <Text style={styles.loadingText}>Building 3D model…</Text>
        </View>
      )}

      <WebView
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        onLoad={() => setLoading(false)}
        allowFileAccess
        mixedContentMode="always"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: LAVENDER_BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: WHITE,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE9FE',
  },
  backBtn: { padding: 4 },
  backText: { color: PURPLE, fontSize: 15, fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1F2937' },
  infoPill: {
    alignSelf: 'center',
    backgroundColor: '#EDE9FE',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginTop: 10,
    marginBottom: 4,
  },
  infoPillText: {
    color: PURPLE,
    fontSize: 13,
    fontWeight: '600',
  },
  webview: {
    flex: 1,
    backgroundColor: LAVENDER_BG,
  },
  loadingOverlay: {
    position: 'absolute',
    top: '35%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
    gap: 10,
  },
  loadingText: {
    color: PURPLE,
    fontSize: 14,
    fontWeight: '600',
  },
});
