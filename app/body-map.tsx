import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';

const PURPLE = '#7C3AED';
const LAVENDER_BG = '#F3EFFE';
const WHITE = '#FFFFFF';

const BODY_PART_3D: Record<string, {x:number,y:number,z:number}> = {
  face:             {x:0,    y:1.58, z:0.18},
  head:             {x:0,    y:1.65, z:0},
  neck:             {x:0,    y:1.32, z:0.12},
  chest:            {x:0,    y:1.05, z:0.23},
  stomach:          {x:0,    y:0.72, z:0.23},
  abdomen:          {x:0,    y:0.65, z:0.23},
  back:             {x:0,    y:1.0,  z:-0.23},
  'lower back':     {x:0,    y:0.72, z:-0.23},
  'upper back':     {x:0,    y:1.1,  z:-0.23},
  'left arm':       {x:-0.55,y:1.0,  z:0},
  'right arm':      {x:0.55, y:1.0,  z:0},
  'left hand':      {x:-0.62,y:0.48, z:0},
  'right hand':     {x:0.62, y:0.48, z:0},
  'left leg':       {x:-0.2, y:0.1,  z:0},
  'right leg':      {x:0.2,  y:0.1,  z:0},
  'left foot':      {x:-0.2, y:-1.05,z:0.14},
  'right foot':     {x:0.2,  y:-1.05,z:0.14},
  'left shoulder':  {x:-0.42,y:1.22, z:0},
  'right shoulder': {x:0.42, y:1.22, z:0},
  shoulder:         {x:0.42, y:1.22, z:0},
  hip:              {x:0,    y:0.42, z:0.18},
  knee:             {x:0.2,  y:-0.38,z:0.12},
  arm:              {x:0.55, y:1.0,  z:0},
  leg:              {x:0.2,  y:0.1,  z:0},
  foot:             {x:0.2,  y:-1.05,z:0.14},
  hand:             {x:0.62, y:0.48, z:0},
};

function getRashCoord(bodyPart: string) {
  const key = (bodyPart || '').toLowerCase().trim();
  for (const [k,v] of Object.entries(BODY_PART_3D)) {
    if (key.includes(k)) return v;
  }
  return {x:0, y:0.72, z:0.23};
}

function buildHtml(rx: number, ry: number, rz: number, condition: string, urgency: string, bodyPart: string): string {
  const dotColor = urgency==='urgent' ? '#EF4444' : urgency==='soon' ? '#F59E0B' : '#A78BFA';
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#F3EFFE;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;height:100vh;overflow:hidden}
#cw{flex:1;display:flex;align-items:center;justify-content:center;position:relative}
canvas{display:block;touch-action:none}
#hint{position:absolute;bottom:8px;left:0;right:0;text-align:center;font-size:11px;color:#9CA3AF;pointer-events:none}
#panel{background:rgba(255,255,255,.97);border-radius:22px 22px 0 0;padding:14px 18px 26px;box-shadow:0 -4px 20px rgba(124,58,237,.15)}
.ptitle{font-size:14px;font-weight:700;color:#4C1D95;margin-bottom:2px}
.psub{font-size:11px;color:#6B7280;margin-bottom:12px}
.srow{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.slbl{font-size:13px;font-weight:700;color:#7C3AED;min-width:105px}
input[type=range]{flex:1;accent-color:#7C3AED}
.leg{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.li{display:flex;align-items:center;gap:5px;font-size:11px;color:#374151}
.ld{width:10px;height:10px;border-radius:50%;flex-shrink:0}
</style>
</head>
<body>
<div id="cw"><canvas id="c"></canvas><div id="hint">⬆ Drag to rotate in 3D</div></div>
<div id="panel">
  <div class="ptitle">📍 ${condition}</div>
  <div class="psub">Location: ${bodyPart||'Body'}</div>
  <div class="srow">
    <span class="slbl" id="slbl">Now</span>
    <input type="range" id="tl" min="0" max="3" step="1" value="0">
  </div>
  <div class="leg">
    <div class="li"><div class="ld" style="background:${dotColor}"></div>Current</div>
    <div class="li"><div class="ld" style="background:#F97316;opacity:.7"></div>+1 Week</div>
    <div class="li"><div class="ld" style="background:#EF4444;opacity:.5"></div>+1 Month</div>
    <div class="li"><div class="ld" style="background:#991B1B;opacity:.35"></div>+2 Months</div>
  </div>
</div>
<script>
// ── 3D Software Renderer ──────────────────────────────────────────
var W,H,cx,cy,SCALE;
var canvas=document.getElementById('c');
var ctx=canvas.getContext('2d');
var rotY=0.3, rotX=0.08;
var dragging=false,lastX=0,lastY=0;
var projection=0;
var pulse=0;

var RASH={x:${rx},y:${ry},z:${rz}};
var DOT_COLOR='${dotColor}';
var RING_COLORS=['#F97316','#EF4444','#991B1B'];
var RING_ALPHA=[0.55,0.38,0.22];
var SPREAD_LABELS=['Now','+1 Week','+1 Month','+2 Months'];

// ── Vec3 helpers ──
function rotY3(v,a){var c=Math.cos(a),s=Math.sin(a);return {x:v.x*c+v.z*s,y:v.y,z:-v.x*s+v.z*c};}
function rotX3(v,a){var c=Math.cos(a),s=Math.sin(a);return {x:v.x,y:v.y*c-v.z*s,z:v.y*s+v.z*c};}
function rotate(v){return rotX3(rotY3(v,rotY),rotX);}
function project(v){
  var fov=2.8, z=v.z+fov;
  return {x:cx+v.x*(SCALE*fov)/z, y:cy-v.y*(SCALE*fov)/z, z:v.z};
}
function pr(v){return project(rotate(v));}

// ── Box primitive: center(cx,cy,cz), half-sizes(hw,hh,hd) ──
function makeBox(ox,oy,oz,hw,hh,hd,baseColor){
  var v=[
    {x:ox-hw,y:oy+hh,z:oz-hd},{x:ox+hw,y:oy+hh,z:oz-hd},
    {x:ox+hw,y:oy-hh,z:oz-hd},{x:ox-hw,y:oy-hh,z:oz-hd},
    {x:ox-hw,y:oy+hh,z:oz+hd},{x:ox+hw,y:oy+hh,z:oz+hd},
    {x:ox+hw,y:oy-hh,z:oz+hd},{x:ox-hw,y:oy-hh,z:oz+hd},
  ];
  return {verts:v,faces:[
    {idx:[4,5,6,7],n:{x:0,y:0,z:1},shade:1.0},   // front
    {idx:[1,0,3,2],n:{x:0,y:0,z:-1},shade:0.55},  // back
    {idx:[0,1,5,4],n:{x:0,y:1,z:0},shade:0.85},   // top
    {idx:[3,7,6,2],n:{x:0,y:-1,z:0},shade:0.45},  // bottom
    {idx:[0,4,7,3],n:{x:-1,y:0,z:0},shade:0.72},  // left
    {idx:[5,1,2,6],n:{x:1,y:0,z:0},shade:0.72},   // right
  ],color:baseColor};
}

// ── Body definition ──
var SKIN='#E8C9A0', SKIN2='#D4B090', SHIRT='#7C3AED', PANTS='#374151';
var parts=[
  // HEAD
  makeBox(0,1.62,0,    0.18,0.20,0.17, SKIN),
  // NECK
  makeBox(0,1.33,0,    0.07,0.10,0.07, SKIN),
  // TORSO (shirt)
  makeBox(0,0.92,0,    0.24,0.32,0.14, SHIRT),
  // HIPS
  makeBox(0,0.52,0,    0.22,0.12,0.13, PANTS),
  // LEFT UPPER ARM
  makeBox(-0.40,1.02,0, 0.08,0.20,0.08, SKIN2),
  // LEFT FOREARM
  makeBox(-0.44,0.65,0, 0.065,0.18,0.065, SKIN),
  // LEFT HAND
  makeBox(-0.46,0.42,0, 0.065,0.075,0.045, SKIN),
  // RIGHT UPPER ARM
  makeBox(0.40,1.02,0,  0.08,0.20,0.08, SKIN2),
  // RIGHT FOREARM
  makeBox(0.44,0.65,0,  0.065,0.18,0.065, SKIN),
  // RIGHT HAND
  makeBox(0.46,0.42,0,  0.065,0.075,0.045, SKIN),
  // LEFT THIGH
  makeBox(-0.16,0.22,0, 0.10,0.22,0.10, PANTS),
  // LEFT SHIN
  makeBox(-0.16,-0.20,0,0.08,0.20,0.08, SKIN),
  // LEFT FOOT
  makeBox(-0.16,-0.50,0.06,0.09,0.055,0.16, SKIN2),
  // RIGHT THIGH
  makeBox(0.16,0.22,0,  0.10,0.22,0.10, PANTS),
  // RIGHT SHIN
  makeBox(0.16,-0.20,0, 0.08,0.20,0.08, SKIN),
  // RIGHT FOOT
  makeBox(0.16,-0.50,0.06,0.09,0.055,0.16, SKIN2),
];

// ── Face rendering ──
function hexToRgb(h){
  var r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);
  return {r:r,g:g,b:b};
}
function shadedColor(hex,shade,alpha){
  var c=hexToRgb(hex);
  var r=Math.round(c.r*shade),g=Math.round(c.g*shade),b=Math.round(c.b*shade);
  if(alpha===undefined) return 'rgb('+r+','+g+','+b+')';
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}

function drawScene(){
  ctx.clearRect(0,0,W,H);
  // Subtle background gradient
  var bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#F3EFFE');bg.addColorStop(1,'#E9E0FF');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

  // Shadow on floor
  var shadowY=cy+SCALE*0.78;
  var grad=ctx.createRadialGradient(cx,shadowY,2,cx,shadowY,SCALE*0.35);
  grad.addColorStop(0,'rgba(124,58,237,0.18)');grad.addColorStop(1,'rgba(124,58,237,0)');
  ctx.beginPath();ctx.ellipse(cx,shadowY,SCALE*0.32,SCALE*0.06,0,0,Math.PI*2);
  ctx.fillStyle=grad;ctx.fill();

  // Collect all faces with depth
  var allFaces=[];
  for(var p=0;p<parts.length;p++){
    var part=parts[p];
    for(var f=0;f<part.faces.length;f++){
      var face=part.faces[f];
      // Backface culling: rotate normal, check z
      var rn=rotate(face.n);
      if(rn.z<0) continue;
      var projected=[];
      var avgZ=0;
      for(var i=0;i<face.idx.length;i++){
        var pv=pr(part.verts[face.idx[i]]);
        projected.push(pv);
        avgZ+=pv.z; // actually use rotated z for depth
      }
      var rotatedCenter=rotate({
        x:(part.verts[face.idx[0]].x+part.verts[face.idx[2]].x)/2,
        y:(part.verts[face.idx[0]].y+part.verts[face.idx[2]].y)/2,
        z:(part.verts[face.idx[0]].z+part.verts[face.idx[2]].z)/2,
      });
      allFaces.push({pts:projected,shade:face.shade,color:part.color,depth:rotatedCenter.z});
    }
  }
  // Painter's algorithm: back to front
  allFaces.sort(function(a,b){return a.depth-b.depth;});

  for(var i=0;i<allFaces.length;i++){
    var af=allFaces[i];
    ctx.beginPath();
    ctx.moveTo(af.pts[0].x,af.pts[0].y);
    for(var j=1;j<af.pts.length;j++) ctx.lineTo(af.pts[j].x,af.pts[j].y);
    ctx.closePath();
    ctx.fillStyle=shadedColor(af.color,af.shade);
    ctx.fill();
    ctx.strokeStyle=shadedColor(af.color,af.shade*0.7);
    ctx.lineWidth=0.6;
    ctx.stroke();
  }

  // Face details
  var headCenter=pr({x:0,y:1.62,z:0});
  var es=SCALE*0.045;
  // Eyes
  ctx.fillStyle='#4A3728';
  ctx.beginPath();ctx.ellipse(headCenter.x-es*1.4,headCenter.y-es*0.5,es,es*1.1,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(headCenter.x+es*1.4,headCenter.y-es*0.5,es,es*1.1,0,0,Math.PI*2);ctx.fill();
  // Pupils
  ctx.fillStyle='#fff';
  ctx.beginPath();ctx.ellipse(headCenter.x-es*1.1,headCenter.y-es*0.8,es*0.4,es*0.4,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(headCenter.x+es*1.7,headCenter.y-es*0.8,es*0.4,es*0.4,0,0,Math.PI*2);ctx.fill();
  // Smile
  ctx.beginPath();
  ctx.arc(headCenter.x,headCenter.y+es*0.8,es*1.2,0.15,Math.PI-0.15);
  ctx.strokeStyle='#A0725A';ctx.lineWidth=es*0.6;ctx.stroke();

  // ── Rash marker ──
  var rp=pr(RASH);
  // Check if rash is visible (front-facing): rotate rash pos and check z
  var rr=rotate(RASH);
  var rashVisible=(rr.z>-0.05);

  if(rashVisible){
    // Spread rings
    for(var ri=2;ri>=0;ri--){
      if(projection>=ri+1){
        var ringR=(22+ri*22)*SCALE/120;
        ctx.beginPath();ctx.arc(rp.x,rp.y,ringR,0,Math.PI*2);
        ctx.fillStyle=RING_COLORS[ri];
        ctx.globalAlpha=RING_ALPHA[ri];
        ctx.fill();
        ctx.globalAlpha=1;
      }
    }
    // Glow
    var gr=(14+4*Math.sin(pulse))*SCALE/120;
    var grd=ctx.createRadialGradient(rp.x,rp.y,0,rp.x,rp.y,gr*2.5);
    grd.addColorStop(0,DOT_COLOR+'BB');grd.addColorStop(1,DOT_COLOR+'00');
    ctx.beginPath();ctx.arc(rp.x,rp.y,gr*2.5,0,Math.PI*2);
    ctx.fillStyle=grd;ctx.fill();
    // Core dot
    var dr=(5+1.5*Math.sin(pulse))*SCALE/120;
    ctx.beginPath();ctx.arc(rp.x,rp.y,dr,0,Math.PI*2);
    ctx.fillStyle=DOT_COLOR;ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=1.2;ctx.stroke();
    // Label
    ctx.fillStyle='#4C1D95';
    ctx.font='bold '+(Math.max(9,Math.round(10*SCALE/120)))+'px -apple-system,sans-serif';
    ctx.textAlign='center';
    ctx.fillText('\\u{1F4CD} Rash',rp.x,rp.y-dr-6);
  }
}

// ── Resize ──
function resize(){
  var cw=document.getElementById('cw');
  W=cw.clientWidth; H=cw.clientHeight;
  canvas.width=W; canvas.height=H;
  cx=W/2; cy=H/2+H*0.04;
  SCALE=Math.min(W,H)*0.72;
  drawScene();
}
window.addEventListener('resize',resize);

// ── Input ──
canvas.addEventListener('touchstart',function(e){dragging=true;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;},{passive:true});
canvas.addEventListener('touchmove',function(e){
  if(!dragging)return;
  rotY+=(e.touches[0].clientX-lastX)*0.016;
  rotX+=(e.touches[0].clientY-lastY)*0.01;
  rotX=Math.max(-0.55,Math.min(0.55,rotX));
  lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;
},{passive:true});
canvas.addEventListener('touchend',function(){dragging=false;});
canvas.addEventListener('mousedown',function(e){dragging=true;lastX=e.clientX;lastY=e.clientY;});
window.addEventListener('mouseup',function(){dragging=false;});
window.addEventListener('mousemove',function(e){
  if(!dragging)return;
  rotY+=(e.clientX-lastX)*0.016;
  rotX+=(e.clientY-lastY)*0.01;
  rotX=Math.max(-0.55,Math.min(0.55,rotX));
  lastX=e.clientX;lastY=e.clientY;
  drawScene();
});

document.getElementById('tl').addEventListener('input',function(e){
  projection=parseInt(e.target.value);
  document.getElementById('slbl').textContent=SPREAD_LABELS[projection];
  drawScene();
});

// ── Animate ──
function animate(){
  requestAnimationFrame(animate);
  pulse+=0.06;
  if(!dragging) rotY+=0.004; // slow auto-spin when idle
  drawScene();
}
resize();
animate();
</script>
</body>
</html>`;
}

export default function BodyMapScreen() {
  const router = useRouter();
  const { bodyPart, condition, urgency } = useLocalSearchParams<{
    bodyPart: string; condition: string; urgency: string;
  }>();
  const coord = getRashCoord(bodyPart || 'chest');
  const html = buildHtml(coord.x, coord.y, coord.z, condition || 'Skin Condition', urgency || 'monitor', bodyPart || 'Body');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>3D Body Map</Text>
        <View style={{ width: 60 }} />
      </View>
      <WebView
        source={{ html }}
        style={{ flex: 1, backgroundColor: LAVENDER_BG }}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        mixedContentMode="always"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: LAVENDER_BG },
  header:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: WHITE, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#EDE9FE',
  },
  backBtn: { padding: 4 },
  backText:{ color: PURPLE, fontSize: 15, fontWeight: '600' },
  title:   { fontSize: 17, fontWeight: '700', color: '#1F2937' },
});
