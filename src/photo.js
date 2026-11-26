// Photo mode: while paused, fly the camera freely, set lens / depth of field / motion blur, and save a still.
import * as THREE from 'three';
import { PHOTO, camera, cv, renderer, composer, renderFrame, stage, scene, fitCamera } from './render.js';

// a small orbit / pan / dolly controller around a target point
class Orbit {
  constructor(cam, el) {
    this.cam = cam; this.el = el; this.target = new THREE.Vector3(); this.sph = new THREE.Spherical();
    this.goal = new THREE.Spherical(); this.goalT = new THREE.Vector3(); this.cbs = []; this.drag = null;
    this.roll = 0; this.goalRoll = 0; this.minDistance = 8; this.maxDistance = 1200;
    this._down = e => { if (e.button > 2) return; e.preventDefault(); this.drag = { b: e.button, x: e.clientX, y: e.clientY }; el.setPointerCapture && el.setPointerCapture(e.pointerId); };
    this._move = e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag.x = e.clientX; this.drag.y = e.clientY;
      const b = e.buttons;
      if ((b & 1) && e.altKey) {   // Alt + left: bank (roll) the camera
        this.goalRoll += (dx - dy) * 0.005;
      } else if ((b & 1) && !e.shiftKey && !(b & 2)) {   // left: orbit
        this.goal.theta -= dx * 0.006; this.goal.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.goal.phi - dy * 0.006));
      } else {   // pan in the screen plane
        const k = this.goal.radius * Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * 2 / el.clientHeight;
        const right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1);
        this.goalT.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      }
      this.fire();
    };
    this._up = () => { this.drag = null; };
    this._wheel = e => { e.preventDefault(); this.goal.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this.goal.radius * Math.exp(e.deltaY * 0.0012))); this.fire(); };
    el.addEventListener('pointerdown', this._down); window.addEventListener('pointermove', this._move); window.addEventListener('pointerup', this._up);
    el.addEventListener('wheel', this._wheel, { passive: false });
  }
  // the scene's "up" is +y, but the playfield faces +z: orbit about a frame where +z plays the role of the pole axis
  sync() {
    const off = this.cam.position.clone().sub(this.target);
    this.sph.set(off.length(), Math.acos(THREE.MathUtils.clamp(off.y / off.length(), -1, 1)), Math.atan2(off.x, off.z));
    this.goal.copy(this.sph); this.goalT.copy(this.target); this.roll = this.goalRoll = 0;
  }
  addEventListener(_, f) { this.cbs.push(f); }
  fire() { this.cbs.forEach(f => f()); }
  update() {
    const k = 0.25;
    this.sph.radius += (this.goal.radius - this.sph.radius) * k; this.sph.phi += (this.goal.phi - this.sph.phi) * k; this.sph.theta += (this.goal.theta - this.sph.theta) * k;
    this.target.lerp(this.goalT, k); this.roll += (this.goalRoll - this.roll) * k;
    const moving = Math.abs(this.goal.radius - this.sph.radius) > 1e-3 || Math.abs(this.goal.phi - this.sph.phi) > 1e-5 || Math.abs(this.goal.theta - this.sph.theta) > 1e-5 || Math.abs(this.goalRoll - this.roll) > 1e-5 || this.target.distanceToSquared(this.goalT) > 1e-6;
    const o = new THREE.Vector3().setFromSpherical(this.sph);
    this.cam.position.copy(this.target).add(o); this.cam.up.set(0, 1, 0); this.cam.lookAt(this.target); if (this.roll) this.cam.rotateZ(this.roll); this.cam.updateMatrixWorld();
    if (moving) this.fire();
  }
  dispose() {
    this.el.removeEventListener('pointerdown', this._down); window.removeEventListener('pointermove', this._move); window.removeEventListener('pointerup', this._up);
    this.el.removeEventListener('wheel', this._wheel);
  }
}
let curAlpha = 1, controls = null, frozenNow = 0, saved = null, panel = null, still = null, stillValid = false, lastMove = 0;
const opts = { fov: 42, focus: 200, aperture: 0, maxblur: 40, blur: 0, grain: 0, scale: 1, run: false, slow: 5 };
const onExit = [];
export function photoRate() { return opts.run ? opts.slow / 100 : 0; }
export function toggleSlow() {
  opts.run = !opts.run;
  const b = panel && panel.querySelector('#phRun'); if (b) { b.textContent = opts.run ? '❚❚ Freeze (Enter)' : '▶ Slow motion (Enter)'; b.classList.toggle('on', opts.run); }
  invalidate();
}
export function onPhotoExit(fn) { onExit.push(fn); }

const css = `
#photoPanel { position:absolute; right:12px; top:12px; max-height:calc(100% - 24px); overflow:auto; z-index:30; width:250px; padding:12px 14px 14px; border-radius:12px;
  background:rgba(12,14,22,.78); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,.12);
  color:#e8ecf4; font:13px/1.35 system-ui, sans-serif; box-shadow:0 8px 30px rgba(0,0,0,.4); user-select:none; }
#photoPanel h3 { margin:0 0 8px; font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:#9fb4ff; }
#photoPanel label { display:block; margin:8px 0 2px; color:#c9d0de; }
#photoPanel label span { float:right; color:#8a93a6; font-variant-numeric:tabular-nums; }
#photoPanel input[type=range] { width:100%; accent-color:#7ea2ff; }
#photoPanel .row { display:flex; gap:6px; margin-top:12px; }
#photoPanel .row button { flex:1; padding:7px 6px; border-radius:8px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.07); color:#e8ecf4; font:600 12px system-ui; cursor:pointer; }
#photoPanel .row button.primary { background:#3d63e0; border-color:#5b7cf0; }
#photoPanel .row button.on { background:rgba(126,162,255,.3); }
#photoPanel .hint { margin-top:10px; color:#8a93a6; font-size:11.5px; }
.stage.photo .hud, .stage.photo .msg, .stage.photo #fps { display:none !important; }
#photoGrain { position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; z-index:6; mix-blend-mode:overlay; display:none; }
#photoStill { position:absolute; left:0; top:0; width:100%; height:100%; pointer-events:none; z-index:5; display:none; }
#photoShot { position:absolute; left:12px; bottom:12px; z-index:31; padding:8px; border-radius:10px; background:rgba(12,14,22,.85); color:#e8ecf4; font:12px system-ui; max-width:260px; }
#photoShot img { display:block; width:240px; border-radius:6px; margin-bottom:6px; }
#photoShot a { color:#9fb4ff; }
`;

function slider(id, label, min, max, step, fmt) {
  return `<label>${label}<span id="${id}V"></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"></label>`;
}
function buildPanel() {
  if (!document.getElementById('photoCss')) { const st = document.createElement('style'); st.id = 'photoCss'; st.textContent = css; document.head.appendChild(st); }
  panel = document.createElement('div'); panel.id = 'photoPanel';
  panel.innerHTML = `<h3>Photo mode</h3>
    ${slider('phFov', 'Lens (field of view)', 8, 110, 1)}
    ${slider('phFocus', 'Focus distance', 10, 700, 1)}
    ${slider('phAperture', 'Aperture (depth of field)', 0, 100, 1)}
    ${slider('phMaxblur', 'Max blur', 5, 100, 1)}
    ${slider('phBlur', 'Motion blur', 0, 100, 1)}
    ${slider('phGrain', 'Film grain', 0, 100, 1)}
    <div class="row"><button id="phRun" type="button">▶ Slow motion (Enter)</button></div>
    ${slider('phSlow', 'Slow motion speed', 1, 30, 1)}
    <div class="row"><button id="phS1" type="button">1×</button><button id="phS2" type="button">2×</button><button id="phS4" type="button">4×</button></div>
    <div class="row"><button id="phReset" type="button">Reset view</button><button id="phSave" class="primary" type="button">Save photo</button></div>
    <div class="row"><button id="phExit" type="button">Exit (Esc) · F resumes game</button></div>
    <div class="hint">Drag: orbit · Alt+drag: roll · Middle, right or Shift-drag: pan · Wheel: move in/out · Double-click: focus there</div>`;
  stage.appendChild(panel);
  still = document.createElement('canvas'); still.id = 'photoStill'; stage.appendChild(still);
  grainEl = document.createElement('canvas'); grainEl.id = 'photoGrain'; stage.appendChild(grainEl);
  const bind = (id, key, fmt) => {
    const el = panel.querySelector('#' + id), out = panel.querySelector('#' + id + 'V');
    el.value = opts[key]; out.textContent = fmt(opts[key]);
    el.addEventListener('input', () => { opts[key] = +el.value; out.textContent = fmt(opts[key]); apply(); });
  };
  bind('phFov', 'fov', v => v + '°  (' + Math.round(18 / Math.tan(THREE.MathUtils.degToRad(v / 2))) + ' mm)');
  bind('phFocus', 'focus', v => String(v));
  bind('phAperture', 'aperture', v => v ? 'f/' + (22 / (1 + v / 6)).toFixed(1) : 'off');
  bind('phMaxblur', 'maxblur', v => v + '%');
  bind('phBlur', 'blur', v => v ? v + '%' : 'off');
  bind('phSlow', 'slow', v => v + '%');
  bind('phGrain', 'grain', v => v ? v + '%' : 'off');
  const scaleBtns = () => [1, 2, 4].forEach(s => panel.querySelector('#phS' + s).classList.toggle('on', opts.scale === s));
  [1, 2, 4].forEach(s => panel.querySelector('#phS' + s).addEventListener('click', () => { opts.scale = s; scaleBtns(); }));
  scaleBtns();
  panel.querySelector('#phRun').addEventListener('click', toggleSlow);
  panel.querySelector('#phReset').addEventListener('click', resetView);
  panel.querySelector('#phSave').addEventListener('click', savePhoto);
  panel.querySelector('#phExit').addEventListener('click', exitPhoto);
  // keep clicks on the panel away from the game
  for (const ev of ['pointerdown', 'mousedown', 'click', 'wheel', 'dblclick']) panel.addEventListener(ev, e => e.stopPropagation());
}
function setSlider(id, v, key) { opts[key] = v; const el = panel && panel.querySelector('#' + id); if (el) { el.value = v; el.dispatchEvent(new Event('input')); } }

function apply() {
  camera.fov = opts.fov; camera.updateProjectionMatrix();
  PHOTO.focus = opts.focus;
  PHOTO.aperture = opts.aperture ? (opts.aperture / 100) ** 1.5 * 0.0016 : 0;
  PHOTO.maxblur = opts.maxblur / 100 * 0.03;
  updateGrainOverlay();
  invalidate();
}
// film grain: monochrome noise blended with "overlay" (strongest in the mid-tones, like film)
let grainEl = null, grainKey = '';
function makeNoise(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;   // roughly gaussian
    const v = Math.max(0, Math.min(255, 128 + g * 110)); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0); return c;
}
function grainAlpha() { return opts.grain ? 0.08 + (opts.grain / 100) * 0.62 : 0; }
function updateGrainOverlay() {
  if (!grainEl) return;
  const w = renderer.domElement.width, h = renderer.domElement.height, key = w + 'x' + h;
  grainEl.style.display = opts.grain ? 'block' : 'none';
  grainEl.style.opacity = grainAlpha();
  if (opts.grain && grainKey !== key) { grainKey = key; grainEl.width = w; grainEl.height = h; grainEl.getContext('2d').drawImage(makeNoise(w, h), 0, 0); }
}
function addGrain(ctx, w, h, cell) {
  if (!opts.grain) return;
  const n = makeNoise(Math.ceil(w / cell), Math.ceil(h / cell));
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = grainAlpha(); ctx.imageSmoothingEnabled = cell > 1;
  ctx.drawImage(n, 0, 0, w, h); ctx.restore();
}
function invalidate() { stillValid = false; if (still) still.style.display = 'none'; lastMove = performance.now(); }

function resetView() {
  camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat);
  controls.target.copy(saved.target); controls.sync();
  setSlider('phFov', saved.fov, 'fov');
  setSlider('phFocus', Math.round(saved.pos.distanceTo(saved.target)), 'focus');
}

export function enterPhoto() {
  if (PHOTO.on) return;
  PHOTO.on = true; frozenNow = performance.now();
  // where the game camera is looking: straight ahead to the playfield plane
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const t = dir.z !== 0 ? -camera.position.z / dir.z : 200;
  const target = camera.position.clone().addScaledVector(dir, t);
  saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov, target };
  opts.fov = Math.round(camera.fov); opts.focus = Math.round(t);
  controls = new Orbit(camera, cv);
  controls.target.copy(target); controls.sync();
  controls.addEventListener('change', invalidate);
  cv.addEventListener('dblclick', focusAt);
  cv.addEventListener('contextmenu', noMenu);
  buildPanel(); apply(); stage.classList.add('photo');
}
export function exitPhoto() {
  if (!PHOTO.on) return;
  controls.dispose(); controls = null;
  cv.removeEventListener('dblclick', focusAt); cv.removeEventListener('contextmenu', noMenu);
  camera.fov = saved.fov; camera.updateProjectionMatrix();
  camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat);
  opts.run = false; curAlpha = 1;
  PHOTO.on = false; PHOTO.aperture = 0; stage.classList.remove('photo');
  panel.remove(); still.remove(); grainEl.remove(); panel = still = grainEl = null;
  const shot = document.getElementById('photoShot'); if (shot) shot.remove();
  onExit.forEach(f => f());
}
function noMenu(e) { e.preventDefault(); }

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function focusAt(e) {
  const r = cv.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(scene.children, true).find(h => h.object.visible && h.object.isMesh && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending));
  if (hit) {
    // BokehPass focus is the distance along the view axis
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    setSlider('phFocus', Math.max(10, Math.min(700, Math.round(hit.point.clone().sub(camera.position).dot(d)))), 'focus');
    if (!opts.aperture) setSlider('phAperture', 35, 'aperture');
  }
}

// motion blur: average several renders spread back along the last move of every ball, the bat etc.
function renderInto(ctx, w, h) {
  const n = opts.blur ? 14 : 1, span = opts.blur / 100 * 4;   // up to 4 game frames (80 ms "shutter")
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? curAlpha : curAlpha - span * (i / (n - 1));
    renderFrame(a, frozenNow);
    ctx.globalAlpha = 1 / (i + 1); ctx.drawImage(renderer.domElement, 0, 0, w, h);
  }
  ctx.globalAlpha = 1;
  renderFrame(curAlpha, frozenNow);
}

export function photoFrame(now, alpha = 1, simDt = 0) {
  if (opts.run) { frozenNow += simDt; curAlpha = alpha; if (stillValid || (still && still.style.display !== 'none')) invalidate(); lastMove = now; }
  if (controls) controls.update();
  updateGrainOverlay();
  if (opts.blur && !stillValid && now - lastMove > 180) {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    still.width = w; still.height = h;
    renderInto(still.getContext('2d'), w, h);
    still.style.display = 'block'; stillValid = true;
    return;
  }
  if (stillValid) return;   // the blurred still is on screen; nothing changes until the view does
  renderFrame(curAlpha, frozenNow);
}

function savePhoto() {
  const pr = renderer.getPixelRatio(), s = opts.scale;
  if (s !== 1) { renderer.setPixelRatio(pr * s); composer.setPixelRatio(pr * s); fitCamera(); }
  const w = renderer.domElement.width, h = renderer.domElement.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  try { renderInto(out.getContext('2d'), w, h); addGrain(out.getContext('2d'), w, h, s); }
  finally { if (s !== 1) { renderer.setPixelRatio(pr); composer.setPixelRatio(pr); fitCamera(); } }
  invalidate();
  out.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const name = 'giganoid-photo-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.png';
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a);
    try { a.click(); } catch (e) {}
    a.remove();
    // also show it, in case the browser blocks the download: right-click → Save image as…
    let shot = document.getElementById('photoShot');
    if (!shot) { shot = document.createElement('div'); shot.id = 'photoShot'; stage.appendChild(shot); for (const ev of ['pointerdown', 'mousedown', 'click', 'wheel']) shot.addEventListener(ev, e => e.stopPropagation()); }
    shot.innerHTML = `<img alt="Saved photo"><div>${w}×${h} · <a download="${name}">download</a> · right-click the image to save · <a href="#" data-close>close</a></div>`;
    shot.querySelector('img').src = url; shot.querySelector('a[download]').href = url;
    shot.querySelector('[data-close]').addEventListener('click', e => { e.preventDefault(); shot.remove(); });
  }, 'image/png');
}
