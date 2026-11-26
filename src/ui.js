/* Giganoid 3D: page UI, input, main loop and disk loading. */
import * as THREE from 'three';
import { PL, PR, BAT_Y, getMine, setMine, previewRound, loadArkanoidAdf, loadPackText, clearPacks, packInfo, lastRound, roundLabel, takeCapsule, tilt, FX, LIFE_EVERY, A, AC, COP, CUSTOM, G, HOOKS, INPUT, M, PAL, SET, SET_DEFAULTS, SND, START_ROUND, adfFind, applyCustomSounds, audioInit, setReverb, musicSetVol, setSfx, setLowAudio, applyEq, eqState, eqFlat, EQ_FREQS, bgCache, bufCache, buildRound, chan, decodeAssets, firstCodeHunk, go, keys, muted, newLife, play, rebuildSpeed, saveSettings, setMem, soundKey, startGame, stopChan, toggleMute, unpack, update } from './engine.js';
import { enterPhoto, exitPhoto, photoFrame, onPhotoExit, photoRate, toggleSlow } from './photo.js';
import { PHOTO, X, Y, PX_R, applyShadowStrength, applyFov, applyBallLight, refreshCapsules, VIEW, applyGlow, camera, cv, fitCamera, indexedToCanvas, renderFrame, stage, stepParticles, unitsPerPx , applyBackground } from './render.js';

/* ============================================================
   UI, input, loop, disk loading
   ============================================================ */
const $ = id => document.getElementById(id);
const hud = $('hud'), msg = $('msg');
const loaderCard = $('loader'), titleCard = $('titleCard'), overCard = $('overCard');

const pauseCard = $('pauseCard');
const LIVE = new Set(['play', 'intro', 'dchoose', 'demons']);
function liveMode() { return LIVE.has(G.mode); }
// the pause menu shows inside the game window whenever play is paused (and settings are closed)
function syncPause() {
  const inGame = liveMode();
  pauseCard.hidden = !(inGame && G.paused && !PHOTO.on && $('settings').hidden && !(document.getElementById('levelSel') && !document.getElementById('levelSel').hidden) && !(document.getElementById('editor') && !document.getElementById('editor').hidden));
  placePause();
  stage.classList.toggle('idle', !pauseCard.hidden || !titleCard.hidden || !overCard.hidden || !loaderCard.hidden);
}
function showOnly(card) {
  for (const c of [loaderCard, titleCard, overCard]) c.hidden = c !== card;
  if (card) pauseCard.hidden = true;
  hud.hidden = card === loaderCard || card === titleCard;
  stage.classList.toggle('idle', !!card);
}

const pad = (n, w) => String(n).padStart(w, '0');
let lastHud = '';
// the score panel sits outside the right-hand pipe, level with the bat, when there is room for it;
// on narrow screens it stays across the top of the game window
const _hv = new THREE.Vector3();
let hudKey = '';
function placeHud() {
  if (hud.hidden) return;
  const sr = stage.getBoundingClientRect(), cr = cv.getBoundingClientRect();
  if (!sr.width || !cr.width) return;
  _hv.set(X(PX_R + 5), Y(BAT_Y + 4), 0).project(camera);
  const sx = (_hv.x + 1) / 2 * cr.width + (cr.left - sr.left), sy = (1 - _hv.y) / 2 * cr.height + (cr.top - sr.top);
  // try two rows beside the pipe, then a single column, then fall back to the top bar
  const room = sr.width - sx - 16;
  const key = Math.round(room) + '|' + Math.round(sy) + '|' + sr.height;
  if (key === hudKey) return; hudKey = key;
  let mode = 'top';
  for (const m of ['side', 'side narrow']) {
    hud.className = 'hud ' + m;
    if (hud.offsetWidth <= room) { mode = m; break; }
  }
  if (mode === 'top') { hud.className = 'hud'; hud.style.left = ''; hud.style.top = ''; return; }
  const h = hud.offsetHeight;
  hud.style.left = Math.round(sx + 14) + 'px';
  hud.style.top = Math.round(Math.max(8, Math.min(sr.height - h - 8, sy - h / 2))) + 'px';
}
// pause menu: in the free column right of the play area (above the score), never over the bricks
function placePause() {
  if (pauseCard.hidden) return;
  const box = pauseCard.querySelector('.box'); if (!box) return;
  const sr = stage.getBoundingClientRect(), cr = cv.getBoundingClientRect();
  if (!sr.width || !cr.width) return;
  _hv.set(X(PX_R + 5), Y(10), 0).project(camera);
  const sx = (_hv.x + 1) / 2 * cr.width + (cr.left - sr.left), sy = (1 - _hv.y) / 2 * cr.height + (cr.top - sr.top);
  const room = sr.width - sx - 28;
  if (room < 170) { box.style.cssText = ''; pauseCard.classList.remove('side'); return; }   // no room beside it: centred as before
  pauseCard.classList.add('side');
  box.style.position = 'absolute'; box.style.width = Math.min(240, room) + 'px';
  box.style.left = Math.round(sx + 14) + 'px';
  box.style.top = Math.round(Math.max(8, sy)) + 'px';
}
let lastTimers = '';
function updateHud() {
  placeHud(); placePause();
  const power = G.ice > 0 ? 'ICEBERG ' + Math.ceil(G.ice / 50) : G.grenade ? 'GRENADE' : G.pierce > 0 ? 'NEUTRINO ' + Math.ceil(G.pierce / 50) : G.replicant ? 'REPLICANT ' + Math.ceil(G.replicantTime / 50) : G.laser ? 'LASER' + (G.laserTime > 0 ? ' ' + Math.ceil(G.laserTime / 50) : '') : G.catching ? 'CATCH' : G.batTarget === 18 ? 'EXPAND' : G.warp ? 'BREAK' : G.speed === 0 ? 'SLOW' : '–';
  // power-up countdowns, big and red in the side panel (they used to sit under the bat)
  const tm = [];
  if (G.mode === 'play' || G.mode === 'intro') {
    if (G.ice > 0) tm.push(['Iceberg', G.ice]);
    if (G.pierce > 0) tm.push(['Neutrino', G.pierce]);
    if (G.laser && G.laserTime > 0) tm.push(['Laser', G.laserTime]);
    if (G.replicant && G.replicantTime > 0) tm.push(['Replicant', G.replicantTime]);
  }
  const tkey = tm.map(([n, f]) => n + Math.ceil(f / 50)).join('|');
  if (tkey !== lastTimers) { lastTimers = tkey; $('hTimers').innerHTML = tm.map(([n, f]) => `<div class="t" title="${n}"><b>${Math.ceil(f / 50)}</b></div>`).join(''); }
  const key = [G.score, G.top, G.round, G.lives, power].join('|');
  if (key === lastHud) return; lastHud = key;
  $('hScore').textContent = pad(G.score, 7); $('hTop').textContent = pad(Math.max(G.top, G.score), 7);
  $('hRound').textContent = pad(G.round, 2); $('hLives').textContent = String(G.lives); $('hPower').textContent = power;
}

// message layer
let faceCanvases = [];
function setMsg(html) { msg.innerHTML = html; }
/* ---------- progress: saved at the start of every round (and after a lost life) ---------- */
const SAVE_KEY = 'giganoid3d-save';
function readSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && s.round >= 1 && s.round <= lastRound() ? s : null; } catch (e) { return null; } }
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ round: G.round, score: G.score, lives: G.lives, nextLife: G.nextLife, at: Date.now() })); } catch (e) {} }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
function refreshContinue() {
  const s = readSave(), b = $('btnContinue');
  b.hidden = !s;
  if (s) b.textContent = 'Continue · round ' + pad(s.round, 2) + ' · ' + pad(s.score, 7);
}
function continueGame() {
  const s = readSave(); if (!s) return;
  audioInit(); grabPointer();
  G.score = s.score | 0; G.lives = Math.max(0, s.lives | 0); G.nextLife = s.nextLife || LIFE_EVERY;
  buildRound(s.round); newLife(); go('intro');
}
$('btnContinue').addEventListener('click', continueGame);

function onMode(m) {
  faceCanvases = [];
  if (m === 'intro' && G.grid) writeSave();
  if (m === 'over' || m === 'win') clearSave();
  if (m === 'title') refreshContinue();
  if (m === 'title') { showOnly(titleCard); $('titleTop').textContent = 'Top score ' + pad(G.top, 7); setMsg(''); }
  else if (m === 'over' || m === 'win') {
    showOnly(overCard);
    $('overTitle').textContent = m === 'win' ? 'All ' + lastRound() + ' rounds cleared' : 'Game over';
    $('overText').textContent = 'Score ' + pad(G.score, 7) + (G.newTop || m === 'win' ? ' · new top score' : '') + ' · round ' + G.round;
    setMsg('');
    releasePointer();
  }
  else showOnly(null);
  if (m === 'intro') {
    if (G.bossNo) setMsg('<div class="sub">The</div><div class="big">' + (G.bossNo === 1 ? 'Gatekeeper' : 'Grand Master') + '</div><div class="sub">Round ' + pad(G.round, 2) + '</div>');
    else setMsg('<div class="big">' + roundLabel(G.round) + '</div><div class="sub">Ready</div>');
  }
  if (m === 'play' || m === 'dead') setMsg('');
  if (m === 'clear') setMsg('<div class="big">Round clear</div><div class="sub" id="bonusLine">Bonus</div>');
  if (m === 'warp') setMsg('<div class="big">Break out</div><div class="sub">Bonus</div>');
  if (m === 'inter') {
    setMsg('<div class="sub">Prepare to meet</div><div class="big">The Demons</div><div class="faces"><canvas></canvas><canvas></canvas><canvas></canvas></div>');
    faceCanvases = [...msg.querySelectorAll('canvas')];
  }
  if (m === 'dchoose') setMsg('<div class="sub demonhint">Shoot the ball into a box</div>');
  if (m === 'demons') {
    const n = G.dem ? G.dem.n : 1;
    setMsg('<div class="big">Level ' + ['I', 'II', 'III', 'IV'][n - 1] + '</div><div class="sub">Catch ' + n + (n > 1 ? ' balls' : ' ball') + ' and send ' + (n > 1 ? 'them' : 'it') + ' back</div>');
  }
  if (m === 'dresult') {
    const D = G.dem;
    if (D && D.success) setMsg('<div class="sub">Congratulations!! You defeated</div><div class="big">The Demons</div><div class="sub">and are awarded with a ' + ['one', 'two', 'three', 'four'][D.n - 1] + '-jump spell · next: round ' + pad(Math.min(50, D.target + D.n), 2) + '</div>');
    else setMsg('<div class="sub">Sorry!! But you were defeated by</div><div class="big">The Demons</div><div class="sub">Next round ' + pad(D ? D.target : G.round, 2) + '</div>');
  }
  updateStatus();
}
function animateMessages() {
  if (G.mode === 'demons' && G.t === 110) setMsg('');
  if (G.mode === 'inter' && faceCanvases.length) {
    const f = [0, 1, 2, 1][(G.t >> 3) & 3];
    faceCanvases.forEach((c, i) => indexedToCanvas(A.god[(f + i) % 3], PAL.demon || PAL.normal, 2, c));
  }

}

HOOKS.status = () => updateStatus();
FX.mode = m => onMode(m);
function updateStatus() {
  $('btnPause').textContent = G.paused ? 'Resume' : 'Pause';
  $('btnMute').textContent = muted ? 'Sound off' : 'Sound on';
  $('btnCam').textContent = 'Camera: ' + VIEW.mode;
  $('pCam').textContent = 'Camera: ' + VIEW.mode; $('tCam').textContent = 'Camera: ' + VIEW.mode;
  $('pSound').textContent = muted ? 'Sound off' : 'Sound on';
  const s = $('status');
  if (!M) s.textContent = 'Reads the game from your own Amiga disk image';
  else if (G.mode === 'title') s.textContent = 'Disk loaded · top score ' + G.top;
  else s.textContent = 'Round ' + G.round + ' of ' + lastRound() + (G.round > 50 ? ' · ' + roundLabel(G.round) : '') + (G.paused ? ' · paused' : '');
}

/* ---------- title demo: show round 1 behind the title card ---------- */
function toTitle() {
  if (!M) return;
  buildRound(1); newLife(); G.balls = [];
  go('title');
  if (AC && AC.state === 'running' && !chan[0]) play(SND.intro, 0, true);
}

function begin(i) {
  audioInit(); grabPointer();
  startGame(START_ROUND[i]);
}
titleCard.querySelectorAll('[data-lv]').forEach(b => b.addEventListener('click', () => begin(+b.dataset.lv)));
titleCard.addEventListener('pointerdown', () => { audioInit(); if (!chan[0] && SND) play(SND.intro, 0, true); });
$('btnAgain').addEventListener('click', () => { audioInit(); toTitle(); });

/* ---------- input ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
function pointerToPx(clientX, clientY) {
  const r = cv.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane0, hit) ? hit.x + (PL + PR) / 2 : null;   // world x is centred on the playfield
}
const locked = () => document.pointerLockElement === cv;
function grabPointer() { try { const p = cv.requestPointerLock && cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
function releasePointer() { try { if (locked()) document.exitPointerLock(); } catch (e) {} }

cv.addEventListener('mousemove', e => {
  if (PHOTO.on) return;
  if (locked()) { let mv = e.movementX; if (SET.accel) mv *= 1 + Math.min(1.2, Math.abs(mv) * 0.03); INPUT.dx += mv * unitsPerPx() * 1.25 * SET.mouse / 100; }
  else if (liveMode()) { const px = pointerToPx(e.clientX, e.clientY); if (px !== null) INPUT.abs = px; }
});
// middle mouse button pauses / resumes anywhere in the game window (and never auto-scrolls)
stage.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
stage.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
stage.addEventListener('pointerdown', e => {
  if (e.button !== 1 || !M || PHOTO.on) return;
  e.preventDefault();
  if (!$('settings').hidden) return;
  togglePause();
});
cv.addEventListener('pointerdown', e => {
  if (e.button === 1 || PHOTO.on) return;   // middle button is pause, not fire
  audioInit();
  if (e.pointerType === 'touch') { const px = pointerToPx(e.clientX, e.clientY); if (px !== null) INPUT.abs = px; }
  else if (!locked() && liveMode()) grabPointer();
  G.fire = true;
});
// auto-fire: holding the left button (or Space) keeps the lasers firing
let fireHeld = false;
cv.addEventListener('pointerdown', e => { if (e.button === 0 && !PHOTO.on) fireHeld = true; });
window.addEventListener('pointerup', e => { if (e.button === 0) fireHeld = false; });
window.addEventListener('blur', () => { fireHeld = false; });
function autoFire() {
  G.fireHeld = fireHeld || keys.has('Space');   // the engine uses this to loop the laser sound while held
  if (G.mode !== 'play' || G.paused || !(fireHeld || keys.has('Space'))) return;
  // C power-up: while the button is held a caught ball leaves the bat straight away, as without C
  if (G.catching && G.balls.some(b => b.stuck && !b.dead)) { G.fire = true; return; }
  if (SET.autofire === false || !(G.laser && G.batF === 0) || G.balls.some(b => b.stuck)) return;
  G.fire = true; G.autoFiring = true;   // held-button auto-fire: the engine paces these 20% slower than tapping
}
cv.addEventListener('pointermove', e => { if (e.pointerType === 'touch') { const px = pointerToPx(e.clientX, e.clientY); if (px !== null) INPUT.abs = px; } });

window.addEventListener('keydown', e => {
  if (PHOTO.on) {   // photo mode: only its own keys
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); toggleSlow(); }
    else if (e.code === 'Escape') { e.preventDefault(); exitPhoto(); }
    else if (e.code === 'KeyF') { e.preventDefault(); exitPhoto(); setPaused(false); }   // F: straight back into the game
    return;
  }
  if (e.code === 'Escape' && !setDlg.hidden) { closeSettings(); return; }
  if (!lvlDlg.hidden) { if (e.code === 'Escape' || e.code === 'KeyJ') { closeLevels(); e.preventDefault(); } return; }
  if (e.code === 'KeyJ' && M && setDlg.hidden) { openLevels(); return; }
  if (!edDlg.hidden) {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) edRestore(ED.redo, ED.undo); else edRestore(ED.undo, ED.redo); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); edRestore(ED.redo, ED.undo); return; }
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape' || e.code === 'KeyK') { closeEditor(); e.preventDefault(); } return;
  }
  if (e.code === 'KeyK' && M && setDlg.hidden) { openEditor(); return; }
  if (!M || !setDlg.hidden) return;
  const k = e.code;
  if (['ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
  keys.add(k); audioInit();
  if (G.mode === 'title' && /^Digit[1-4]$/.test(k)) begin(+k.slice(5) - 1);
  else if (G.mode === 'title' && (k === 'Space' || k === 'Enter')) { if (readSave()) continueGame(); else begin(0); }
  else if ((G.mode === 'over' || G.mode === 'win') && (k === 'Space' || k === 'Enter')) toTitle();
  else if (k === 'Space' || k === 'Enter') G.fire = true;
  if (k === 'KeyP') togglePause();
  if (k === 'KeyF' && liveMode()) startPhoto();
  if (k === 'KeyS') { if ($('settings').hidden) openSettings(); else closeSettings(); }
  if (k === 'KeyU') toggleMute();
  if (k === 'KeyV') toggleCam();
  if (k === 'KeyT' && G.mode === 'play' && !G.paused) tilt();   // TILT: shake free a stuck ball
  // [ / ]: skip to the previous / next round (keeps score and lives)
  if ((k === 'BracketLeft' || k === 'BracketRight') && ['play', 'intro', 'clear'].includes(G.mode) && !G.paused) {
    const r = Math.max(1, Math.min(lastRound(), G.round + (k === 'BracketRight' ? 1 : -1)));
    if (r !== G.round) { buildRound(r); newLife(); go('intro'); }
  }
  if (k === 'KeyE' && !e.repeat) G.toyBat = !G.toyBat;          // E toggles the novelty "toy" bat on/off
  // power-up shortcuts during play
  const pk = { KeyE: 2, KeyC: 1, KeyL: 5, KeyB: 7, KeyD: 4, KeyN: 8, KeyM: 9, KeyG: 10, KeyI: 11, KeyR: 12 }[k];
  if (pk && G.mode === 'play' && !G.paused) takeCapsule(pk);
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); if (liveMode() && G.mode !== 'intro') { G.paused = true; updateStatus(); } });

function setPaused(p) {
  if (!liveMode()) return;
  if (!p && PHOTO.on) exitPhoto();
  G.paused = p;
  if (!p) grabPointer(); else releasePointer();
  syncPause(); updateStatus();
}
function startPhoto() {
  if (!liveMode()) return;
  if (!G.paused) setPaused(true);
  releasePointer(); enterPhoto(); updateStatus(); syncPause();
}
onPhotoExit(() => { updateStatus(); syncPause(); });
// a "Photo mode" entry in the pause menu
{ const b = document.createElement('button'); b.type = 'button'; b.id = 'pPhoto'; b.textContent = 'Photo mode (F)';
  const r = $('pResume'); if (r) r.after(b); b.addEventListener('click', startPhoto); }
function togglePause() { setPaused(!G.paused); }
// Esc releases the pointer: treat that as "pause" so the menu appears inside the game window
let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  const now = locked();
  if (hadLock && !now && liveMode() && !G.paused && $('settings').hidden) setPaused(true);
  hadLock = now;
});
$('pResume').addEventListener('click', () => setPaused(false));
$('pSettings').addEventListener('click', () => openSettings());
$('pCam').addEventListener('click', () => toggleCam());
$('pSound').addEventListener('click', () => { audioInit(); toggleMute(); });
$('pQuit').addEventListener('click', () => { G.paused = false; pauseCard.hidden = true; toTitle(); });
$('tSettings').addEventListener('click', () => openSettings());
$('tCam').addEventListener('click', () => toggleCam());
function toggleCam() { VIEW.mode = VIEW.mode === 'tilted' ? 'flat' : 'tilted'; try { localStorage.setItem('giganoid3d-cam2', VIEW.mode); } catch (e) {} updateStatus(); }
try { const c = localStorage.getItem('giganoid3d-cam2'); if (c === 'flat' || c === 'tilted') VIEW.mode = c; } catch (e) {}
$('btnPause').addEventListener('click', togglePause);
$('btnTilt').addEventListener('click', () => { if (G.mode === 'play' && !G.paused) tilt(); });
$('btnMute').addEventListener('click', () => { audioInit(); toggleMute(); });
$('btnCam').addEventListener('click', toggleCam);
$('btnFull').addEventListener('click', () => {
  try { const p = document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
});
$('btnDisk').addEventListener('click', () => { G.paused = false; stopChan(0); setMem(null); G.mode = 'load'; releasePointer(); showOnly(loaderCard); $('loadErr').textContent = ''; updateStatus(); });

/* ---------- settings dialog and replacement sounds ---------- */
const setDlg = $('settings');
let pausedBySettings = false;
function syncSettingsUI() {
  $('setSpeed').value = SET.speed; $('setSpeedOut').textContent = SET.speed + '%';
  $('setAngles').value = SET.angles; $('setAnglesOut').textContent = SET.angles;
  $('setDrop').value = SET.drop; $('setDropOut').textContent = SET.drop + '%';
  $('setShadow').value = SET.shadow; $('setShadowOut').textContent = SET.shadow + '%';
  $('setReverb').value = SET.reverb; $('setReverbOut').textContent = SET.reverb + '%';
  $('setMusic').value = SET.music; $('setMusicOut').textContent = SET.music > 0 ? SET.music + '%' : 'Off';
  $('setPulse').value = SET.pulse ?? 50; $('setPulseOut').textContent = (SET.pulse ?? 50) > 0 ? (SET.pulse ?? 50) + '%' : 'Off';
  $('setSfx').checked = SET.sfx !== false;
  $('setCustomBg').checked = SET.customBg !== false;
  $('setLowAudio').checked = !!SET.lowAudio;
  $('setFov').value = SET.fov; $('setFovOut').textContent = SET.fov + '°';
  $('setReach').value = SET.reach; $('setReachOut').textContent = SET.reach + '%';
  $('setClassic').checked = !!SET.classic;
  $('setTaper').checked = SET.taper !== false; $('setTaper').disabled = !!SET.classic || !!SET.curved || !!SET.arkBat;
  $('setCurved').checked = !!SET.curved; $('setCurved').disabled = !!SET.classic || !!SET.arkBat;
  $('setArkBat').checked = !!SET.arkBat; $('setArkBat').disabled = !!SET.classic;
  $('setAccel').checked = !!SET.accel;
  $('setMirror').checked = SET.mirror !== false;
  $('setTrails').checked = !!SET.trails;
  $('setDust').checked = SET.dust !== false;
  $('setCA').checked = SET.ca !== false;
  $('setAA').checked = SET.aa !== false;
  $('setAutofire').checked = SET.autofire !== false;
  const pi = packInfo();
  $('setPack').checked = SET.pack !== false; $('setPack').disabled = !pi.length; $('packClear').disabled = !pi.length;
  $('packInfo').textContent = pi.length
    ? 'After round 50: ' + pi.map(p => `${p.name} (${p.n} rounds)`).join(', then ') + ` · ${lastRound()} rounds in all.` + (pi.some(p => p.stale) ? ' Load the Revenge of Doh disk again to get its regenerating bricks.' : '')
    : 'Load your Arkanoid, Revenge of Doh, Amegas and Crystal Hammer disks (.adf) to carry on with their rounds after Giganoid\'s 50.';
  // classic plays by the original rules, so the rule sliders are locked while it is on
  for (const id of ['setSpeed', 'setAngles', 'setDrop']) $(id).disabled = !!SET.classic;
  $('setAngles').disabled = !!SET.classic || !!SET.arkBat;
  $('setFps').checked = !!SET.fps; $('fps').hidden = !SET.fps;
  $('setMouse').value = SET.mouse; $('setMouseOut').textContent = SET.mouse + '%';
  $('setGlow').value = SET.glow; $('setGlowOut').textContent = SET.glow + '%';
  const ks = [...CUSTOM.keys()].sort();
  $('sndList').innerHTML = ks.length ? ks.map(k => { const v = CUSTOM.get(k), n = Array.isArray(v) ? v.length : 1; return '<li>' + k + (n > 1 ? ' · ' + n + ' variations' : '') + '</li>'; }).join('') : '<li>Original sounds from your disk</li>';
}
function openSettings() {
  if (liveMode() && !G.paused) { G.paused = true; pausedBySettings = true; updateStatus(); }
  releasePointer(); syncSettingsUI(); setDlg.hidden = false; syncPause(); $('setClose').focus();
}
function closeSettings() {
  setDlg.hidden = true;
  if (pausedBySettings) { pausedBySettings = false; setPaused(false); }
  else syncPause();          // opened from the pause menu: go back to it
}
$('btnSettings').addEventListener('click', openSettings);
$('btnEditor').addEventListener('click', () => openEditor());
$('btnHelp').addEventListener('click', () => { const k = $('keys'); k.hidden = !k.hidden; $('btnHelp').setAttribute('aria-expanded', String(!k.hidden)); });
$('setClose').addEventListener('click', closeSettings);
setDlg.addEventListener('click', e => { if (e.target === setDlg) closeSettings(); });
$('setSpeed').addEventListener('input', e => { SET.speed = +e.target.value; rebuildSpeed(); saveSettings(); syncSettingsUI(); });
$('setAngles').addEventListener('input', e => { SET.angles = +e.target.value; rebuildSpeed(); saveSettings(); syncSettingsUI(); });
$('setDrop').addEventListener('input', e => { SET.drop = +e.target.value; saveSettings(); syncSettingsUI(); });
$('setShadow').addEventListener('input', e => { SET.shadow = +e.target.value; applyShadowStrength(); saveSettings(); syncSettingsUI(); });
$('setReverb').addEventListener('input', e => { SET.reverb = +e.target.value; setReverb(SET.reverb); saveSettings(); syncSettingsUI(); });
$('setMusic').addEventListener('input', e => { SET.music = +e.target.value; musicSetVol(SET.music); saveSettings(); syncSettingsUI(); });
$('setPulse').addEventListener('input', e => { SET.pulse = +e.target.value; musicSetVol(SET.music); saveSettings(); syncSettingsUI(); });
$('setCustomBg').addEventListener('change', e => { SET.customBg = e.target.checked; saveSettings(); if (G.grid) applyBackground(); });
$('setSfx').addEventListener('change', e => { SET.sfx = e.target.checked; setSfx(SET.sfx); saveSettings(); });
$('setLowAudio').addEventListener('change', e => { SET.lowAudio = e.target.checked; setLowAudio(SET.lowAudio); saveSettings(); });
$('setFov').addEventListener('input', e => { SET.fov = +e.target.value; applyFov(); saveSettings(); syncSettingsUI(); });
$('setReach').addEventListener('input', e => { SET.reach = +e.target.value; applyBallLight(); saveSettings(); syncSettingsUI(); });
$('setClassic').addEventListener('change', e => { SET.classic = e.target.checked; rebuildSpeed(); saveSettings(); refreshCapsules(); syncSettingsUI(); });
$('setArkBat').addEventListener('change', e => { SET.arkBat = e.target.checked; rebuildSpeed(); saveSettings(); syncSettingsUI(); });
$('setCurved').addEventListener('change', e => { SET.curved = e.target.checked; saveSettings(); syncSettingsUI(); });
$('setTaper').addEventListener('change', e => { SET.taper = e.target.checked; rebuildSpeed(); saveSettings(); });
$('setAccel').addEventListener('change', e => { SET.accel = e.target.checked; saveSettings(); });
$('setTrails').addEventListener('change', e => { SET.trails = e.target.checked; saveSettings(); });
$('setDust').addEventListener('change', e => { SET.dust = e.target.checked; saveSettings(); });
$('setCA').addEventListener('change', e => { SET.ca = e.target.checked; saveSettings(); });
$('setAA').addEventListener('change', e => { SET.aa = e.target.checked; saveSettings(); });
$('setAutofire').addEventListener('change', e => { SET.autofire = e.target.checked; saveSettings(); });
$('setPack').addEventListener('change', e => { SET.pack = e.target.checked; saveSettings(); syncSettingsUI(); });
$('packInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    // an Arkanoid disk image: read its rounds straight from the disk; anything else: a text/JSON level file
    if (buf.length >= 901120 && buf[0] === 0x44 && buf[1] === 0x4f && buf[2] === 0x53) loadArkanoidAdf(buf);
    else loadPackText(new TextDecoder().decode(buf), f.name.replace(/\.[^.]+$/, ''));
    SET.pack = true; saveSettings(); syncSettingsUI();
  }
  catch (err) { $('packInfo').textContent = 'Could not read levels from that file: ' + err.message; }
});
$('packClear').addEventListener('click', () => { clearPacks(); syncSettingsUI(); });
$('setMirror').addEventListener('change', e => { SET.mirror = e.target.checked; saveSettings(); });
$('setFps').addEventListener('change', e => { SET.fps = e.target.checked; saveSettings(); syncSettingsUI(); });
$('setMouse').addEventListener('input', e => { SET.mouse = +e.target.value; saveSettings(); syncSettingsUI(); });
$('setGlow').addEventListener('input', e => { SET.glow = +e.target.value; applyGlow(); saveSettings(); syncSettingsUI(); });
$('setDefaults').addEventListener('click', () => { Object.assign(SET, SET_DEFAULTS); rebuildSpeed(); applyGlow(); applyBallLight(); applyFov(); applyShadowStrength(); refreshCapsules(); refreshCapsules(); saveSettings(); syncSettingsUI(); });
async function saveCustom() { try { const db = await idb(); db.transaction('f', 'readwrite').objectStore('f').put(Object.fromEntries(CUSTOM), 'sounds'); } catch (e) {} }
async function loadCustom() {
  try {
    const db = await idb();
    const v = await new Promise(res => { const q = db.transaction('f').objectStore('f').get('sounds'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
    if (v) for (const [k, b] of Object.entries(v)) CUSTOM.set(k, b);
  } catch (e) {}
}
$('sndInput').addEventListener('change', async e => {
  audioInit();
  // files that map to the same sound become its round-robin variations (e.g. sfx_03a.wav, sfx_03b.wav)
  const got = new Map();
  for (const f of e.target.files) { const k = soundKey(f.name); if (!k) continue; if (!got.has(k)) got.set(k, []); got.get(k).push(await f.arrayBuffer()); }
  for (const [k, list] of got) CUSTOM.set(k, list);
  e.target.value = '';
  await applyCustomSounds(); saveCustom(); syncSettingsUI();
});
$('sndReset').addEventListener('click', async () => { CUSTOM.clear(); await applyCustomSounds(); saveCustom(); syncSettingsUI(); });


/* ---------- level selector (J): every round, grouped by game; jump straight to any of them ---------- */
const lvlDlg = document.createElement('div'); lvlDlg.className = 'dialog'; lvlDlg.id = 'levelSel'; lvlDlg.hidden = true;
lvlDlg.innerHTML = '<div class="panel"><h2>Jump to a round</h2><p class="hint" id="lvlHint"></p><div id="lvlGroups"></div><div class="row"><button type="button" id="lvlClose">Close</button></div></div>';
stage.appendChild(lvlDlg);
const lvlStyle = document.createElement('style');
lvlStyle.textContent = '#levelSel .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px;margin:6px 0 12px}' +
  '#levelSel .grid button{padding:4px 4px 5px;display:flex;flex-direction:column;align-items:center;gap:3px;font:600 12px/1 var(--display);font-variant-numeric:tabular-nums}' +
  '#levelSel .grid canvas{width:100%;aspect-ratio:66/56;border-radius:4px;background:#0b0a12;image-rendering:pixelated}' +
  '#levelSel .grid button.cur{outline:2px solid var(--gold)}#levelSel .grid button.boss{color:var(--gold)}';
document.head.appendChild(lvlStyle);
let lvlPaused = false;
let lvlPick = null;
function openLevels(pick) {
  if (!M || G.mode === 'load') return;
  lvlPick = pick || null; lvlDlg.style.zIndex = pick ? '40' : '';
  if (!pick && liveMode() && !G.paused) { G.paused = true; lvlPaused = true; updateStatus(); }
  releasePointer();
  const groups = [{ name: 'Giganoid', from: 1, to: 50 }];
  let r = 51; for (const p of packInfo()) { if (SET.pack !== false) groups.push({ name: p.name, from: r, to: r + p.n - 1 }); r += p.n; }
  const inGame = G.mode !== 'title' && G.mode !== 'over' && G.mode !== 'win';
  $('lvlHint').textContent = lvlPick ? 'Pick a round to copy into the editor as a new level.' : inGame ? 'Your score and ships carry over.' : 'Starts a new game from the round you pick.';
  lvlDlg.querySelector('h2').textContent = lvlPick ? 'Copy a round' : 'Jump to a round';
  $('lvlGroups').innerHTML = groups.map(g => `<h3>${g.name}</h3><div class="grid">` +
    Array.from({ length: g.to - g.from + 1 }, (_, k) => { const n = g.from + k, lab = n <= 50 ? n : k + 1;
      return `<button type="button" data-round="${n}" class="${n === G.round && inGame ? 'cur' : ''}${n === 25 || n === 50 ? ' boss' : ''}" title="${roundLabel(n)}"><canvas width="66" height="56"></canvas>${lab}</button>`; }).join('') + '</div>').join('');
  lvlDlg.hidden = false; syncPause();
  drawThumbs();
}
// small previews: the round's background with its bricks, drawn a few at a time so the dialog opens at once
const thumbCache = new Map(), PACK_HEX = { 101: '#f2f2f2', 102: '#ff8a1c', 103: '#4fd6ff', 104: '#35cf4a', 105: '#e8322a', 106: '#2f5bff', 107: '#ff5bd0', 108: '#ffe23a', 109: '#c9ccd4', 110: '#e0a82a' };
const hex12 = w => '#' + [(w >> 8) & 15, (w >> 4) & 15, w & 15].map(v => (v * 17).toString(16).padStart(2, '0')).join('');
function brickHex(t, pal) {
  if (PACK_HEX[t]) return PACK_HEX[t];
  if (t === 2) return '#d8b040';
  const img = A['brick' + t]; if (!img) return '#ccc';
  const cnt = new Map();
  for (let y = 0; y < 5; y++) for (let x = 1; x < 15; x++) { const v = img.d[y * img.w + x]; if (v !== 255) cnt.set(v, (cnt.get(v) || 0) + 1); }
  let best = 1, n = -1; for (const [k, c] of cnt) if (c > n) { n = c; best = k; }
  return hex12(pal[best & 31]);
}
function makeThumb(r) {
  const key = r + '|' + packInfo().map(p => p.id + p.n).join(',') + '|' + SET.pack;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const pv = previewRound(r), c = document.createElement('canvas'); c.width = 66; c.height = 56;
  const x = c.getContext('2d');
  if (pv) {
    const bg = indexedToCanvas(pv.bg, pv.pal, 1);
    x.globalAlpha = 0.55; x.drawImage(bg, 6, 8, 221, 190, 0, 0, 66, 56); x.globalAlpha = 1;
    if (pv.boss) { const bc = indexedToCanvas(pv.boss.img, pv.pal, 1); x.drawImage(bc, (pv.boss.x - 6) * 66 / 221, (pv.boss.y - 8) * 56 / 190, 112 * 66 / 221, 101 * 56 / 190); }
    const bp = pv.bpx || 17, bw = Math.max(2, Math.round(((pv.bw || 16) / 16) * 4));
    for (let rr = 0; rr < pv.grid.length; rr++) for (let cc = 0; cc < pv.grid[rr].length; cc++) {
      const cell = pv.grid[rr][cc]; if (!cell) continue;
      x.fillStyle = brickHex(cell.t, pv.pal);
      x.fillRect(Math.round(cc * bp * 66 / 221), Math.round((rr * 7 + 4) * 56 / 190), bw, 2);
    }
  }
  thumbCache.set(key, c); return c;
}
function drawThumbs() {
  const btns = [...lvlDlg.querySelectorAll('button[data-round]')]; let i = 0;
  const step = () => {
    if (lvlDlg.hidden) return;
    const end = Math.min(btns.length, i + 8);
    for (; i < end; i++) { const b = btns[i], cv2 = b.querySelector('canvas'); try { cv2.getContext('2d').drawImage(makeThumb(+b.dataset.round), 0, 0); } catch (e) {} }
    if (i < btns.length) setTimeout(step, 0);
  };
  step();
}
function closeLevels(resume = true) {
  lvlDlg.hidden = true; if (lvlPick) { lvlPick = null; lvlDlg.style.zIndex = ''; return; }
  if (lvlPaused && resume) { lvlPaused = false; setPaused(false); } else { lvlPaused = false; syncPause(); }
}
function jumpTo(r) {
  const inGame = G.mode !== 'title' && G.mode !== 'over' && G.mode !== 'win';
  lvlDlg.hidden = true; lvlPaused = false; G.paused = false;
  G.dem = null;
  if (inGame) { buildRound(r); newLife(); go('intro'); } else startGame(r);
  showOnly(null); syncPause(); updateStatus(); grabPointer();
}
lvlDlg.addEventListener('click', e => { const b = e.target.closest('button[data-round]'); if (!b) return; if (lvlPick) { const f = lvlPick; lvlPick = null; lvlDlg.hidden = true; lvlDlg.style.zIndex = ''; f(+b.dataset.round); } else jumpTo(+b.dataset.round); });
$('lvlClose').addEventListener('click', () => closeLevels());


/* ---------- level editor (K): make, edit, duplicate and play your own rounds ---------- */
const ED_COL = ['', '#f2f2f2', '#ff8a1c', '#4fd6ff', '#35cf4a', '#e8322a', '#2f5bff', '#ff5bd0', '#ffe23a', '#c9ccd4', '#e0a82a'];
const ED_NAME = ['Eraser', 'White', 'Orange', 'Light blue', 'Green', 'Red', 'Blue', 'Pink', 'Yellow', 'Silver (several hits)', 'Gold (unbreakable)'];
const edDlg = document.createElement('div'); edDlg.className = 'dialog'; edDlg.id = 'editor'; edDlg.hidden = true;
edDlg.innerHTML = `<div class="panel"><h2>Level editor</h2>
<div class="edwrap">
  <div class="edside">
    <h3>My levels</h3><select id="edList" size="8"></select>
    <div class="row"><button type="button" id="edNew">New</button><button type="button" id="edDup">Duplicate</button><button type="button" id="edDel">Delete</button></div>
    <h3>Copy a round</h3>
    <div class="row"><button type="button" id="edBrowse">Browse rounds…</button><input type="number" id="edFrom" min="1" value="1" style="width:5em"><button type="button" id="edCopy">Copy</button></div>
    <p class="hint" id="edFromName"></p>
    <h3>Tool</h3>
    <div class="row" id="edTools"><button type="button" data-tool="pen">Pencil</button><button type="button" data-tool="line">Line</button><button type="button" data-tool="rect">Box</button><button type="button" data-tool="fill">Fill</button><button type="button" id="edClear">Clear</button></div>
    <div class="row"><button type="button" id="edUndo" title="Ctrl+Z">Undo</button><button type="button" id="edRedo" title="Ctrl+Y / Ctrl+Shift+Z">Redo</button></div>
    <h3>Brick</h3><div id="edPal"></div>
    <p class="hint">Alt + click (or right click) erases: with Line or Box, Alt + drag clears that line or box. Line and box: press, drag, release.</p>
  </div>
  <div class="edmain"><canvas id="edCanvas" width="442" height="378"></canvas>
    <div class="row"><button type="button" id="edPlay" class="continue">Play this level</button><button type="button" id="edClose">Close</button></div>
    <p class="hint" id="edInfo"></p></div>
</div></div>`;
stage.appendChild(edDlg);
const edCss = document.createElement('style');
edCss.textContent = '#editor .edwrap{display:flex;gap:18px;flex-wrap:wrap}#editor .edside{flex:1 1 220px;display:flex;flex-direction:column;gap:8px;min-width:0}' +
  '#editor .edmain{flex:0 1 auto;display:flex;flex-direction:column;gap:8px}#editor select{background:#0e0d16;color:inherit;border:1px solid var(--edge);border-radius:8px;padding:4px;font:inherit}' +
  '#editor canvas{width:442px;max-width:100%;height:auto;border-radius:8px;cursor:crosshair;touch-action:none}#editor #edPal{display:grid;grid-template-columns:repeat(6,1fr);gap:5px}' +
  '#editor #edPal button{height:26px;padding:0;border-radius:6px}#editor .on{outline:2px solid var(--gold);outline-offset:1px}#editor input{background:#0e0d16;color:inherit;border:1px solid var(--edge);border-radius:6px;padding:4px}';
document.head.appendChild(edCss);
const ED = { levels: [], cur: -1, tool: 'pen', col: 5, drag: null, paused: false, undo: [], redo: [] };
// undo / redo: snapshots of the whole editor state (all levels + which one is open)
function edSnap() { return JSON.stringify({ l: ED.levels, c: ED.cur }); }
function edPush() { ED.undo.push(edSnap()); if (ED.undo.length > 100) ED.undo.shift(); ED.redo.length = 0; edUR(); }
function edRestore(from, to) { if (!from.length) return; to.push(edSnap()); const st = JSON.parse(from.pop()); ED.levels = st.l; ED.cur = st.c; edSave(); edDraw(); edUR(); }
function edUR() { const u = document.getElementById('edUndo'), r = document.getElementById('edRedo'); if (u) { u.disabled = !ED.undo.length; r.disabled = !ED.redo.length; } }
const blank = () => Array.from({ length: 18 }, () => new Array(13).fill(0));
const edCv = $('edCanvas'), edX = edCv.getContext('2d'), CW = 34, CH = 21;
function packIndexOf(cell, pal) {
  if (!cell) return 0;
  if (cell.t >= 101 && cell.t <= 110) return cell.t - 100;
  if (cell.gold || cell.t === 2) return 10;
  if (cell.t === 1) return 9;
  const h = brickHex(cell.t, pal), rgb = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  let best = 1, bd = 1e9;
  for (let k = 1; k <= 8; k++) { const q = [1, 3, 5].map(i => parseInt(ED_COL[k].slice(i, i + 2), 16)); const d = q.reduce((a, v, i) => a + (v - rgb[i]) ** 2, 0); if (d < bd) { bd = d; best = k; } }
  return best;
}
function edSave() { setMine(ED.levels); edRefreshList(); }
function edRefreshList() {
  const l = $('edList'); l.innerHTML = ED.levels.map((_, i) => `<option value="${i}">My level ${i + 1} · round ${51 + packInfo().filter(p => p.id !== 'mine').reduce((n, p) => n + p.n, 0) + i - 1 + 1}</option>`).join('');
  if (ED.cur >= 0) l.value = String(ED.cur);
  $('edDup').disabled = $('edDel').disabled = $('edPlay').disabled = ED.cur < 0;
}
function edDraw(preview) {
  const g = ED.cur >= 0 ? ED.levels[ED.cur] : blank();
  edX.fillStyle = '#0b0a12'; edX.fillRect(0, 0, edCv.width, edCv.height);
  edX.strokeStyle = 'rgba(255,255,255,.06)';
  for (let r = 0; r <= 18; r++) { edX.beginPath(); edX.moveTo(0, r * CH + .5); edX.lineTo(442, r * CH + .5); edX.stroke(); }
  for (let c = 0; c <= 13; c++) { edX.beginPath(); edX.moveTo(c * CW + .5, 0); edX.lineTo(c * CW + .5, 378); edX.stroke(); }
  const cell = (r, c, v, a) => { if (!v) return; edX.globalAlpha = a; edX.fillStyle = ED_COL[v]; edX.fillRect(c * CW + 2, r * CH + 2, CW - 3, CH - 3);
    if (v >= 9) { edX.fillStyle = 'rgba(0,0,0,.25)'; edX.fillRect(c * CW + 2, r * CH + CH - 6, CW - 3, 4); } edX.globalAlpha = 1; };
  for (let r = 0; r < 18; r++) for (let c = 0; c < 13; c++) cell(r, c, g[r][c], 1);
  if (preview) for (const [r, c] of preview) { const v = ED.drag && ED.drag.v === 0 ? 0 : ED.col; if (v) cell(r, c, v, 0.55); else { edX.strokeStyle = 'rgba(255,90,90,.9)'; edX.strokeRect(c * CW + 3, r * CH + 3, CW - 5, CH - 5); } }
  if (ED.cur < 0) { edX.fillStyle = '#9a96b0'; edX.font = '14px sans-serif'; edX.textAlign = 'center'; edX.fillText('Press New, or copy a round, to start', 221, 190); }
  const n = ED.cur >= 0 ? g.flat().filter(v => v && v !== 10).length : 0;
  $('edInfo').textContent = ED.cur >= 0 ? `${n} bricks to clear · saved automatically` : '';
}
function edCells(a, b) {
  if (ED.tool === 'line') {           // straight or diagonal line of bricks (Bresenham)
    const out = []; let [r0, c0] = a; const [r1, c1] = b, dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0), sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1; let e = dc - dr;
    for (;;) { out.push([r0, c0]); if (r0 === r1 && c0 === c1) break; const e2 = 2 * e; if (e2 > -dr) { e -= dr; c0 += sc; } if (e2 < dc) { e += dc; r0 += sr; } }
    return out;
  }
  const out = []; for (let r = Math.min(a[0], b[0]); r <= Math.max(a[0], b[0]); r++) for (let c = Math.min(a[1], b[1]); c <= Math.max(a[1], b[1]); c++) out.push([r, c]); return out;
}
function edAt(e) { const rc = edCv.getBoundingClientRect(); const x = (e.clientX - rc.left) * 442 / rc.width, y = (e.clientY - rc.top) * 378 / rc.height;
  return [Math.max(0, Math.min(17, Math.floor(y / CH))), Math.max(0, Math.min(12, Math.floor(x / CW)))]; }
function edFill(r, c, v) {
  const g = ED.levels[ED.cur], from = g[r][c]; if (from === v) return;
  const st = [[r, c]]; while (st.length) { const [y, x] = st.pop(); if (y < 0 || y > 17 || x < 0 || x > 12 || g[y][x] !== from) continue; g[y][x] = v; st.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]); }
}
edCv.addEventListener('contextmenu', e => e.preventDefault());
edDlg.addEventListener('contextmenu', e => { if (e.target === edCv) e.preventDefault(); });
edCv.addEventListener('mousedown', e => { if (e.button === 2) e.preventDefault(); });
edCv.addEventListener('pointerdown', e => {
  if (ED.cur < 0) return; edCv.setPointerCapture(e.pointerId);
  const at = edAt(e), erase = e.button === 2 || (e.buttons & 2) === 2 || (e.altKey && e.button === 0), v = erase ? 0 : ED.col, g = ED.levels[ED.cur];
  edPush();
  if (erase) {
    e.preventDefault();
    // right button: Line and Box clear along their shape; Pencil and Fill rub out bricks under the pointer
    if (ED.tool === 'line' || ED.tool === 'rect') { ED.drag = { a: at, b: at, v: 0 }; edDraw(edCells(at, at)); return; }
    g[at[0]][at[1]] = 0; ED.drag = { v: 0, erase: true }; edDraw(); return;
  }
  if (ED.tool === 'fill') { edFill(at[0], at[1], v); edSave(); edDraw(); return; }
  if (ED.tool === 'pen') { g[at[0]][at[1]] = v; ED.drag = { v }; edDraw(); return; }
  ED.drag = { a: at, b: at, v }; edDraw(edCells(at, at));
});
edCv.addEventListener('pointermove', e => {
  if (!ED.drag || ED.cur < 0) return; const at = edAt(e);
  if (ED.tool === 'pen' || ED.drag.erase) { ED.levels[ED.cur][at[0]][at[1]] = ED.drag.v; edDraw(); }
  else { ED.drag.b = at; edDraw(edCells(ED.drag.a, at)); }
});
edCv.addEventListener('pointerup', () => {
  if (!ED.drag) return;
  if (ED.tool !== 'pen' && !ED.drag.erase) for (const [r, c] of edCells(ED.drag.a, ED.drag.b)) ED.levels[ED.cur][r][c] = ED.drag.v;
  ED.drag = null; edSave(); edDraw();
});
$('edPal').innerHTML = ED_COL.map((c, i) => `<button type="button" data-col="${i}" title="${ED_NAME[i]}" style="background:${i ? c : 'repeating-linear-gradient(45deg,#222 0 4px,#444 4px 8px)'}"></button>`).join('');
function edMark() {
  edDlg.querySelectorAll('[data-col]').forEach(b => b.classList.toggle('on', +b.dataset.col === ED.col));
  edDlg.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === ED.tool));
}
$('edPal').addEventListener('click', e => { const b = e.target.closest('[data-col]'); if (b) { ED.col = +b.dataset.col; edMark(); } });
$('edTools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) { ED.tool = b.dataset.tool; edMark(); } });
$('edList').addEventListener('change', e => { ED.cur = +e.target.value; edRefreshList(); edDraw(); });
$('edNew').addEventListener('click', () => { edPush(); ED.levels.push(blank()); ED.cur = ED.levels.length - 1; edSave(); edDraw(); });
$('edDup').addEventListener('click', () => { if (ED.cur < 0) return; edPush(); ED.levels.push(ED.levels[ED.cur].map(r => r.slice())); ED.cur = ED.levels.length - 1; edSave(); edDraw(); });
$('edDel').addEventListener('click', () => { if (ED.cur < 0 || !confirm('Delete this level?')) return; edPush(); ED.levels.splice(ED.cur, 1); ED.cur = Math.min(ED.cur, ED.levels.length - 1); edSave(); edDraw(); });
$('edClear').addEventListener('click', () => { if (ED.cur < 0) return; edPush(); ED.levels[ED.cur] = blank(); edSave(); edDraw(); });
$('edFrom').addEventListener('input', () => { const r = +$('edFrom').value; $('edFromName').textContent = r >= 1 && r <= lastRound() ? roundLabel(r) : ''; });
function edCopyRound(r) {
  r = Math.max(1, Math.min(lastRound(), r | 0)); const pv = previewRound(r); if (!pv) return;
  edPush(); ED.levels.push(pv.grid.map(row => row.map(c => packIndexOf(c, pv.pal)))); ED.cur = ED.levels.length - 1; edSave(); edDraw();
}
$('edCopy').addEventListener('click', () => edCopyRound(+$('edFrom').value));
$('edBrowse').addEventListener('click', () => openLevels(r => { $('edFrom').value = r; $('edFrom').dispatchEvent(new Event('input')); edCopyRound(r); }));
$('edUndo').addEventListener('click', () => edRestore(ED.undo, ED.redo));
$('edRedo').addEventListener('click', () => edRestore(ED.redo, ED.undo));
$('edPlay').addEventListener('click', () => {
  if (ED.cur < 0) return;
  const before = packInfo().filter(p => p.id !== 'mine').reduce((n, p) => n + p.n, 0);
  const wasPack = SET.pack; SET.pack = true; saveSettings();
  closeEditor(false); jumpTo(51 + before + ED.cur);
  if (!wasPack) syncSettingsUI();
});
function openEditor() {
  if (!M || G.mode === 'load') return;
  if (liveMode() && !G.paused) { G.paused = true; ED.paused = true; updateStatus(); }
  releasePointer();
  ED.levels = getMine(); if (ED.cur >= ED.levels.length) ED.cur = ED.levels.length - 1; if (ED.cur < 0 && ED.levels.length) ED.cur = 0;
  $('edFrom').max = lastRound(); $('edFrom').dispatchEvent(new Event('input'));
  ED.undo.length = 0; ED.redo.length = 0; edUR();
  edRefreshList(); edMark(); edDraw(); edDlg.hidden = false; syncPause();
}
function closeEditor(resume = true) {
  edDlg.hidden = true;
  if (ED.paused && resume) { ED.paused = false; setPaused(false); } else { ED.paused = false; syncPause(); }
}
$('edClose').addEventListener('click', () => closeEditor());

/* ---------- main loop: 50 Hz simulation, interpolated rendering ---------- */
let last = 0, acc = 0, pacc = 0;
// frame-rate counter: frames drawn over the last half second
const fpsEl = $('fps'); let fpsFrames = 0, fpsFrom = 0;
function countFrame(now) {
  fpsFrames++;
  if (now - fpsFrom >= 500) { if (SET.fps) fpsEl.textContent = Math.round(fpsFrames * 1000 / (now - fpsFrom)) + ' fps'; fpsFrames = 0; fpsFrom = now; }
}
function loop(now) {
  countFrame(now);
  if (!last) last = now;
  const dt = Math.min(250, now - last); last = now;
  // photo mode: the game can run on in very slow motion (Enter toggles)
  const rate = PHOTO.on ? photoRate() : 0;
  if (PHOTO.on) {
    pacc += dt * rate;
    while (pacc >= 20) { pacc -= 20; if (M && liveMode()) { try { update(); stepParticles(); } catch (err) { console.error(err); } } }
  } else acc += dt;
  while (acc >= 20) {
    acc -= 20;
    if (M && G.mode !== 'load' && !G.paused) {
      try { autoFire(); update(); stepParticles(); } catch (err) { console.error(err); }
    }
  }
  if (M) { updateHud(); animateMessages(); }
  try { if (PHOTO.on) photoFrame(now, pacc / 20, dt * rate); else renderFrame(G.paused ? 1 : acc / 20, now); } catch (err) { console.error(err); }
  requestAnimationFrame(loop);
}

/* ---------- loading the disk ---------- */
function idb() {
  return new Promise((res, rej) => {
    try { const r = indexedDB.open('giganoid-remake', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
    catch (e) { rej(e); }
  });
}
async function remember(u8) { try { const db = await idb(); db.transaction('f', 'readwrite').objectStore('f').put(u8, 'adf'); } catch (e) {} }
async function recall() {
  try { const db = await idb(); return await new Promise(res => { const q = db.transaction('f').objectStore('f').get('adf'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
  catch (e) { return null; }
}
function boot(u8, save) {
  try {
    setMem(unpack(firstCodeHunk(adfFind(u8, 'load'))));
    bufCache.clear(); bgCache.clear();
    decodeAssets();
    applyCustomSounds();
    indexedToCanvas(A.title, PAL.titleBase, 1, $('titlePic'), COP.title);
    if (save) remember(u8);
    toTitle();
  } catch (e) {
    setMem(null); G.mode = 'load'; showOnly(loaderCard); $('loadErr').textContent = e.message || 'Could not read that disk.';
  }
}
async function readFile(f) { if (!f) return; try { boot(new Uint8Array(await f.arrayBuffer()), true); } catch (e) { $('loadErr').textContent = 'Could not read that file.'; } }
$('adfInput').addEventListener('change', e => { audioInit(); readFile(e.target.files[0]); e.target.value = ''; });
['dragenter', 'dragover'].forEach(t => stage.addEventListener(t, e => { e.preventDefault(); loaderCard.classList.add('drag'); }));
['dragleave', 'drop'].forEach(t => stage.addEventListener(t, e => { e.preventDefault(); loaderCard.classList.remove('drag'); }));
stage.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });

applyFov();
applyShadowStrength();
fitCamera();
applyGlow();
// capsule letters use the display font: redraw them once it has loaded
try { document.fonts.load('700 50px "Chakra Petch"').then(() => refreshCapsules()).catch(() => {}); } catch (e) {}
fpsEl.hidden = !SET.fps;
showOnly(loaderCard);
// desktop app (Tauri): look for .adf disk images next to the exe and in its sub-folders (one level deep);
// the Giganoid disk boots the game, any Arkanoid / Revenge of Doh / Amegas / Crystal Hammer disks load as level packs
async function scanLocalAdfs() {
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!core) return false;
  let paths = [];
  try { paths = await core.invoke('list_adfs'); } catch (e) { return false; }
  let main = null, packs = 0;
  for (const p of paths) {
    let u8;
    try { u8 = new Uint8Array(await core.invoke('read_adf', { path: p })); } catch (e) { continue; }
    if (!main) { try { unpack(firstCodeHunk(adfFind(u8, 'load'))); main = u8; continue; } catch (e) {} }
    try { loadArkanoidAdf(u8); packs++; } catch (e) {}
  }
  if (packs) { try { syncSettingsUI(); } catch (e) {} }
  if (main) { boot(main, false); return true; }
  return false;
}
(async () => {
  await loadCustom();
  if (!(await scanLocalAdfs())) {
    const saved = await recall();
    if (saved && saved.length) boot(new Uint8Array(saved), false);
  }
  requestAnimationFrame(loop);
})();

/* ---------- equalizer UI: one 5-band EQ for everything, or (split) one for music and one for game sounds ---------- */
const fmtHz = f => f >= 1000 ? (Math.round(f / 100) / 10) + 'k' : String(Math.round(f));
const f2s = f => Math.round(Math.log(f / 20) / Math.log(1000) * 1000), s2f = v => { const f = 20 * Math.pow(1000, v / 1000); return f < 100 ? Math.round(f) : f < 1000 ? Math.round(f / 5) * 5 : Math.round(f / 50) * 50; };
const fmtQ = (q, i) => (i === 0 || i === 4) && q <= 0 ? 'shelf' : 'Q ' + q.toFixed(1);
function buildEqUI() {
  const e = eqState(), box = $('eqBox');
  $('setEqSplit').checked = e.split;
  box.innerHTML = '';
  const panels = e.split ? [['music', 'Music'], ['fx', 'Game sounds']] : [['all', 'All audio']];
  for (const [key, title] of panels) {
    const p = document.createElement('div'); p.className = 'eqPanel';
    p.innerHTML = `<h4><span>${title}</span><button type="button">Flat</button></h4><div class="eqBands"></div>`;
    const bands = p.querySelector('.eqBands');
    EQ_FREQS.forEach((f, i) => {
      const b = e[key][i], qMin = i === 0 || i === 4 ? 0 : 0.1;
      const d = document.createElement('div'); d.className = 'eqBand';
      d.innerHTML = `<output class="go"></output><input class="g" type="range" min="-12" max="12" step="0.5" title="Band ${i + 1} gain"><output class="f"></output><input class="fr" type="range" min="0" max="1000" step="1" title="Band ${i + 1} frequency"><input class="q" type="range" min="${qMin}" max="8" step="0.1" title="Band ${i + 1} Q"><output class="qo"></output>`;
      const g = d.querySelector('.g'), q = d.querySelector('.q'), go_ = d.querySelector('.go'), qo = d.querySelector('.qo'), fr = d.querySelector('.fr'), fo = d.querySelector('.f');
      if (!b.f) b.f = f;
      const show = () => { go_.textContent = (b.g > 0 ? '+' : '') + b.g + ' dB'; qo.textContent = fmtQ(b.q, i); fo.textContent = fmtHz(b.f); };
      g.value = b.g; q.value = Math.max(qMin, b.q); fr.value = f2s(b.f); show();
      fr.addEventListener('input', () => { b.f = s2f(+fr.value); show(); applyEq(); saveSettings(); });
      fr.addEventListener('dblclick', () => { b.f = f; fr.value = f2s(f); show(); applyEq(); saveSettings(); });
      g.addEventListener('input', () => { b.g = +g.value; show(); applyEq(); saveSettings(); });
      g.addEventListener('dblclick', () => { b.g = 0; g.value = 0; show(); applyEq(); saveSettings(); });
      q.addEventListener('input', () => { b.q = +q.value; show(); applyEq(); saveSettings(); });
      bands.appendChild(d);
    });
    p.querySelector('button').addEventListener('click', () => { e[key] = eqFlat(); applyEq(); saveSettings(); buildEqUI(); });
    box.appendChild(p);
  }
}
$('setEqSplit').addEventListener('change', ev => {
  const e = eqState();
  // splitting starts both EQs from the shared curve, so nothing jumps
  if (ev.target.checked && !e.split) { e.fx = e.all.map(b => ({ ...b })); e.music = e.all.map(b => ({ ...b })); }
  e.split = ev.target.checked; applyEq(); saveSettings(); buildEqUI();
});
buildEqUI();
