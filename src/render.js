/* Giganoid 3D renderer (three.js). Simulation stays in original 330x200 pixels. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadModel } from './models.js';
import { BG_TILES, BG_TILE_SCALE } from './bgtiles.js';
import { A, BAT_Y, BRICK, FX, G, SET, SPD, PL, PR, PT, batScale, batGeom, repGeom, crop, play, sprite, DEMON_HEAD_X, DEMON_HEAD_Y, CHOOSE_X, CHOOSE_Y } from './engine.js';

/* ============================================================
   three.js renderer
   Simulation space: original 330x200 pixels. World: 1 unit = 1 pixel,
   x centred on the playfield, y up, z toward the viewer.
   ============================================================ */
const X = px => px - (PL + PR) / 2;   // world x: centred on the playfield (wider for Amegas / Crystal Hammer)
const Y = py => 100 - py;

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = false;   // shadows are drawn as soft blurred shapes instead (see 'soft shadows')
renderer.localClippingEnabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // steadier soft shadows for small objects
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.className = 'gl';
stage.prepend(renderer.domElement);
const cv = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060c);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(36, 16 / 10, 1, 3000);
// the composer's buffer carries a stencil so the capsule's shadow can be drawn on brick faces only
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, stencilBuffer: true, samples: 0 }));   // 4x MSAA: smooth edges
composer.addPass(new RenderPass(scene, camera));
// photo mode: depth of field (only switched on while taking photos)
const bokeh = new BokehPass(scene, camera, { focus: 200, aperture: 0.002, maxblur: 0.012 });
bokeh.enabled = false;
composer.addPass(bokeh);
export const PHOTO = { on: false, focus: 200, aperture: 0, maxblur: 0.012 };
const bloom = new UnrealBloomPass(new THREE.Vector2(800, 500), 0.06, 0.3, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// chromatic aberration: colour fringes that grow toward the edges of the screen, nothing in the middle
const caPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.0035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main(){ vec2 d = vUv - 0.5; float k = dot(d, d) * 4.0; vec2 o = d * amount * k;
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(texture2D(tDiffuse, vUv + o).r, c.g, texture2D(tDiffuse, vUv - o).b, c.a); }`,
});
composer.addPass(caPass);
function applyCA() {
  caPass.enabled = SET.ca !== false;
  const n = SET.aa === false ? 0 : 4;   // 4x MSAA on the scene render (the composer bypasses the canvas's own antialiasing)
  for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples !== n) { t.samples = n; t.dispose(); }
}

// lights
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1426, 0.7));
// key light: shapes the bricks, bat and pipes from above-left, but casts no shadows
const sun = new THREE.DirectionalLight(0xfff4e6, 1.05);
sun.position.set(-80, 130, 300);
scene.add(sun);
// shadow light: straight from the front, so every shadow sits centred behind its object;
// wide blur for soft edges, and enough strength that the shadows read a little darker
// shadow light: centred left-to-right and a little above, so each shadow falls just below its object
// (straight-on light hid every shadow directly behind the object that cast it)
const shadowLight = new THREE.DirectionalLight(0xffffff, 2.5);
shadowLight.position.set(0, 190, 400);   // steeper from above: shadows fall a bit further below each object
shadowLight.castShadow = true;
shadowLight.shadow.mapSize.set(2048, 2048);
Object.assign(shadowLight.shadow.camera, { left: -122, right: 122, top: 108, bottom: -112, near: 100, far: 700 });   // playfield only: more detail per object
shadowLight.shadow.bias = -0.0006;
shadowLight.shadow.normalBias = 0.2;
shadowLight.shadow.radius = 3;
scene.add(shadowLight);
const rim = new THREE.DirectionalLight(0x6f8cff, 0.8);
rim.position.set(160, -60, 120);
scene.add(rim);

const srgb = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
const amigaColor = v => srgb(((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17);

// indexed image -> canvas (for textures and DOM previews)
function indexedToCanvas(img, pal, scale = 1, canvas, ev) {
  const c = canvas || document.createElement('canvas');
  c.width = img.w * scale; c.height = img.h * scale;
  const small = document.createElement('canvas'); small.width = img.w; small.height = img.h;
  const sx = small.getContext('2d'), id = sx.createImageData(img.w, img.h);
  const cur = pal.slice(0, 32); let e = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    if (ev && i % img.w === 0) { const y = i / img.w; while (e < ev.length && ev[e][0] <= y) { cur[ev[e][1]] = ev[e][2]; e++; } }
    const v = img.d[i];
    if (v === 255) { id.data[i * 4 + 3] = 0; continue; }
    const w = cur[v & 31];
    id.data[i * 4] = ((w >> 8) & 15) * 17; id.data[i * 4 + 1] = ((w >> 4) & 15) * 17; id.data[i * 4 + 2] = (w & 15) * 17; id.data[i * 4 + 3] = 255;
  }
  sx.putImageData(id, 0, 0);
  const cx2 = c.getContext('2d'); cx2.imageSmoothingEnabled = false;
  cx2.clearRect(0, 0, c.width, c.height);
  cx2.drawImage(small, 0, 0, c.width, c.height);
  return c;
}

// soft round glow used for the pipe rings and the falling power-ups
const glowDot = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.4, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

/* ---------- static playfield ---------- */
const bgMat = new THREE.MeshStandardMaterial({ color: 0xb6b4c6, roughness: 0.92, metalness: 0 });
// background fills exactly the rectangle framed by the pipes (pipe centres: x 2.5..230.5,
// top y 3, open bottom to y 204). It sits just behind the pipes so perspective cannot open a gap.
const BG = { l: 2.5, r: 230.5, t: 3, b: 300, z: -9 };   // runs well past the bottom of the screen
const bgPlane = new THREE.Mesh(new THREE.PlaneGeometry(BG.r - BG.l, BG.b - BG.t), bgMat);
bgPlane.position.set(X((BG.l + BG.r) / 2), Y((BG.t + BG.b) / 2), BG.z);
bgPlane.receiveShadow = true;
scene.add(bgPlane);
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1400, 900), new THREE.MeshBasicMaterial({ color: 0x07060c, toneMapped: false }));
backdrop.position.z = -24;
scene.add(backdrop);
// light pool: a dark vignette just in front of the background, clear at the centre
const vignette = (() => {
  const c = document.createElement('canvas'); c.width = 456; c.height = 594;   // 2 px per unit, rows 3..300
  const x = c.getContext('2d'), g = x.createRadialGradient(228, -70, 30, 228, -70, 540);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.3, 'rgba(0,0,0,0.03)'); g.addColorStop(0.6, 'rgba(0,0,0,0.3)'); g.addColorStop(0.85, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0.7)');
  x.fillStyle = g; x.fillRect(0, 0, 456, 594);
  const t = new THREE.CanvasTexture(c);
  const VT = 3, VB = BG.b;   // runs as far down as the background, so the falloff never stops abruptly
  const m = new THREE.Mesh(new THREE.PlaneGeometry(BG.r - BG.l, VB - VT), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.position.set(X((BG.l + BG.r) / 2), Y((VT + VB) / 2), BG.z + 0.4); scene.add(m); return m;
})();

const pipeMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd8, metalness: 0.95, roughness: 0.22, envMapIntensity: 1.1 });
const glowMat = new THREE.MeshStandardMaterial({ color: 0x0b1530, emissive: 0x3d7dff, emissiveIntensity: 1.1 });
function pipe(len, horiz) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, len, 28), pipeMat);
  m.castShadow = false; m.receiveShadow = true; g.add(m);
  const n = Math.floor(len / 22);
  for (let i = 0; i <= n; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.55, 8, 28), glowMat);
    ring.visible = false;   // blue rings switched off (fully transparent)
    ring.rotation.x = Math.PI / 2; ring.position.y = -len / 2 + (i + 0.5) * (len / (n + 1));
    g.add(ring);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0x4d86ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(13, 13, 1); halo.position.copy(ring.position); halo.visible = false; g.add(halo);
  }
  if (horiz) g.rotation.z = Math.PI / 2;
  return g;
}
// frame: straight pipes joined by quarter-circle elbows at the two top corners
const BEND = 7, PX_L = 2.5, PY_T = 3, PY_B = 320, PY_GAP = 176;
let PX_R = PR + 3.5;   // right pipe: follows the playfield width
function straight(pxA, pyA, pxB, pyB) {           // pipe between two original-pixel points
  const horiz = pyA === pyB, len = horiz ? Math.abs(pxB - pxA) : Math.abs(pyB - pyA);
  const p = pipe(len, horiz); p.position.set(X((pxA + pxB) / 2), Y((pyA + pyB) / 2), 0); scene.add(p); return p;
}
const wallL = straight(PX_L, PY_T + BEND, PX_L, PY_B);
const wallRTop = straight(PX_R, PY_T + BEND, PX_R, PY_GAP);
const wallRLow = straight(PX_R, PY_GAP, PX_R, PY_B);
const wallT = straight(PX_L + BEND, PY_T, PX_R - BEND, PY_T);
// the break-out door (lower right pipe) has its own materials so it can dissolve away
const doorPipeMat = pipeMat.clone(), doorGlowMat = glowMat.clone(); doorPipeMat.transparent = doorGlowMat.transparent = true;
const doorSprites = [];
wallRLow.traverse(o => { if (o.isMesh) o.material = o.material === pipeMat ? doorPipeMat : doorGlowMat; else if (o.isSprite) { o.material = o.material.clone(); doorSprites.push(o); } });
const doorMirrors = [];
const frameElbows = [];
for (const [px, rot] of [[PX_L + BEND, Math.PI / 2], [PX_R - BEND, 0]]) {
  const elbow = new THREE.Mesh(new THREE.TorusGeometry(BEND, 3.1, 20, 28, Math.PI / 2), pipeMat);
  elbow.position.set(X(px), Y(PY_T + BEND), 0); elbow.rotation.z = rot;
  elbow.castShadow = false; elbow.receiveShadow = true; scene.add(elbow); frameElbows.push(elbow);
}
// "Infinite mirror": tightly nested clones of the real pipe frame (same pipes, bends and rings), drawn
// flat on the background with multiply blending, so they only darken it. Each copy is 1.5% smaller and lighter.
const mirrorGroup = new THREE.Group(); scene.add(mirrorGroup);
(() => {
  const COPIES = 8;
  // multiplier texture: darker toward the tube's sides, lighter along its front, like a shaded pipe
  function mulTex(strength, alongV) {
    const c = document.createElement('canvas'); c.width = alongV ? 1 : 64; c.height = alongV ? 64 : 1;
    const x = c.getContext('2d'), img = x.createImageData(c.width, c.height);
    for (let i = 0; i < 64; i++) {
      const side = (1 - Math.cos(2 * Math.PI * i / 64)) / 2;          // 0 at the front, 1 at the sides
      const v = Math.round(255 * (1 - strength * (0.55 + 0.45 * side)));
      img.data.set([v, v, v, 255], i * 4);
    }
    x.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  }
  const parts = [wallL, wallRTop, wallRLow, wallT, ...frameElbows];
  for (let k = 1; k <= COPIES; k++) {
    const strength = 0.48 * Math.pow(0.8, k - 1);
    const mk = map => new THREE.MeshBasicMaterial({ map, transparent: true, premultipliedAlpha: true, blending: THREE.MultiplyBlending, depthWrite: false, toneMapped: false });
    const cylMat = mk(mulTex(strength, false)), torMat = mk(mulTex(strength, true));
    // the blue rings are lights: their reflections add a faint blue instead of darkening
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2f5fc0, transparent: true, opacity: Math.min(1, strength * 0.22), depthWrite: false, toneMapped: false });   // faint, no glow
    const copy = new THREE.Group();
    for (const part of parts) {
      const c = part.clone(true), drop = [];
      c.traverse(o => {
        if (o.isSprite) drop.push(o);
        else if (o.isMesh) {
          const ring = o.geometry.type === 'TorusGeometry' && o.geometry.parameters.tube < 1;
          o.material = ring ? ringMat : o.geometry.type === 'TorusGeometry' ? torMat : cylMat; o.castShadow = o.receiveShadow = false;
          if (ring) o.renderOrder = 2;
        }
      });
      drop.forEach(o => o.parent.remove(o));
      if (part === wallRLow) doorMirrors.push(c);
      copy.add(c);
    }
    const s = Math.pow(0.985, k);
    copy.scale.set(s, s, 0.04);                  // flattened onto the background
    copy.position.z = BG.z + 0.12 + k * 0.004;
    copy.renderOrder = 1;
    mirrorGroup.add(copy);
  }
})();
const warpLight = new THREE.PointLight(0x66ff99, 0, 70, 2);
warpLight.position.set(X(232), Y(189), 6); scene.add(warpLight);
// wider rounds (Amegas, Crystal Hammer): move the side pipes out, stretch the top pipe, background and fades
const FIELD_W0 = 230.5 - PX_L;
let fieldPR = 227;
function fitField() {
  if (PR === fieldPR) return; fieldPR = PR;
  PX_R = PR + 3.5; FRAME.r = PR - 1;
  const k = (PX_R - PX_L) / FIELD_W0, kTop = (PX_R - PX_L - 2 * BEND) / (FIELD_W0 - 2 * BEND);
  const place = (list) => {
    list[0].position.x = X(PX_L); list[1].position.x = X(PX_R); list[2].position.x = X(PX_R);
    list[3].position.x = X((PX_L + PX_R) / 2); list[3].scale.y = kTop;
    list[4].position.x = X(PX_L + BEND); list[5].position.x = X(PX_R - BEND);
  };
  place([wallL, wallRTop, wallRLow, wallT, ...frameElbows]);
  mirrorGroup.children.forEach(copy => place(copy.children));
  for (const m of [bgPlane, vignette]) { m.scale.x = k; m.position.x = X((PX_L + PX_R) / 2); }
  bottomFade.scale.x = k; bottomFade.position.x = X((PX_L + PX_R) / 2);
  warpLight.position.x = X(PR + 5);
}

// bottom fade: the playfield melts into the dark surroundings below the bat instead of ending in a hard edge.
// It sits in front of the background and the pipes, and matches the page colour exactly.
const bottomFade = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(7,6,12,0)'); g.addColorStop(0.3, 'rgba(7,6,12,0.55)'); g.addColorStop(0.62, 'rgba(7,6,12,0.95)'); g.addColorStop(1, 'rgba(7,6,12,1)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const top = 194, bottom = 330;   // original-pixel rows: fade starts just below the bat
  const m = new THREE.Mesh(new THREE.PlaneGeometry(300, bottom - top), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.position.set(X(116.5), Y((top + bottom) / 2), 4.5); m.renderOrder = 5; scene.add(m); return m;
})();

/* ---------- bricks ---------- */
const brickGeo = new RoundedBoxGeometry(15.4, 5.6, 7, 2, 1.1);
const ghosts = [];
const metalGeo = loadModel('brick', 15.4, 5.6, 7, false, [0, Math.PI / 2, 0]) || new RoundedBoxGeometry(15.4, 5.6, 7, 3, 1.4);   // indestructible bricks: custom Blender model
const brickMat = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.8, envMapIntensity: 1.3 });   // coloured metal: same shine as the indestructible bricks
const metalMat = new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.78, envMapIntensity: 2.0, emissive: 0x3a3e45, emissiveIntensity: 0.1 });
for (const m of [brickMat, metalMat]) { m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.AlwaysStencilFunc; m.stencilZPass = THREE.ReplaceStencilOp; }
const bricks = new THREE.InstancedMesh(brickGeo, brickMat, 420);
const metal = new THREE.InstancedMesh(metalGeo, metalMat, 420);
for (const m of [bricks, metal]) {
  m.castShadow = true; m.receiveShadow = true;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color()); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(m);
}
// Amegas special stones: a dark glyph on the brick's face (1 exit L, 2 survivor ring, 3 spreader X, 4 jumper triangles, 5 killer skull)
function stoneGlyph(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.strokeStyle = x.fillStyle = 'rgba(10,8,16,0.82)'; x.lineWidth = 9; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath();
  if (kind === 1) { x.moveTo(20, 10); x.lineTo(20, 54); x.lineTo(48, 54); x.stroke(); }
  else if (kind === 2) { x.lineWidth = 6; x.arc(32, 32, 20, 0, Math.PI * 2); x.stroke(); }
  else if (kind === 3) { x.moveTo(12, 12); x.lineTo(52, 52); x.moveTo(52, 12); x.lineTo(12, 52); x.stroke(); }
  else if (kind === 4) { x.moveTo(32, 4); x.lineTo(54, 30); x.lineTo(10, 30); x.closePath(); x.moveTo(32, 34); x.lineTo(54, 60); x.lineTo(10, 60); x.closePath(); x.fill(); }
  else if (kind === 5) {
    x.arc(32, 26, 21, 0, Math.PI * 2); x.fill(); x.fillRect(19, 38, 26, 18);
    x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(24, 26, 6, 0, Math.PI * 2); x.arc(40, 26, 6, 0, Math.PI * 2); x.fill();
    x.fillRect(25, 46, 4, 9); x.fillRect(35, 46, 4, 9);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glyphGeo = new THREE.PlaneGeometry(4.6, 4.6);
const glyphs = [null];
for (let k = 1; k <= 5; k++) {
  const m = new THREE.InstancedMesh(glyphGeo, new THREE.MeshBasicMaterial({ map: stoneGlyph(k), transparent: true, depthWrite: false, toneMapped: false }), 420);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.renderOrder = 2; scene.add(m); glyphs.push(m);
}
const SURVIVOR_WHITE = new THREE.Color(2.2, 2.2, 2.2);
let brickColors = [];   // per type, from the brick sprite's dominant colour in the round palette
function brickPaletteFor(pal) {
  brickColors = [null];
  for (let t = 1; t <= 12; t++) {
    const img = A['brick' + t], cnt = new Map();
    for (let y = 0; y < 5; y++) for (let x = 1; x < 15; x++) { const v = img.d[y * img.w + x]; if (v !== 255) cnt.set(v, (cnt.get(v) || 0) + 1); }
    let best = 1, n = -1; for (const [k, c] of cnt) if (c > n) { n = c; best = k; }
    brickColors.push(amigaColor(pal[best & 31]));
  }
  // imported (Arkanoid-style) level packs: bricks 101..108 keep their own colours
  ['#f2f2f2', '#ff8a1c', '#4fd6ff', '#35cf4a', '#e8322a', '#2f5bff', '#ff5bd0', '#ffe23a', '#c9ccd4', '#e0a82a'].forEach((h, i) => (brickColors[101 + i] = new THREE.Color(h)));
  // tame the very bright ones (yellow, pink, pale blue, white...): above a perceived brightness, pull them down
  const srgb = new THREE.Color();
  brickColors.forEach(c => {
    if (!c) return;
    srgb.copy(c).convertLinearToSRGB();
    const lum = 0.2126 * srgb.r + 0.7152 * srgb.g + 0.0722 * srgb.b;
    if (lum > 0.42) { const f = (0.42 + (lum - 0.42) * 0.3) / lum; srgb.multiplyScalar(f); c.copy(srgb).convertSRGBToLinear(); }
  });
}

/* ---------- soft shadows ----------
   Each brick, the bat, every ball and the falling capsule gets a blurred dark shape drawn on the
   background just below it. Darkness comes from Settings (Shadow darkness). */
// Shape of a given core size (96x40 rect or r=40 circle) blurred by `blur`, on a canvas with `m` px margin.
// Returns the texture and the fraction of the canvas the core occupies (to size planes by the object).
function shadowTexture(round, blur, m, inset) {
  const W = 96 + 2 * m, H = round ? W : 40 + 2 * m;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#000'; x.filter = `blur(${blur}px)`; x.beginPath();
  if (round) x.arc(W / 2, H / 2, 40 - inset, 0, Math.PI * 2); else x.roundRect(m + inset, m + inset, 96 - 2 * inset, 40 - 2 * inset, 12);
  x.fill();
  return { tex: new THREE.CanvasTexture(c), fx: (round ? 80 : 96) / W, fy: (round ? 80 : 40) / H };
}
// Two shadows per object: a far, very soft one well below it, and a closer, tighter, darker one right under it.
const FAR_R = shadowTexture(false, 20, 48, 0), FAR_C = shadowTexture(true, 20, 56, 0);
const NEAR_R = shadowTexture(false, 5, 14, 0), NEAR_C = shadowTexture(true, 5, 16, 4);
const smat = t => new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, depthWrite: false, toneMapped: false });
const shadowMat = smat(FAR_R), roundShadowMat = smat(FAR_C), nearShadowMat = smat(NEAR_R), nearRoundMat = smat(NEAR_C);
const SHADOW_Z = BG.z + 0.6, SHADOW_DROP = 6, NEAR_DROP = 2.2;
// plane size per object size: far = wide halo (1.5x / 2.2x the object), near = just larger than the object
const RECT_FX = 1.5 / FAR_R.fx, RECT_FY = 2.2 / FAR_R.fy, NEAR_FX = 1.08 / NEAR_R.fx, NEAR_FY = 1.3 / NEAR_R.fy;
const BALL_FAR = 12 / FAR_C.fx, BALL_NEAR = 6.2 / NEAR_C.fx;
function shadowPair(mat, nmat) {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); f.renderOrder = 3; scene.add(f);
  const n = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nmat); n.renderOrder = 4; scene.add(n);
  return { f, n, set visible(v) { f.visible = n.visible = v; } };
}
const brickShadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), shadowMat, 420);
brickShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage); brickShadows.renderOrder = 3; brickShadows.count = 0; scene.add(brickShadows);
const brickNear = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), nearShadowMat, 420);
brickNear.instanceMatrix.setUsage(THREE.DynamicDrawUsage); brickNear.renderOrder = 4; brickNear.count = 0; scene.add(brickNear);
// the capsule's shadow falls on the bricks just behind it: its own, denser materials so it reads there
const capShadowMat = shadowMat.clone(), capNearMat = nearShadowMat.clone();
for (const m of [capShadowMat, capNearMat]) { m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.EqualStencilFunc; m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp; }
const batShadow = shadowPair(shadowMat, nearShadowMat), capShadow = shadowPair(capShadowMat, capNearMat);
const capShadowBg = shadowPair(shadowMat, nearShadowMat);   // the ordinary one, on the background
const ballShadows = []; for (let i = 0; i < 10; i++) { const s = shadowPair(roundShadowMat, nearRoundMat); s.visible = false; ballShadows.push(s); }
// Where an object at (x, y, z) appears on the shadow plane: follow the camera's line of sight through it
// to the background, then drop. Without this, perspective pulls the deeper shadow toward the screen centre
// and hides it behind its own object (most visibly under the bat and the bottom brick rows).
const _sv = new THREE.Vector3();
function shadowSpot(x, y, z, drop, out, pz = SHADOW_Z) {
  const c = camera.position;
  _sv.set(x - c.x, y - c.y, z - c.z);
  const t = (pz - c.z) / (_sv.z || -1);
  return out.set(c.x + _sv.x * t, c.y + _sv.y * t - drop, pz);
}
// place both shadows of an object of size w x h
function placePair(pair, x, y, z, w, h, extraDrop = 0, pz = SHADOW_Z) {
  shadowSpot(x, y, z, SHADOW_DROP + extraDrop, pair.f.position, pz); pair.f.scale.set(w * RECT_FX, h * RECT_FY, 1);
  shadowSpot(x, y, z, NEAR_DROP + extraDrop * 0.3, pair.n.position, pz); pair.n.scale.set(w * NEAR_FX, h * NEAR_FY, 1);
}
function applyShadowStrength() {
  const a = SET.shadow / 100;
  shadowMat.opacity = roundShadowMat.opacity = a * 0.8;       // far: soft and light
  nearShadowMat.opacity = nearRoundMat.opacity = Math.min(1, a * 0.85);
  capShadowMat.opacity = Math.min(1, a * 1.1); capNearMat.opacity = Math.min(1, a * 1.5);    // near: tighter and a bit darker
}

/* ---------- bat ---------- */
const batGroup = new THREE.Group(); scene.add(batGroup);
const batBodyMat = new THREE.MeshStandardMaterial({ color: 0xd2d5dc, metalness: 0.55, roughness: 0.32, envMapIntensity: 0.75 });   // light grey metal
const batCapMat = new THREE.MeshStandardMaterial({ color: 0xff3b2f, metalness: 0.4, roughness: 0.3, emissive: 0x400800, emissiveIntensity: 1 });
let recoilAt = -1e9, lastShotCount = 0;
// faint bounce light under the bat: brightens the lower curve so it reads as a cylinder, reaches only the bat.
// It stays in the scene and is dimmed to zero when the bat is hidden (no light-count change, no shader rebuild).
const batUnderLight = new THREE.PointLight(0xb4cbff, 0, 22, 1.2);   // low decay: broad, smooth falloff
scene.add(batUnderLight);
const BAT_BODY = batBodyMat.color.clone(), BAT_CAP = batCapMat.color.clone();
const batTipMat = new THREE.MeshStandardMaterial({ color: 0x0a1a40, emissive: 0x3d8bff, emissiveIntensity: 1.6 });
// during Break Out the bat is cut off at the right wall, so it vanishes into the exit as it slides through
const exitClip = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)];
// body shading, painted into the texture so the bat always reads as a cylinder:
// around the circumference (u): brightest on the front face just above centre, darker toward top, bottom and back;
// along the length (v): full brightness in the middle, a little darker toward both ends
const batShade = (() => {
  const W = 128, Hh = 128, c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const x = c.getContext('2d'), img = x.createImageData(W, Hh);
  for (let j = 0; j < Hh; j++) {
    const v = j / (Hh - 1), along = 0.72 + 0.28 * Math.sin(Math.PI * v) ** 0.5;
    for (let i = 0; i < W; i++) {
      // u = 0 faces the camera; u = 0.25 is the top, 0.75 the bottom (after the body is laid on its side)
      const a = 2 * Math.PI * (i / W - 0.04);            // light peak slightly toward the top
      const facing = Math.max(0, Math.cos(a));
      const round = 0.34 + 0.66 * facing ** 0.8;           // soft falloff toward the silhouette
      const sheen = 0.16 * Math.exp(-(((i / W - 0.06 + 1) % 1 - 0) ** 2) / 0.0012) + 0.16 * Math.exp(-((i / W - 0.06) ** 2) / 0.0012);
      const val = Math.min(1, (round + sheen) * along);
      const o = (j * W + i) * 4, g = Math.round(255 * val);
      img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = Math.min(255, g + 6); img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
})();
// soft highlight band, like a fixed overhead light reflected in the chrome; it slides as the bat moves
const batGleam = (() => {
  const c = document.createElement('canvas'); c.width = 1; c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#000'); g.addColorStop(0.28, '#000'); g.addColorStop(0.4, '#6a6a6a'); g.addColorStop(0.5, '#e6e6e6'); g.addColorStop(0.6, '#6a6a6a'); g.addColorStop(0.72, '#000'); g.addColorStop(1, '#000');
  x.fillStyle = g; x.fillRect(0, 0, 1, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; return t;
})();
// laser bat: the same shading with fine diagonal lines wrapped around the body
const batShadeLaser = (() => {
  const src = batShade.image, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0);
  for (let k = -16; k < 32; k++) {                     // dark groove with a bright edge beside it, so it reads as relief
    x.beginPath(); x.moveTo(k * 8, 0); x.lineTo(k * 8 + 128, 128); x.strokeStyle = 'rgba(25,28,38,0.6)'; x.lineWidth = 2.6; x.stroke();
    x.beginPath(); x.moveTo(k * 8 + 2.4, 0); x.lineTo(k * 8 + 130.4, 128); x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1.2; x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
})();
batBodyMat.map = batShade; batBodyMat.emissiveMap = batGleam; batBodyMat.emissive.set(0xffffff); batBodyMat.emissiveIntensity = 0.07;   // highlight kept very faint
const batBody = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 1, 32, 20), batBodyMat);
const batBodyRest = batBody.geometry.attributes.position.array.slice();   // for the E wobble
batBody.rotation.z = Math.PI / 2; batBody.castShadow = true; batGroup.add(batBody);
const caps = [], tips = [], guns = [], domes = [];
const gunMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.7, roughness: 0.35 });   // grey gun metal
for (let i = 0; i < 2; i++) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 4.2, 32), batCapMat);
  c.rotation.z = Math.PI / 2; c.castShadow = true; batGroup.add(c); caps.push(c);
  // rounded end: a flattened half-sphere capping each red end, the little light sits at its tip
  const dm = new THREE.Mesh(new THREE.SphereGeometry(3.9, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), batCapMat);
  dm.rotation.z = i ? -Math.PI / 2 : Math.PI / 2; dm.scale.set(1, 0.55, 1); batGroup.add(dm); domes.push(dm);
  const t = new THREE.Mesh(new THREE.SphereGeometry(2.1, 20, 12), batTipMat); batGroup.add(t); tips.push(t);
  const tg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0x3d8bff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  tg.scale.set(9, 9, 1); t.add(tg); t.userData.glow = tg;
  const g = new THREE.Mesh(new THREE.ConeGeometry(2.0, 3.8, 4).rotateY(Math.PI / 4), gunMat); g.visible = false; batGroup.add(g); guns.push(g);   // tiny pyramid
}
// laser bat (as on the Amiga): red gun rings set in from the ends, with red struts sloping down to the ends
const fins = [0, 1].map(() => { const f = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 2.4), batCapMat); f.visible = false; batGroup.add(f); return f; });
// E power-up novelty shape: a rounded, ridged head on the right, a flat flared base on the left
const toyMat = new THREE.MeshStandardMaterial({ color: 0xe58aa8, roughness: 0.42, metalness: 0.0, transparent: true });
const toyHead = new THREE.Mesh(new THREE.SphereGeometry(3.9, 28, 18), toyMat); toyHead.scale.set(1.35, 1, 1);
const toyRidge = new THREE.Mesh(new THREE.TorusGeometry(3.55, 0.75, 10, 28), toyMat); toyRidge.rotation.y = Math.PI / 2;
const toyBase = new THREE.Mesh(new THREE.SphereGeometry(3.9, 28, 18), toyMat); toyBase.scale.set(1.35, 1, 1);   // second rounded head
const toyRidge2 = new THREE.Mesh(new THREE.TorusGeometry(3.55, 0.75, 10, 28), toyMat); toyRidge2.rotation.y = Math.PI / 2;
const toy = [toyHead, toyRidge, toyBase, toyRidge2]; toy.forEach(m => { m.visible = false; batGroup.add(m); });
const satMat = new THREE.MeshMatcapMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.6, depthWrite: false });   // clear glass; matcap ignores the ball's strong point lights, so the opacity actually shows (matcap set below)
// ball glints on the bat top and the three frame pipes (per ball, first three balls)
const reflPool = [0, 1, 2].map(() => [[3.2, 1.3], [1.3, 3.2], [1.3, 3.2], [3.2, 1.3]].map(([sx, sy]) => {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0xeaf3ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  sp.scale.set(sx * 2, sy * 2, 1); sp.visible = false; sp.renderOrder = 9; scene.add(sp); return sp; }));
const sats = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), satMat); m.visible = false; scene.add(m); return m; });
const fragMat = new THREE.MeshBasicMaterial({ color: 0xffe066, toneMapped: false });   // small neutrino ball
const frags = Array.from({ length: 18 }, () => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), fragMat); m.visible = false;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0xffc23a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  halo.scale.set(9, 9, 1); m.add(halo); scene.add(m); return m;
});
const TOY_BODY = new THREE.Color(0xe58aa8), Z_AXIS = new THREE.Vector3(0, 0, 1);
// R (Replicant): a second bat at the top, identical to the main bat but with blue ends instead of red.
// Built once at the normal-bat (frame 9) layout from the same geometries; only its position tracks the player.
const repGroup = new THREE.Group(); repGroup.visible = false; scene.add(repGroup);
const repBodyMat = new THREE.MeshStandardMaterial({ color: 0xd2d5dc, map: batShade, metalness: 0.55, roughness: 0.32, envMapIntensity: 0.75, transparent: true });
const repCapMat = new THREE.MeshStandardMaterial({ color: 0x2f7bff, metalness: 0.4, roughness: 0.3, emissive: 0x001c48, emissiveIntensity: 1, transparent: true });   // blue caps (vs the main bat's red)
const repTipMat = new THREE.MeshStandardMaterial({ color: 0x0a1a40, emissive: 0x4db0ff, emissiveIntensity: 1.8, transparent: true });
{
  const RL = 22;   // normal bat body length (frame 9: width 31 - 9)
  const rb = new THREE.Mesh(batBody.geometry.clone(), repBodyMat); rb.rotation.z = Math.PI / 2; rb.scale.set(1, RL, 1); repGroup.add(rb);
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    const c = new THREE.Mesh(caps[0].geometry, repCapMat); c.rotation.z = Math.PI / 2; c.position.set(s * (RL / 2 + 2), 0, 0); repGroup.add(c);
    const dm = new THREE.Mesh(domes[0].geometry, repCapMat); dm.rotation.z = i ? -Math.PI / 2 : Math.PI / 2; dm.scale.set(1, 0.55, 1); dm.position.set(s * (RL / 2 + 4.1), 0, 0); repGroup.add(dm);
    const t = new THREE.Mesh(tips[0].geometry, repTipMat); t.position.set(s * (RL / 2 + 4.1 + 3.9 * 0.55 - 0.35), 0, 0); repGroup.add(t);
    const tg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0x4db0ff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })); tg.scale.set(7, 7, 1); t.add(tg);
  }
}
const CAP_WHITE = new THREE.Color(0xf2f2f2), CATCH_BODY = new THREE.Color('#2fbf71'), LASER_BODY = new THREE.Color(0xd8322a);   // C: the C capsule's green; L: red
// brick hit glow: a short additive flash at the brick
const hitGlows = Array.from({ length: 12 }, () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0xfff2d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); sp.visible = false; scene.add(sp); return { sp, at: -1e9 }; });
let hitGlowI = 0;
// E power-up: fine veins running along the bat's body, with a faint pulse
const veinCanvas = document.createElement('canvas'); veinCanvas.width = 128; veinCanvas.height = 512;
const veinTex = new THREE.CanvasTexture(veinCanvas);   // height map: raised veins pressed into the bat's metal
// random branching veins over the whole bat (canvas x = around the tube, y = along it); a new set each time E is taken
function drawVeins() {
  const x = veinCanvas.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 128, 512); x.lineCap = 'round'; x.lineJoin = 'round'; x.filter = 'blur(0.8px)';
  const vein = (px, py, ang, w, len, depth) => {
    const pts = [[px, py]];
    for (let i = 0; i < len; i++) {
      ang += (Math.random() - 0.5) * 0.9;                 // wander
      const step = 3 + Math.random() * 4;
      px += Math.sin(ang) * step * 0.55; py += Math.cos(ang) * step;
      pts.push([px, py]);
      if (depth < 3 && Math.random() < 0.09) vein(px, py, ang + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.9), w * 0.62, (len - i) * 0.5 | 0, depth + 1);
    }
    for (let k = 1; k < pts.length; k++) {                  // taper toward the tip
      const t = 1 - k / pts.length, lw = Math.max(0.5, w * (0.35 + 0.65 * t));
      x.beginPath(); x.moveTo(...pts[k - 1]); x.lineTo(...pts[k]);
      x.lineWidth = lw + 1.6; x.strokeStyle = 'rgba(255,255,255,0.35)'; x.stroke();
      x.lineWidth = lw; x.strokeStyle = '#fff'; x.stroke();
    }
  };
  const n = 10 + (Math.random() * 5 | 0);
  for (let i = 0; i < n; i++) {
    const down = Math.random() < 0.5;
    vein(Math.random() * 128, down ? Math.random() * 120 : 512 - Math.random() * 120, (down ? 0 : Math.PI) + (Math.random() - 0.5) * 0.8, 2.2 + Math.random() * 2, 30 + Math.random() * 50 | 0, 0);
  }
  x.filter = 'none'; veinTex.needsUpdate = true;
}
drawVeins();
let lastSag = 0, veinsWere = false, veinNext = 0, tipBlinkNext = 0, wobbleAt = -1e9, wobbleOn = false;
// every few seconds the veins throb: a quick double beat, like a heartbeat, then rest
function veinPulse(now) {
  if (now > veinNext + 700) veinNext = now + 1800 + Math.random() * 3500;
  const t = now - veinNext; if (t < 0) return 0;
  const beat = u => (u > 0 ? Math.exp(-u / 90) * Math.min(1, u / 25) : 0);
  return 1.3 * (beat(t) + 0.7 * beat(t - 220));
}
const veinMat = new THREE.MeshStandardMaterial({ map: veinTex, transparent: true, alphaTest: 0.05, roughness: 0.5, metalness: 0.1, emissive: 0xff2050, emissiveMap: veinTex, emissiveIntensity: 0.15, depthWrite: false });
const veins = new THREE.Mesh(new THREE.CylinderGeometry(3.36, 3.36, 1, 32, 1, true), veinMat);
veins.rotation.z = Math.PI / 2; veins.visible = false;   // (kept for reference; the veins are now relief on the body itself)
batBodyMat.bumpMap = veinTex; batBodyMat.bumpScale = 0;
// C power-up: a short fading beam from the caught ball showing the direction it will leave in
const beamTex = (() => {
  const c = document.createElement('canvas'); c.width = 16; c.height = 128;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 16, 128);
  const h = x.createLinearGradient(0, 0, 16, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = h; x.fillRect(0, 0, 16, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const aimBeam = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 34), new THREE.MeshBasicMaterial({ map: beamTex, color: 0x66ffaa, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
aimBeam.geometry.translate(0, 17, 0); aimBeam.visible = false; aimBeam.renderOrder = 8; scene.add(aimBeam);
const aimBeams = [aimBeam]; for (let i = 1; i < 10; i++) { const m = aimBeam.clone(); m.material = aimBeam.material.clone(); scene.add(m); aimBeams.push(m); }

/* ---------- balls ---------- */
// N power-up ball: dark orange molten surface with glowing cracks, slowly turning
const lavaTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#7a1e04'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 90; i++) {                 // blotches of hotter rock
    const px = Math.random() * 256, py = Math.random() * 128, r = 6 + Math.random() * 18;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, Math.random() < 0.4 ? 'rgba(255,140,20,0.8)' : 'rgba(200,70,8,0.7)'); g.addColorStop(1, 'rgba(120,30,4,0)');
    x.fillStyle = g; for (const dx of [-256, 0, 256]) { x.save(); x.translate(dx, 0); x.fillRect(px - r, py - r, r * 2, r * 2); x.restore(); }
  }
  x.lineCap = 'round';
  for (let i = 0; i < 26; i++) {                 // bright cracks
    let px = Math.random() * 256, py = Math.random() * 128; x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 6; k++) { px += (Math.random() - 0.5) * 30; py += (Math.random() - 0.5) * 22; x.lineTo(px, py); }
    x.lineWidth = 3; x.strokeStyle = 'rgba(255,120,10,0.55)'; x.stroke();
    x.lineWidth = 1.2; x.strokeStyle = 'rgba(255,220,90,0.95)'; x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
})();
const lavaMat = new THREE.MeshStandardMaterial({ map: lavaTex, emissive: 0xffffff, emissiveMap: lavaTex, emissiveIntensity: 1.1, roughness: 0.6, metalness: 0 });
// N countdown: small number riding under the bat
const nTimerCanvas = document.createElement('canvas'); nTimerCanvas.width = 64; nTimerCanvas.height = 32;
const nTimerTex = new THREE.CanvasTexture(nTimerCanvas); nTimerTex.colorSpace = THREE.SRGBColorSpace;
const nTimer = new THREE.Sprite(new THREE.SpriteMaterial({ map: nTimerTex, transparent: true, depthWrite: false, depthTest: false }));
nTimer.scale.set(12, 6, 1); nTimer.visible = false; nTimer.renderOrder = 9;
let nTimerShown = -1;
function drawNTimer(n, col = '#ff9a2e') {
  const x = nTimerCanvas.getContext('2d'); x.clearRect(0, 0, 64, 32);
  x.font = '700 24px "Space Grotesk", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 5; x.strokeStyle = 'rgba(20,6,0,0.85)'; x.strokeText(String(n), 32, 17);
  x.fillStyle = col; x.fillText(String(n), 32, 17);
  nTimerTex.needsUpdate = true;
}
// R countdown, shown just under the replicant bat (same style as the Laser/Neutrino one, in blue)
const repTimerCanvas = document.createElement('canvas'); repTimerCanvas.width = 64; repTimerCanvas.height = 32;
const repTimerTex = new THREE.CanvasTexture(repTimerCanvas); repTimerTex.colorSpace = THREE.SRGBColorSpace;
const repTimer = new THREE.Sprite(new THREE.SpriteMaterial({ map: repTimerTex, transparent: true, depthWrite: false, depthTest: false }));
repTimer.scale.set(12, 6, 1); repTimer.visible = false; repTimer.renderOrder = 9; scene.add(repTimer);
let repTimerShown = -1;
function drawRepTimer(n) {
  const x = repTimerCanvas.getContext('2d'); x.clearRect(0, 0, 64, 32);
  x.font = '700 24px "Space Grotesk", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 5; x.strokeStyle = 'rgba(0,8,24,0.85)'; x.strokeText(String(n), 32, 17);
  x.fillStyle = '#6cc8ff'; x.fillText(String(n), 32, 17);
  repTimerTex.needsUpdate = true;
}
const tmpS2 = new THREE.Matrix4(), tmpS3 = new THREE.Matrix4();
const ballGeo = loadModel('ball', 6.4, 6.4, 6.4, true) || new THREE.SphereGeometry(2.7, 40, 28);   // custom Blender ball (falls back to a sphere)
// golf-ball dimples: a bump map laid out in rows around the sphere (fewer dimples toward the poles)
const dimpleTex = (() => {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const rows = 16;
  for (let r = 0; r < rows; r++) {
    const lat = ((r + 0.5) / rows - 0.5) * Math.PI, y = (r + 0.5) / rows * H;
    const n = Math.max(3, Math.round(32 * Math.cos(lat))), rad = H / rows * 0.42;
    for (let k = 0; k < n; k++) {
      const px = ((k + (r & 1) * 0.5) / n) * W, rx = Math.min(W / n * 0.42, rad / Math.max(0.25, Math.cos(lat)));
      for (const dx of [-W, 0, W]) {
        const g = x.createRadialGradient(px + dx, y, 0, px + dx, y, rx);
        g.addColorStop(0, '#6a6a6a'); g.addColorStop(0.75, '#c8c8c8'); g.addColorStop(1, '#fff');
        x.fillStyle = g; x.beginPath(); x.ellipse(px + dx, y, rx, rad, 0, 0, Math.PI * 2); x.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
})();
// The ball carries its own strong light, which would burn any lit material to pure white, so it uses a
// matcap: baked sphere shading (soft top-left highlight) that ignores the scene lights; the dimples come from the bump map.
const ballMatcap = (() => {
  // a glossy white ball as seen under a soft key light: bright body, hot specular spot, darker rim, faint bounce light
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  let g = x.createRadialGradient(N * 0.42, N * 0.38, N * 0.05, N * 0.5, N * 0.5, N * 0.5);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#eef0f3'); g.addColorStop(0.82, '#b9bec6'); g.addColorStop(1, '#7c828c');
  x.fillStyle = g; x.fillRect(0, 0, N, N);
  g = x.createRadialGradient(N * 0.36, N * 0.3, 0, N * 0.36, N * 0.3, N * 0.13);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, N, N);
  g = x.createRadialGradient(N * 0.66, N * 0.74, 0, N * 0.66, N * 0.74, N * 0.2);
  g.addColorStop(0, 'rgba(200,220,255,0.35)'); g.addColorStop(1, 'rgba(200,220,255,0)'); x.fillStyle = g; x.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
satMat.matcap = ballMatcap;
const ballMat = new THREE.MeshMatcapMaterial({ matcap: ballMatcap, color: 0xeceef1, bumpMap: dimpleTex, bumpScale: 1.8 });
const trailMat = new THREE.MeshBasicMaterial({ color: 0x9cc6ff, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending });
// Ball light reach (Settings, 100% = the earlier short light). Brightness right next to the ball stays
// the same at every setting; a larger reach only makes it fade more slowly and cut off further out.
let BALL_LIGHT = 900;
function applyBallLight() {
  const k = SET.reach / 100;
  const decay = Math.max(0.6, 2 - 0.6 * (k - 1));
  const intensity = 3.6 * Math.pow(12, decay);   // same illumination 12 units from the ball
  const distance = 90 * k;
  BALL_LIGHT = intensity;
  for (const p of ballPool) if (p.light) { p.light.decay = decay; p.light.distance = distance; }
}
const ballPool = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(ballGeo, ballMat); m.castShadow = true; m.visible = false; scene.add(m);
  // lights stay in the scene all the time and are only dimmed: switching lights on/off changes the light
  // count, which makes three.js recompile every material (the hitch when multiball starts)
  const light = i < 3 ? new THREE.PointLight(0xbcd8ff, 0, 90, 2) : null;
  if (light) scene.add(light);
  // close-range light at the ball's centre: short, strong falloff that grazes the brick bevels and makes them glint
  const glint = i < 3 ? new THREE.PointLight(0xd6e6ff, 0, 38, 2) : null;
  if (glint) scene.add(glint);
  const trail = [];
  for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(ballGeo, trailMat.clone()); s.visible = false; scene.add(s); trail.push(s); }
  ballPool.push({ m, trail, hist: [], light, glint });
}

/* ---------- capsule ---------- */
const LETTERS = 'CESDLPBNMGIR';   // N = Neutrino, M = Multi, R = Replicant (second bat at the top)
const capGroup = new THREE.Group(); capGroup.visible = false; scene.add(capGroup);
let capTex = [], capShown = -1;
const capBodyColor = [];
// Every capsule on the disk uses the same sprite colours: body in colours 22-25, letter in colour 18.
// The optional "by type" set is this remake's own addition for readability.
const CAP_TYPE_COLORS = ['#2fbf71', '#3b82f6', '#f59e0b', '#22c3d6', '#ef4444', '#9aa3b2', '#e85aad', '#8b5cf6', '#eef2ff', '#6b7f2a', '#9be7ff', '#141418'];   // ... I, R (Replicant: black)
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), c = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => c(v).toString(16).padStart(2, '0')).join('');
}
const amigaHex = v => '#' + [(v >> 8) & 15, (v >> 4) & 15, v & 15].map(n => (n * 17).toString(16).padStart(2, '0')).join('');
function buildCapTextures(pal) {
  capTex.forEach(t => t.dispose()); capTex = [];
  for (let i = 0; i < LETTERS.length; i++) {
    const L = LETTERS[i];
    const body = CAP_TYPE_COLORS[i];
    // letter: light on dark bodies, dark on light bodies, with a thin outline of the opposite tone
    const n = parseInt(body.slice(1), 16), lum = (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
    const letter = (lum > 0.5 ? '#14121c' : '#fff6cf');
    const outline = lum > 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
    capBodyColor[i] = body;
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = body; x.fillRect(0, 0, 256, 64);
    x.fillStyle = letter; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = SET.classic ? '500 42px "Chakra Petch", sans-serif' : '700 50px "Chakra Petch", "Arial Black", sans-serif';
    x.lineJoin = 'round';
    for (const u of [64, 192]) {
      x.save(); x.translate(u, 34); x.rotate(Math.PI / 2);
      x.lineWidth = SET.classic ? 5 : 9; x.strokeStyle = outline; x.strokeText(L, 0, 0);          // outline
      if (!SET.classic) { x.lineWidth = 3; x.strokeStyle = letter; x.strokeText(L, 0, 0); }      // thicken the letter
      x.fillText(L, 0, 0); x.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; capTex.push(t);
  }
  capShown = -1;
}
function refreshCapsules() { if (G.pal) buildCapTextures(G.pal); }
buildCapTextures(Array(32).fill(0x0af));
const capBodyMat = new THREE.MeshStandardMaterial({ map: capTex[0], metalness: 0.35, roughness: 0.3, emissive: 0xffffff, emissiveMap: capTex[0], emissiveIntensity: 0 });
const capBody = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 9, 32, 1, true), capBodyMat);
capBody.rotation.z = Math.PI / 2; capBody.castShadow = true;
const capSpin = new THREE.Group(); capSpin.add(capBody); capGroup.add(capSpin);
const capEndMat = new THREE.MeshStandardMaterial({ color: 0x6fa4ff, metalness: 0.35, roughness: 0.3 });   // same surface as the body
const capGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
capGlow.scale.set(34, 24, 1); capGlow.position.z = -0.5; capGlow.renderOrder = 2; capGroup.add(capGlow);
for (const s of [-1, 1]) {
  const e = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), capEndMat);
  e.rotation.z = -s * Math.PI / 2; e.position.x = s * 4.5; capSpin.add(e);
}

applyBallLight();

/* ---------- lasers, boss, boss shots ---------- */
const laserMat = new THREE.MeshStandardMaterial({ color: 0x331000, emissive: 0xff8a3d, emissiveIntensity: 2.2 });
const laserPool = [];
const softDot = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.35, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
// motion-blur streak: bright at the bolt, fading out behind it
const streakTex = (() => {
  const c = document.createElement('canvas'); c.width = 8; c.height = 64;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(0.35, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 8, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
for (let i = 0; i < 12; i++) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 6, 4, 8), laserMat); m.visible = false; scene.add(m); laserPool.push(m);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot, color: 0xff9448, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(11, 20, 1); m.add(glow);
  // motion trail: a bright narrow core plus a wide soft haze behind the bolt
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 26), new THREE.MeshBasicMaterial({ map: streakTex, color: 0xffa060, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  streak.position.set(0, -14.5, 0);
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(7, 30), new THREE.MeshBasicMaterial({ map: streakTex, color: 0xff7a30, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  haze.position.set(0, 2, -0.1); streak.add(haze);
  m.add(streak); m.userData.streak = streak;
}
/* ---------- floating sparkles: tiny motes drifting slowly over the level, fading in and out,
   with the odd one catching the light and glittering for a moment ---------- */
const DUST_N = 170;
const DUST_L = 10, DUST_R = 223, DUST_T = 10, DUST_B = 196;   // the level's inner area, in original pixels
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_N * 3), dustCol = new Float32Array(DUST_N * 3);
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3).setUsage(THREE.DynamicDrawUsage));
dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3).setUsage(THREE.DynamicDrawUsage));
const moteDot = (() => {   // small crisp dot: solid centre, one soft pixel of edge
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const x = c.getContext('2d'), g = x.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 16, 16);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: moteDot, size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
dust.frustumCulled = false; dust.renderOrder = 6; scene.add(dust);
const motes = [];
function newMote(m, anyAge) {
  m.x = X(DUST_L + Math.random() * (DUST_R - DUST_L)); m.y = Y(DUST_T + Math.random() * (DUST_B - DUST_T)); m.z = 3.8 + Math.random() * 2.5;   // just in front of the bricks, inside the level
  const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 3;       // world units (≈ original pixels) per second: slow drift
  m.vx = Math.cos(a) * v; m.vy = Math.sin(a) * v * 0.7 + 0.8; m.vz = (Math.random() - 0.5) * 0.6;
  m.life = 2.5 + Math.random() * 4; m.age = anyAge ? Math.random() * m.life : 0;
  m.peak = 0.3 + Math.random() * 0.35; m.phase = Math.random() * 6.28;
  m.tw = 0; m.nextTw = 0.5 + Math.random() * 5; m.ex = 0; m.ey = 0; m.spin = Math.random() < 0.5 ? -1 : 1;
  m.hue = Math.random();
  return m;
}
for (let i = 0; i < DUST_N; i++) motes.push(newMote({}, true));
let dustLast = 0;
// glow halo around a sparkle, shown only while it is at full glitter
const glowGeo = new THREE.BufferGeometry(), glowCol = new Float32Array(DUST_N * 3);
glowGeo.setAttribute('position', dustGeo.attributes.position);
glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3).setUsage(THREE.DynamicDrawUsage));
const dustGlow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ map: softDot, size: 18, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
dustGlow.frustumCulled = false; dustGlow.renderOrder = 6; scene.add(dustGlow);
const _balls = [];
function stepDust(now) {
  const dt = dustLast ? Math.min(0.1, (now - dustLast) / 1000) : 0; dustLast = now;
  dust.visible = dustGlow.visible = SET.dust !== false && !!G.grid && G.mode !== 'load' && G.mode !== 'title';
  if (!dust.visible) return;
  const run = G.paused ? 0 : dt;
  // balls stir the motes they pass: pushed along with the ball and swirled around it
  _balls.length = 0;
  if (G.mode === 'play' || G.mode === 'demons' || G.mode === 'dchoose') for (const b of G.balls) {
    if (b.dead || b.ox === undefined) continue;
    _balls.push({ x: X(b.x + 2.5), y: Y(b.y + 2.5), vx: (b.x - b.ox) * 50, vy: -(b.y - b.oy) * 50 });
  }
  const R = 26;
  for (let i = 0; i < DUST_N; i++) {
    const m = motes[i];
    m.age += run;
    if (m.age >= m.life) newMote(m, false);
    if (!m.spin) m.spin = Math.random() < 0.5 ? -1 : 1;
    if (!Number.isFinite(m.ex + m.ey + m.x + m.y)) newMote(m, true);   // safety: never let a mote go NaN (it would vanish)
    for (const b of _balls) {
      const dx = m.x - b.x, dy = m.y - b.y, d = Math.hypot(dx, dy);
      if (d >= R || d < 0.01) continue;
      const f = (1 - d / R) ** 2, sp = Math.hypot(b.vx, b.vy);
      // gentle push along with the ball, mostly a swirl around its path
      m.ex += (b.vx * 0.3 + (-dy / d) * sp * 0.9 * m.spin + (Math.random() - 0.5) * sp * 0.8) * f * run * 9;
      m.ey += (b.vy * 0.3 + (dx / d) * sp * 0.9 * m.spin + (Math.random() - 0.5) * sp * 0.8) * f * run * 9;
    }
    // the stirred motion wobbles and settles back over a second or two
    const damp = Math.max(0, 1 - run * 1.2);
    m.ex *= damp; m.ey *= damp;
    { const e = Math.hypot(m.ex, m.ey); if (e > 75) { m.ex *= 75 / e; m.ey *= 75 / e; } }   // capped: they whirl, never shoot off
    const wob = Math.hypot(m.ex, m.ey) * 1.6;   // turbulence: the faster a mote was stirred, the more it wobbles
    m.x += (m.vx + m.ex + Math.sin(now * 0.0007 + m.phase) * 2.2 + (Math.sin(now * 0.011 + m.phase * 3) + 0.6 * Math.sin(now * 0.029 + m.phase * 7)) * wob) * run;
    m.y += (m.vy + m.ey + Math.cos(now * 0.0006 + m.phase * 1.3) * 1.6 + (Math.cos(now * 0.013 + m.phase * 2) + 0.6 * Math.cos(now * 0.031 + m.phase * 5)) * wob) * run;
    // contained: a mote that drifts or is flung out of the level is replaced inside it
    if (m.x < X(DUST_L) || m.x > X(DUST_R) || m.y > Y(DUST_T) || m.y < Y(DUST_B)) newMote(m, false);
    m.z += m.vz * run;
    // fade in and out of existence over its life
    const k = m.age / m.life, fade = Math.sin(Math.PI * k) ** 2;
    // glitter: a short bright flash every now and then
    m.nextTw -= run;
    if (m.nextTw <= 0) { m.tw = 1; m.nextTw = 2 + Math.random() * 6; }   // now and then a mote reaches full brightness
    m.tw = Math.max(0, m.tw - run * 2.6);
    const stir = Math.min(1.6, Math.hypot(m.ex, m.ey) / 22);   // stirred motes flare up so they stand out even in the ball's light   // motes swept up by a ball light up as they whirl
    const b = fade * (m.peak + 3.2 * m.tw * m.tw + stir) * (0.75 + 0.25 * Math.sin(now * 0.002 + m.phase));
    dustPos[i * 3] = m.x; dustPos[i * 3 + 1] = m.y; dustPos[i * 3 + 2] = m.z;
    // pale white, a touch of blue or gold
    const cr = m.hue > 0.7 ? 1 : 0.82, cb = m.hue < 0.5 ? 1 : 0.75;
    dustCol[i * 3] = b * cr; dustCol[i * 3 + 1] = b * 0.9; dustCol[i * 3 + 2] = b * cb;
    const g = fade * Math.pow(m.tw, 3) * 0.55;
    glowCol[i * 3] = g * cr; glowCol[i * 3 + 1] = g * 0.92; glowCol[i * 3 + 2] = g * cb;
  }
  dustGeo.attributes.position.needsUpdate = true; dustGeo.attributes.color.needsUpdate = true; glowGeo.attributes.color.needsUpdate = true;
}
const shotMat = new THREE.MeshBasicMaterial({ color: 0xffdf66, toneMapped: false });   // molten core, stays bright through tone mapping so it blooms
const shotPool = [];
for (let i = 0; i < 12; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 10), shotMat); m.visible = false; scene.add(m);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0xff5a1e, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  halo.scale.set(16, 16, 1); m.add(halo);
  m.visible = false; scene.add(m); shotPool.push(m);
}
// small fire tails behind the boss fireballs (like the Neutrino comet): a pool of additive embers
const fireTrailPool = [];
for (let i = 0; i < 60; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); sp.visible = false; scene.add(sp); fireTrailPool.push(sp); }
const fireTrail = [];   // { x, y, born, life }
const fireHot = new THREE.Color(0xffe07a), fireMid = new THREE.Color(0xff7a1e);
const bossMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, toneMapped: false });   // unlit: keeps the Gatekeeper's true pixel colours (lighting + bloom were bleaching it white)
const bossMesh = new THREE.Mesh(new THREE.PlaneGeometry(112, 101), bossMat);
bossMesh.visible = false; bossMesh.castShadow = true; scene.add(bossMesh);
// demons bonus stage: four flat demon heads (3 mouth frames) and the "choose level" board
const demonMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, color: 0xcfcfcf }));   // unlit: keeps the original pixel colours
const demonHeads = DEMON_HEAD_X.map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(64, 40), demonMats[0]); m.visible = false; m.renderOrder = 5; scene.add(m); return m; });
const demonShadows = DEMON_HEAD_X.map(() => { const p = shadowPair(shadowMat, nearShadowMat); p.visible = false; return p; });
const chooseMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, color: 0xdddddd });
const choosePlane = new THREE.Mesh(new THREE.PlaneGeometry(208, 56), chooseMat); choosePlane.visible = false; scene.add(choosePlane);
const chooseHi = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
chooseHi.visible = false; scene.add(chooseHi);
let demonTexFor = -1;
function buildDemonTextures() {
  demonTexFor = G.roundId;
  const tex = img => { const t = new THREE.CanvasTexture(indexedToCanvas(img, G.pal, 4)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  demonMats.forEach((m, f) => { if (m.map) m.map.dispose(); m.map = tex(A.god[f]); m.needsUpdate = true; });
  if (chooseMat.map) chooseMat.map.dispose();
  chooseMat.map = tex(A.choose); chooseMat.needsUpdate = true;
}

/* ---------- debris particles ---------- */
const PMAX = 500;
// destruction sparkles: crisp dots in the brick's own colour, fully opaque at first, then fading out (no glow)
const sparkDot = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.beginPath(); x.arc(16, 16, 13, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const partAlpha = new THREE.InstancedBufferAttribute(new Float32Array(PMAX).fill(1), 1); partAlpha.setUsage(THREE.DynamicDrawUsage);
const partMat = new THREE.MeshBasicMaterial({ map: sparkDot, transparent: true, depthWrite: false });
partMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAlpha; varying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\n#include <opaque_fragment>');
};
const partGeo = new THREE.PlaneGeometry(1, 1);   // sized per frame in screen pixels (see the particle loop)
partGeo.setAttribute('aAlpha', partAlpha);
const partMesh = new THREE.InstancedMesh(partGeo, partMat, PMAX);
partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
partMesh.setColorAt(0, new THREE.Color()); partMesh.count = 0; partMesh.castShadow = false; partMesh.frustumCulled = false;   // instances move every frame; a stale bounding sphere hid them
scene.add(partMesh);
const parts = [];
const partCol = new THREE.Color();
// breaking bricks light up their surroundings for a moment in the brick's colour (a small fixed pool, so no shader recompiles)
const breakLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffffff, 0, 60, 2); l.userData.t0 = -1e9; scene.add(l); return l; });
let breakLightNext = 0;
function flashLight(x, y, color) {
  const l = breakLights[breakLightNext++ % breakLights.length];
  l.color.copy(color); l.position.set(x, y, 8); l.userData.t0 = clockNow;
}
function burst(x, y, color, n, speed = 1, dir = null) {
  // every burst differs: particle count, spread and force vary, and a few fast strays shoot off
  n = Math.round(n * (0.7 + Math.random() * 0.6));
  const spread = 0.6 + Math.random() * 0.8, force = speed * (1.25 + Math.random() * 0.6);
  const base = dir ? Math.atan2(dir[1], dir[0]) : 0;
  for (let i = 0; i < n && parts.length < PMAX; i++) {
    let vx, vy;
    if (dir) {   // sprays on in the direction the ball was travelling (away from it)
      const ang = base + (Math.random() + Math.random() - 1) * spread, v = (0.5 + Math.random() * 1.7) * force;
      vx = Math.cos(ang) * v; vy = Math.sin(ang) * v + 0.35;
    } else { vx = (Math.random() - 0.5) * 2.4 * force; vy = (Math.random() * 1.6 + 0.4) * force; }
    let vz = Math.random() * 2.2 * force;
    if (Math.random() < 0.1) { const k = 1.8 + Math.random(); vx *= k; vy *= k; vz *= 0.5; }   // stray
    parts.push({ x, y, z: 3.8 + Math.random() * 2.5, vx, vy, vz, rx: Math.random() * 6, ry: Math.random() * 6, life: 0, max: 0, c: color.clone() });
    const q = parts[parts.length - 1]; q.life = q.max = 24 + Math.random() * 26;
  }
}
// containment: particles live a little in front of the brick plane, so a world clamp lets
// perspective push them past the frame on screen. We clamp in screen space instead: project
// each one, keep it inside the frame's screen rectangle, then unproject at its own depth.
const _pc = new THREE.Vector3();
const FRAME = { l: PL + 1, r: PR - 1, t: PT + 1, b: 198 };   // r follows the field width (fitField)   // inner metal-frame edges (b: just below the bat, where the frame fades)
function stepParticles() {
  // frame rectangle in NDC, measured on the brick plane (z = 0)
  _pc.set(X(FRAME.l), Y(FRAME.t), 0).project(camera); const nL = _pc.x, nT = _pc.y;
  _pc.set(X(FRAME.r), Y(FRAME.b), 0).project(camera); const nR = _pc.x, nB = _pc.y;
  for (const p of parts) {
    p.x += p.vx; p.y += p.vy; p.z += p.vz; p.vy -= 0.12; p.vz -= 0.03; p.rx += 0.2; p.ry += 0.15; p.life--;
    _pc.set(p.x, p.y, p.z).project(camera);
    let hx = 0, hy = 0;
    if (_pc.x < nL) { _pc.x = nL; hx = 1; } else if (_pc.x > nR) { _pc.x = nR; hx = 1; }
    if (_pc.y > nT) { _pc.y = nT; hy = 1; } else if (_pc.y < nB) { _pc.y = nB; hy = 1; }   // NDC y: up is +
    if (hx || hy) {
      _pc.unproject(camera); p.x = _pc.x; p.y = _pc.y;   // back to world at the same depth
      if (hx) p.vx *= -0.45; if (hy) { p.vy *= -0.45; p.vx *= 0.7; }
    }
  }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0 || parts[i].z < -20) parts.splice(i, 1);
}

/* ---------- camera ---------- */
export const VIEW = { mode: 'flat' };
let fallSpin = 1;
let doorOpenAt = -1, doorAlpha = 1;
const implodeFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0xbfd8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
implodeFlash.visible = false; scene.add(implodeFlash);
// the bat's materials stay transparent-capable (switching would recompile shaders); opacity 1 normally
for (const m of [batBodyMat, batCapMat, batTipMat]) m.transparent = true;
let batFadeNow = 1;
function setBatFade(f) {
  if (f === batFadeNow) return; batFadeNow = f;
  for (const m of [batBodyMat, batCapMat, batTipMat]) { m.opacity = f; m.depthWrite = f > 0.99; }
}
// dissolve motes: small glowing specks used by the bat implosion and the break-out door
const DIS_N = 260;
const disGeo = new THREE.BufferGeometry();
const disPos = new Float32Array(DIS_N * 3), disCol = new Float32Array(DIS_N * 3);
disGeo.setAttribute('position', new THREE.BufferAttribute(disPos, 3).setUsage(THREE.DynamicDrawUsage));
disGeo.setAttribute('color', new THREE.BufferAttribute(disCol, 3).setUsage(THREE.DynamicDrawUsage));
const disMotes = [];
let disPoints = null, disLast = 0;
function addMote(m) { if (disMotes.length < DIS_N) disMotes.push(Object.assign({ age: 0, vz: 0, tx: null }, m)); }
// implosion: specks come off the shrinking bat and are pulled into its centre
function implodeBat(x, y, w) {
  for (let k = 0; k < 6; k++) {
    const blue = Math.random() < 0.3, ox = (Math.random() - 0.5) * w, oy = (Math.random() - 0.5) * 7;
    addMote({ x: x + ox * 1.15, y: y + oy * 1.3, z: 1 + (Math.random() - 0.5) * 4, vx: -oy * 1.5, vy: ox * 0.35, tx: x, ty: y,
      life: 0.35 + Math.random() * 0.3, r: blue ? 0.45 : 0.9, g: blue ? 0.7 : 0.9, b: 1 });
  }
}
// break-out door: the pipe section breaks up into specks that drift away outward
function dissolveDoor(x, y0, y1) {
  for (let k = 0; k < 8; k++) {
    const blue = Math.random() < 0.3;
    addMote({ x: x + (Math.random() - 0.5) * 6, y: y0 + Math.random() * (y1 - y0), z: (Math.random() - 0.5) * 6,
      vx: 3 + Math.random() * 10, vy: (Math.random() - 0.3) * 8, vz: (Math.random() - 0.5) * 6,
      life: 0.6 + Math.random() * 0.8, r: blue ? 0.45 : 0.85, g: blue ? 0.7 : 0.88, b: 1 });
  }
}
// while the B exit is open: a steady shimmer of green glowing specks around the opening
function exitShimmer(x, y0, y1) {
  for (let k = 0; k < 3; k++) {
    const y = y0 + Math.random() * (y1 - y0);
    addMote({ x: x + (Math.random() - 0.5) * 7, y, z: (Math.random() - 0.5) * 7,
      vx: (Math.random() - 0.35) * 9, vy: (Math.random() - 0.5) * 7, vz: (Math.random() - 0.5) * 5,
      life: 0.4 + Math.random() * 0.5, r: 0.35 + Math.random() * 0.2, g: 1, b: 0.55 });
  }
}
function stepDissolve(now) {
  if (!disPoints) {
    disPoints = new THREE.Points(disGeo, new THREE.PointsMaterial({ map: softDot, size: 4.5, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    disPoints.frustumCulled = false; disPoints.renderOrder = 7; scene.add(disPoints);
  }
  const dt = disLast ? Math.min(0.1, (now - disLast) / 1000) : 0; disLast = now;
  const run = G.paused ? 0 : dt;
  for (let i = disMotes.length - 1; i >= 0; i--) {
    const m = disMotes[i]; m.age += run;
    if (m.age >= m.life) { disMotes.splice(i, 1); continue; }
    if (m.tx !== null) { m.vx += (m.tx - m.x) * 60 * run; m.vy += (m.ty - m.y) * 60 * run; m.vx *= 1 - run * 6; m.vy *= 1 - run * 6; }
    else { m.vx *= 1 - run * 1.5; m.vy *= 1 - run * 0.8; }
    m.x += m.vx * run; m.y += m.vy * run; m.z += m.vz * run;
  }
  for (let i = 0; i < DIS_N; i++) {
    const m = disMotes[i];
    if (!m) { disCol[i * 3] = disCol[i * 3 + 1] = disCol[i * 3 + 2] = 0; continue; }
    const k = m.age / m.life, a = (1 - k) * (1 - k) * 0.8;
    disPos[i * 3] = m.x; disPos[i * 3 + 1] = m.y; disPos[i * 3 + 2] = m.z;
    disCol[i * 3] = m.r * a; disCol[i * 3 + 1] = m.g * a; disCol[i * 3 + 2] = m.b * a;
  }
  disPoints.visible = disMotes.length > 0;
  disGeo.attributes.position.needsUpdate = true; disGeo.attributes.color.needsUpdate = true;
}
// flames for the N ball: bright yellow specks shed behind the ball, turning orange and red as they die
const FIRE_N = 1800;
const fireGeo = new THREE.BufferGeometry();
const firePos = new Float32Array(FIRE_N * 3), fireCol = new Float32Array(FIRE_N * 3);
fireGeo.setAttribute('position', new THREE.BufferAttribute(firePos, 3).setUsage(THREE.DynamicDrawUsage));
fireGeo.setAttribute('color', new THREE.BufferAttribute(fireCol, 3).setUsage(THREE.DynamicDrawUsage));
const flames = [];
let firePoints = null, fireLast = 0, flameLast = 0;
function addFlame(x, y, bvx, bvy) {
  if (flames.length >= FIRE_N) return;
  const sp = Math.hypot(bvx, bvy) || 1;
  const spark = Math.random() < 0.18;   // some are flung out as sparks; the rest hang back as the comet's tail
  const a = Math.atan2(-bvy, -bvx) + (Math.random() - 0.5) * (spark ? 2.2 : 0.9), v = spark ? 40 + Math.random() * 60 : 6 + Math.random() * 16;
  flames.push({ x: x + (Math.random() - 0.5) * 4, y: y + (Math.random() - 0.5) * 4, z: 1.5 + (Math.random() - 0.5) * 3,
    vx: Math.cos(a) * v, vy: Math.sin(a) * v + 4, age: 0, life: spark ? 0.25 + Math.random() * 0.3 : 0.22 + Math.random() * 0.25, spark });
}
function stepFire(now) {
  if (!firePoints) {
    firePoints = new THREE.Points(fireGeo, new THREE.PointsMaterial({ map: softDot, size: 9, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    firePoints.frustumCulled = false; firePoints.renderOrder = 7; scene.add(firePoints);
  }
  const dt = flameLast ? Math.min(0.1, (now - flameLast) / 1000) : 0; flameLast = now;
  const run = G.paused ? 0 : dt;
  for (let i = flames.length - 1; i >= 0; i--) {
    const f = flames[i]; f.age += run;
    if (f.age >= f.life) { flames.splice(i, 1); continue; }
    const drag = f.spark ? 1.2 : 2.2; f.vx *= 1 - run * drag; f.vy = f.vy * (1 - run * drag) + 16 * run;   // slows down and licks upward
    f.x += f.vx * run; f.y += f.vy * run;
  }
  for (let i = 0; i < FIRE_N; i++) {
    const f = flames[i];
    if (!f) { fireCol[i * 3] = fireCol[i * 3 + 1] = fireCol[i * 3 + 2] = 0; continue; }
    const k = f.age / f.life, a = (1 - k) * (f.spark ? 0.6 : 0.3) * (k < 0.08 ? k / 0.08 : 1);
    firePos[i * 3] = f.x; firePos[i * 3 + 1] = f.y; firePos[i * 3 + 2] = f.z;
    // yellow-white -> orange -> deep red
    fireCol[i * 3] = a; fireCol[i * 3 + 1] = a * Math.max(0.08, 0.72 - k * 1.2); fireCol[i * 3 + 2] = a * Math.max(0, 0.22 - k * 1.2);
  }
  firePoints.visible = flames.length > 0;
  fireGeo.attributes.position.needsUpdate = true; fireGeo.attributes.color.needsUpdate = true;
}
let shake = 0, camBias = 0, camTarget = 0, camVel = 0, camLastT = 0;
// critically damped spring: eases in, trails the target by roughly CAM_LAG seconds, never overshoots
const CAM_LAG = 0.35;
function smoothDamp(cur, target, dt, st = camH) {
  const omega = 2 / CAM_LAG, x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, temp = (st.v + omega * change) * dt;
  st.v = (st.v - omega * temp) * e;
  return target + (change + temp) * e;
}
// vertical follow: tilted view drifts up/down with the balls' average height, same smooth delay
const camH = { v: 0 }, camV = { v: 0 };
let camBiasY = 0, camTargetY = 0, topHold = 0, topTime = 0, lowTime = 0, topLastT = 0;
function fitCamera() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
function applyFov() { camera.fov = SET.fov; camera.updateProjectionMatrix(); }
function placeCamera(t) {
  if (PHOTO.on) { camLastT = t; return; }   // the photo-mode controls own the camera
  const dt = camLastT ? Math.min(0.1, (t - camLastT) / 1000) : 0; camLastT = t;
  if (dt > 0) { camBias = smoothDamp(camBias, camTarget, dt, camH); camBiasY = smoothDamp(camBiasY, camTargetY, dt, camV); }
  const vy = 0;   // tilted view: horizontal swing only, no vertical tilt
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const needH = 118, needW = (PX_R - PX_L) / 2 + 18;   // 132 for the standard field
  const dist = Math.max(needH / Math.tan(half), needW / (Math.tan(half) * camera.aspect)) * 1.02;
  const tilt = 0;   // camera straight in front, as in flat view
  const idle = G.mode === 'title' || G.mode === 'load';
  // tilted view: the camera swings a little toward the bat's side, so that side comes closer
  const orbit = idle ? Math.sin(t * 0.00025) * 0.35 : (VIEW.mode === 'tilted' ? (camBias / 115) * 0.15 * (SET.fov / 42) : 0);
  const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
  camera.position.set(Math.sin(orbit) * dist * 0.5 + sx, -Math.sin(tilt) * dist + sy - 6 + vy * 0.13, Math.cos(tilt) * dist);
  camera.lookAt(sx * 0.5 + (VIEW.mode === 'tilted' && !idle ? camBias * 0.018 : 0), -8 + vy * 0.06, 0);
}
new ResizeObserver(fitCamera).observe(stage);

function applyGlow() { bloom.strength = 0.6 * SET.glow / 100; bloom.enabled = SET.glow > 0; }
// world units per CSS pixel at the bat's depth, so pointer-lock movement matches the 2D version
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();
function unitsPerPx() {
  const w = cv.getBoundingClientRect().width || 1;
  _p0.set(X(20), Y(BAT_Y + 3), 0).project(camera); _p1.set(X(200), Y(BAT_Y + 3), 0).project(camera);
  const px = Math.abs(_p1.x - _p0.x) / 2 * w;
  return px > 1 ? 180 / px : 0.5;
}

/* ---------- background upscaling ---------- */
// Scale2x (EPX): doubles pixel art while rounding diagonal edges instead of blurring them
function scale2x(src, w, h) {
  const dst = new Uint32Array(w * h * 4), W2 = w * 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const P = src[y * w + x];
    const A = src[Math.max(0, y - 1) * w + x], D = src[Math.min(h - 1, y + 1) * w + x];
    const C = src[y * w + Math.max(0, x - 1)], B = src[y * w + Math.min(w - 1, x + 1)];
    const o = (y * 2) * W2 + x * 2;
    dst[o] = (C === A && C !== D && A !== B) ? A : P;
    dst[o + 1] = (A === B && A !== C && B !== D) ? B : P;
    dst[o + W2] = (D === C && D !== B && C !== A) ? C : P;
    dst[o + W2 + 1] = (B === D && B !== A && D !== C) ? D : P;
  }
  return dst;
}
// 240x200 background -> 960x800: two Scale2x passes, then a very light grain for surface detail
function upscaleBackground(full) {
  const w = 240, h = 200;
  const px = new Uint32Array(full.getContext('2d').getImageData(0, 0, w, h).data.buffer.slice(0));
  // some backgrounds leave the top (or bottom) rows of the playfield empty: fill them by mirroring the
  // pattern next to the gap, so the texture reaches the pipes on every level
  const blank = y => { const r = y * w, c0 = px[r + 6]; if ((c0 & 0xffffff) > 0x101010) return false; for (let x = 6; x < 228; x++) if (px[r + x] !== c0) return false; return true; };
  let top = 0; while (top < 60 && blank(top)) top++;
  if (top > 0 && top < 60) for (let y = top - 1; y >= 0; y--) { const src = Math.min(h - 1, 2 * top - 1 - y); px.copyWithin(y * w, src * w, src * w + w); }
  let bot = h - 1; while (bot > h - 60 && blank(bot)) bot--;
  if (bot < h - 1 && bot > h - 60) for (let y = bot + 1; y < h; y++) { const src = Math.max(0, 2 * bot + 1 - y); px.copyWithin(y * w, src * w, src * w + w); }
  // side edges: mirror the pattern into the margins beyond the playfield, so the parallax drift never shows the dark panel
  for (let y = 0; y < h; y++) { const r = y * w; for (let x = 228; x < w; x++) px[r + x] = px[r + Math.max(6, 455 - x)]; for (let x = 0; x < 6; x++) px[r + x] = px[r + 11 - x]; }
  const up = scale2x(scale2x(px, w, h), w * 2, h * 2);
  const c = document.createElement('canvas'); c.width = w * 4; c.height = h * 4;
  const x = c.getContext('2d'), img = x.createImageData(c.width, c.height);
  new Uint32Array(img.data.buffer).set(up);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(img, 0, 0);
  return c;
}
// relief map: softened brightness, so lighter shapes read as raised under the lights
function reliefFrom(src) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.filter = 'grayscale(1) blur(1.5px)'; x.drawImage(src, 0, 0); x.filter = 'none';
  return c;
}

/* ---------- shader warm-up ---------- */
let warmedUp = false;
function warmUp() {
  if (warmedUp) return; warmedUp = true;
  // Compile every shader the game can ever need up front, so no effect causes a hitch the first time it
  // appears (lava ball, flames, hit glows, dissolve specks, aim beams, the E shape...): make everything
  // visible for one compile pass, including the materials that are only swapped in later.
  try { stepDissolve(performance.now()); stepFire(performance.now()); } catch (e) {}   // creates their point clouds now
  const hidden = [];
  scene.traverse(o => { if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; } });   // lights untouched: changing their count would recompile everything again
  const swaps = [];
  if (ballPool[0]) { swaps.push([ballPool[0].m, ballPool[0].m.material]); ballPool[0].m.material = lavaMat; }
  try { renderer.compile(scene, camera); } catch (e) {}
  for (const [m, mat] of swaps) m.material = mat;
  try { renderer.compile(scene, camera); } catch (e) {}
  hidden.forEach(o => (o.visible = false));
}
/* ---------- per-round setup ---------- */
let builtRound = -1, bgBaseX = 0, bgDriftK = 1;
// custom seamless background tiles (one per round), decoded once up front
const bgTileImg = {};
for (const k in BG_TILES) { const im = new Image(); im.src = BG_TILES[k].src; bgTileImg[k] = im; }
function setBgTextures(canvas, rx, ry, ox, oy, wrapT) {
  if (bgMat.map) bgMat.map.dispose();
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = wrapT;
  tex.repeat.set(rx, ry); tex.offset.set(ox, oy);
  bgBaseX = tex.offset.x; bgMat.map = tex;
  if (bgMat.bumpMap) bgMat.bumpMap.dispose();
  const bump = new THREE.CanvasTexture(reliefFrom(canvas));
  bump.wrapS = THREE.RepeatWrapping; bump.wrapT = wrapT; bump.repeat.copy(tex.repeat); bump.offset.copy(tex.offset);
  bgMat.bumpMap = bump; bgMat.bumpScale = 2.2; bgMat.needsUpdate = true;
}
function applyBackground() {
  const special = G.mode === 'inter' || G.mode === 'dchoose' || G.mode === 'demons' || G.mode === 'dresult';
  const n = ((Math.max(1, G.round | 0) - 1) % 50) + 1, t = BG_TILES[n], im = bgTileImg[n];
  if (SET.customBg !== false && !special && t && im) {
    if (!im.complete) { const id = G.roundId; im.onload = () => { if (builtRound === id) applyBackground(); }; }
    else {
      // tile it at its true size: one tile spans (w/4 x h/4) original pixels, repeating seamlessly in both directions
      const c = document.createElement('canvas'); c.width = t.w; c.height = t.h; c.getContext('2d').drawImage(im, 0, 0);
      const tw = t.w / BG_TILE_SCALE, th = t.h / BG_TILE_SCALE;
      bgDriftK = 240 / tw;
      setBgTextures(c, (BG.r - BG.l) / tw, (BG.b - BG.t) / th, 0, 0, THREE.RepeatWrapping);
      return;
    }
  }
  // fallback: the round's tiled background from the disk, playfield part only
  bgDriftK = 1;
  const crop = upscaleBackground(indexedToCanvas(G.bg, G.pal, 1));
  // map the plane onto original pixels: u = px / 240, v = (200 - py) / 200
  setBgTextures(crop, (BG.r - BG.l) / 240, (BG.b - BG.t) / 200, BG.l / 240, (200 - BG.b) / 200, THREE.MirroredRepeatWrapping);
}
function setupRoundVisuals() {
  ghosts.length = 0;
  builtRound = G.roundId;
  sweepStart = clockNow;
  queueMicrotask(warmUp);
  const pal = G.pal;
  brickPaletteFor(pal);
  buildCapTextures(pal);
  capShown = -1;
  applyBackground();
  if (G.boss) {
    if (bossMat.map) bossMat.map.dispose();
    const bt = new THREE.CanvasTexture(indexedToCanvas(G.boss.img, pal, 4)); bt.colorSpace = THREE.SRGBColorSpace;
    bossMat.map = bt; bossMat.needsUpdate = true;
  }
  sun.color.set(G.bossNo ? 0xffd7d0 : 0xfff4e6);
}

/* ---------- effects hooks called by the engine ---------- */
Object.assign(FX, {
  brickHit(c, r) {
    const [bx, by] = BRICK(c, r), g = hitGlows[hitGlowI++ % hitGlows.length];
    g.at = clockNow; g.sp.position.set(X(bx + (G.bw || 16) / 2), Y(by + 3), 5); g.sp.visible = true;
  },
  broken(c, r, t) {
    const [bx, by] = BRICK(c, r);
    // which way the ball was going (game y points down, so flip it) and how fast
    const d = G._hitDir || [0, -1], spd = (SET.speed / 95) * (G.speed === 0 ? 0.75 : 1);
    ghosts.push({ bx, by, t, f: G.frame, dir: [d[0], -d[1]], spd });   // flashes white for a moment, then bursts (see the brick loop)
    shake = Math.max(shake, 1.2);
  },
  bossHit() { shake = Math.max(shake, 3); if (G.boss) burst(X(G.boss.x + 56), Y(G.boss.y + 70), new THREE.Color(0xff6680), 20, 1.4); },
  lost() { fallSpin = Math.random() < 0.5 ? -1 : 1; shake = 0.8; },
  batHit() { wobbleAt = clockNow; },   // the bat just drops away (no explosion)
  power() {},
});

/* ---------- frame render ---------- */
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(1, 1, 1), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();
const WHITE_HOT = new THREE.Color(1.8, 1.8, 1.8);
// round-start shine: a light band sweeps across the bricks from top-left to bottom-right
const WHITE_1 = new THREE.Color(1, 1, 1), sweepCol = new THREE.Color();
const SWEEP_MS = 650, SWEEP_DELAY = 120;
let sweepStart = -1e9;
// idle shimmer: every 9-16 s during play, a slow, faint band drifts across the bricks
const SHIMMER_MS = 2600;
let shimmerStart = -1e9, shimmerNext = 0;
let clockNow = performance.now();   // the render clock (photo mode slows or freezes it), used for every effect start time
function renderFrame(alpha, now) {
  fitField();
  clockNow = now;
  if (G.shake > 0) shake = Math.max(shake, 7);   // TILT: a momentary hard screen shake
  if (G.grid && builtRound !== G.roundId) setupRoundVisuals();
  const playing = G.grid && G.mode !== 'load' && G.mode !== 'title';
  // bricks
  const sp = (now - sweepStart - SWEEP_DELAY) / SWEEP_MS;
  let sweep = sp >= 0 && sp <= 1 ? -0.2 + 1.4 * sp : -2;   // band centre along the diagonal
  let sweepAmt = 1, sweepW = 0.07;
  if (sweep < -1 && G.mode === 'play' && !G.paused) {
    if (!shimmerNext) shimmerNext = now + 9000 + Math.random() * 7000;
    if (now >= shimmerNext) { shimmerStart = now; shimmerNext = now + SHIMMER_MS + 9000 + Math.random() * 7000; }
    const hp = (now - shimmerStart) / SHIMMER_MS;
    if (hp >= 0 && hp <= 1) { sweep = -0.25 + 1.5 * hp; sweepAmt = 0.28; sweepW = 0.12; }
  }
  let nb = 0, nm = 0, ns = 0; const ng = [0, 0, 0, 0, 0, 0];
  const survOn = ((G.frame >> 5) & 1) === 1;
  const BH = (G.bw || 16) / 2, BXS = (G.bw || 16) / 16;   // brick half-width and x scale (Amegas rounds use narrower bricks)
  if (G.grid) for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const cell = G.grid[r][c]; if (!cell || cell.hidden) continue;
    let [bx, by] = BRICK(c, r); bx += cell.mx || 0;   // roaming bricks slide between cells
    if (cell.kick) {   // knocked back by a hit, then springs home with a small overshoot (~0.3 s)
      const t = (G.frame - cell.kick.f + alpha) / 50;
      const n = cell.kick.n || 1, tau = 0.04 + 0.015 * n;   // settles quickly   // harder hits travel further and settle slower
      if (t > tau * 7) cell.kick = null;
      else { const k = Math.exp(-t / tau) * Math.cos(t * 2 * Math.PI * 2.6); bx += cell.kick.x * k; by += cell.kick.y * k; }
    }
    const isMetal = cell.gold;   // custom model + metal geometry only for the unbreakable (gold) bricks
    const pulse = cell.flash ? 1 + cell.flash * 0.03 : 1;
    tmpS.set(pulse * BXS, pulse, pulse);
    tmpM.compose(tmpP.set(X(bx + BH), Y(by + 3), 0), tmpQ.identity(), tmpS);
    const mesh = isMetal ? metal : bricks, i = isMetal ? nm++ : nb++;
    mesh.setMatrixAt(i, tmpM);
    let col = cell.flash ? WHITE_HOT : (brickColors[cell.t] || WHITE_HOT);
    if (cell.ame === 2 && survOn) col = SURVIVOR_WHITE;   // survivor stone: breakable while it flashes white
    if (cell.ame && glyphs[cell.ame]) { tmpM.compose(tmpP.set(X(bx + BH), Y(by + 3), 3.62 * pulse), tmpQ.identity(), tmpS.set(pulse * Math.min(1, BXS * 1.3), pulse, pulse)); glyphs[cell.ame].setMatrixAt(ng[cell.ame]++, tmpM); }
    if (sweep > -1) {
      // diagonal position of this brick, 0 at top-left .. 1 at bottom-right
      const d = ((bx - 6) / 221 + ((by - 12) / 126) * 0.6) / 1.6;
      const k = sweepAmt * Math.exp(-(((d - sweep) / sweepW) ** 2));
      if (k > 0.01) col = sweepCol.copy(col).lerp(WHITE_1, k * 0.65).multiplyScalar(1 + k * 0.9);
    }
    mesh.setColorAt(i, col);
    tmpM.compose(shadowSpot(X(bx + BH), Y(by + 3), 0, SHADOW_DROP, tmpP), tmpQ.identity(), tmpS.set(15.4 * BXS * RECT_FX, 5.6 * RECT_FY, 1));
    brickShadows.setMatrixAt(ns, tmpM);
    tmpM.compose(shadowSpot(X(bx + BH), Y(by + 3), 0, NEAR_DROP, tmpP), tmpQ.identity(), tmpS.set(15.4 * BXS * NEAR_FX, 5.6 * NEAR_FY, 1));
    brickNear.setMatrixAt(ns++, tmpM);
  }
  // just-broken bricks: a quick white flash, then they turn into particles
  for (let gi = ghosts.length - 1; gi >= 0; gi--) {
    const gh = ghosts[gi], age = G.frame - gh.f + alpha;
    if (age >= 3 || nb >= 420) { flashLight(X(gh.bx + BH), Y(gh.by + 3), brickColors[gh.t] || WHITE_HOT); burst(X(gh.bx + BH), Y(gh.by + 3), brickColors[gh.t] || new THREE.Color(0xffffff), 22, gh.spd || 1, gh.dir); ghosts.splice(gi, 1); continue; }
    const pulse = 1 + (6 - age * 2) * 0.03;
    tmpM.compose(tmpP.set(X(gh.bx + BH), Y(gh.by + 3), 0), tmpQ.identity(), tmpS.set(pulse * BXS, pulse, pulse));
    bricks.setMatrixAt(nb, tmpM); bricks.setColorAt(nb++, WHITE_HOT);
  }
  for (let k = 1; k <= 5; k++) { glyphs[k].count = ng[k]; glyphs[k].instanceMatrix.needsUpdate = true; }
  bricks.count = nb; metal.count = nm; brickShadows.count = ns; brickShadows.instanceMatrix.needsUpdate = true; brickNear.count = ns; brickNear.instanceMatrix.needsUpdate = true;
  for (const m of [bricks, metal]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

  // bat
  const showBat = playing && G.mode !== 'over' && G.mode !== 'win';
  batGroup.visible = showBat; batShadow.visible = showBat; nTimer.visible = false;
  batUnderLight.intensity = 0;
  if (showBat) {
    const e = A.bat[G.batF].ext;
    const bx = (G.obx ?? G.batX) + ((G.batX - (G.obx ?? G.batX)) * alpha);
    const k2 = batScale(), mid = bx + (e.l + e.r) / 2;
    const l = mid - (mid - bx - e.l) * k2, r = mid + (bx + e.r - mid) * k2, w = r - l + 1;   // XXXL doubles the width
    let grow = 1;
    if (G.mode === 'intro') grow = Math.min(1, G.t / 28);
    // ball lost: the bat implodes into its centre while dissolving into specks (~0.3 s), ending in a small flash
    const dead = G.mode === 'dead', ft = dead ? G.t + alpha : 0;
    const imp = dead ? Math.min(1, ft / 14) : 0, ie = imp * imp;
    const batFade = dead ? Math.max(0, 1 - Math.max(0, ft - 5) / 9) : 1;
    batGroup.position.set(X((l + r) / 2), Y(BAT_Y + e.top + 3.5), 1);
    batGroup.rotation.z = 0;
    setBatFade(batFade);
    if (dead && batFade > 0 && !G.paused) implodeBat(batGroup.position.x, batGroup.position.y, w * (1 - ie));
    implodeFlash.visible = dead && ft > 8 && ft < 30;
    if (implodeFlash.visible) {
      const fa = Math.max(0, 1 - Math.abs(ft - 14) / (ft < 14 ? 6 : 16));
      implodeFlash.position.set(batGroup.position.x, batGroup.position.y, 2);
      implodeFlash.material.opacity = 0.75 * fa; const fs = 6 + 16 * fa; implodeFlash.scale.set(fs, fs, 1);
    }
    if (batFade <= 0) { batGroup.visible = false; batShadow.visible = false; }
    batUnderLight.position.set(batGroup.position.x, batGroup.position.y - 13, 3); batUnderLight.intensity = 9 * grow;
    batGroup.scale.set(grow * (1 - 0.97 * ie), grow * (1 - 0.7 * ie), grow * (1 - 0.7 * ie));
    placePair(batShadow, batGroup.position.x, batGroup.position.y, 1, (w + 1) * grow, 6.6 * grow);
    batShadow.f.scale.multiplyScalar(Math.max(0.01, batFade)); batShadow.n.scale.multiplyScalar(Math.max(0.01, batFade));
    const laser = G.batF === 0 || G.laser;
    const bodyLen = Math.max(2, w - 9);
    batBody.scale.set(1, bodyLen, 1);
    const expanded = G.batTarget === 18 && !laser && G.batF > 9;
    const toyOn = expanded && G.toyBat;   // E is a plain wide bat; the novelty shape only shows while E is held
    veins.visible = false;
    toy.forEach(m => { m.visible = true; if (!toyOn) m.scale.setScalar(1e-4); else if (m.scale.y < 0.5) m.scale.set(m === toyHead || m === toyBase ? 1.35 : 1, 1, 1); });   // always drawn (no shader compile hitch), shrunk away unless E is held
    if (toyOn) {
      const hx = bodyLen / 2;
      toyHead.position.set(hx + 2.2, 0, 0); toyRidge.position.set(hx + 0.2, 0, 0); toyBase.position.set(-hx - 2.2, 0, 0); toyRidge2.position.set(-hx - 0.2, 0, 0);
    }
    veinsWere = toyOn;
    // E: veins raised in the bat's own metal; now and then they swell with a heartbeat
    batBodyMat.bumpScale = toyOn ? 0.7 + 1.1 * veinPulse(now) : 0;
    // E: struck by the ball, the body twangs like a plucked string - middle bows, ends stay put - and settles in ~0.3 s
    {
      const wt = (now - wobbleAt) / 1000, active = toyOn && wt < 0.45;
      // curved bat option: the body arches (ends sag), matching the physics' tilted surface
      const sag = SET.curved && !SET.classic && !toyOn ? Math.min(2.6, bodyLen * 0.075) : 0;
      if (active || wobbleOn || sag !== lastSag) {
        const pos = batBody.geometry.attributes.position, arr = pos.array;
        const amp = active ? 1.1 * Math.exp(-wt / 0.11) * Math.cos(2 * Math.PI * 11 * wt) : 0;
        for (let v = 0; v < arr.length; v += 3) {
          const along = batBodyRest[v + 1] + 0.5;          // 0..1 along the bat
          arr[v] = batBodyRest[v] + amp * Math.sin(Math.PI * along) / 1 - sag * (2 * along - 1) ** 2;
        }
        pos.needsUpdate = true; wobbleOn = active; lastSag = sag; pos.array === arr && batBody.geometry.computeVertexNormals();
        // the ends follow the string's slope: middle down -> heads tip up, and the other way round
        const tilt = Math.atan(amp * Math.PI / Math.max(4, bodyLen)) * 1.6, hx = bodyLen / 2;
        toyHead.rotation.z = -tilt; toyRidge.rotation.set(0, Math.PI / 2, 0); toyRidge.rotateOnWorldAxis(Z_AXIS, -tilt);
        toyBase.rotation.z = tilt; toyRidge2.rotation.set(0, Math.PI / 2, 0); toyRidge2.rotateOnWorldAxis(Z_AXIS, tilt);
        toyHead.position.set(hx + 2.2 * Math.cos(tilt), -2.2 * Math.sin(tilt), 0); toyBase.position.set(-hx - 2.2 * Math.cos(tilt), -2.2 * Math.sin(tilt), 0);
        veins.position.x = 0;
      }
    }
    if (G.shots.length > lastShotCount) recoilAt = now;
    lastShotCount = G.shots.length;
    const kick = Math.max(0, 1 - (now - recoilAt) / 110);
    // curved bat: the end pieces follow the arch - lowered by the sag and tipped to the body's end slope
    const sagE = lastSag, endTilt = Math.atan(4 * sagE / Math.max(4, bodyLen));
    const endPos = (s, d) => [s * (bodyLen / 2 + d * Math.cos(endTilt)), -sagE - d * Math.sin(endTilt)];
    caps.forEach((c, i) => { const s = i ? 1 : -1, [px, py] = endPos(s, 2); c.position.set(px, py, 0); c.rotation.z = Math.PI / 2 - s * endTilt; c.scale.set(1, 1, 1); });
    fins.forEach(f => (f.visible = false));
    domes.forEach((d, i) => { const s = i ? 1 : -1, [px, py] = endPos(s, 4.1); d.position.set(px, py, 0); d.rotation.z = (i ? -Math.PI / 2 : Math.PI / 2) - s * endTilt; d.visible = !toyOn; });
    tips.forEach((t, i) => { const s = i ? 1 : -1, [px, py] = endPos(s, 4.1 + 3.9 * 0.55 - 0.35); t.position.set(px, py, t.position.z); t.visible = true; t.scale.setScalar(0.5); });
    { const want = expanded ? batShade : batShadeLaser; if (batBodyMat.map !== want) { batBodyMat.map = want; } }
    // laser: two guns on top, exactly where the beams leave the bat (5.5 px either side of the centre), kicking back on each shot
    guns.forEach((g, i) => { const s = i ? 1 : -1; g.position.set(s * 5.5, 3.2 - kick * 0.8, 0); g.visible = laser; });
    if (toyOn) { tips.forEach(t => (t.visible = false)); caps.forEach(c => (c.visible = false)); } else caps.forEach(c => (c.visible = true));
    // end lights: small, mostly dim, with a quick blink every 2-3 s that speeds up as the ball speeds up
    const blinkEvery = Math.max(700, 2600 - (G.speed || 0) * 380);
    if (now > tipBlinkNext + 400) tipBlinkNext = now + blinkEvery * (0.85 + Math.random() * 0.3);
    const bt = now - tipBlinkNext, blink = bt > 0 && bt < 160 ? Math.sin(Math.PI * bt / 160) : 0;
    batTipMat.emissiveIntensity = 0.35 + 2.6 * blink;
    tips.forEach(t => { const gl = t.userData.glow; gl.material.color.copy(batTipMat.emissive); gl.material.opacity = (0.04 + 0.5 * blink) * batFade; const sc = 4 + 5 * blink; gl.scale.set(sc, sc, 1); });
    // highlight slides along the bat as it moves across the screen
    batGleam.offset.y = -(X((l + r) / 2) / 115) * 0.4 * (bodyLen / 30);
    // overall brightness falls off gently as the bat nears either wall
    const edge = Math.min(1, Math.abs(X((l + r) / 2)) / 108);
    const bright = 1 - 0.38 * edge * edge;
    batBodyMat.color.copy(toyOn ? TOY_BODY : G.laser || G.batF === 0 ? LASER_BODY : G.catching ? CATCH_BODY : BAT_BODY).multiplyScalar(bright); batCapMat.color.copy(G.laser || G.batF === 0 || G.catching ? CAP_WHITE : BAT_CAP).multiplyScalar(bright);
    batBodyMat.metalness = toyOn ? 0.0 : 0.55; batBodyMat.roughness = toyOn ? 0.42 : 0.32;
    toyMat.color.copy(TOY_BODY).multiplyScalar(bright); toyMat.opacity = batFade; toyMat.depthWrite = batFade > 0.99;
    batTipMat.emissive.set(G.laser || G.batF === 0 ? 0xffffff : G.catching ? 0x44ff99 : G.batTarget === 18 ? 0xffd166 : 0x3d8bff);
    camTarget = X((l + r) / 2);   // the camera follows this with a smooth delay (see placeCamera)
    // N countdown under the bat
    const tOk = !SET.classic && G.mode === 'play';
    const tIce = tOk && !(G.pierce > 0) && G.ice > 0;
    const tLaser = tOk && !(G.pierce > 0) && !(G.ice > 0) && G.laser && G.laserTime > 0;
    const tFrames = tOk ? (G.pierce > 0 ? G.pierce : G.ice > 0 ? G.ice : G.laser && G.laserTime > 0 ? G.laserTime : 0) : 0;
    const nLeft = tFrames > 0 ? Math.ceil(tFrames / 50) : 0;
    if (!nTimer.parent) scene.add(nTimer);
    nTimer.visible = false;   // countdowns now show in the side panel (ui.js)
    if (nLeft > 0) {
      const tCol = tIce ? '#8fe4ff' : tLaser ? '#ff5a5a' : '#ff9a2e';
      const key = nLeft + (tIce ? 1000 : tLaser ? 2000 : 0);
      if (key !== nTimerShown) { nTimerShown = key; drawNTimer(nLeft, tCol); }
      nTimer.position.set(batGroup.position.x, batGroup.position.y - 9.5, 3);
      nTimer.material.opacity = tFrames < 100 ? 0.55 + 0.45 * Math.abs(Math.sin(now * 0.012)) : 1;
    }
  }

  // R (Replicant): draw the second bat at the top, tracking the player's bat
  { const on = playing && (G.replicant || G.repFade > 0) && G.mode !== 'over' && G.mode !== 'win';
    repGroup.visible = on; if (!on) repTimer.visible = false;
    if (on) {
      const e = A.bat[9].ext, bx = (G.obx ?? G.batX) + ((G.batX - (G.obx ?? G.batX)) * alpha);
      const l = bx + e.l, r = bx + e.r;
      repGroup.position.set(X((l + r) / 2), Y(PT + e.top + 3.5), 1);
      // last 2 s: a warning blink; when the counter runs out it fades smoothly out of existence (no longer solid)
      const fade = G.replicant ? (G.replicantTime < 100 ? 0.55 + 0.45 * Math.abs(Math.sin(now * 0.02)) : 1) : Math.max(0, G.repFade / 40);
      repGroup.scale.set(1, G.replicant ? 1 : 0.4 + 0.6 * fade, 1);
      repBodyMat.opacity = repCapMat.opacity = repTipMat.opacity = fade;
      repTipMat.emissiveIntensity = 1.4 + 0.6 * Math.sin(now * 0.006);
      // replicant countdown (hidden once it starts fading away)
      const rn = G.replicant ? Math.ceil(G.replicantTime / 50) : 0;
      repTimer.visible = false;
      if (rn > 0) {
        if (rn !== repTimerShown) { repTimerShown = rn; drawRepTimer(rn); }
        // under the player's (bottom) bat, like the Laser/Neutrino countdowns; if one of those is showing too, sit side by side
        const both = nTimer.visible;
        repTimer.position.set(batGroup.position.x + (both ? 7 : 0), batGroup.position.y - 9.5, 3);
        if (both) nTimer.position.x = batGroup.position.x - 7;
        repTimer.material.opacity = G.replicantTime < 100 ? 0.55 + 0.45 * Math.abs(Math.sin(now * 0.012)) : 1;
      }
    }
  }

  // balls
  const showBalls = playing && (G.mode === 'play' || G.mode === 'intro' || G.mode === 'dchoose' || G.mode === 'demons');
  // vertical camera target: average height of the balls in play (world y), 0 when none
  {
    let sum = 0, n = 0; if (showBalls) for (const b of G.balls) { sum += Y(b.y + 2.5); n++; }
    const avg = n ? sum / n : 0;
    // topTime counts how long the balls have stayed in the top half. Nothing happens for the first
    // ~3 s; then topHold eases in slowly over ~8 s. Once the balls come down, the tilt holds for ~3 s
    // (so quick trips to the bat don't reset it), then unwinds slowly over ~9 s.
    const dts = topLastT ? Math.min(0.1, (now - topLastT) / 1000) : 0; topLastT = now;
    const TOP_DELAY = 3, TOP_RAMP = 8, DOWN_DELAY = 3, DOWN_RAMP = 9;
    const live = n && G.mode === 'play' && !G.paused;
    if (live && avg > 0) { lowTime = 0; topTime = Math.min(TOP_DELAY + TOP_RAMP, topTime + dts); }
    else if (live || !n) {
      lowTime += dts;
      if (lowTime > DOWN_DELAY || !n) { topTime -= dts * TOP_RAMP / DOWN_RAMP; if (topTime < TOP_DELAY) topTime = 0; }
    }
    { const k = Math.max(0, Math.min(1, (topTime - TOP_DELAY) / TOP_RAMP)); topHold = k * k * (3 - 2 * k); }
    // held upward lift, plus the ordinary ball follow (whose downward part is held back while lifted)
    camTargetY = (avg > 0 ? avg : avg * (1 - topHold)) + 2.5 * topHold * Math.max(avg, 45);
  }
  // N power-up: the balls become yellow balls of fire with a flaming trail (flickering in the last 2 seconds)
  const onFire = G.pierce > 0 && !SET.classic && !(G.pierce < 100 && (G.pierce >> 3) & 1);
  const onIce = G.ice > 0 && !SET.classic && !(G.ice < 100 && (G.ice >> 3) & 1);
  if (onIce) ballMat.color.setHex(0x9fe8ff).multiplyScalar(1.2); else ballMat.color.setRGB(1.18, 1.18, 1.2);   // a little brighter than plain white
  {

    for (const p of ballPool) { p.m.material = onFire ? lavaMat : ballMat; if (p.light) p.light.color.setHex(onFire ? 0xff7a20 : 0xbcd8ff); if (p.glint) p.glint.color.setHex(onFire ? 0xff9a40 : 0xd6e6ff); }
    if (onFire) { lavaTex.offset.x = (now * 0.00025) % 1; lavaMat.emissiveIntensity = 1.1 + 0.25 * Math.sin(now * 0.02); }
  }
  const fireDt = fireLast ? Math.min(0.1, (now - fireLast) / 1000) : 0; fireLast = now;
  ballPool.forEach((p, i) => {
    const b = showBalls ? G.balls[i] : null;
    p.m.visible = !!b; ballShadows[i].visible = !!b;
    if (p.light) p.light.intensity = b ? BALL_LIGHT : 0;
    if (p.glint) p.glint.intensity = b ? 700 : 0;
    if (!b) { p.hist.length = 0; p.trail.forEach(t => (t.visible = false)); if (p.halo) p.halo.visible = false; if (i < 3) reflPool[i].forEach(r => (r.visible = false)); return; }
    const bx = (b.ox ?? b.x) + (b.x - (b.ox ?? b.x)) * alpha, by = (b.oy ?? b.y) + (b.y - (b.oy ?? b.y)) * alpha;
    p.m.position.set(X(bx + 2.5), Y(by + 2.5), 1.5);
    // a subtle jelly wobble for a moment after the bat
    { const ft = b.squash != null ? (G.frame - b.squash + alpha) / 50 : 9; const k = ft < 0.55 ? 0.34 * Math.exp(-ft / 0.13) * Math.cos(ft * 2 * Math.PI * 4.5) : 0; p.m.userData.sq = k; }
    // fake reflections: a soft glint of the ball on the bat's top and on the nearby frame pipes
    if (i < 3) {
      const rf = reflPool[i], bxw = p.m.position.x, byw = p.m.position.y, batTopW = batGroup.position.y + 2.4;
      const dyB = byw - batTopW, onBat = batGroup.visible && dyB > 0 && dyB < 26 && Math.abs(bxw - batGroup.position.x) < (batBody.scale.y / 2 + 6);
      rf[0].visible = onBat; if (onBat) { rf[0].position.set(bxw, batTopW, 4.2); rf[0].material.opacity = 0.55 * (1 - dyB / 26); }
      const dl = bxw - X(PX_L), dr = X(PX_R) - bxw, dt = Y(PY_T) - byw;
      rf[1].visible = dl < 28; if (rf[1].visible) { rf[1].position.set(X(PX_L) + 1.8, byw, 2.6); rf[1].material.opacity = 0.5 * (1 - dl / 28); }
      rf[2].visible = dr < 28 && byw > Y(PY_GAP + 20); if (rf[2].visible) { rf[2].position.set(X(PX_R) - 1.8, byw, 2.6); rf[2].material.opacity = 0.5 * (1 - dr / 28); }
      rf[3].visible = dt < 28; if (rf[3].visible) { rf[3].position.set(bxw, Y(PY_T) - 1.8, 2.6); rf[3].material.opacity = 0.5 * (1 - dt / 28); }
    }
    // roll: turn about the axis across the direction of travel
    if (!G.paused && !b.stuck) { const vx = b.x - (b.ox ?? b.x), vy = b.y - (b.oy ?? b.y); p.m.rotation.y += vx * 0.06; p.m.rotation.x += vy * 0.06; }
    { // squash along world axes (the ball's own spin must not turn the wobble sideways)
      const k = p.m.userData.sq || 0; p.m.matrixAutoUpdate = false;
      p.m.matrix.makeRotationFromEuler(p.m.rotation);
      if (k) p.m.matrix.premultiply(tmpS2.makeScale(1 + k, 1 - k, 1 + k * 0.5));
      // at high speed: stretched a little along its flight, like a bullet
      // (velocity smoothed: the game moves the ball in whole-pixel steps, so single frames jitter)
      const ud = p.m.userData;
      ud.vx = (ud.vx || 0) * 0.75 + (b.x - (b.ox ?? b.x)) * 0.25; ud.vy = (ud.vy || 0) * 0.75 - (b.y - (b.oy ?? b.y)) * 0.25;
      const sp = Math.hypot(ud.vx, ud.vy);
      const want = sp > 0.01 && !b.stuck ? Math.min(0.2, Math.max(0, (sp - 2.2) * 0.07)) : 0;
      ud.el = (ud.el || 0) + (want - (ud.el || 0)) * 0.25;
      if (sp > 0.01) ud.elA = Math.atan2(ud.vy, ud.vx);
      if (ud.el > 0.004) {
        const e = 1 + ud.el, q = 1 / Math.sqrt(e), ang = ud.elA || 0;
        p.m.matrix.premultiply(tmpS3.makeRotationZ(-ang)).premultiply(tmpS2.makeScale(e, q, q)).premultiply(tmpS3.makeRotationZ(ang));
      }
      p.m.matrix.setPosition(p.m.position);
    }
    if (p.light) p.light.position.set(p.m.position.x, p.m.position.y, 7);
    if (p.glint) p.glint.position.set(p.m.position.x, p.m.position.y, 1.5);
    { const sh = ballShadows[i]; shadowSpot(p.m.position.x, p.m.position.y, 1.5, SHADOW_DROP, sh.f.position); sh.f.scale.set(BALL_FAR, BALL_FAR, 1);
      shadowSpot(p.m.position.x, p.m.position.y, 1.5, NEAR_DROP, sh.n.position); sh.n.scale.set(BALL_NEAR, BALL_NEAR, 1); }   // a little in front, so brick faces catch a touch of it
    if (!p.halo) { p.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowDot, color: 0xff5a0a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(p.halo); p.fireAcc = 0; }
    p.halo.visible = onFire;
    if (onFire) {
      const fl = 0.85 + 0.3 * Math.random();
      p.halo.position.set(p.m.position.x, p.m.position.y, 2.2); p.halo.scale.set(15 * fl, 15 * fl, 1); p.halo.material.opacity = 0.42 * fl;
      if (!G.paused && !b.stuck) {
        p.fireAcc += fireDt * 190;   // fewer embers (toned down)
        const vx = (b.x - (b.ox ?? b.x)) * 50, vy = -(b.y - (b.oy ?? b.y)) * 50;
        while (p.fireAcc >= 1) { p.fireAcc--; addFlame(p.m.position.x, p.m.position.y, vx, vy); }
      }
    }
    { const v = p.hist.length > 14 ? p.hist.pop() : new THREE.Vector3(); p.hist.unshift(v.copy(p.m.position)); }   // recycled, no garbage every frame
    p.trail.forEach((t, k) => {
      const h = p.hist[(k + 1) * 2]; t.visible = !!h && !b.stuck && SET.trails;
      if (h) { t.position.copy(h); const s = 0.85 - k * 0.12; t.scale.set(s, s, s); t.material.opacity = 0.075 - k * 0.012; }   // faint trail, fading out
    });
  });

  // catch aim: which way each caught ball will leave
  {
    // shown for balls caught by C, and for the ball waiting on the bat at the start of a round or a new ship
    const stuck = playing && !SET.classic && (G.mode === 'play' || G.mode === 'intro') && SPD ? G.balls.filter(b => b.stuck && !b.dead && (G.catching || !b.launched)) : [];
    const lvl = SPD ? (SPD[G.speed] || SPD[0]) : null;
    aimBeams.forEach((beam, i) => {
      const sb = stuck[i]; beam.visible = !!sb; if (!sb) return;
      const st = lvl[Math.min(sb.a, lvl.length - 1)];
      let dx = 0, dy = 0; for (const [a, b] of st) { dx += a; dy += b; }
      const ang = Math.atan2(dx * (sb.sx || 1), dy);   // 0 = straight up
      const bx = (G.obx ?? G.batX) + (G.batX - (G.obx ?? G.batX)) * alpha + sb.off;
      beam.position.set(X(bx + 2.5), Y(BAT_Y + A.bat[G.batF].ext.top - 2.5), 1.6);   // a waiting ball always sits on the bat
      beam.rotation.z = -ang;
      beam.material.opacity = 0.45 + 0.2 * Math.sin(now * 0.008 + i);
    });
  }

  // grenade: six satellites circling the first ball until fired, then flying fragments
  {
    const b = playing && G.grenade ? G.balls.find(x => !x.dead) : null, p0 = b ? ballPool[G.balls.indexOf(b)] : null;
    sats.forEach((m, i) => {
      m.visible = !!(b && p0); if (!m.visible) return;
      const a = -now * 0.0038 + i / 6 * Math.PI * 2;   // clockwise
      m.position.set(p0.m.position.x + Math.cos(a) * 5.4, p0.m.position.y + Math.sin(a) * 5.4, 1.5 + Math.sin(a * 2) * 1.5);
    });
    const fl = playing && G.frags ? G.frags : [];
    frags.forEach((m, i) => { const f = fl[i]; m.visible = !!f; if (f) m.position.set(X(f.x + 1), Y(f.y + 1), 1.5); });
  }

  // capsule
  const c = playing ? G.capsule : null;
  capGroup.visible = !!c; capShadow.visible = !!c; capShadowBg.visible = !!c;
  if (c) {
    // the capsule falls just in front of the bricks, so its shadow lands on their faces as it passes
    capGroup.position.set(X(c.x + 8), Y(c.y + 4.5), 7);
    placePair(capShadow, X(c.x + 8), Y(c.y + 4.5), 7, 15, 7, 4, 3.7);
    capShadow.n.position.y -= 3.5; capShadow.f.scale.multiplyScalar(0.8);   // close shadow peeks out below the capsule (brick faces only)
    placePair(capShadowBg, X(c.x + 8), Y(c.y + 4.5), 7, 15, 7, 1.5);   // and the ordinary one on the background
    capSpin.rotation.x = now * 0.006;   // rolls forward: the face toward you turns downward, the way it falls
    if (capShown !== c.t) {
      capShown = c.t;
      capBodyMat.map = capTex[c.t - 1]; capBodyMat.emissiveMap = capTex[c.t - 1];   // texture swap only: no shader rebuild
      capEndMat.color.set(capBodyColor[c.t - 1]); capGlow.material.color.set(capBodyColor[c.t - 1]);   // caps match the body exactly
    }
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.007);
    capGlow.visible = !SET.classic;
    capGlow.material.opacity = 0.3 + 0.4 * pulse;
    const gs = 0.9 + 0.3 * pulse; capGlow.scale.set(34 * gs, 24 * gs, 1);
  }

  // lasers & boss shots
  let li = 0;
  if (playing) for (const s of G.shots) for (const ox of [2, 13]) { if (li < laserPool.length) { const m = laserPool[li++]; m.visible = true; m.position.set(X(s.x + ox + 0.5), Y(s.y + 4), 1); if (m.userData.streak) m.userData.streak.visible = !SET.classic; } }
  for (; li < laserPool.length; li++) laserPool[li].visible = false;
  let si = 0;
  if (playing) for (const s of G.bossShots) if (si < shotPool.length) {
    const m = shotPool[si++]; m.visible = true; m.position.set(X(s.x + 8), Y(s.y + 3), 3); const pul = 1 + Math.sin(now * 0.02 + s.y) * 0.12; m.scale.setScalar(pul);
    if (!G.paused && fireTrail.length < 60) fireTrail.push({ x: X(s.x + 8) - s.vx * 0.5, y: Y(s.y + 3) + s.vy * 0.5, born: now, life: 260 + Math.random() * 120 });   // drop an ember just behind the ball
  }
  for (; si < shotPool.length; si++) shotPool[si].visible = false;
  // fire tails: each ember fades warm -> dark and shrinks
  { let fi = 0;
    for (let i = fireTrail.length - 1; i >= 0; i--) { if (now - fireTrail[i].born >= fireTrail[i].life) fireTrail.splice(i, 1); }
    for (const e of fireTrail) { if (fi >= fireTrailPool.length) break;
      const k = Math.min(1, (now - e.born) / e.life), sp = fireTrailPool[fi++];
      sp.visible = true; sp.position.set(e.x, e.y, 2.6);
      const sc = (7 - k * 4.5); sp.scale.set(sc, sc, 1);
      sp.material.color.copy(fireHot).lerp(fireMid, Math.min(1, k * 1.6)).multiplyScalar(1 - k * 0.3);
      sp.material.opacity = (1 - k) * 0.8;
    }
    for (; fi < fireTrailPool.length; fi++) fireTrailPool[fi].visible = false;
  }

  // boss
  bossMesh.visible = !!(G.grid && G.boss);
  if (G.boss) {
    const b = G.boss;
    bossMesh.position.set(X(b.x + 56), Y(b.y + 50.5), BG.z + 1.2);   // just in front of the background, behind the bricks
    const breathe = 1 + Math.sin(now * 0.003) * 0.012;
    bossMesh.scale.set(breathe, breathe, 1);
    bossMat.color.setScalar(b.flash ? 2.2 : 1);   // a bright punch when hit (toneMapped:false lets it exceed 1)
  }

  // demons bonus stage
  {
    const D = G.dem, dm = G.mode;
    const headsOn = !!D && (dm === 'demons' || dm === 'dresult');
    const chooseOn = !!D && (dm === 'inter' || dm === 'dchoose');
    if ((headsOn || chooseOn) && demonTexFor !== G.roundId) buildDemonTextures();
    demonHeads.forEach((m, i) => {
      m.visible = headsOn; demonShadows[i].visible = headsOn;
      if (!headsOn) return;
      const f = i === D.head ? D.mouth : 0;
      m.material = demonMats[f];
      m.position.set(X(DEMON_HEAD_X[i] + 32), Y(DEMON_HEAD_Y + 20), -1.5);
      placePair(demonShadows[i], X(DEMON_HEAD_X[i] + 22), Y(DEMON_HEAD_Y + 20), -1.5, 40, 34);
    });
    choosePlane.visible = chooseOn;
    chooseHi.visible = chooseOn && D.picked > 0;
    if (chooseOn) {
      choosePlane.position.set(X(CHOOSE_X + 104), Y(CHOOSE_Y + 28), -1.5);
      if (D.picked > 0) {
        const bx = [25, 75, 126, 176][D.picked - 1] + 16;
        chooseHi.position.set(X(bx), Y(CHOOSE_Y + 39), -1.2);
        chooseHi.material.opacity = 0.25 + 0.25 * Math.sin(now * 0.02);
      }
    }
  }

  stepDust(now); stepDissolve(now); stepFire(now);
  for (const g of hitGlows) { const k = (now - g.at) / 260; if (k >= 1) { g.sp.visible = false; continue; } g.sp.material.opacity = 0.7 * (1 - k); const sc = 22 + 14 * k; g.sp.scale.set(sc, sc * 0.6, 1); }

  // warp exit
  mirrorGroup.visible = SET.mirror !== false;
  const warpOpen = G.warp || G.mode === 'warp';
  if (warpOpen && doorOpenAt < 0) doorOpenAt = now;
  if (!warpOpen) doorOpenAt = -1;
  {
    const k = doorOpenAt < 0 ? 0 : Math.min(1, (now - doorOpenAt) / 650), a = 1 - k;
    wallRLow.visible = a > 0; doorMirrors.forEach(m => (m.visible = a > 0.5));
    if (a !== doorAlpha) {
      doorAlpha = a;
      doorPipeMat.opacity = doorGlowMat.opacity = a; doorPipeMat.depthWrite = doorGlowMat.depthWrite = a > 0.99;
      doorSprites.forEach(sp => (sp.material.opacity = 0.16 * a));
    }
    if (k > 0 && k < 1 && !G.paused) dissolveDoor(X(PX_R), Y(Math.min(PY_B, 212)), Y(PY_GAP));
  }
  warpLight.intensity = warpOpen ? 1800 + Math.sin(now * 0.02) * 600 : 0;
  if (warpOpen && !G.paused) exitShimmer(X(PX_R), Y(Math.min(PY_B, 210)), Y(PY_GAP));
  const clipOn = warpOpen;
  exitClip[0].constant = X(PX_R - 1);
  for (const mtl of [batBodyMat, batCapMat, batTipMat]) {
    const want = clipOn ? exitClip : null;
    if (mtl.clippingPlanes !== want) { mtl.clippingPlanes = want; mtl.needsUpdate = true; }
  }

  for (const l of breakLights) { const t = (now - l.userData.t0) / 1000; l.intensity = t >= 0 && t < 0.4 ? 1400 * Math.exp(-t / 0.09) : 0; }
  // particles
  partMesh.count = parts.length;
  const partPx = unitsPerPx();   // world units per screen pixel
  parts.forEach((p, i) => {
    tmpQ.copy(camera.quaternion);   // billboards: always face the camera
    // starts as a solid chip of the brick's colour, then quickly darkens and dissolves (shrinks) away
    const a = 1 - p.life / (p.max || 30), s = (3.6 - a * 1.2) * partPx / 0.82;   // ~3.6 px at the start, ~2.4 px by the end
    tmpS.set(s, s, s); tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS);
    partMesh.setMatrixAt(i, tmpM); partMesh.setColorAt(i, p.c); partAlpha.setX(i, Math.min(1, (1 - a) * 2.2) ** 0.8);   // full for the first half, then fades
  });
  partMesh.instanceMatrix.needsUpdate = true; partAlpha.needsUpdate = true; if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;

  shake *= 0.86; if (shake < 0.05) shake = 0;
  placeCamera(now);
  // background parallax: drifts slightly the opposite way to the bat, following the camera's smoothed lag
  if (bgMat.map) { const ox = bgBaseX + (VIEW.mode === 'tilted' ? -1 : 1) * (camBias / 115) * 0.01 * bgDriftK; bgMat.map.offset.x = ox; if (bgMat.bumpMap) bgMat.bumpMap.offset.x = ox; }
  applyCA();
  bokeh.enabled = PHOTO.on && PHOTO.aperture > 0;
  if (bokeh.enabled) { const u = bokeh.uniforms; u.focus.value = PHOTO.focus; u.aperture.value = PHOTO.aperture; u.maxblur.value = PHOTO.maxblur; }
  composer.render();
}

export {
  motes, stepDust, dust, aimBeam, veins, batShadow, brickShadows, brickNear, nearShadowMat, nearRoundMat, shadowMat, roundShadowMat, capShadow, applyShadowStrength, applyFov, applyBallLight, refreshCapsules, X, Y, stage, renderer, cv, scene, pmrem, camera, composer, bloom, sun, rim, srgb, amigaColor, indexedToCanvas, bgMat, BG, bgPlane, backdrop, vignette, pipeMat, glowMat, pipe, BEND, PX_L, PX_R, PY_T, PY_B, PY_GAP, straight, wallL, wallRTop, wallRLow, wallT, warpLight, brickGeo, brickMat, metalMat, bricks, metal, brickColors, brickPaletteFor, batGroup, batBodyMat, batCapMat, batTipMat, batBody, caps, domes, tips, guns, fins, ballGeo, ballMat, trailMat, ballPool, LETTERS, capGroup, capTex, capBodyMat, capBody, capSpin, capEndMat, laserMat, laserPool, shotMat, shotPool, bossMat, bossMesh, PMAX, partMesh, parts, burst, stepParticles, shake, camBias, fitCamera, placeCamera, applyGlow, _p0, _p1, unitsPerPx, builtRound, setupRoundVisuals, tmpM, tmpQ, tmpS, tmpP, tmpE, WHITE_HOT, renderFrame, applyBackground
};
