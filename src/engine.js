/* Giganoid engine: disk unpacking, asset decoding, sound, and the game rules
   (ported from the original 68000 code). No rendering here; the renderer hooks in through FX. */
import { LASER_OGG } from './laseraudio.js';
export const FX = { broken() {}, bossHit() {}, lost() {}, power() {}, mode() {}, batHit() {}, brickHit() {} };
export const HOOKS = { status() {} };
function updateStatus() { HOOKS.status(); }
function setPalette() {}
function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.8; updateStatus(); }
const TRANSP = 255;
const W = 330;
let H = 200;               // original screen height in pixels (taller for the widened Amegas / Crystal Hammer stage)
/* ============================================================
   Disk image -> memory image (AmigaDOS, hunk, decruncher, RLE, delta)
   ============================================================ */
const be32 = (a, o) => ((a[o] << 24) | (a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]) >>> 0;
const be16 = (a, o) => (a[o] << 8) | a[o + 1];

function adfFind(d, want) {
  if (d.length < 901120 || d[0] !== 0x44 || d[1] !== 0x4f || d[2] !== 0x53)
    throw new Error('That file is not an Amiga DD disk image (.adf, 880 KB).');
  const ffs = d[3] & 1;
  const B = n => n * 512;
  const nameOf = b => { let s = ''; for (let i = 0; i < d[b + 432]; i++) s += String.fromCharCode(d[b + 433 + i]); return s; };
  function read(h) {
    const size = be32(d, h + 324), out = new Uint8Array(size); let p = 0;
    if (ffs) {
      const list = []; let hb = h;
      for (;;) {
        const cnt = be32(d, hb + 8);
        for (let i = 0; i < cnt; i++) list.push(be32(d, hb + 308 - 4 * i));
        const ext = be32(d, hb + 504); if (!ext) break; hb = B(ext);
      }
      for (const b of list) { const n = Math.min(512, size - p); out.set(d.subarray(B(b), B(b) + n), p); p += n; if (p >= size) break; }
    } else {
      let n = be32(d, h + 16);
      while (n && p < size) {
        const b = B(n), sz = Math.min(be32(d, b + 12), size - p);
        out.set(d.subarray(b + 24, b + 24 + sz), p); p += sz; n = be32(d, b + 16);
      }
    }
    return out;
  }
  const seen = new Set();
  function walk(bn) {
    if (seen.has(bn)) return null; seen.add(bn);
    const b = B(bn);
    for (let i = 0; i < 72; i++) {
      let e = be32(d, b + 24 + 4 * i);
      while (e && e < 1760) {
        const h = B(e), st = be32(d, h + 508) | 0, nm = nameOf(h);
        if (st === -3 && nm.toLowerCase() === want) return read(h);
        if (st === 2) { const r = walk(e); if (r) return r; }
        e = be32(d, h + 496);
      }
    }
    return null;
  }
  const f = walk(880);
  if (!f) throw new Error('No "load" file on this disk. This remake reads the single-file Giganoid release.');
  return f;
}

function firstCodeHunk(f) {
  let p = 0; const L = () => { const v = be32(f, p); p += 4; return v; };
  if (L() !== 0x3f3) throw new Error('"load" is not an Amiga executable.');
  for (;;) { const n = L(); if (!n) break; p += n * 4; }
  L(); const first = L(), last = L(); p += 4 * (last - first + 1);
  for (;;) {
    const t = L() & 0x3fffffff;
    if (t === 0x3e9) { const n = L(); return f.subarray(p, p + n * 4); }
    throw new Error('Unexpected executable layout.');
  }
}

function unpack(c) {
  const ok = be16(c, 0x42) === 0x41fa && be16(c, 0x46) === 0xd1fc && be16(c, 0x4c) === 0x43f9 &&
             be16(c, 0x358) === 0x41f9 && be16(c, 0x35e) === 0x43f9 && be16(c, 0x38a) === 0x45f9 && be16(c, 0x390) === 0x47f9;
  if (!ok) throw new Error('The loader on this disk is a different version than expected.');
  let a0 = 0x44 + ((be16(c, 0x44) << 16) >> 16) + be32(c, 0x48);
  const a1 = be32(c, 0x4e);
  const mem = new Uint8Array(0x80000);
  const rl = () => { a0 -= 4; return be32(c, a0); };
  const ulen = rl(); let a2 = a1 + ulen; rl(); let d0 = rl();
  if (a2 > mem.length) throw new Error('Unexpected packed size.');
  const bit = () => {
    let b = d0 & 1; d0 >>>= 1;
    if (d0 === 0) { d0 = rl(); b = d0 & 1; d0 = ((d0 >>> 1) | 0x80000000) >>> 0; }
    return b;
  };
  const bits = n => { let v = 0; for (let i = 0; i < n; i++) v = (v * 2) + bit(); return v; };
  const offsel = () => bit() === 0 ? 16 : (bit() ? 8 : 12);
  for (;;) {
    let n = bits(3);
    if (n) {
      if (n === 7) {
        if (bit() === 0) n = bits(4) + 7;
        else { n = bits(10); if (n === 0) n = bits(18); }
      }
      for (let i = 0; i < n; i++) mem[--a2] = bits(8);
    }
    if (a2 <= a1) break;
    const t = bits(2); let ln, ob;
    if (t === 0) { ln = 2; ob = 8; }
    else if (t === 1) { ln = 3; ob = bit() ? 8 : 14; }
    else if (t === 2) { ln = 4; ob = offsel(); }
    else {
      const e = bits(2);
      ln = e === 3 ? bits(8) : e === 2 ? bits(2) + 7 : e + 5;
      ob = offsel();
    }
    const off = bits(ob);
    for (let i = 0; i < ln; i++) { a2--; mem[a2] = mem[a2 + off]; }
    if (a2 <= a1) break;
  }
  // RLE ($B2 escape) into final layout
  const rsrc = be32(c, 0x38c), rdst = be32(c, 0x392);
  const out = new Uint8Array(0x80000);
  let p = rsrc, q = rdst;
  for (;;) {
    const v = mem[p];
    if (v !== 0xb2) { out[q++] = v; p++; continue; }
    p++;
    if (mem[p] === 1) break;
    if (mem[p] === 0) { out[q++] = 0xb2; p++; continue; }
    const k = mem[p++], cc = mem[p++];
    for (let i = 0; i < k; i++) out[q++] = cc;
    if (q > out.length) throw new Error('Unpacking failed.');
  }
  // running-sum decode of the sample area
  const ds = be32(c, 0x35a), de = be32(c, 0x360);
  for (let a = ds; a < de; a++) out[a + 1] = (out[a + 1] + out[a]) & 255;
  if (be32(out, 0x70000) !== 0x33fc0100) throw new Error('Unpacked data does not look like Giganoid.');
  return out;
}

/* ============================================================
   Asset decoding from the memory image
   ============================================================ */
let M = null;
function setMem(m) { M = m; }          // 512 KB chip RAM image
const A = {};          // images {w,h,d}
let SPD_ORIG = null;
let PAL = {}, LEVELS = null, SPD = null, BGTAB = null, FONT = null, COP = {}, SND = null;

/* ---------- settings: ball speed and number of bounce angles ---------- */
const SET = { speed: 95, angles: 7, glow: 5, mouse: 130, drop: 100, fps: true, reach: 280, classic: false, mirror: true, fov: 42, trails: true, shadow: 50, dust: true, autofire: true, pack: true, ca: true, aa: true, taper: true, accel: false, reverb: 40, music: 55, sfx: true, lowAudio: false, pulse: 50, customBg: true, eq: null, curved: false, arkBat: false };
const SET_DEFAULTS = { speed: 95, angles: 7, glow: 5, mouse: 130, drop: 100, fps: true, reach: 280, classic: false, mirror: true, fov: 42, trails: true, shadow: 50, dust: true, autofire: true, pack: true, ca: true, aa: true };
try {
  let v = JSON.parse(localStorage.getItem('giganoid-settings-v4') || 'null');
  if (!v) { v = JSON.parse(localStorage.getItem('giganoid-settings-v3') || '{}'); delete v.capTypes; }
  if (v.speed >= 50 && v.speed <= 200) SET.speed = Math.round(v.speed / 5) * 5;
  if (v.angles >= 1 && v.angles <= 11 && v.angV === 2) SET.angles = Math.min(7, v.angles | 0);   // at most 7 angles (older saves above that come down to 7)
  if (v.glow >= 0 && v.glow <= 100) SET.glow = v.glow | 0;
  if (v.mouse >= 25 && v.mouse <= 300) SET.mouse = v.mouse | 0;
  if (v.drop >= 25 && v.drop <= 300) SET.drop = v.drop | 0;
  if (typeof v.fps === 'boolean') SET.fps = v.fps;
  if (v.reach >= 50 && v.reach <= 400) SET.reach = v.reach | 0;
  if (typeof v.classic === 'boolean') SET.classic = v.classic;
  if (typeof v.mirror === 'boolean') SET.mirror = v.mirror;
  if (v.fov >= 12 && v.fov <= 75) SET.fov = v.fov | 0;
  if (typeof v.trails === 'boolean') SET.trails = v.trails;
  if (typeof v.curved === 'boolean') SET.curved = v.curved;
  if (typeof v.arkBat === 'boolean') SET.arkBat = v.arkBat;
  if (typeof v.dust === 'boolean') SET.dust = v.dust;
  if (typeof v.ca === 'boolean') SET.ca = v.ca;
  if (typeof v.aa === 'boolean') SET.aa = v.aa;
  if (typeof v.autofire === 'boolean') SET.autofire = v.autofire;
  if (typeof v.pack === 'boolean') SET.pack = v.pack;
  if (v.shadow >= 0 && v.shadow <= 100 && v.shadowV === 4) SET.shadow = v.shadow | 0;
  if (v.reverb >= 0 && v.reverb <= 100) SET.reverb = v.reverb | 0;
  if (v.music >= 0 && v.music <= 100) SET.music = v.music | 0;
  if (typeof v.sfx === 'boolean') SET.sfx = v.sfx;
  if (typeof v.lowAudio === 'boolean') SET.lowAudio = v.lowAudio;
  if (v.pulse >= 0 && v.pulse <= 100) SET.pulse = v.pulse | 0;
  if (typeof v.customBg === 'boolean') SET.customBg = v.customBg;
  if (typeof v.taper === 'boolean') SET.taper = v.taper;
  if (typeof v.accel === 'boolean') SET.accel = v.accel;
  // the EQ is checked later (eqState), once its band table exists - reading it here used to throw and
  // silently skip every setting listed after it
  if (v.eq && typeof v.eq === 'object') SET.eq = { raw: v.eq.raw || v.eq };
} catch (e) {}
function setSfx(on) { if (sfxBus) try { sfxBus.gain.value = on ? 1 : 0; } catch (e) {} }
function saveSettings() { try { localStorage.setItem('giganoid-settings-v4', JSON.stringify({ ...SET, shadowV: 4, angV: 2 })); } catch (e) {} }
// Classic mode plays by the original rules: original speed table, 4 angles, original bat, drops and lasers
const ANGLES = () => SET.classic ? 4 : SET.arkBat ? 4 : SET.angles;
const startAngle = () => Math.min(ANGLES() - 1, Math.round((ANGLES() - 1) / 3));
// 100% with 4 angles uses the game's own table. Anything else is generated from it:
// same per-level speed, angles spread between the original steepest and shallowest,
// and whole-pixel steps spread over the same 4-frame cycle.
// "Arkanoid bat": the per-pixel bounce table of Arkanoid (Discovery, 1988), read from its code ($37C8 looks up
// the word table at $AF02 by the ball's pixel offset along the bat). Angles above horizontal; zones left to right
// as [width in table pixels, angle index], left half sends the ball left. Normal bat: 35 entries; wide bat: 51.
const ARK_ANG = [64.7, 39.4, 35.9, 29.5];
const ARK_NORMAL = [[4, 3], [6, 2], [7, 0], [8, 0], [6, 2], [4, 3]];
const ARK_WIDE = [[3, 3], [5, 1], [17, 0], [18, 0], [5, 1], [3, 3]];
function arkBounce(b, g) {
  const zones = G.batTarget === 18 && G.batF > 9 ? ARK_WIDE : ARK_NORMAL;
  const n = zones.reduce((s, z) => s + z[0], 0);
  const t = Math.max(0, Math.min(0.9999, (b.x + 2 - g.l + 0.5) / Math.max(1, g.r - g.l + 1)));
  let k = Math.floor(t * n), z = 0;
  while (k >= zones[z][0]) { k -= zones[z][0]; z++; }
  b.a = zones[z][1]; b.sx = z < 3 ? -1 : 1;
}
let ANG = [];   // bounce elevation (radians) for each angle index, for the curved bat
function rebuildSpeed() {
  const N = ANGLES(), mult = SET.classic ? 1 : SET.speed / 100;
  ZONE = [];
  const vert = !SET.classic && N % 2 === 1 && N > 1;   // odd angle count: a single middle zone sends the ball straight up
  if (vert) for (let z = 0; z < 2 * N - 1; z++) ZONE.push(Math.abs(z - (N - 1)));
  else for (let z = 0; z < 2 * N; z++) ZONE.push(z < N ? N - 1 - z : z - N);
  // zone boundaries along the bat (0..1): widest just off centre, tapering narrower toward the edges;
  // for an odd count the vertical (90°) middle zone is kept small so it needs a near-dead-centre hit.
  if (SET.taper === false) {   // classic: every zone the same width
    const NZ = ZONE.length; ZONE_B = []; for (let z = 0; z <= NZ; z++) ZONE_B.push(z / NZ);
  } else {
    // gentle taper: centre zones up to 1.6x the end zones (was a steep triangle that left the end zones a
    // fraction of a pixel wide - the shallowest angles were unreachable and the straight-up zone never hit)
    const NZ = ZONE.length, mid = (NZ - 1) / 2;
    const w = [];
    for (let z = 0; z < NZ; z++) { let ww = 1 + 0.6 * (1 - Math.abs(z - mid) / Math.max(1, mid)); if (vert && z === N - 1) ww *= 0.7; w.push(ww); }
    const tot = w.reduce((s, v) => s + v, 0);
    ZONE_B = [0]; for (let z = 0; z < NZ; z++) ZONE_B.push(ZONE_B[z] + w[z] / tot);
  }
  if (!SPD_ORIG) return;
  if (N === 4 && mult === 1 && SET.classic) { SPD = SPD_ORIG; return; }
  const sums = a => { let sx = 0, sy = 0; for (const lvl of SPD_ORIG) for (const [dx, dy] of lvl[a]) { sx += dx; sy += dy; } return [sx, sy]; };
  const th = [0, 1, 2, 3].map(a => { const [sx, sy] = sums(a); return Math.atan2(sy, sx); });
  // the shallowest bounce is the original game's own (~21°); an earlier tweak lowered it to 15°
  const mag = SPD_ORIG.map(lvl => {
    let t = 0;
    for (let a = 0; a < 4; a++) { let sx = 0, sy = 0; for (const [dx, dy] of lvl[a]) { sx += dx; sy += dy; } t += Math.hypot(sx, sy) / 4; }
    return t / 4;
  });
  const angles = [];
  if (vert) { for (let k = 0; k < N; k++) angles.push(Math.PI / 2 + (th[3] - Math.PI / 2) * k / (N - 1)); }   // even steps from 90° out to the shallowest
  else for (let k = 0; k < N; k++) angles.push(N === 4 ? th[k] : N === 1 ? (th[0] + th[3]) / 2 : th[0] + (th[3] - th[0]) * k / (N - 1));
  if (SET.arkBat && !SET.classic) { angles.length = 0; for (const d of ARK_ANG) angles.push(d * Math.PI / 180); }
  ANG = angles.slice();
  SPD = mag.map(m => angles.map(t => {
    const vx = m * mult * Math.cos(t), vy = m * mult * Math.sin(t), out = [];
    for (let p = 0; p < 4; p++) out.push([Math.round((p + 1) * vx) - Math.round(p * vx), Math.round((p + 1) * vy) - Math.round(p * vy)]);
    if (out.every(v => v[0] === 0) && Math.abs(t - Math.PI / 2) > 1e-6) out[0][0] = 1;   // only the true vertical may have no sideways step
    if (out.every(v => v[1] === 0)) out[0][1] = 1;
    return out;
  }));
}
function copperWithBase(addr) {
  const base = new Array(32).fill(0), ev = []; let a = addr, line = null;
  for (let i = 0; i < 600; i++) {
    const w1 = be16(M, a), w2 = be16(M, a + 2); a += 4;
    if (w1 === 0xffff && w2 === 0xfffe) break;
    if (w1 & 1) { line = (w1 >> 8) - 0x2e; continue; }
    if (w1 >= 0x180 && w1 <= 0x1be) { if (line === null) base[(w1 - 0x180) >> 1] = w2; else ev.push([Math.max(0, line), (w1 - 0x180) >> 1, w2]); }
  }
  return { base, ev };
}

function planar(a, w, h, np = 5) {
  const bpr = w >> 3, o = new Uint8Array(w * h);
  for (let p = 0; p < np; p++) {
    const base = a + p * bpr * h;
    for (let y = 0; y < h; y++) for (let xb = 0; xb < bpr; xb++) {
      const v = M[base + y * bpr + xb]; if (!v) continue;
      for (let k = 0; k < 8; k++) if (v & (128 >> k)) o[y * w + xb * 8 + k] |= 1 << p;
    }
  }
  return o;
}
function mask(o, a, w, h) {
  const bpr = w >> 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (!(M[a + y * bpr + (x >> 3)] & (128 >> (x & 7)))) o[y * w + x] = TRANSP;
  return o;
}
function crop(img, w) {
  const d = new Uint8Array(w * img.h);
  for (let y = 0; y < img.h; y++) d.set(img.d.subarray(y * img.w, y * img.w + w), y * w);
  return { w, h: img.h, d };
}
function sprite(a, rows, base) {
  const d = new Uint8Array(16 * rows).fill(TRANSP);
  for (let r = 0; r < rows; r++) {
    const w1 = be16(M, a + 4 + 4 * r), w2 = be16(M, a + 6 + 4 * r);
    for (let x = 0; x < 16; x++) {
      const v = ((w1 >> (15 - x)) & 1) | (((w2 >> (15 - x)) & 1) << 1);
      if (v) d[r * 16 + x] = base + v;
    }
  }
  return { w: 16, h: rows, d };
}
const words = (a, n) => Array.from({ length: n }, (_, i) => be16(M, a + 2 * i));
function extents(img, rows) {
  let l = 1e9, r = -1, top = 1e9;
  for (const y of rows) for (let x = 0; x < img.w; x++) if (img.d[y * img.w + x] !== TRANSP) { if (x < l) l = x; if (x > r) r = x; }
  for (let y = 0; y < img.h && top === 1e9; y++) for (let x = 0; x < img.w; x++) if (img.d[y * img.w + x] !== TRANSP) { top = y; break; }
  return { l, r, top };
}
function batProfile(im) {
  const col = new Int8Array(im.w).fill(-1); let l = 1e9, r = -1, top = 1e9, bottom = 0;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const v = im.d[y * im.w + x]; if (v === TRANSP || v === 26) continue;
    if (col[x] < 0) col[x] = y;
    if (x < l) l = x; if (x > r) r = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  for (let x = l; x <= r; x++) if (col[x] < 0) {
    const a = col[x - 1] >= 0 ? col[x - 1] : 99, b = col[x + 1] >= 0 ? col[x + 1] : 99;
    col[x] = Math.min(a, b, bottom);
  }
  return { l, r, top, bottom, col };
}
function parseCopper(addr) {
  const ev = []; let a = addr, line = null;
  for (let i = 0; i < 600; i++) {
    const w1 = be16(M, a), w2 = be16(M, a + 2); a += 4;
    if (w1 === 0xffff && w2 === 0xfffe) break;
    if (w1 & 1) { line = (w1 >> 8) - 0x2e; continue; }
    if (line !== null && w1 >= 0x180 && w1 <= 0x1be) ev.push([Math.max(0, line), (w1 - 0x180) >> 1, w2]);
  }
  return ev;
}

function decodeAssets() {
  PAL.normal = words(0x7C38C, 32); PAL.r50 = words(0x7C3CC, 32); PAL.r25 = words(0x7C40C, 32); PAL.demon = words(0x7C44C, 32);   // demon heads stage ($75C12)
  { const a = 0x7C818 + (6 * 2 + 4 + 16) * 4; PAL.title = Array.from({ length: 32 }, (_, i) => be16(M, a + 2 + 4 * i)); }
  PAL.bgsets = Array.from({ length: 12 }, (_, i) => words(0x76824 + 12 * i, 6));
  COP.game = parseCopper(0x7CD18);
  { const t = copperWithBase(0x7CBA8); PAL.titleBase = t.base; COP.title = t.ev; }
  COP.menu = parseCopper(0x7C490); COP.inter = parseCopper(0x7C60C);

  A.title = { w: 320, h: 200, d: planar(0x3B514, 320, 200) };
  A.panel = { w: 96, h: 200, d: planar(0x67348, 96, 200) };
  const K = 0x65818;
  A.wallL = { w: 16, h: 200, d: mask(planar(K, 16, 200), K + 0x7D0, 16, 200) };
  A.wallR = { w: 16, h: 200, d: mask(planar(K + 0x960, 16, 200), K + 0x960 + 0x7D0, 16, 200) };
  // top border: the side wall turned on its side
  { const s = A.wallL, d = new Uint8Array(200 * 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 200; x++) d[y * 200 + x] = s.d[x * 16 + y];
    A.wallT = { w: 200, h: 16, d }; }
  const Bk = 0x4DAE2;
  for (let t = 0; t < 12; t++) {
    const full = { w: 48, h: 7, d: mask(planar(Bk + 0x2A + t * 0xD2, 48, 7), Bk, 48, 7) };
    A['brick' + (t + 1)] = crop(full, 17);
  }
  A.bat = [];
  for (let f = 0; f < 19; f++) {
    const a = 0x6C1A8 + f * 0x348;
    const im = { w: 80, h: 14, d: mask(planar(a, 80, 14), a + 0x2BC, 80, 14) };
    im.ext = batProfile(im);
    A.bat.push(im);
  }
  A.cap = [];
  for (let t = 0; t < 7; t++) {
    const fr = [];
    for (let f = 0; f < 16; f++) {
      const a = 0x6A228 + t * 0x480 + f * 0x48, d = new Uint8Array(16 * 9).fill(TRANSP);
      for (let r = 0; r < 9; r++) {
        const w = [0, 1, 2, 3].map(k => be16(M, a + r * 8 + k * 2));
        for (let x = 0; x < 16; x++) {
          let v = 0; for (let k = 0; k < 4; k++) v |= ((w[k] >> (15 - x)) & 1) << k;
          if (v) d[r * 16 + x] = 16 + v;
        }
      }
      fr.push({ w: 16, h: 9, d });
    }
    A.cap.push(fr);
  }
  A.ball = sprite(0x7BF5C, 8, 24);
  A.laser = sprite(0x7C088, 8, 16);
  A.bossShot = sprite(0x7C184, 7, 20);
  const Hd = 0x5FF50;
  A.boss = [0, 1].map(i => ({ w: 112, h: 101, d: mask(planar(Hd + i * 0x2124, 112, 101), Hd + i * 0x2124 + 0x1B9E, 112, 101) }));
  const G = 0x474F4;
  A.god = [0, 1, 2].map(f => ({ w: 64, h: 40, d: mask(planar(G + 0x140 + f * 0x640, 64, 40), G, 64, 40) }));
  const MS = 0x4BDBC;
  A.msgThe = { w: 64, h: 16, d: planar(MS, 64, 16) };
  A.msgDemons = { w: 128, h: 19, d: planar(MS + 0x280, 128, 19) };
  A.msgGate = { w: 192, h: 19, d: planar(MS + 0x870, 192, 19) };
  A.msgGrand = { w: 224, h: 19, d: planar(MS + 0x1158, 224, 19) };
  const KL = 0x4AB14;
  A.ready = { w: 80, h: 12, d: mask(planar(KL, 80, 12), KL + 0x258, 80, 12) };
  A.player = { w: 112, h: 12, d: mask(planar(KL + 0x2D0, 112, 12), KL + 0x2D0 + 0x348, 112, 12) };
  A.gameover = { w: 160, h: 17, d: planar(KL + 0xAB0, 160, 17) };
  A.choose = { w: 208, h: 56, d: mask(planar(0x488F4, 208, 56), 0x488F4 + 0x1C70, 208, 56) };
  FONT = M.subarray(0x737B6, 0x737B6 + 64 * 8);
  // levels
  const base = 0x59A88;
  LEVELS = { order: Array.from(M.subarray(0x74994, 0x74994 + 50)), lay: [] };
  for (let L = 0; L < 50; L++) {
    const o = base + L * 0x204;
    LEVELS.lay.push({
      b: M.subarray(o, o + 234), h: M.subarray(o + 234, o + 468),
      caps: Array.from({ length: 7 }, (_, i) => be32(M, o + 0x1D4 + 4 * i)),
      prm: Array.from({ length: 5 }, (_, i) => be32(M, o + 0x1F0 + 4 * i)),
    });
  }
  SPD = [];
  for (let s = 0; s < 6; s++) {
    const ang = [];
    for (let a = 0; a < 4; a++) {
      const ph = [];
      for (let p = 0; p < 4; p++) { const o = 0x7BA12 + s * 0xC0 + a * 0x30 + p * 8; ph.push([be32(M, o) | 0, be32(M, o + 4) | 0]); }
      ang.push(ph);
    }
    SPD.push(ang);
  }
  BGTAB = Array.from({ length: 50 }, (_, i) => ({ set: be32(M, 0x76906 + 12 * i), list: be32(M, 0x76906 + 12 * i + 4), n: be32(M, 0x76906 + 12 * i + 8) }));
  SND = [];
  for (let i = 0; i < 18; i++) {
    const a = 0x708C0 + 10 * i;
    SND.push({ addr: 0x16800 + be32(M, a), len: be16(M, a + 4) * 2, per: be16(M, a + 6), vol: be16(M, a + 8) });
  }
  SPD_ORIG = SPD; rebuildSpeed();
  SND.intro = { addr: 0x2D614, len: 0x5918 * 2, per: 0x15E, vol: 64 };
  SND.jingle = { addr: 0x28FC6, len: 0x231D * 2, per: 0x15E, vol: 64 };
}

const bgCache = new Map();
function bgMap(entry) {
  const e = BGTAB[entry - 1];
  if (bgCache.has(e.list)) return bgCache.get(e.list);
  const planes = Array.from({ length: 5 }, () => new Uint8Array(200 * 40));
  for (let i = 0; i < e.n; i++) {
    const it = e.list + 16 * i;
    const d4 = be32(M, it), d2 = be32(M, it + 4), d3 = be32(M, it + 8), d1 = be32(M, it + 12);
    const h = (d1 >> 6) & 0x3ff, w = (d1 & 63) * 2, y0 = Math.floor(d2 / 40), x0 = d2 % 40;
    for (let p = 0; p < 5; p++) {
      const s = 0x4E4E4 + d4 + p * d3;
      for (let y = 0; y < h && y0 + y < 200; y++) for (let x = 0; x < w && x0 + x < 40; x++)
        planes[p][(y0 + y) * 40 + x0 + x] |= M[s + y * w + x];
    }
  }
  const idx = new Uint8Array(320 * 200);
  for (let p = 0; p < 5; p++) for (let i = 0; i < 8000; i++) {
    const v = planes[p][i]; if (!v) continue;
    for (let k = 0; k < 8; k++) if (v & (128 >> k)) idx[i * 8 + k] |= 1 << p;
  }
  const img = { w: 320, h: 200, d: idx };
  bgCache.set(e.list, img);
  return img;
}

/* ============================================================
   Sound (Paula-style: 4 channels, one sample per channel)
   ============================================================ */
const PAULA = 3546895;
let AC = null, master = null, muted = false, comp = null, reverbIn = null, reverbOut = null, sfxBus = null;
const chan = [null, null, null, null];
const bufCache = new Map();
// algorithmic reverb: a bank of feedback comb filters (with high-frequency damping) fed in parallel,
// then two short feedback delays to diffuse. Freeverb-style, so the tail is clearly audible on short SFX.
function buildReverb() {
  // CONVOLUTION reverb: a fixed, pre-rendered impulse response run through a ConvolverNode.
  // This is purely feed-forward — there is NO feedback loop anywhere, so it cannot resonate or
  // build up, whatever the input. The IR is a cluster of decaying early reflections plus a soft
  // noise tail, then scaled so sum(|IR|) equals a fixed constant — that bounds the gain even for
  // sustained input (e.g. the laser loop): output can never exceed input * TARGET_SUM.
  const rate = AC.sampleRate, len = Math.max(1, (rate * 0.85) | 0), tau = 0.28, G = 2.6;
  const ir = AC.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    // a dense exponentially-decaying noise tail (a real room's late reflections)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / rate / tau);
    // normalise by ENERGY (L2), not peak: this sets the reverb's gain to a fixed G, so the tail is
    // clearly audible (~6 dB under the dry hit) yet sustained input (e.g. the laser) can't be amplified
    // beyond G. Feed-forward convolution has no feedback, so it cannot resonate; the limiter is the final cap.
    let e = 0; for (let i = 0; i < len; i++) e += d[i] * d[i]; const k = e > 0 ? G / Math.sqrt(e) : 0;
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  const conv = AC.createConvolver(); conv.normalize = false; conv.buffer = ir;
  return { input: conv, output: conv };
}
function setReverb(amount) {   // 0..100: wet level of the global reverb send
  if (reverbIn) try { reverbIn.gain.value = Math.max(0, Math.min(100, amount)) / 100 * 0.9; } catch (e) {}
}
/* ---------- 5-band EQ ----------
   Two identical chains: game sounds (sfxBus -> eqFx -> master) and music (musicOut -> eqMusic -> master), so the
   reverb and limiter see the EQ'd mix. Unsplit, both chains use the "all" curve; split, each has its own.
   Band 1 and 5 can be shelves (Q slider at its far left) or peaks; bands 2-4 are peaks. */
const EQ_FREQS = [80, 400, 1000, 3000, 8000];
const EQ_SHELF = 0;   // q value meaning "shelf" (bands 1 and 5 only)
const eqFlat = () => EQ_FREQS.map((f, i) => ({ g: 0, q: i === 0 || i === 4 ? EQ_SHELF : 1, f }));
function eqSanitize(e) {
  const band = (b, i) => ({ g: Math.max(-12, Math.min(12, +((b && b.g) || 0))), q: b && b.q >= 0 && b.q <= 8 ? +b.q : (i === 0 || i === 4 ? EQ_SHELF : 1), f: b && b.f >= 20 && b.f <= 20000 ? +b.f : EQ_FREQS[i] });
  const set = a => EQ_FREQS.map((_, i) => band(Array.isArray(a) ? a[i] : null, i));
  return { split: !!e.split, all: set(e.all), fx: set(e.fx), music: set(e.music) };
}
function eqState() { if (SET.eq && SET.eq.raw) SET.eq = eqSanitize(SET.eq.raw); if (!SET.eq) SET.eq = { split: false, all: eqFlat(), fx: eqFlat(), music: eqFlat() }; return SET.eq; }
let eqFx = null, eqMusic = null;
function eqChain() {
  const input = AC.createGain(); let last = input; const bands = [];
  EQ_FREQS.forEach(f => { const b = AC.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.gain.value = 0; last.connect(b); last = b; bands.push(b); });
  return { input, output: last, bands };
}
function eqApplyTo(ch, curve) {
  if (!ch) return;
  const now = AC.currentTime;
  ch.bands.forEach((b, i) => {
    const c = curve[i], shelf = (i === 0 || i === 4) && c.q <= EQ_SHELF;
    const type = shelf ? (i === 0 ? 'lowshelf' : 'highshelf') : 'peaking';
    if (b.type !== type) b.type = type;
    b.gain.setTargetAtTime(c.g, now, 0.02);
    b.Q.setTargetAtTime(shelf ? 0.7 : Math.max(0.1, c.q), now, 0.02);
    b.frequency.setTargetAtTime(c.f || EQ_FREQS[i], now, 0.02);
  });
}
function applyEq() {
  if (!AC) return;
  const e = eqState();
  eqApplyTo(eqFx, e.split ? e.fx : e.all);
  eqApplyTo(eqMusic, e.split ? e.music : e.all);
}
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume().catch(() => {}); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.8;
    sfxBus = AC.createGain(); sfxBus.gain.value = SET.sfx === false ? 0 : 1;
    eqFx = eqChain(); eqMusic = eqChain(); sfxBus.connect(eqFx.input); eqFx.output.connect(master); eqMusic.output.connect(master);   // game sounds only, so music can play alone
    // a gentle limiter on the sum so stacked hits (multiball, busy moments) stop reading as random loud spikes
    comp = AC.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 12; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.12;
    master.connect(comp); comp.connect(AC.destination);
    // global reverb send: a slice of the master mix through the reverb, back into the limiter
    try {
      const rv = buildReverb();
      reverbIn = AC.createGain(); setReverb(SET.reverb); reverbOut = rv.output;
      // collapse the send to mono so the stereo (decorrelated) IR spreads the tail across BOTH channels,
      // even when the dry sound is panned hard to one edge — the reverb always plays in full stereo
      reverbIn.channelCount = 1; reverbIn.channelCountMode = 'explicit'; reverbIn.channelInterpretation = 'speakers';
      master.connect(reverbIn); reverbIn.connect(rv.input); rv.output.connect(comp);
    } catch (e) { reverbIn = reverbOut = null; }
    musicInit();
    applyEq();
    applyCustomSounds();
  } catch (e) { AC = null; }
}
// replacement sounds: file names follow the exported pack (sfx_01..sfx_18, intro, jingle)
const CUSTOM = new Map();
function b64ToBuf(b64) { const bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
try { CUSTOM.set('sfx_01', [b64ToBuf(LASER_OGG)]); } catch (e) {}   // default laser = the supplied sample (a user upload still overrides)
// looping laser: while auto-fire is held the laser sound loops instead of retriggering per shot
let laserLoop = null;
function startLaserLoop() {
  if (!AC || muted || laserLoop) return;
  const s = SND && SND[0]; if (!s) return; const buf = sampleBuf(s); if (!buf) return;
  try { const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const sr = buf.sampleRate || 44100; src.loopStart = 3700 / sr; src.loopEnd = 94310 / sr;   // sustain loop region (samples)
    const gn = AC.createGain(); gn.gain.value = s.custom ? 0.6 : (s.vol / 64) * 0.6;
    let node = gn, pan = null;
    if (AC.createStereoPanner) { pan = AC.createStereoPanner(); gn.connect(pan); node = pan; }
    src.connect(gn); node.connect(sfxBus || master); src.start(); laserLoop = { src, gn, pan };
  } catch (e) {}
}
function stopLaserLoop() { if (laserLoop) { try { laserLoop.src.stop(); laserLoop.src.disconnect(); laserLoop.gn.disconnect(); if (laserLoop.pan) laserLoop.pan.disconnect(); } catch (e) {} laserLoop = null; } }
function laserLoopPan(x) { if (laserLoop && laserLoop.pan && x != null) try { laserLoop.pan.pan.value = panFor(x); } catch (e) {} }
function soundKey(name) {
  const n = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  if (/intro|title|music/.test(n)) return 'intro';
  if (/jingle|hiscore|high/.test(n)) return 'jingle';
  const m = n.match(/(\d{1,2})/); if (!m) return null;
  const id = +m[1]; return id >= 1 && id <= 18 ? 'sfx_' + String(id).padStart(2, '0') : null;
}
const soundEntry = k => !SND ? null : k === 'intro' ? SND.intro : k === 'jingle' ? SND.jingle : SND[+k.slice(4) - 1];
function applyCustomSounds() {
  if (!AC || !SND) return Promise.resolve();
  const jobs = [];
  for (const k of ['intro', 'jingle']) { const e = soundEntry(k); if (e) e.custom = null; }
  SND.forEach(e => (e.custom = null));
  for (const [k, bufs] of CUSTOM) {
    const e = soundEntry(k); if (!e) continue;
    const list = Array.isArray(bufs) ? bufs : [bufs];   // several files for one sound = round-robin variations
    e.custom = [];
    for (const buf of list) jobs.push(new Promise(res => AC.decodeAudioData(buf.slice(0), b => { e.custom.push(b); res(); }, () => res())));
  }
  return Promise.all(jobs).then(() => { for (const k of ['intro', 'jingle']) { const e = soundEntry(k); if (e && e.custom && !e.custom.length) e.custom = null; } SND.forEach(e => { if (e.custom && !e.custom.length) e.custom = null; }); });
}
function sampleBuf(s) {
  if (s.custom) {
    // round robin: a random variation each time, never the same one twice in a row
    const c = s.custom; if (c.length === 1) return c[0];
    let i = (Math.random() * c.length) | 0; if (i === s.lastPick) i = (i + 1) % c.length; s.lastPick = i; return c[i];
  }
  const key = s.addr + ':' + s.per;
  if (bufCache.has(key)) return bufCache.get(key);
  const rate = Math.min(96000, Math.max(3000, Math.round(PAULA / s.per)));
  const b = AC.createBuffer(1, s.len, rate), ch = b.getChannelData(0);
  for (let i = 0; i < s.len; i++) { const v = M[s.addr + i]; ch[i] = (v > 127 ? v - 256 : v) / 128; }
  bufCache.set(key, b); return b;
}
const PAN = [-0.55, 0.55, 0.55, -0.55];
function stopChan(c) { if (chan[c]) { try { chan[c].stop(); } catch (e) {} chan[c] = null; } }
// stereo: a sound with a playfield x is panned to where it happens (left wall = left speaker)
const panFor = x => Math.max(-1, Math.min(1, (x - (PL + PR) / 2) / ((PR - PL) / 2))) * 0.6;
const voices = [];   // one-shot sounds still ringing; a new trigger never cuts their tails
function play(s, c, loop, x) {
  if (!AC || !s) return;
  try {
    if (AC.state === 'suspended') AC.resume().catch(() => {});
    if (loop) stopChan(c);   // music/loops still own their channel
    const src = AC.createBufferSource(); src.buffer = sampleBuf(s); src.loop = !!loop;
    const g = AC.createGain(); g.gain.value = s.custom ? 0.6 : (s.vol / 64) * 0.6;
    let node = g;
    if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = x == null ? 0 : panFor(x); g.connect(p); node = p; }   // sounds without a place stay centred
    src.connect(g); node.connect(sfxBus || master); src.start();
    // rarely "steal" a one-shot game sound into the procedural-music chain, so it rings through its reverb/delay/phaser
    let steal = null;
    if (!loop && SET.music > 0 && musicBus && Math.random() < 0.035) { steal = AC.createGain(); steal.gain.value = 0.7; node.connect(steal); steal.connect(musicBus); }
    if (loop) chan[c] = src;
    else {
      // free the whole little node chain when the sound ends, so one-shots don't pile up on master
      const first = g, last = node;
      src.onended = () => { const i = voices.indexOf(src); if (i >= 0) voices.splice(i, 1);
        try { src.disconnect(); first.disconnect(); if (last !== first) last.disconnect(); if (steal) steal.disconnect(); } catch (e) {} };
      src._t0 = AC.currentTime; voices.push(src);
      // cap: drop the oldest voice that has already been ringing a while — never a freshly started one (that was cutting bat hits during busy moments)
      if (voices.length > 48) { const old = voices.find(v => AC.currentTime - (v._t0 || 0) > 0.12); if (old) { try { old.stop(); } catch (e) {} const j = voices.indexOf(old); if (j >= 0) voices.splice(j, 1); } }
    }
  } catch (e) {}
}
// N countdown: an open hi-hat each second (high-passed noise with a ringing decay)
let hatNoise = null;
function beep() {
  if (!AC || muted) return;
  try {
    if (!hatNoise) {
      hatNoise = AC.createBuffer(1, AC.sampleRate * 0.6 | 0, AC.sampleRate);
      const ch = hatNoise.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    const t = AC.currentTime, src = AC.createBufferSource(); src.buffer = hatNoise;
    const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const bp = AC.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 10000; bp.gain.value = 9; bp.Q.value = 0.8;
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(sfxBus || master); src.start(t); src.stop(t + 0.5);
  } catch (e) {}
}

/* ============================================================
   Procedural soundtrack: a per-level drone plus sparse, colour-mapped
   interval notes from breaking bricks, all through an "extreme" long
   reverb that is separate from the game's reverb. Random sine/triangle/
   square voices with slow low/high-pass sweeps bounded to 50 Hz..5 kHz.
   ============================================================ */
let musicBus = null, musicRevIn = null, musicDry = null, drone = null, musicBase = 55, musicLastNote = 0, musicLastIdx = -1, noiseBuf = null, distDrive = null, distWet = null, distTimer = null, musicRound = -1, musicPunch = null, musicBed = null, musicDelay = null, musicDelayIn = null,
  phaserWet = null, formantWet = null, formantBands = null, phaserTimer = null, formantTimer = null, formantMorphTimer = null, musicConv = null, musicOut = null;
// fade the whole music output (including reverb/delay tails) — used to cut cleanly between levels
function musicDuck(sec) { if (musicOut) try { const now = AC.currentTime; musicOut.gain.cancelScheduledValues(now); musicOut.gain.setValueAtTime(musicOut.gain.value, now); musicOut.gain.linearRampToValueAtTime(0.0001, now + sec); } catch (e) {} }
function musicUnduck() { if (musicOut) try { const now = AC.currentTime; musicOut.gain.cancelScheduledValues(now); musicOut.gain.setValueAtTime(Math.max(0.0001, musicOut.gain.value), now); musicOut.gain.linearRampToValueAtTime(1, now + 0.4); } catch (e) {} }
// Low-power audio: disconnect the two convolution reverbs (the only heavy nodes) and lean on the cheap delay + dry;
// the per-frame effect schedulers and note voicing also check SET.lowAudio to stay light.
function setLowAudio(on) {
  try {
    if (on) {
      if (reverbIn) reverbIn.disconnect();                 // game reverb convolver: cut its input
      if (musicRevIn) musicRevIn.disconnect();             // music reverb convolver: cut its input
      if (musicDry) musicDry.gain.value = 0.4;             // compensate the lost wetness with more dry + the (cheap) delay
      if (phaserWet) phaserWet.gain.value = 0.0001;
      if (formantWet) formantWet.gain.value = 0.0001;
      if (distWet) distWet.gain.value = 0.0001;
    } else {
      if (reverbIn && reverbOut) reverbIn.connect(reverbOut);
      if (musicRevIn && musicConv) musicRevIn.connect(musicConv);
      if (musicDry) musicDry.gain.value = 0.16;
      setReverb(SET.reverb);
    }
  } catch (e) {}
}
const VOWELS = [[800, 1150, 2900], [400, 1600, 2700], [250, 1750, 2600], [400, 750, 2400], [350, 600, 2400]];   // a e i o u formant triplets
// each level picks a bright major-family mode; the scale spans ~3 octaves so brick colours map to pleasant intervals
const MUSIC_MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydianDominant: [0, 2, 4, 6, 7, 9, 10], bebopMajor: [0, 2, 4, 5, 7, 8, 9, 11], majorPentatonic: [0, 2, 4, 7, 9]   // major jazz flavours
};
const MODE_PICK = ['major', 'major', 'lydian', 'mixolydian'];
let MUSIC_SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
function musicBuildScale() {
  const m = MUSIC_MODES[MODE_PICK[(Math.random() * MODE_PICK.length) | 0]], s = [];
  for (let o = 0; o < 3; o++) for (const d of m) s.push(d + o * 12);
  MUSIC_SCALE = s;
}
const DRONE_DEG = [0, 3, 5, 7, -5, -2];   // low, mostly-consonant moves for the bass drone
const mclamp = v => Math.max(50, Math.min(5000, v));
function musicNoise() { if (!noiseBuf) { noiseBuf = AC.createBuffer(1, (AC.sampleRate * 2) | 0, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return noiseBuf; }
function musicIR(seconds, tau, gain) {   // long dense decaying-noise IR, energy-normalised (feed-forward, can't resonate)
  const rate = AC.sampleRate, len = Math.max(1, (rate * seconds) | 0), ir = AC.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / rate / tau);
    let e = 0; for (let i = 0; i < len; i++) e += d[i] * d[i]; const k = e > 0 ? gain / Math.sqrt(e) : 0;
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return ir;
}
function musicDistCurve(k) {   // soft-clip (tanh) curve, normalised so output stays within ±1 — bounded, just adds warmth/harmonics
  const n = 1024, c = new Float32Array(n), d = Math.tanh(k) || 1;
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / d; }
  return c;
}
// a slow 6-stage phaser (allpass cascade swept by a slow LFO, mild feedback). Bounded: allpasses are unity-gain and feedback < 1.
function makePhaser() {
  const input = AC.createGain(), output = AC.createGain(), aps = [];
  let node = input;
  for (let i = 0; i < 6; i++) { const ap = AC.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 300 + i * 320; ap.Q.value = 0.7; node.connect(ap); node = ap; aps.push(ap); }
  node.connect(output);
  const fb = AC.createGain(); fb.gain.value = 0.3; output.connect(fb); fb.connect(aps[0]);
  const lfo = AC.createOscillator(); lfo.frequency.value = 0.05; const depth = AC.createGain(); depth.gain.value = 900;   // very slow sweep
  lfo.connect(depth); aps.forEach(ap => depth.connect(ap.frequency)); lfo.start();
  return { input, output };
}
// a vowel/formant filter: three parallel bandpasses whose centres slowly morph between vowel shapes
function makeFormant() {
  const input = AC.createGain(), output = AC.createGain();
  const bands = VOWELS[0].map(f => { const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8; bp.frequency.value = f; input.connect(bp); bp.connect(output); return bp; });
  return { input, output, bands };
}
function musicInit() {
  if (!AC || musicBus) return;
  try {
    musicBus = AC.createGain();
    musicOut = AC.createGain(); musicOut.connect(eqMusic ? eqMusic.input : master);       // single music output, so a level change can duck everything (incl. reverb tails)
    // the background (drone, notes, arps, reverb, delay) is levelled by its own compressor, so its loudness stays
    // steady while the random FX drift in and out — that keeps the pulse/music balance consistent
    musicBed = AC.createDynamicsCompressor(); musicBed.threshold.value = -26; musicBed.knee.value = 12; musicBed.ratio.value = 4; musicBed.attack.value = 0.03; musicBed.release.value = 0.4;
    const bedMake = AC.createGain(); bedMake.gain.value = 1.25; musicBed.connect(bedMake); bedMake.connect(musicOut);
    musicPunch = AC.createGain(); musicPunch.connect(musicOut);   // a dry path (under Music volume) for percussive hits like the pulse bass
    musicSetVol(SET.music);
    // parallel soft-clip distortion: a clean path plus a distorted path whose drive and level
    // wander over time (scheduleDist), so the grit comes and goes at random amounts
    const shaper = AC.createWaveShaper(); shaper.curve = musicDistCurve(2.2); shaper.oversample = '2x';
    const mix = AC.createGain();
    const clean = AC.createGain(); clean.gain.value = 1;
    distDrive = AC.createGain(); distDrive.gain.value = 1;
    distWet = AC.createGain(); distWet.gain.value = 0.0001;   // starts clean
    musicBus.connect(clean); clean.connect(mix);
    musicBus.connect(distDrive); distDrive.connect(shaper); shaper.connect(distWet); distWet.connect(mix);
    // the extreme reverb: a long (~4.5 s) dense tail, mostly wet
    const conv = AC.createConvolver(); conv.normalize = false; conv.buffer = musicIR(6.5, 2.2, 2.0); musicConv = conv;
    musicRevIn = AC.createGain(); musicRevIn.gain.value = 1.0;
    musicRevIn.channelCount = 1; musicRevIn.channelCountMode = 'explicit'; musicRevIn.channelInterpretation = 'speakers';
    musicDry = AC.createGain(); musicDry.gain.value = 0.16;
    // slow phaser + vowel-formant inserts (parallel wet, each randomly faded in/out); dry always passes
    const ph = makePhaser(), fm = makeFormant(); formantBands = fm.bands;
    const aOut = AC.createGain(), bOut = AC.createGain();
    phaserWet = AC.createGain(); phaserWet.gain.value = 0.0001; formantWet = AC.createGain(); formantWet.gain.value = 0.0001;
    mix.connect(aOut);                       // phaser dry
    mix.connect(ph.input); ph.output.connect(phaserWet); phaserWet.connect(aOut);
    aOut.connect(bOut);                      // formant dry
    aOut.connect(fm.input); fm.output.connect(formantWet); formantWet.connect(bOut);
    bOut.connect(musicRevIn); musicRevIn.connect(conv); conv.connect(musicBed);
    bOut.connect(musicDry); musicDry.connect(musicBed);
    // a separate echo/delay FX bus: notes and arps send into it for rhythmic trails; the drone and pulse do not.
    // Feedback stays well under 1 with a lowpass in the loop, so it's bounded (and the limiter backstops it).
    const dl = AC.createDelay(1.6); dl.delayTime.value = 0.3;
    const dlFb = AC.createGain(); dlFb.gain.value = 0.42;
    const dlLp = AC.createBiquadFilter(); dlLp.type = 'lowpass'; dlLp.frequency.value = 2600;
    dl.connect(dlLp); dlLp.connect(dlFb); dlFb.connect(dl);
    musicDelayIn = AC.createGain(); musicDelayIn.connect(dl);
    const dlWet = AC.createGain(); dlWet.gain.value = 0.5; dl.connect(dlWet); dlWet.connect(musicBed);
    dl.connect(musicRevIn);   // the echoes also feed the reverb for space
    musicDelay = dl;
    scheduleDist(); schedulePhaser(); scheduleFormant(); scheduleFormantMorph();
    setLowAudio(!!SET.lowAudio);
  } catch (e) { musicBus = null; }
}
// the distortion drifts in and out at random amounts — sometimes fully clean, sometimes a touch of grit
function scheduleDist() {
  if (!AC || !distWet) return;
  try {
    const now = AC.currentTime, present = !SET.lowAudio && Math.random() < 0.5, ramp = 2 + Math.random() * 3;
    const wet = present ? 0.25 + Math.random() * 0.5 : 0.0001, drive = present ? 1.3 + Math.random() * 2.2 : 1;
    distWet.gain.cancelScheduledValues(now); distWet.gain.setValueAtTime(Math.max(0.0001, distWet.gain.value), now); distWet.gain.linearRampToValueAtTime(wet, now + ramp);
    distDrive.gain.cancelScheduledValues(now); distDrive.gain.setValueAtTime(distDrive.gain.value, now); distDrive.gain.linearRampToValueAtTime(drive, now + ramp);
  } catch (e) {}
  distTimer = setTimeout(scheduleDist, (4 + Math.random() * 6) * 1000);
}
// the phaser is only occasionally present, fading in and out very slowly
function schedulePhaser() {
  if (!phaserWet) return;
  try { const now = AC.currentTime, on = !SET.lowAudio && Math.random() < 0.4, tgt = on ? 0.9 : 0.0001;
    phaserWet.gain.cancelScheduledValues(now); phaserWet.gain.setValueAtTime(Math.max(0.0001, phaserWet.gain.value), now); phaserWet.gain.linearRampToValueAtTime(tgt, now + (4 + Math.random() * 5)); } catch (e) {}
  phaserTimer = setTimeout(schedulePhaser, (10 + Math.random() * 14) * 1000);
}
// the vowel filter likewise drifts in and out
function scheduleFormant() {
  if (!formantWet) return;
  try { const now = AC.currentTime, on = !SET.lowAudio && Math.random() < 0.4, tgt = on ? 0.8 : 0.0001;
    formantWet.gain.cancelScheduledValues(now); formantWet.gain.setValueAtTime(Math.max(0.0001, formantWet.gain.value), now); formantWet.gain.linearRampToValueAtTime(tgt, now + (4 + Math.random() * 5)); } catch (e) {}
  formantTimer = setTimeout(scheduleFormant, (11 + Math.random() * 14) * 1000);
}
// slowly morph the vowel the formant filter is shaped to
function scheduleFormantMorph() {
  if (formantBands) try { const now = AC.currentTime, v = VOWELS[(Math.random() * VOWELS.length) | 0];
    formantBands.forEach((bp, i) => { bp.frequency.cancelScheduledValues(now); bp.frequency.setValueAtTime(bp.frequency.value, now); bp.frequency.linearRampToValueAtTime(v[i], now + (4 + Math.random() * 5)); }); } catch (e) {}
  formantMorphTimer = setTimeout(scheduleFormantMorph, (6 + Math.random() * 8) * 1000);
}
function musicSetVol(v) { const f = Math.max(0, Math.min(100, v)) / 100, g = Math.pow(f, 1.8) * 0.6; if (musicBus) try { musicBus.gain.value = g; } catch (e) {} if (musicPunch) try { musicPunch.gain.value = g * pulseFactor(); } catch (e) {} }
function pulseFactor() { const p = Math.max(0, Math.min(100, SET.pulse ?? 50)) / 50; return Math.pow(p, 1.6); }   // Pulse slider: 50% = 1x, 0 = off, 100% ~ 3x   // curved so low % is genuinely quiet; 0 = off   // punch bus runs hotter so the staccato pulse cuts through
function stopDrone(fade = 2.6) {
  if (!drone) return;
  try {
    const now = AC.currentTime, d = drone, end = now + fade; drone = null;
    if (d.timer) clearTimeout(d.timer); if (d.arpTimer) clearTimeout(d.arpTimer); if (d.noiseTimer) clearTimeout(d.noiseTimer); if (d.pulseTimer) clearTimeout(d.pulseTimer);
    d.g.gain.cancelScheduledValues(now); d.g.gain.setValueAtTime(d.g.gain.value, now); d.g.gain.linearRampToValueAtTime(0, end);
    d.voice.oscs.forEach(o => o.stop(end + 0.2)); d.lfo.stop(end + 0.2); if (d.lfo2) d.lfo2.stop(end + 0.2);
    if (d.noise) d.noise.stop(end + 0.2); if (d.nlfo) d.nlfo.stop(end + 0.2);
  } catch (e) {}
}
// one trio of detuned oscillators at a base frequency, with its own fader so notes can be crossfaded
function droneVoices(freq) {
  const vg = AC.createGain(); vg.gain.value = 0.0001; vg.connect(drone.lp);
  const oscs = [];
  for (const [mult, det] of [[1, 0], [1, -6], [2, 5]]) {
    const o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult; o.detune.value = det; o.connect(vg); o.start(); oscs.push(o);   // drone is always pure sine
  }
  return { oscs, vg };
}
// move the drone to a new base note: usually a slow crossfade between two voice groups, rarely a pitch glide
function droneSetNote(freq, allowGlide) {
  if (!drone) return;
  freq = Math.max(50, freq);   // the base note never drops below 50 Hz
  const now = AC.currentTime, xf = 3 + Math.random() * 2.5;
  if (allowGlide && Math.random() < 0.2) {
    drone.voice.oscs.forEach((o, i) => { const mult = i === 2 ? 2 : 1; o.frequency.cancelScheduledValues(now); o.frequency.setValueAtTime(o.frequency.value, now); o.frequency.linearRampToValueAtTime(freq * mult, now + xf); });
  } else {
    const vo = droneVoices(freq); vo.vg.gain.setValueAtTime(0.0001, now); vo.vg.gain.linearRampToValueAtTime(1, now + xf);
    const old = drone.voice; old.vg.gain.cancelScheduledValues(now); old.vg.gain.setValueAtTime(old.vg.gain.value, now); old.vg.gain.linearRampToValueAtTime(0.0001, now + xf);
    old.oscs.forEach(o => o.stop(now + xf + 0.4));
    drone.voice = vo;
  }
}
// occasionally a short arpeggiated figure drifts in over the drone, plays a few seconds, and fades out slowly
function playArp() {
  if (!AC || !musicBus || !drone || !(SET.music > 0)) return;
  try {
    const now = AC.currentTime, dur = 8 + Math.random() * 7;                // longer arpeggio
    const bus = AC.createGain(); bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(0.18, now + 1.8);                 // slow fade-in
    bus.gain.setValueAtTime(0.18, Math.max(now + 1.9, now + dur - 1.5));
    bus.gain.exponentialRampToValueAtTime(0.0001, now + dur + 1.8);         // slow fade-out
    // a panner that wanders left/right across the figure
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    if (pan) {
      pan.pan.setValueAtTime((Math.random() * 2 - 1) * 0.65, now);
      for (let pt = now + 0.8; pt < now + dur; pt += 0.6 + Math.random() * 0.8) pan.pan.linearRampToValueAtTime((Math.random() * 2 - 1) * 0.65, pt);
      bus.connect(pan); pan.connect(musicBus);
    } else bus.connect(musicBus);
    let arpSend = null; if (musicDelayIn) { arpSend = AC.createGain(); arpSend.gain.value = 0.45; (pan || bus).connect(arpSend); arpSend.connect(musicDelayIn); }   // arps echo strongly
    const type = ['sine', 'triangle', 'sawtooth', 'square'][(Math.random() * 4) | 0], oct = 4 * (Math.random() < 0.5 ? 1 : 2);
    // a fully random figure: random number of notes, each a random scale degree within a window
    const patLen = 3 + ((Math.random() * 6) | 0), start = (Math.random() * Math.max(1, MUSIC_SCALE.length - 8)) | 0, pat = [];
    for (let i = 0; i < patLen; i++) pat.push(start + ((Math.random() * 8) | 0));
    const step = 0.1 + Math.random() * 0.1;
    let t = now + 0.3, i = 0;
    while (t < now + dur) {
      const deg = MUSIC_SCALE[pat[i % pat.length] % MUSIC_SCALE.length], f = musicBase * Math.pow(2, deg / 12) * oct;
      const o = AC.createOscillator(); o.type = type; o.frequency.value = f;
      const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + step * 2.2);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + step * 2.4);
      const oo = o, gg = g; o.onended = () => { try { oo.disconnect(); gg.disconnect(); } catch (e) {} };
      t += step; i++;
    }
    setTimeout(() => { try { bus.disconnect(); if (pan) pan.disconnect(); if (arpSend) arpSend.disconnect(); } catch (e) {} }, (dur + 2.5) * 1000);
  } catch (e) {}
}
function scheduleArp() {
  if (!drone) return;
  drone.arpTimer = setTimeout(() => { if (drone) { if (Math.random() < 0.95) playArp(); scheduleArp(); } }, (3 + Math.random() * 6) * 1000);
}
// every so often the drone drifts to a new scale degree (crossfading) and the filter re-aims its sweep
function scheduleDroneMove() {
  if (!drone) return;
  drone.timer = setTimeout(() => {
    if (!drone || !AC) return;
    try {
      const now = AC.currentTime, deg = DRONE_DEG[(Math.random() * DRONE_DEG.length) | 0];
      drone.curDeg = deg;   // the pulse follows this
      droneSetNote(musicBase * Math.pow(2, deg / 12), true);
      // everything drifts: filter centre, both sweep depths and rates, and the noise highpass sweep
      const centre = 300 + Math.random() * 1100;
      drone.lp.frequency.cancelScheduledValues(now); drone.lp.frequency.setValueAtTime(drone.lp.frequency.value, now); drone.lp.frequency.linearRampToValueAtTime(centre, now + 3 + Math.random() * 4);
      drone.depth.gain.setTargetAtTime(400 + Math.random() * 900, now, 2);
      drone.lfo.frequency.setTargetAtTime(0.02 + Math.random() * 0.12, now, 1);
      if (drone.lfo2) drone.lfo2.frequency.setTargetAtTime(0.008 + Math.random() * 0.04, now, 1);
      if (drone.ndepth) drone.ndepth.gain.setTargetAtTime(500 + Math.random() * 900, now, 2);
      if (drone.nlfo) drone.nlfo.frequency.setTargetAtTime(0.015 + Math.random() * 0.07, now, 1);
    } catch (e) {}
    scheduleDroneMove();
  }, (5 + Math.random() * 7) * 1000);
}
// the noise layer comes and goes: it swells in, lingers, then recedes to silence on its own schedule
function scheduleNoise() {
  if (!drone) return;
  drone.noiseTimer = setTimeout(() => {
    if (!drone) return;
    try {
      const now = AC.currentTime, on = Math.random() < 0.7, tgt = on ? 0.16 + Math.random() * 0.2 : 0.0001;
      drone.ng.gain.cancelScheduledValues(now); drone.ng.gain.setValueAtTime(Math.max(0.0001, drone.ng.gain.value), now); drone.ng.gain.linearRampToValueAtTime(tgt, now + (3 + Math.random() * 4));
    } catch (e) {}
    scheduleNoise();
  }, (5 + Math.random() * 7) * 1000);
}
// one staccato pulse hit — a tone (following the drone's current note, an octave up) or a low noise thud
function pulseVoice(kind) {
  if (!drone || !AC || !musicBus) return;
  try {
    const now = AC.currentTime, len = Math.max(0.09, Math.min(0.18, (60 / drone.bpm) * 0.25));
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(kind === 'noise' ? 0.9 : 0.8, now + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    const srcs = [];
    if (kind === 'noise') {   // a crisp, mid-range noise tick so it reads on any speaker
      const s = AC.createBufferSource(); s.buffer = musicNoise(); s.loop = true;
      const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.9;
      s.connect(bp); bp.connect(lp); lp.frequency.value = 3200; srcs.push(s, bp);
    } else {
      // the drone's current note: a body an octave up plus a harmonic-rich voice two octaves up,
      // so it's audible even on small speakers that can't reproduce real bass
      const f = Math.max(50, musicBase * Math.pow(2, (drone.curDeg || 0) / 12));
      const body = AC.createOscillator(); body.type = 'triangle'; body.frequency.value = f * 2;
      const edge = AC.createOscillator(); edge.type = drone.pulseWave; edge.frequency.value = f * 4;
      const eg = AC.createGain(); eg.gain.value = 0.55; edge.connect(eg); eg.connect(lp); body.connect(lp);
      lp.frequency.setValueAtTime(2600, now); lp.frequency.exponentialRampToValueAtTime(500, now + len);   // a little "pluck" sweep
      srcs.push(body, edge, eg);
    }
    lp.connect(g);
    g.connect(musicPunch || musicBus);                 // dry punch so the rhythm is clearly heard
    const col = AC.createGain(); col.gain.value = 0.3 * pulseFactor(); g.connect(col); col.connect(musicBus);   // a little into the reverb bus for colour
    srcs.forEach(n => { if (n.start) { n.start(now); n.stop(now + len + 0.05); } });
    srcs[0].onended = () => { try { srcs.forEach(n => n.disconnect()); lp.disconnect(); g.disconnect(); col.disconnect(); } catch (e) {} };
  } catch (e) {}
}
function pulseHit() {
  if (!drone) return;
  if (Math.random() < 0.15) return;   // randomly skip notes, leaving rests in the rhythm
  if (drone.pulseNoise) pulseVoice('noise');
  else { pulseVoice('tone'); if (Math.random() < 0.3) pulseVoice('noise'); }   // tone levels: occasionally a noise hit on top of the base-note pulse
}
function schedulePulse() {
  if (!drone) return;
  const beat = 60 / drone.bpm, step = drone.pulseNoise ? beat : beat / 2;   // noise levels = quarter notes, tone levels = eighth notes
  drone.pulseTimer = setTimeout(() => { if (drone) { pulseHit(); schedulePulse(); } }, step * 1000);
}
function startDrone(freq) {
  stopDrone(); if (!AC || !musicBus) return;
  try {
    const now = AC.currentTime;
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.24, now + 3);   // slow fade-in
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.05; const depth = AC.createGain(); depth.gain.value = 700;
    lfo.connect(depth); depth.connect(lp.frequency); lfo.start();
    const lfo2 = AC.createOscillator(); lfo2.frequency.value = 0.017; const depth2 = AC.createGain(); depth2.gain.value = 400;
    lfo2.connect(depth2); depth2.connect(lp.frequency); lfo2.start();
    lp.connect(g); g.connect(musicBus);
    // noise layer, starting silent — scheduleNoise swells it in and out
    const noise = AC.createBufferSource(); noise.buffer = musicNoise(); noise.loop = true;
    const nhp = AC.createBiquadFilter(); nhp.type = 'highpass'; nhp.frequency.value = 400;
    const nlfo = AC.createOscillator(); nlfo.frequency.value = 0.03; const ndepth = AC.createGain(); ndepth.gain.value = 900;   // wider sweep
    nlfo.connect(ndepth); ndepth.connect(nhp.frequency); nlfo.start();
    const ng = AC.createGain(); ng.gain.value = 0.0001;
    noise.connect(nhp); nhp.connect(ng); ng.connect(g); noise.start();
    drone = { voice: null, g, lp, lfo, lfo2, depth, noise, nlfo, ndepth, nhp, ng, timer: null, arpTimer: null, noiseTimer: null, pulseTimer: null,
      bpm: 80 + Math.random() * 120, pulseNoise: Math.random() < 0.35, pulseWave: ['sawtooth', 'square', 'triangle'][(Math.random() * 3) | 0], curDeg: 0 };   // random 80-200 BPM + pulse type per level
    drone.voice = droneVoices(freq); drone.voice.vg.gain.setValueAtTime(0.0001, now); drone.voice.vg.gain.linearRampToValueAtTime(1, now + 3);
    if (musicDelay) musicDelay.delayTime.setTargetAtTime(Math.min(1.4, 60 / drone.bpm * 0.75), now, 0.1);   // echo synced to a dotted-eighth of the level tempo
    musicUnduck();   // bring the music output back up for the new level
    scheduleDroneMove(); scheduleArp(); scheduleNoise(); schedulePulse();
  } catch (e) { drone = null; }
}
function musicStartLevel(r) {
  if (!AC || !musicBus || !(SET.music > 0)) { stopDrone(); return; }
  if (drone && r === musicRound) return;                   // respawn on the same level: leave the music as it is
  musicRound = r;
  musicBuildScale();                                       // new mode (major / Lydian / Mixolydian) per level
  const m = 26 + ((Math.random() * 14) | 0);               // new base note (~D1..E2)
  musicBase = Math.max(50, 440 * Math.pow(2, (m - 69) / 12));   // never below 50 Hz
  startDrone(musicBase);                                    // each level starts fresh (the old one was quick-faded on level end)
}
function musicNote(t, octaveMul = 4, peak = 0.2, attack = 0.85, dur = 7.5, glide = 0, force = false) {
  if (!AC || !musicBus || !drone || !(SET.music > 0)) return;
  const now = AC.currentTime; if (!force && now - musicLastNote < 0.1) return; musicLastNote = now;   // keep it sparse (power-ups bypass this)
  try {
    const NL = MUSIC_SCALE.length;
    let idx = (Math.abs(t | 0)) % NL;
    if (idx === musicLastIdx) idx = (idx + 1 + ((Math.random() * (NL - 1)) | 0)) % NL;   // never the same pitch twice in a row
    musicLastIdx = idx;
    const freq = musicBase * Math.pow(2, MUSIC_SCALE[idx] / 12) * octaveMul;   // octaveMul: 4 = two octaves up (bricks), 8 = one higher (power-ups)
    // per-note jitter so no two notes share the same length / shape / loudness
    dur *= 0.7 + Math.random() * 0.8; attack = Math.max(0.002, attack * (0.55 + Math.random())); peak *= 0.75 + Math.random() * 0.5;
    // waveform palette, weighted toward noise (and noise gets its own swept bandpass below)
    const wave = ['sine', 'square', 'sawtooth', 'triangle', 'noise', 'noise', 'noise'][(Math.random() * 7) | 0];
    // multi-waypoint exponential sweep on a filter param: 2-3 random moves across the note's life
    const sweep = (param, lo, hi) => {
      const segs = 2 + ((Math.random() * 2) | 0);
      param.setValueAtTime(mclamp(lo + Math.random() * (hi - lo)), now);
      for (let s = 1; s <= segs; s++) param.exponentialRampToValueAtTime(mclamp(lo + Math.random() * (hi - lo)), now + dur * s / segs);
    };
    const hp = AC.createBiquadFilter(); hp.type = 'highpass'; sweep(hp.frequency, 50, 1500);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; sweep(lp.frequency, 500, 5000);
    // unison: now and then stack several slightly-detuned copies of the same note for a thick, chorused voice
    const unison = !SET.lowAudio && Math.random() < 0.5, count = unison ? 3 + ((Math.random() * 4) | 0) : 1, spread = 6 + Math.random() * 22;   // cents
    const gt = glide ? Math.min(dur, 0.1 + Math.random() * dur) : 0;   // random glide speed: some bend fast, some slow
    const nodes = [];
    for (let v = 0; v < count; v++) {
      const det = count === 1 ? 0 : (v / (count - 1) - 0.5) * 2 * spread;
      const ratio = glide ? Math.pow(2, glide / 12) : 0;   // rare pitch-shift over the note's life
      if (wave === 'noise') {   // pitched noise with its own swept, variable-resonance bandpass
        const s = AC.createBufferSource(); s.buffer = musicNoise(); s.loop = true;
        const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3 + Math.random() * 10;
        const cf = freq * Math.pow(2, det / 1200);
        if (glide) { bp.frequency.setValueAtTime(mclamp(cf), now); bp.frequency.exponentialRampToValueAtTime(mclamp(cf * ratio), now + gt); }
        else sweep(bp.frequency, cf * 0.5, cf * 2);
        s.connect(bp); bp.connect(hp); nodes.push(s, bp);
      } else {
        const s = AC.createOscillator(); s.type = wave; s.frequency.value = freq; s.detune.value = det;
        if (glide) { s.frequency.setValueAtTime(freq, now); s.frequency.exponentialRampToValueAtTime(freq * ratio, now + gt); }
        s.connect(hp); nodes.push(s);
      }
    }
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak / Math.sqrt(count), now + attack);   // keep level even as voices stack
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);                       // long tail
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;           // random placement, up to 65% either side
    if (pan) pan.pan.value = (Math.random() * 2 - 1) * 0.65;
    hp.connect(lp); lp.connect(g); const out = pan || g; if (pan) g.connect(pan); out.connect(musicBus);
    let sg = null; if (musicDelayIn) { sg = AC.createGain(); sg.gain.value = 0.22; out.connect(sg); sg.connect(musicDelayIn); }   // echo send
    nodes.forEach(n => { if (n.start) { n.start(now); n.stop(now + dur + 0.1); } });
    nodes[0].onended = () => { try { nodes.forEach(n => n.disconnect()); hp.disconnect(); lp.disconnect(); g.disconnect(); if (pan) pan.disconnect(); if (sg) sg.disconnect(); } catch (e) {} };
  } catch (e) {}
}
// sound ids follow the game's own table ($708C0); channels as the game queues them
const sfx = (id, c, x) => SND && play(SND[id - 1], c, false, x);
// channel = the Paula channel the original queues each sound on
const SFX = {
  laser: x => sfx(1, 1, x),        // $799D4
  hard: x => sfx(2, 2, x),         // brick hit but not broken ($7A88A)
  brick: x => sfx(3, 2, x),        // brick broken ($7A8C6)
  wall: x => sfx(4, 0, x),         // ball off a wall ($7B574)
  growSmall: x => sfx(5, 1, x),    // E capsule from a small bat ($78A82)
  grow: x => sfx(6, 1, x),         // E capsule ($78A9C)
  warp: x => sfx(7, 2, x),         // leaving through the B exit ($77768)
  bossHit: x => sfx(10, 1, x),     // ball hits the boss face ($78424)
  demons: x => sfx(11, 1, x),
  life: x => sfx(12, 3, x),        // extra life ($78C10, $7923A)
  bat: x => sfx(13, 2, x),         // ball off the bat ($7B7EC)
  catch: x => sfx(14, 2, x),       // ball caught by the C bat ($7B780)
  appear: x => sfx(15, 3, x),      // bat materialises ($78C76)
  vanish: x => sfx(16, 2, x),      // bat dissolves ($78D8C)
  clear: x => sfx(18, 0, x),       // round cleared ($77BCC)
};
// bonus counter ticks: $70C56 alternates samples 8 and 9 every second frame
let tickCount = 0;
const bonusTick = () => { tickCount++; if (tickCount === 2) sfx(8, 1); else if (tickCount >= 4) { tickCount = 0; sfx(9, 1); } };

/* ============================================================
   Game constants (from the original code)
   ============================================================ */
const PL = 6, PT = 8;                       // playfield bounds
let PR = 227;                               // right edge: wider for Amegas / Crystal Hammer rounds (their own 1:1 grids)
let BAT_Y = 185;                           // bat blit row ($B9); lower on the widened stage
const BOSS_EYES = [[29, 37], [79, 38]];    // fireball spawn (ball centre, boss-relative) tuned so the z=3 balls land on the eyes
const PANEL_X = 234;
// brick grid: 13 x 18 bricks 16 px wide on a 17 px pitch; Amegas (20 x 20) and Crystal Hammer (18 x 20) rounds keep
// their own grids 1:1 with full-size bricks, and the stage widens to fit them
const GRID_STD = { cols: 13, rows: 18, bpx: 17, bw: 16, bpy: 7, bh: 6 }, GRID_WIDE = { cols: 20, rows: 20, bpx: 17, bw: 16, bpy: 8, bh: 7 };
// the playfield's right edge follows the grid: 13 columns = the original 221 px; wider grids widen the stage
// and the stage grows taller with it (bat lower), keeping roughly the original games' proportions
const setField = () => {
  PR = PL + G.cols * G.bpx; const dy = Math.round((PR - 227) * 0.45); BAT_Y = 185 + dy; H = 200 + dy;
  G.batMul = PR > 227 ? 1.55 : 1;   // Amegas / Crystal Hammer: their bat is ~48 px (3 bricks) against Giganoid's 31
};
const BRICK = (c, r) => [(G.bpx || 17) * c + 6, (G.bpy || 7) * r + 12];
const INTERMISSION = new Set([5, 10, 15, 20, 30, 35, 40, 45]);
const START_ROUND = [1, 11, 21, 31];
const LIFE_EVERY = 80000;                  // a new life every 80,000 points

/* ============================================================
   Game state
   ============================================================ */
const G = {
  mode: 'load', t: 0, frame: 0, paused: false, cols: 13, rows: 18, bpx: 17, bw: 16,
  round: 1, score: 0, top: 0, lives: 2, nextLife: LIFE_EVERY,
  grid: null, counter: 0, brickScore: 200, speedEvery: 1500,
  balls: [], speed: 1, speedTimer: 0,
  batX: 100, batF: 9, batTarget: 9, batTick: 0,
  laser: false, catching: false, warp: false,
  shots: [], capsule: null, boss: null, bossShots: [], bossQueue: [],
  pal: null, bg: null, fire: false, launchTimer: 0,
};
try { G.top = parseInt(localStorage.getItem('giganoid-top') || '0', 10) || 0; } catch (e) {}

// XXXL: the (E) bat at twice its width, stretched about its centre
// G.batMul: the original games' own bat size on their rounds (Amegas / Crystal Hammer bats are ~3 bricks wide)
const batScale = () => (G.xxl ? 2 : 1) * (G.batMul || 1);
function batCol(x) {
  const e = A.bat[G.batF].ext;
  const k = batScale(); if (k === 1) return x - G.batX;
  const cx = G.batX + (e.l + e.r) / 2; return Math.round(cx + (x - cx) / k) - G.batX;
}
function batGeom() {
  const b = A.bat[G.batF], e = b.ext, k = batScale(), cx = G.batX + (e.l + e.r) / 2;
  return { l: Math.round(cx - (cx - G.batX - e.l) * k), r: Math.round(cx + (G.batX + e.r - cx) * k), top: BAT_Y + e.top };
}


/* ---------- imported level packs ----------
   A text/JSON/JS file holding level layouts as nested number arrays, e.g. the 11-wide Arkanoid grids
   (0 empty, 1 white, 2 orange, 3 light blue, 4 green, 5 red, 6 blue, 7 pink, 8 yellow, 9 silver, 10 gold).
   Nothing is bundled: the pack is whatever file you load, kept only in this browser. */
// loaded level sets, played in this order after Giganoid's 50 rounds (kept only in this browser)
const PACK_ORDER = ['arkanoid', 'doh', 'amegas', 'crystal', 'custom', 'mine'];
let PACKS = [];
try {
  const p = JSON.parse(localStorage.getItem('giganoid-packs') || 'null');
  if (Array.isArray(p)) PACKS = p.filter(x => x && Array.isArray(x.levels) && x.levels.length);
  else { const o = JSON.parse(localStorage.getItem('giganoid-pack') || 'null'); if (o && o.levels) PACKS = [{ id: o.native ? 'arkanoid' : 'custom', ...o }]; }
} catch (e) {}
function savePacks() {
  PACKS.sort((x, y) => PACK_ORDER.indexOf(x.id) - PACK_ORDER.indexOf(y.id));
  try { localStorage.setItem('giganoid-packs', JSON.stringify(PACKS)); localStorage.removeItem('giganoid-pack'); } catch (e) {}
}
function addPack(pk) { PACKS = PACKS.filter(x => x.id !== pk.id); PACKS.push(pk); savePacks(); return pk.levels.length; }
function parseNested(text) {
  // tolerant reader: brackets and integers only (accepts 00-style numbers, JS assignments, comments)
  const toks = text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ').match(/\[|\]|-?\d+/g) || [];
  const root = [], stack = [root];
  for (const t of toks) {
    if (t === '[') { const a = []; stack[stack.length - 1].push(a); stack.push(a); }
    else if (t === ']') { if (stack.length > 1) stack.pop(); }
    else if (stack.length > 1) stack[stack.length - 1].push(parseInt(t, 10));
  }
  return root;
}
function findLevels(node, out) {
  if (!Array.isArray(node)) return;
  const isRow = a => Array.isArray(a) && a.length >= 8 && a.length <= 16 && a.every(v => typeof v === 'number');
  if (node.length >= 4 && node.every(isRow)) { out.push(node.map(r => r.slice())); return; }
  if (node.length >= 88 && node.every(v => typeof v === 'number') && node.length % 11 === 0) {
    const rows = []; for (let i = 0; i < node.length; i += 11) rows.push(node.slice(i, i + 11)); out.push(rows); return;
  }
  for (const c of node) findLevels(c, out);
}
function loadPackText(text, name) {
  const levels = []; findLevels(parseNested(text), levels);
  const good = levels.filter(l => l.some(r => r.some(v => v > 0 && v <= 10)));
  if (!good.length) throw new Error('No level grids found in that file');
  return addPack({ id: 'custom', name: name || 'Level file', levels: good });
}

/* ---------- Arkanoid (Discovery Software, 1988) levels, read from your own disk image ----------
   The game file "Arkanoid.dat" is run-length packed (escape byte $42: count, value) and unpacks to
   memory from $0. A table of 32 longword pointers ($FCCA in this release) leads to the rounds, each
   13 x 26 words: a negative word -n repeats the next word n times; 0 is empty, otherwise
   bits 4-7 = colour (0 red, 1 orange, 2 yellow, 3 green, 4 light blue, 5 blue, 6 pink, 7 silver,
   8 gold, 9 white), bits 0-3 = 2 x hits - 1 (silver takes several), bits 8-11 = holds a capsule. */
function arkanoidFromAdf(d) {
  let f;
  try { f = adfFind(d, 'arkanoid.dat'); } catch (e) { f = null; }
  if (!f) throw new Error('No Arkanoid.dat on this disk.');
  const mem = new Uint8Array(0x80000); let i = 0, o = 0;
  while (i < f.length && o < mem.length) {
    const b = f[i++];
    if (b === 0x42) { let c = f[i++] || 256; const v = f[i++]; while (c-- && o < mem.length) mem[o++] = v; }
    else mem[o++] = b;
  }
  const W = a => (mem[a] << 8) | mem[a + 1], Lw = a => ((W(a) << 16) | W(a + 2)) >>> 0;
  const decode = p => {
    const cells = []; let a = p, guard = 0;
    while (cells.length < 338 && guard++ < 400) {
      const w = W(a); a += 2;
      if (w >= 0x8000) { const n = 0x10000 - w, v = W(a); a += 2; for (let k = 0; k < n; k++) cells.push(v); }
      else cells.push(w);
    }
    return cells.length >= 338 ? cells.slice(0, 338) : null;
  };
  const tableAt = t => {
    const ptrs = []; for (let k = 0; k < 32; k++) ptrs.push(Lw(t + 4 * k));
    if (!ptrs.every(p => p > 0x400 && p < 0x7ff00)) return null;
    const lv = ptrs.map(decode); if (lv.some(x => !x)) return null;
    // round 1 is six full rows
    const rows = []; for (let r = 0; r < 26; r++) rows.push(lv[0].slice(r * 13, r * 13 + 13));
    if (rows.filter(rw => rw.every(v => v && v === rw[0])).length !== 6) return null;
    return lv;
  };
  let lv = tableAt(0xFCCA);
  for (let t = 0x400; !lv && t < 0x7f000; t += 2) lv = tableAt(t);
  if (!lv) throw new Error('Could not find the Arkanoid level table on this disk.');
  const COL = [5, 2, 8, 4, 3, 6, 7, 9, 10, 1];   // Arkanoid colour -> pack index (1 white .. 10 gold)
  return lv.map(cells => {
    const rows = [];
    for (let r = 0; r < 18; r++) rows.push(cells.slice(r * 13, r * 13 + 13).map(v => {
      if (!v) return 0;
      const c = COL[(v >> 4) & 15] || 1, cap = (v >> 8) & 15 ? 1 : 0, hits = ((v & 15) + 1) >> 1;
      return c + 100 * cap + (c === 9 ? 1000 * hits : 0);
    }));
    return rows;
  });
}
/* Arkanoid - Revenge of Doh (Imagine, 1989): a non-DOS disk. Bit 7 of a cell = a moving brick; $12+ = notched
   (regenerating) silver. The bootblock loads $58000 bytes from disk
   offset $AA00 to $18000; the rounds sit at $20000 (disk offset $12A00): 68 grids (34 rounds x the
   left/right paths) of 18 rows x 16 bytes, 13 used. Cell: bit 7 = holds a capsule; $08-$0F colours
   (red, green, orange, light blue, white, blue, pink, yellow - order from the game's score table at
   $61E3C), $10 silver, $11 gold (unbreakable), $12+ extra-strong (hits = value - $11), $01-$06 hits left. */
function dohFromAdf(d) {
  const ok = o => { for (let r = 0; r < 18; r++) for (let k = 13; k < 16; k++) if (d[o + r * 16 + k]) return false; return true; };
  const grid0 = o => { let full = 0; for (let r = 0; r < 18; r++) if (d[o + r * 16] === 0x10 && d[o + r * 16 + 12] === 0x10) full++; return full; };
  let base = 0x12A00;
  if (!(ok(base) && grid0(base) >= 1)) {
    base = -1;
    for (let o = 0x400; o + 68 * 288 < d.length; o += 16) { let n = 0; while (n < 68 && ok(o + n * 288)) n++; if (n === 68 && grid0(o) >= 1) { base = o; break; } }
  }
  if (base < 0) return null;
  const COL = { 0x08: 5, 0x09: 4, 0x0a: 2, 0x0b: 3, 0x0c: 1, 0x0d: 6, 0x0e: 7, 0x0f: 8 };
  const levels = [], seen = new Set();
  for (let i = 0; i < 68; i++) {
    const o = base + i * 288, key = Array.from(d.subarray(o, o + 288)).join(',');
    if (seen.has(key)) continue; seen.add(key);             // a round whose two paths are the same is played once
    const rows = [];
    for (let r = 0; r < 18; r++) {
      const row = [];
      for (let x = 0; x < 13; x++) {
        // bit 7 marks a brick that roams left and right; $12+ are the notched silver bricks that grow back
        const raw = d[o + r * 16 + x], v = raw & 0x7f, mv = raw & 0x80 ? 100 : 0;
        let c = 0;
        if (COL[v]) c = COL[v] + mv;
        else if (v === 0x10) c = 9 + mv + 2000;
        else if (v === 0x11) c = 10 + mv;
        else if (v >= 0x12) c = 9 + mv + 1000 * Math.min(9, v - 0x10) + 10000;
        else if (v >= 1 && v <= 6) c = 9 + mv + 1000 * v;
        row.push(c);
      }
      rows.push(row);
    }
    if (rows.some(rw => rw.some(Boolean))) levels.push(rows);
  }
  return levels.length ? levels : null;
}
/* Amegas (Guido Bartels / Reline, 1987): "amegas.exe" is ByteKiller-crunched. Unpacked, an embedded data hunk holds a
   table of 40 word offsets to the rounds; each round is rows of 40 bytes: 20 brick bytes (high nibble colour 1-7,
   low nibble hits, $F = unbreakable) then 20 special-stone bytes (1 = power stone). The 20-column field is
   played 1:1 on a 20 x 20 grid of narrower bricks. */
// special-stone byte -> kind (from the game's hit handler jump table at $31756):
// 1 power (+, drops a capsule), 2 exit (L, bonus), 4 survivor (flashing, breakable only while white),
// 7 spreader (X, splits into its 4 diagonal cells), 9 jumper (triangles, hops up a row), 10 killer (skull, costs a life)
const AME_KIND = { 2: 1, 4: 2, 7: 3, 9: 4, 10: 5 };
const amegasOpen = () => ((G.frame >> 5) & 1) === 1;   // survivor stones: solid, then white and breakable, ~0.64 s each
function amegasFromAdf(d) {
  let f; try { f = adfFind(d, 'amegas.exe'); } catch (e) { return null; }
  const c = firstCodeHunk(f);
  let a0 = -1;
  for (let i = 0; i + 12 < c.length && i < 0x400; i += 2) if (be32(c, i) === 0x43f90003 && be16(c, i + 4) === 0 && be16(c, i + 6) === 0x41f9) { a0 = be32(c, i + 8); break; }
  if (a0 < 0 || a0 > c.length) return null;
  const rl = () => { a0 -= 4; return be32(c, a0); };
  const size = rl(); if (size > 0x100000) return null;
  rl(); let d0 = rl();
  const out = new Uint8Array(size); let a2 = size;
  const bit = () => { let b = d0 & 1; d0 >>>= 1; if (d0 === 0) { const n = rl(); b = n & 1; d0 = ((n >>> 1) | 0x80000000) >>> 0; } return b; };
  const bits = n => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bit(); return v; };
  const copy = (off, n) => { for (let i = 0; i < n && a2 > 0; i++) { a2--; out[a2] = out[a2 + off]; } };
  while (a2 > 0) {
    if (a0 < 0) return null;
    let lit = 0;
    if (!bit()) { if (!bit()) lit = bits(3) + 1; else { const o = bits(8); copy(o, 2); continue; } }
    else {
      const t = bits(2);
      if (t === 3) lit = bits(8) + 9;
      else if (t === 2) { const n = bits(8) + 1; copy(bits(12), n); continue; }
      else { const o = bits(9 + t); copy(o, t + 3); continue; }
    }
    for (let i = 0; i < lit && a2 > 0; i++) { a2--; out[a2] = bits(8); }
  }
  // the level table: first data longword of an embedded code hunk, the first at $A0
  let tb = -1;
  for (let i = 0; i + 16 < out.length; i += 2) if (be32(out, i) === 0x3e9 && be32(out, i + 8) === 0xa0) { tb = i + 8; break; }
  if (tb < 0) return null;
  const COL = [0, 4, 6, 7, 5, 2, 8, 3, 1];   // Amegas colour nibble -> pack colour: green, blue, magenta, red, orange, yellow, light blue
  const levels = [], seen = new Set();
  for (let k = 0; k < 40; k++) {
    const o = be32(out, tb + 4 * k); if (seen.has(o)) continue; seen.add(o);
    const base = tb + o; if (base + 20 * 40 > out.length) continue;
    const rows = [];
    for (let r = 0; r < 20; r++) {
      const row = [], p = base + r * 40;
      for (let x = 0; x < 20; x++) {
        const v = out[p + x], sp = out[p + 20 + x];
        if (!v) { row.push(0); continue; }
        const hi = v >> 4, lo = v & 15;
        if (lo === 15) { row.push(10); continue; }
        row.push((COL[hi] || 1) + (sp === 1 ? 100 : 0) + (lo > 1 ? 1000 * Math.min(9, lo) : 0) + 100000 * (AME_KIND[sp] || 0));
      }
      rows.push(row);
    }
    if (rows.some(rw => rw.some(v => v && v !== 10))) levels.push(rows);
  }
  return levels.length ? levels : null;
}
/* Crystal Hammer (Reline, 1987): plain files "prmlevel" (and identical copies seclevel/thrlevel/forlevel), 20000
   bytes = 50 rounds of 20 rows x 20 bytes. Column 0 is empty and column 19 the wall ($FF), leaving 18 brick columns:
   high nibble colour 1-7, low nibble hits, $FF unbreakable. Played 1:1 on an 18 x 20 grid (the stage widens). */
function crystalFromAdf(d) {
  let f; try { f = adfFind(d, 'prmlevel'); } catch (e) { return null; }
  if (f.length < 20000) return null;
  const COL = [0, 3, 2, 4, 8, 5, 6, 7, 1];
  const levels = [];
  for (let L = 0; L < 50; L++) {
    const o = L * 400, rows = [];
    for (let r = 0; r < 20; r++) {
      const row = [], p = o + r * 20;
      for (let x = 0; x < 18; x++) {   // 1:1: the 18 brick columns between the empty column 0 and the wall
        const v = f[p + 1 + x];
        if (!v) row.push(0);
        else if (v === 0xff) row.push(10);
        else { const lo = v & 15; row.push((COL[v >> 4] || 1) + (lo > 1 ? 1000 * Math.min(9, lo) : 0)); }
      }
      rows.push(row);
    }
    if (!rows.some(rw => rw.some(v => v && v !== 10))) continue;
    levels.push(rows);
  }
  return levels.length ? levels : null;
}
function loadArkanoidAdf(d) {
  let lv = null;
  try { lv = arkanoidFromAdf(d); } catch (e) { lv = null; }
  if (lv) return { name: 'Arkanoid', n: addPack({ id: 'arkanoid', name: 'Arkanoid', levels: lv, native: true }) };
  lv = amegasFromAdf(d);
  if (lv) return { name: 'Amegas', n: addPack({ id: 'amegas', name: 'Amegas', levels: lv, native: true, wide: true }) };
  lv = crystalFromAdf(d);
  if (lv) return { name: 'Crystal Hammer', n: addPack({ id: 'crystal', name: 'Crystal Hammer', levels: lv, native: true, wide: true }) };
  lv = dohFromAdf(d);
  if (lv) return { name: 'Revenge of Doh', n: addPack({ id: 'doh', name: 'Revenge of Doh', levels: lv, native: true, v: 2 }) };
  throw new Error('No Arkanoid, Revenge of Doh, Amegas or Crystal Hammer levels found on this disk.');
}
// the level editor's own rounds (13 x 18 grids of pack colour indices), played after everything else
function getMine() { const p = PACKS.find(x => x.id === 'mine'); return p ? p.levels.map(l => l.map(r => r.slice())) : []; }
function setMine(levels) {
  PACKS = PACKS.filter(x => x.id !== 'mine');
  if (levels.length) PACKS.push({ id: 'mine', name: 'My levels', levels, native: true });
  savePacks();
}
function clearPacks() { PACKS = PACKS.filter(x => x.id === 'mine'); savePacks(); }
const packInfo = () => PACKS.map(p => ({ id: p.id, name: p.name, n: p.levels.length, stale: p.id === 'doh' && p.v !== 2 }));
// the whole campaign: Giganoid 1-50, then each loaded set in turn
const usingPacks = () => SET.pack !== false && PACKS.length > 0;
const lastRound = () => 50 + (usingPacks() ? PACKS.reduce((n, p) => n + p.levels.length, 0) : 0);
function packFor(r) {
  let k = r - 50;
  for (const p of PACKS) { if (k <= p.levels.length) return { pack: p, i: k - 1 }; k -= p.levels.length; }
  return null;
}
function roundLabel(r) {
  if (r <= 50 || !usingPacks()) return 'Round ' + String(r).padStart(2, '0');
  const f = packFor(r); return f ? f.pack.name + ' ' + (f.i + 1) : 'Round ' + r;
}
function packCells(pack, i) {
  const lv = pack.levels[i];
  if (pack.native && pack.wide && lv[0] && lv[0].length !== 13) return lv.map(r => r.slice());   // Amegas 20 x 20 / Crystal Hammer 18 x 20, 1:1
  if (pack.native) {
    const g = Array.from({ length: 18 }, (_, y) => Array.from({ length: 13 }, (_, x) => (lv[y] && lv[y][x]) | 0));
    // Amegas / Crystal Hammer rounds touching the ceiling (e.g. Amegas 13's walled cup) get one row of headroom, so the ball can get over the walls
    if ((pack.id === 'amegas' || pack.id === 'crystal') && g[0].some(Boolean) && !g[17].some(Boolean)) { g.pop(); g.unshift(new Array(13).fill(0)); }
    if (pack.id === 'crystal') openSealed(g);   // Amegas rounds open their own walls with spreader / jumper stones
    return g;
  }
  let first = lv.findIndex(row => row.some(v => v > 0)); if (first < 0) first = 0;
  const top = Math.max(0, first - 2), w = Math.max(...lv.map(row => row.length)), off = Math.max(0, Math.floor((13 - w) / 2));
  const out = Array.from({ length: 18 }, () => new Array(13).fill(0));
  for (let y = 0; y < 18 && top + y < lv.length; y++) lv[top + y].forEach((v, x) => { if (x + off < 13) out[y][x + off] = v | 0; });
  return out;
}

// squeezing 20 (or 18) columns onto 13 can seal breakable bricks behind unbreakable ones (e.g. Amegas 18's full-width
// wall). Flood-fill from the bat's side through everything but unbreakable cells; any wall cell between the reached
// area and bricks it can't reach becomes a tough breakable brick (silver, 3 hits), until every brick is reachable.
function openSealed(g) {
  const gold = v => v % 100 === 10;
  for (let pass = 0; pass < 30; pass++) {
    const seen = Array.from({ length: 18 }, () => new Array(13).fill(false)), q = [];
    for (let x = 0; x < 13; x++) if (!gold(g[17][x])) { seen[17][x] = true; q.push([17, x]); }
    while (q.length) {
      const [y, x] = q.pop();
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || ny > 17 || nx < 0 || nx > 12 || seen[ny][nx] || gold(g[ny][nx])) continue;
        seen[ny][nx] = true; q.push([ny, nx]);
      }
    }
    let sealed = false;
    for (let y = 0; y < 18; y++) for (let x = 0; x < 13; x++) if (!seen[y][x] && !gold(g[y][x]) && g[y][x]) sealed = true;
    if (!sealed) return;
    // open the wall cells touching the reached area (prefer those that also touch the sealed side)
    const touch = (y, x, want) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dy, dx]) => { const ny = y + dy, nx = x + dx; return ny >= 0 && ny < 18 && nx >= 0 && nx < 13 && !gold(g[ny][nx]) && seen[ny][nx] === want; });
    let cand = [];
    for (let y = 0; y < 18; y++) for (let x = 0; x < 13; x++) if (gold(g[y][x]) && touch(y, x, true) && touch(y, x, false)) cand.push([y, x]);
    if (!cand.length) for (let y = 0; y < 18; y++) for (let x = 0; x < 13; x++) if (gold(g[y][x]) && touch(y, x, true)) cand.push([y, x]);
    if (!cand.length) return;
    for (const [y, x] of cand) g[y][x] = 9 + 3000;
  }
}

function buildRound(r) {
  const bossNo = r === 25 ? 1 : r === 50 ? 2 : 0;
  // past round 50 the bricks come from a loaded level set; tempo, background and palette cycle through Giganoid's rounds
  const pf = r > 50 && usingPacks() ? packFor(r) : null;
  let base = r;
  if (r > 50) { base = ((r - 51) % 48) + 1; if (base >= 25) base++; }
  const L = LEVELS.lay[LEVELS.order[base - 1] - 1];
  G.round = r;
  G.bossNo = bossNo;
  G.brickScore = L.prm[0] || 200;
  G.speedEvery = Math.max(300, L.prm[1] || 1500);
  const bgEntry = bossNo === 1 ? 3 : bossNo === 2 ? 9 : Math.min(50, Math.max(1, L.prm[4] || 1));
  G.bg = bgMap(bgEntry);
  let pal;
  if (bossNo === 1) pal = PAL.r25.slice();
  else if (bossNo === 2) pal = PAL.r50.slice();
  else { pal = PAL.normal.slice(); const set = PAL.bgsets[(BGTAB[bgEntry - 1].set - 1) % 12]; for (let i = 0; i < 6; i++) pal[6 + i] = set[i]; }
  G.pal = pal;
  // bricks (from the disk's level, or from an imported pack when one is loaded and switched on)
  const usePack = !!pf, pk = usePack ? packCells(pf.pack, pf.i) : null;
  Object.assign(G, GRID_STD);
  if (pk && (pk[0].length !== 13 || pk.length !== 18)) Object.assign(G, GRID_WIDE, { cols: pk[0].length, rows: pk.length });
  setField();
  const grid = []; const breakable = [];
  for (let y = 0; y < G.rows; y++) {
    const row = [];
    for (let x = 0; x < G.cols; x++) {
      // boss rounds (25, 50) have no bricks: their order entry just points at level 1 as a placeholder
      let t = bossNo || y >= 18 || x >= 13 ? 0 : L.b[y * 13 + x], h = y >= 18 || x >= 13 ? 0 : L.h[y * 13 + x];
      let cell = null;
      if (usePack) {
        const raw = bossNo ? 0 : pk[y][x], v = raw % 100, flag = Math.floor(raw / 100) % 10, hx = Math.floor(raw / 1000) % 10, regen = Math.floor(raw / 10000) % 10;
        if (v === 10) cell = { t: 110, gold: true, hits: 1e9 };
        else if (v === 9) cell = { t: 109, hits: regen ? 2 + Math.floor((r - 1) / 8) : hx || 2 + Math.floor((r - 1) / 8) };
        else if (v >= 1 && v <= 8) cell = { t: 100 + v, hits: hx || 1 };
        if (cell && flag) { if (pf.pack.id === 'doh') { cell.moving = true; cell.dir = Math.random() < 0.5 ? -1 : 1; cell.mx = 0; } else cell.packCap = true; }
        if (cell && regen) { cell.regen = true; cell.maxHits = cell.hits; }
        const kind = Math.floor(raw / 100000) % 10; if (cell && kind && !cell.gold) cell.ame = kind;
        t = -1;
      }
      if (t === 2) cell = { t, gold: true, hits: 1e9 };
      else if (t === 1) cell = { t, hits: Math.max(1, h) };
      else if (t > 0) cell = { t, hits: 1 };
      if (cell) { cell.cap = 0; cell.flash = 0; if (!cell.gold && !cell.regen) breakable.push(cell); }
      row.push(cell);
    }
    grid.push(row);
  }
  // hide capsules in random bricks, as $75D06 does
  for (let i = breakable.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [breakable[i], breakable[j]] = [breakable[j], breakable[i]]; }
  let k = 0;
  if (usePack && pf.pack.native) {
    // Arkanoid marks the bricks that hold a capsule; the kind is drawn as the arcade does, P and B rarely
    const kinds = [1, 1, 2, 2, 3, 4, 4, 5, 5, 1, 2, 4, 5, 6, 7];   // S (slow, 3) drops less often than the others
    if (pf.pack.id === 'amegas') { for (const c of breakable) if (c.packCap) c.cap = kinds[(Math.random() * kinds.length) | 0]; }   // Amegas: only its power stones (+) hold capsules
    else for (const c of breakable) if (Math.random() < 0.16) c.cap = kinds[(Math.random() * kinds.length) | 0];   // capsules from random bricks, as in the arcade (Arkanoid, Doh, custom)
  } else L.caps.forEach((n, t) => { for (let i = 0; i < n && k < breakable.length; i++) breakable[k++].cap = t + 1; });
  G.grid = grid; G.roundId = (G.roundId || 0) + 1; G.regen = [];
  G.counter = bossNo ? 60 : usePack ? breakable.length : (L.prm[3] || breakable.length);
  G.boss = bossNo ? { img: A.boss[bossNo === 1 ? 1 : 0], x: 64, y: 20, flash: 0, timer: 120 } : null;
  G.bossShots = []; G.bossQueue = [];
  setPalette(G.pal, COP.game);
}

function newLife() {
  G.killer = false;
  G.balls = [{ x: 0, y: 0, a: startAngle(), sx: 1, sy: -1, stuck: true, off: 0 }];
  G.speed = 1; G.speedTimer = 0;
  G.batF = 9; G.batTarget = 9; G.laser = false; G.catching = false; G.warp = false; G.pierce = 0; G.ice = 0; G.grenade = false; G.frags = []; G.iceQ = [];
  G.replicant = false; G.replicantTime = 0; G.repFade = 0; G.shake = 0; G.toyBat = false;
  G.shots = []; G.capsule = null; G.bossShots = []; G.bossQueue = [];
  const b = A.bat[9].ext; G.batX = Math.round((PL + PR) / 2 - (b.l + b.r) / 2);
  G.balls[0].off = Math.round((b.r - b.l) / 2) - 2;
  G.launchTimer = 150;
}

// a round's layout for previews, without disturbing the game in progress
function previewRound(r) {
  const keep = {}; for (const k of ['cols', 'rows', 'bpx', 'bw', 'bpy', 'bh', 'round', 'bossNo', 'brickScore', 'speedEvery', 'bg', 'pal', 'grid', 'roundId', 'counter', 'boss', 'bossShots']) keep[k] = G[k];
  let out = null;
  try { buildRound(r); out = { grid: G.grid, pal: G.pal, bg: G.bg, boss: G.boss, bossNo: G.bossNo, bpx: G.bpx, bw: G.bw }; }
  finally { Object.assign(G, keep); setField(); if (G.pal) setPalette(G.pal, COP.game); }
  return out;
}
function startGame(r) {
  G.score = 0; G.lives = 2; G.nextLife = LIFE_EVERY;
  buildRound(r); newLife();
  go('intro');
}

function go(mode) {
  G.mode = mode; G.t = 0; FX.mode(mode);
  if (mode !== 'play') stopLaserLoop();
  const idle = mode === 'title' || mode === 'choose' || mode === 'over' || mode === 'win' || mode === 'load';
  if (mode !== 'over' && mode !== 'win') stopChan(0);
  if (mode === 'title') { setPalette(PAL.titleBase, COP.title); if (AC && AC.state === 'running') play(SND.intro, 0, true); }
  if (mode === 'choose') { setPalette(PAL.normal, COP.menu); }
  if (mode === 'intro') { setPalette(G.pal, COP.game); SFX.appear(batCentre()); musicStartLevel(G.round); }
  if (idle) { stopDrone(); musicDuck(0.6); }                                          // title/choose/over/win/load: fade out everything
  else if (mode === 'clear') { stopDrone(3); musicDuck(3); }                       // round clear: a slow 3 s fade-out
  else if (mode === 'warp' || mode === 'inter') { stopDrone(0.2); musicDuck(0.35); }   // exit / bonus stage: quickly cut music + reverb tails
  if (mode === 'clear') { tickCount = 0; }   // (level-complete jingle removed)
  if (mode === 'warp') tickCount = 0;
  if (mode === 'inter') {
    const p = PAL.normal.slice(); const set = PAL.bgsets[(BGTAB[43].set - 1) % 12]; for (let i = 0; i < 6; i++) p[6 + i] = set[i];
    setPalette(p, COP.inter); G.interBg = bgMap(44); SFX.demons(); setupDemonStage();
  }
  if (mode === 'over') {
    if (G.score > G.top) { G.top = G.score; G.newTop = true; try { localStorage.setItem('giganoid-top', String(G.top)); } catch (e) {} play(SND.jingle, 0, true); }
    else G.newTop = false;
  }
  if (mode === 'win') {
    if (G.score > G.top) { G.top = G.score; try { localStorage.setItem('giganoid-top', String(G.top)); } catch (e) {} }
    play(SND.jingle, 0, true);
  }
  updateStatus();
}

/* ============================================================
   Collision
   ============================================================ */
function cellAt(px, py) {
  if (px < 6 || py < 12) return null;
  const P = G.bpx || 17, Q = G.bpy || 7, r = Math.floor((py - 12) / Q);
  if (r < 0 || r >= G.rows || (py - 12) % Q > (G.bh || 6) - 1 || px < 6) return null;
  const c0 = Math.floor((px - 6) / P);
  // test the brick where it is drawn: roaming bricks (Revenge of Doh) sit mx px away from their cell,
  // so check this cell and both neighbours with their offsets (the hit used to land on the home cell only)
  for (const c of [c0, c0 - 1, c0 + 1]) {
    if (c < 0 || c >= G.cols) continue;
    const cell = G.grid[r][c]; if (!cell) continue;
    const x0 = 6 + P * c + (cell.mx || 0);
    if (px >= x0 && px < x0 + G.bw) return { cell, c, r };
  }
  return null;
}
function brickUnder(x, y) {
  return cellAt(x, y) || cellAt(x + 4, y) || cellAt(x, y + 4) || cellAt(x + 4, y + 4);
}
function bossUnder(x, y) {
  const b = G.boss; if (!b) return false;
  for (const [ox, oy] of [[0, 0], [4, 0], [0, 4], [4, 4], [2, 2]]) {
    const ix = x + ox - b.x, iy = y + oy - b.y;
    if (ix >= 0 && iy >= 0 && ix < b.img.w && iy < b.img.h && b.img.d[iy * b.img.w + ix] !== TRANSP) return true;
  }
  return false;
}

function addScore(n) {
  G.score += n;
  while (G.score >= G.nextLife) { G.nextLife += LIFE_EVERY; G.lives++; SFX.life(); }
}

const MAX_BALLS = 10;
// N power-up: the ball goes straight through, destroying every brick it touches
function pierceHit(h) {
  if (!(G.pierce > 0) || SET.classic) return false;
  if (!h.cell.gold) { h.cell.hits = 1; hitBrick(h, false); return true; }
  // even the unbreakable bricks burn away (they never counted toward clearing the round)
  G.grid[h.r][h.c] = null;
  FX.broken(h.c, h.r, h.cell.t);
  addScore(G.brickScore);
  SFX.brick(BRICK(h.c, h.r)[0] + 8);
  return true;
}
function hitBrick(h, byLaser) {
  const cell = h.cell;
  if (G.ice > 0 && !byLaser && !SET.classic && !G._iceChain) {
    // iceberg: the brick breaks, then its 8 neighbours shatter one after another, clockwise from top-left
    const ring = [[-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1]];
    G.iceQ = G.iceQ || [];
    ring.forEach(([dr, dc], k) => G.iceQ.push({ r: h.r + dr, c: h.c + dc, at: G.frame + 2 + k * 2 }));
    if (!cell.gold) { G._iceChain = true; cell.hits = 1; hitBrick(h, false); G._iceChain = false; }
    return;
  }
  const hx = BRICK(h.c, h.r)[0] + 8;
  FX.brickHit(h.c, h.r);
  if (cell.ame && !cell.gold) {
    const { r, c } = h, n = cell.hits;
    if (cell.ame === 2 && !amegasOpen()) { cell.flash = 6; SFX.hard(hx); return; }   // survivor: only breaks while flashing white
    const put = (rr, cc) => {
      if (rr < 0 || rr >= G.rows || cc < 0 || cc >= G.cols) return;
      // as the original ($31878): the copy overwrites whatever is there, unbreakable stones included - that's how
      // spreaders and jumpers open walls (round 18). Only a copy into an empty cell adds to the bricks left;
      // one that replaced a wall stone is a bonus brick the round doesn't wait for (so walled-in copies can't block it).
      const old = G.grid[rr][cc];
      if (!old) G.counter++;
      G.grid[rr][cc] = { t: cell.t, hits: n - 1, ame: cell.ame, cap: 0, flash: 6, extra: !!(old && old.gold) || !!(old && old.extra) };
    };
    if (cell.ame === 3 && n >= 2) { put(r - 1, c - 1); put(r - 1, c + 1); put(r + 1, c - 1); put(r + 1, c + 1); cell.hits = 1; }   // spreader
    else if (cell.ame === 4 && n >= 2) { put(r - 1, c); cell.hits = 1; }                                                        // jumper
    else if (cell.ame === 1) addScore(G.brickScore * 10);                                                                      // exit stone bonus
    else if (cell.ame === 5 && !byLaser) G.killer = true;                                                                      // killer: a direct ball hit costs a life
  }
  if (cell.gold) { cell.flash = 6; SFX.hard(hx); if (SET.music > 0 && Math.random() < 0.22) musicNote(cell.t); return; }   // grey/gold bricks ring too
  if (cell.hits0 == null) cell.hits0 = cell.hits;
  cell.hits--;
  if (cell.hits > 0) {
    // tougher bricks get nudged back a little by each hit
    const taken = cell.hits0 - cell.hits, d = G._hitDir || [0, -1];
    const kk = 0.7 * Math.min(taken, 3);   // toned down: a small nudge (was 2.5 px per hit, unbounded)
    cell.kick = { x: d[0] * kk, y: d[1] * kk, f: G.frame, n: Math.min(taken, 3) };
    cell.flash = 6; SFX.hard(hx); if (SET.music > 0 && Math.random() < 0.22) musicNote(cell.t); return;   // grey/silver bricks ring on each hit
  }
  G.grid[h.r][h.c] = null;
  FX.broken(h.c, h.r, cell.t);
  addScore(G.brickScore);
  if (cell.regen) G.regen.push({ r: h.r, c: h.c, cell, t: 300 });   // notched silver: grows back in ~6 s
  else if (!cell.extra) G.counter--;
  SFX.brick(hx);
  if (SET.music > 0 && Math.random() < 0.3) musicNote(cell.t);   // sparse procedural note, interval by brick colour
  if (cell.cap && !G.capsule && (!SET.classic || G.balls.filter(b => !b.dead).length < 2)) {
    const [x, y] = BRICK(h.c, h.r);
    // enhanced mode: now and then a very rare N (Neutrino, 10 s pass-through) or M (Multi, 10 balls) instead
    let t = cell.cap;
    if (!SET.classic) {
      // P (extra life) is very rare too: most of the time it turns into one of the everyday capsules
      if (t === 6 && Math.random() < 0.85) t = [1, 2, 3, 4, 5][(Math.random() * 5) | 0];
      const r = Math.random(); const rare = [8, 9, 10, 11, 12]; if (r < 0.06) t = rare[(r / 0.012) | 0];   // very rare: N M G I R, 1.2% each
    }
    // S (slow) only drops once the ball has sped up past normal, and even then less often
    if (t === 3 && (G.speed <= 1 || Math.random() < 0.5)) t = [1, 2, 4, 5][(Math.random() * 4) | 0];
    // don't drop a power-up that's already active: L (laser), N (neutrino) and E (expand) re-roll to another everyday capsule
    const dup = tt => (tt === 5 && G.laser) || (tt === 8 && G.pierce > 0) || (tt === 2 && G.batTarget === 18);
    if (dup(t)) { const pool = [1, 2, 3, 4, 5].filter(x => !dup(x)); t = pool[(Math.random() * pool.length) | 0]; }
    G.capsule = { t, x, y, f: 0 };
    // power-up appears: piano-like sharp attack, long tail, two octaves above bricks, quieter; rarely it bends up or down
    if (SET.music > 0) { const gl = Math.random() < 0.55 ? (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 9) : 0; musicNote(t + 3, 16, 0.18, 0.002, 3.8, gl, true); }   // force: always play on capsule spawn; often pitch-glides
  }
}

/* ============================================================
   Ball movement: the original speed table, 4-frame phase cycle
   ============================================================ */
let ZONE = [3, 2, 1, 0, 0, 1, 2, 3], ZONE_B = null;
// top of the bat body under columns x0..x1 (screen y), or null if the ball is not over the bat
function batSurface(x0, x1) {
  const p = A.bat[G.batF].ext; let best = null;
  for (let x = x0; x <= x1; x++) {
    const c = batCol(x); if (c < p.l || c > p.r) continue;
    const t = p.col[c]; if (t >= 0 && (best === null || t < best)) best = t;
  }
  return best === null ? null : BAT_Y + best;
}
// does a ball at (x, y) overlap the bat body?
function overlapsBat(x, y) {
  const p = A.bat[G.batF].ext;
  if (y > BAT_Y + p.bottom) return false;
  for (let xx = x; xx <= x + 4; xx++) {
    const c = batCol(xx); if (c < p.l || c > p.r || p.col[c] < 0) continue;
    if (y + 4 >= BAT_Y + p.col[c]) return true;
  }
  return false;
}
// curved bat (optional, after Ricochet): the bat's top is an arch whose surface tilts up to 32° at the ends.
// The ball reflects off that surface like a mirror, so where it lands AND how it came in both set the way out;
// the result snaps to the nearest of the game's bounce angles.
const CURVE_MAX = 32 * Math.PI / 180;
function curvedBounce(b, g) {
  const t = Math.max(0, Math.min(1, (b.x + 2 - g.l + 0.5) / Math.max(1, g.r - g.l + 1)));
  const phi = (t - 0.5) * 2 * CURVE_MAX;
  const th = ANG[b.a] ?? Math.PI / 4, vx = b.sx * Math.cos(th), vy = Math.sin(th);   // incoming, screen y down
  const nx = Math.sin(phi), ny = -Math.cos(phi), d = vx * nx + vy * ny;
  const rx = vx - 2 * d * nx, ry = vy - 2 * d * ny;
  const minEl = Math.min(...ANG), maxEl = Math.max(...ANG);
  let el = Math.atan2(-ry, Math.abs(rx)); el = Math.max(minEl, Math.min(maxEl, el));
  let best = 0; for (let k = 1; k < ANG.length; k++) if (Math.abs(ANG[k] - el) < Math.abs(ANG[best] - el)) best = k;
  b.a = best;
  b.sx = Math.abs(rx) < 1e-3 ? (t < 0.5 ? -1 : 1) : (rx < 0 ? -1 : 1);
}
function batBounce(b, side) {
  const g = batGeom();
  if (side) { b.a = ANGLES() - 1; b.sx = (b.x + 2 < (g.l + g.r) / 2) ? -1 : 1; }
  else if (SET.arkBat && !SET.classic && ANG.length === 4) arkBounce(b, g);
  else if (SET.curved && !SET.classic && ANG.length === ANGLES()) curvedBounce(b, g);
  else {
    const t = Math.max(0, Math.min(1, (b.x + 2 - g.l + 0.5) / Math.max(1, g.r - g.l + 1))), NZ = ZONE.length;
    let z = 0; while (z < NZ - 1 && ZONE_B && t >= ZONE_B[z + 1]) z++;
    b.a = ZONE[z]; b.sx = z < NZ / 2 ? -1 : 1;
  }
  b.sy = -1;
  if (G.catching) { SFX.catch(b.x + 2); b.stuck = true; b.off = b.x - G.batX; b.y = g.top - 5; G.launchTimer = 150; }
  else SFX.bat(b.x + 2);
  FX.batHit(b.x + 2); b.squash = G.frame;
}
function stepX(b) {
  const nx = b.x + b.sx;
  if (nx < PL || nx + 5 > PR) { b.sx = -b.sx; SFX.wall(b.x + 2); return; }
  if (!SET.classic && overlapsBat(nx, b.y) && !overlapsBat(b.x, b.y)) { batBounce(b, true); return; }
  let h = brickUnder(nx, b.y);
  if (h && h.cell.moving && brickUnder(b.x, b.y)?.cell === h.cell) h = null;   // a roaming brick slid over the ball: let it get out
  if (h && pierceHit(h)) { b.x = nx; return; }
  if (h) { G._hitDir = [Math.sign(b.sx), 0]; b.sx = -b.sx; hitBrick(h, false); return; }
  if (bossUnder(nx, b.y)) { b.sx = -b.sx; hitBoss(); return; }
  b.x = nx;
}
// R (Replicant): a second bat at the top knocks upward balls back down
function repGeom() { const e = A.bat[9].ext; return { l: G.batX + e.l, r: G.batX + e.r, bot: PT + e.bottom }; }
function repBounce(b, l, r) {
  const t = Math.max(0, Math.min(1, (b.x + 2 - l + 0.5) / Math.max(1, r - l + 1))), NZ = ZONE.length;
  let z = 0; while (z < NZ - 1 && ZONE_B && t >= ZONE_B[z + 1]) z++;
  b.a = ZONE[z]; b.sx = z < NZ / 2 ? -1 : 1; b.sy = 1; SFX.bat(b.x + 2); FX.batHit(b.x + 2); b.squash = G.frame;
}
function stepY(b) {
  const ny = b.y + b.sy;
  if (b.sy < 0 && G.replicant) {   // the replicant bat catches balls heading up, before the top wall
    const rg = repGeom();
    if (ny <= rg.bot && b.x + 4 >= rg.l && b.x <= rg.r) { b.y = rg.bot; repBounce(b, rg.l, rg.r); return; }
  }
  if (ny < PT) { b.sy = -b.sy; SFX.wall(b.x + 2); return; }
  if (b.sy > 0) {
    // the bat's real top edge under the ball, so the rounded ends catch the ball where they are drawn
    // classic: the original flat top edge across the bat's width; otherwise the bat's drawn outline
    const gg = batGeom();
    // classic: flat top across the width. The ball steps 1px of X before this Y check, so allow a 1px
    // cushion either side — otherwise a ball moving diagonally off the end tunnels straight through the edge.
    const surf = SET.classic ? (b.x + 4 >= gg.l - 1 && b.x <= gg.r + 1 ? gg.top : null) : batSurface(b.x, b.x + 4);
    if (surf !== null && ny + 4 >= surf && b.y + 4 < surf) { batBounce(b, false); return; }
  }
  let h = brickUnder(b.x, ny);
  if (h && h.cell.moving && brickUnder(b.x, b.y)?.cell === h.cell) h = null;
  if (h && pierceHit(h)) { b.y = ny; return; }
  if (h) { G._hitDir = [0, Math.sign(b.sy)]; b.sy = -b.sy; hitBrick(h, false); return; }
  if (bossUnder(b.x, ny)) { b.sy = -b.sy; hitBoss(); return; }
  b.y = ny;
  if (b.y > H) b.dead = true;
}
function moveBall(b, phase) {
  const lvl = SPD[G.speed], [dx, dy] = lvl[Math.min(b.a, lvl.length - 1)][phase];
  const n = Math.max(dx, dy);
  for (let i = 0; i < n && !b.dead && !b.stuck; i++) { if (i < dx) stepX(b); if (i < dy) stepY(b); }
}
function hitBoss() {
  const b = G.boss; if (!b) return;
  b.flash = 6; G.counter -= 1; addScore(200); SFX.bossHit(b.x + 56); FX.bossHit();
}

/* ============================================================
   Capsules: C E S D L P B  (ids 1..7, effect switch $789E0)
   ============================================================ */
function takeCapsule(t) {
  addScore(1000); FX.power(t);
  if (t !== 7 && G.warp) G.warp = false;                                // B: taking any other power-up closes the exit again
  if ([8, 9, 10, 11].includes(t)) {   // N, M, G, I also cancel the laser, the expand (E) and the catch (C)
    if (G.laser) { G.laser = false; G.batTarget = 9; }
    if (G.batTarget === 18) { G.batTarget = 9; }
    G.catching = false;   // N (and M/G/I) cancels C
  }
  if (t !== 6 && t !== 4 && t !== 3 && ![8, 9, 10, 11, 12].includes(t)) { G.catching = false; G.laser = false; G.batTarget = 9; }
  switch (t) {
    case 1: if (!(G.pierce > 0)) G.catching = true; break;   // C does nothing while N (neutrino) is active
    case 2: (G.batF >= 7 ? SFX.grow : SFX.growSmall)(batGeom().l + 16); G.batTarget = 18; break;
    case 3: G.speed = 0; G.speedTimer = 0; break;
    case 4: {
      const src = G.balls.find(b => !b.dead); if (!src) break;
      src.stuck = false; src.launched = true;
      if (G.balls.length < MAX_BALLS) G.balls.push({ ...src, a: (src.a + 1) % ANGLES(), sx: -src.sx });
      if (G.balls.length < MAX_BALLS) G.balls.push({ ...src, a: (src.a + 2) % ANGLES() });
      G.catching = false; break;
    }
    case 5: G.laser = true; G.batTarget = 0; G.laserTime = 750; break;   // 15 s at 50 Hz
    case 6: {   // P (extra life): also clears every other active power-up, but keeps the balls you have
      G.lives++; SFX.life();
      G.laser = false; G.laserTime = 0; G.catching = false; G.warp = false;
      G.pierce = 0; G.ice = 0; G.grenade = false; G.frags = []; G.batTarget = 9;
      if (G.speed === 0) G.speed = 1;
      break;
    }
    case 7: G.warp = true; break;
    case 10: G.grenade = true; break;                                  // G: one click fires all six orbiting neutrinos at once
    case 11: G.ice = 500; break;                                       // I: 10 s, every brick hit shatters a 3x3 block
    case 8: G.pierce = 500; break;                                    // N (Neutrino): 10 s of passing straight through bricks
    case 12: G.replicant = true; G.replicantTime = 750; break;        // R (Replicant): a second bat at the top for 15 s
    case 9: {                                                          // M (Multi): every ball splits, up to 10 in all
      const live = G.balls.filter(b => !b.dead); if (!live.length) break;
      for (const b of live) { b.stuck = false; b.launched = true; }
      const N = ANGLES();
      for (let k = 0; live.length + k < MAX_BALLS; k++) {
        const src = live[k % live.length], step = 1 + Math.floor(k / live.length);
        G.balls.push({ ...src, a: (src.a + step) % N, sx: (k + step) & 1 ? -src.sx : src.sx, sy: step % 3 === 0 ? -src.sy : src.sy });
      }
      G.catching = false; break;
    }
  }
}

/* ============================================================
   Update
   ============================================================ */
const keys = new Set();
const INPUT = { dx: 0, abs: null };   // pointer movement from the UI
// TILT: a momentary screen shake that nudges every ball's direction, to free balls stuck in an endless bounce
function tilt() {
  if (G.mode !== 'play') return;
  for (const b of G.balls) {
    if (b.dead || b.stuck) continue;
    b.a = Math.max(0, Math.min(ANGLES() - 1, b.a + (Math.random() < 0.5 ? -1 : 1)));
    if (Math.random() < 0.5) b.sx = -b.sx;
  }
  G.shake = 14;
}

function updatePlay() {
  const phase = G.frame & 3;
  // bat movement
  const e = A.bat[G.batF].ext;
  if (INPUT.abs !== null) { G.batX = Math.round(INPUT.abs - (e.l + e.r) / 2); G.batFrac = 0; INPUT.abs = null; }
  // keep the sub-pixel remainder of the mouse movement: rounding it away every frame swallowed slow, subtle moves
  G.batX += (G.batFrac || 0) + INPUT.dx; INPUT.dx = 0;
  if (keys.has('ArrowLeft')) G.batX -= 4;
  if (keys.has('ArrowRight')) G.batX += 4;
  const ext = (e.r - e.l) * (batScale() - 1) / 2;   // a scaled-up bat (XXXL, Amegas size) reaches further each way
  const minX = PL - e.l + ext, maxX = (G.warp ? PR + 40 : PR - 1) - e.r - ext;
  { const want = Math.max(minX, Math.min(maxX, G.batX)); G.batX = Math.round(want); G.batFrac = want - G.batX; }
  // pull the bat out once 60% of its width has passed the exit edge
  if (G.warp && (G.batX + e.r) - PR >= 0.6 * (e.r - e.l)) { SFX.warp(PR); go('warp'); return; }
  // bat size animation ($7B032)
  if (++G.batTick >= 2) {
    G.batTick = 0;
    if (G.batF !== G.batTarget) {
      const old = A.bat[G.batF].ext;
      G.batF += G.batF < G.batTarget ? 1 : -1;
      const ne = A.bat[G.batF].ext;
      G.batX += Math.round(((old.l + old.r) - (ne.l + ne.r)) / 2);
    }
  }
  const g = batGeom();
  // fire
  if (G.fire) {
    G.fire = false;
    const auto = G.autoFiring; G.autoFiring = false;
    const stuck = G.balls.find(b => b.stuck);
    if (stuck) { for (const b of G.balls) { b.stuck = false; b.launched = true; } }
    else if (G.grenade && G.balls.some(b => !b.dead)) {
      // grenade: the six orbiting neutrinos all fire at once, flying outward from the ball and burning through every brick
      const b = G.balls.find(b => !b.dead); G.grenade = false; G.frags = G.frags || [];
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + G.frame * 0.02; G.frags.push({ x: b.x + 1, y: b.y + 1, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, life: 160, pierce: true }); }
      SFX.hard(b.x + 2);
    }
    else if (G.laser && G.batF === 0 && (SET.classic ? G.shots.length < 2 : (G.laserCool || 0) <= 0 && G.shots.length < 6)) {
      G.shots.push({ x: Math.round((g.l + g.r) / 2) - 8, y: g.top - 8, sp: Math.round(5.5 * (G.batMul || 1) - 5.5) });   // wide stages: guns sit further apart
      // tapping: a new pair every 6 frames; held auto-fire is 20% slower (7.5 frames, the half frame carried over)
      G.laserCool = auto ? Math.max(G.laserCool || 0, -1) + 7.5 : 6;   // a new pair every 6 frames (~0.12 s) — the sound is the held-fire loop below, not a per-shot one-shot
    }
  }
  // held-fire laser loop: only with auto-fire on and the button/space held
  { const wantLoop = G.laser && G.batF === 0 && !G.paused && !!G.fireHeld;   // sound plays only while firing is held
    if (wantLoop) { startLaserLoop(); laserLoopPan((g.l + g.r) / 2); } else stopLaserLoop(); }
  // a bat swept into a falling ball knocks it back up instead of swallowing it
  for (const b of G.balls) {
    if (SET.classic || b.dead || b.stuck || b.sy < 0 || !overlapsBat(b.x, b.y)) continue;
    batBounce(b, true);
    if (!b.stuck) b.y = Math.min(b.y, (batSurface(b.x, b.x + 4) ?? g.top) - 5);
  }
  // balls
  for (const b of G.balls) {
    if (b.dead) continue;
    if (b.stuck) {
      b.x = Math.max(PL, Math.min(PR - 5, G.batX + b.off)); b.y = g.top - 5;
      if (--G.launchTimer <= 0) { b.stuck = false; b.launched = true; }
      continue;
    }
    moveBall(b, phase);
  }
  G.balls = G.balls.filter(b => !b.dead);
  // speed-up timer
  if (++G.speedTimer >= G.speedEvery) { G.speedTimer = 0; if (G.speed < 5) G.speed++; }
  if (G.ice > 0) G.ice--;
  if (G.iceQ && G.iceQ.length) G.iceQ = G.iceQ.filter(q => {
    if (G.frame < q.at) return true;
    const cl = q.r >= 0 && q.r < G.rows && q.c >= 0 && q.c < G.cols ? G.grid[q.r][q.c] : null;
    if (cl && !cl.gold) { G._iceChain = true; cl.hits = 1; hitBrick({ cell: cl, r: q.r, c: q.c }, false); G._iceChain = false; }
    return false;
  });
  if (G.frags && G.frags.length) {
    for (const f of G.frags) {
      for (let st = 0; st < 3 && !f.dead; st++) {
        f.x += f.vx / 3; f.y += f.vy / 3;
        if (f.x < PL || f.x > PR - 2 || f.y < PT || f.y > H) { f.dead = true; break; }
        const hb = brickUnder(f.x, f.y);
        if (hb) {
          if (!hb.cell.gold) { hb.cell.hits = 1; hitBrick(hb, true); }
          else { G.grid[hb.r][hb.c] = null; FX.broken(hb.c, hb.r, hb.cell.t); addScore(G.brickScore); SFX.brick(BRICK(hb.c, hb.r)[0] + 8); }   // neutrino burns the unbreakable ones too
          if (!f.pierce) f.dead = true;   // old-style frags stop at the first brick; neutrino shots pass through
        }
      }
      if (--f.life <= 0) f.dead = true;
    }
    G.frags = G.frags.filter(f => !f.dead);
  }
  if (G.pierce > 0) { G.pierce--; if (G.pierce > 0 && G.pierce <= 250 && G.pierce % 50 === 0) beep(); }   // N: a beep each of the last 5 seconds
  if (G.replicant && --G.replicantTime <= 0) { G.replicant = false; G.repFade = 40; }   // R: expires, then fades out of existence
  if (G.repFade > 0) G.repFade--;
  if (G.shake > 0) G.shake--;                                       // TILT screen-shake countdown
  // lasers: the sprite carries two bolts at x+2 and x+13
  if (G.laserCool > 0) G.laserCool--;
  if (G.laser && G.laserTime > 0 && --G.laserTime <= 0) { G.laser = false; G.batTarget = 9; }
  const laserSpeed = SET.classic ? 5 : 8;
  for (const s of G.shots) {
    // move one pixel at a time so fast bolts can't skip over a brick row
    for (let k = 0; k < laserSpeed && !s.dead; k++) {
      s.y--;
      for (const bx of [s.x + 2 - (s.sp || 0), s.x + 13 + (s.sp || 0)]) {
        const h = cellAt(bx, s.y);
        if (h && !s.dead) { hitBrick(h, true); s.dead = true; }
      }
      if (s.y < PT) s.dead = true;
    }
  }
  G.shots = G.shots.filter(s => !s.dead);
  // capsule
  const c = G.capsule;
  if (c) {
    c.fy = (c.fy ?? c.y) + 1.5 * (SET.classic ? 1 : SET.drop / 100); c.y = Math.round(c.fy);   // original: 1.5 px per frame
    if (G.frame % 2 === 0) c.f = (c.f + 1) & 15;
    if (c.y + 8 >= g.top && c.y <= g.top + 5 && c.x + 15 >= g.l && c.x <= g.r) { G.capsule = null; takeCapsule(c.t); }
    else if (c.y > H) G.capsule = null;
  }
  // boss
  const B = G.boss;
  if (B) {
    if (B.flash) B.flash--;
    // both eyes spit a set of three parallel fireballs every 3-4 s, aimed at the bat's position at that moment
    if (--B.timer <= 0) {
      B.timer = 150 + Math.floor(Math.random() * 50);
      sfx(17, 2, B.x + 56);   // one shot-fired sound per volley
      const batC = (g.l + g.r) / 2, ty = g.top, SPD = 2.5, STEP = 16;   // STEP = frames between the three balls of a column
      // one shared heading, from the boss centre to the bat, so both eye-columns fly parallel (no converging)
      let dx = batC - (B.x + 56), dy = ty - (B.y + 44); const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      for (const [ox, oy] of BOSS_EYES) {
        const ex = B.x + ox - 8, ey = B.y + oy - 3;   // the shot's drawn centre is at (x+8, y+3), so this lands it on the eye
        // queue three balls that leave the eye one after another (they space out as they travel)
        for (let k = 0; k < 3; k++) G.bossQueue.push({ at: G.frame + k * STEP, x: ex, y: ey, vx: dx * SPD, vy: dy * SPD });
      }
    }
    // release any queued fireballs whose moment has come
    if (G.bossQueue && G.bossQueue.length) for (let i = G.bossQueue.length - 1; i >= 0; i--) {
      const q = G.bossQueue[i]; if (G.frame >= q.at) { G.bossShots.push({ x: q.x, y: q.y, vx: q.vx, vy: q.vy }); G.bossQueue.splice(i, 1); }
    }
    for (const s of G.bossShots) {
      s.x += s.vx; s.y += s.vy;
      if (s.y + 7 >= g.top && s.y + 3 <= g.top + 7 && s.x + 12 >= g.l && s.x + 4 <= g.r) { s.dead = true; loseLife(); return; }   // hit-test on the ball's drawn centre (x+8,y+3)
      if (s.y > H || s.x < PL - 8 || s.x > PR + 8) s.dead = true;
    }
    G.bossShots = G.bossShots.filter(s => !s.dead);
  }
  // Revenge of Doh: roaming bricks slide left/right while there is room, turning at walls and other bricks
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const cell = G.grid[r][c]; if (!cell || !cell.moving || cell.movedAt === G.frame) continue;
    cell.movedAt = G.frame;
    const nc = c + cell.dir;
    if (cell.mx * cell.dir >= 0 && (nc < 0 || nc >= G.cols || G.grid[r][nc])) { cell.dir = -cell.dir; continue; }
    cell.mx += cell.dir * 0.5;
    if (Math.abs(cell.mx) >= G.bpx) { G.grid[r][c] = null; G.grid[r][nc] = cell; cell.mx -= cell.dir * G.bpx; }
  }
  // notched silver bricks grow back once their cell is clear of balls
  if (G.regen && G.regen.length) for (let i = G.regen.length - 1; i >= 0; i--) {
    const g = G.regen[i];
    if (--g.t > 0) continue;
    const [bx, by] = BRICK(g.c, g.r);
    if (G.grid[g.r][g.c] || G.balls.some(b => b.x + 5 > bx && b.x < bx + G.bw && b.y + 5 > by && b.y < by + 6)) { g.t = 10; continue; }
    g.cell.hits = g.cell.maxHits; g.cell.flash = 8; g.cell.mx = 0; G.grid[g.r][g.c] = g.cell; G.regen.splice(i, 1);
  }
  // flashes
  for (const row of G.grid) for (const cell of row) if (cell && cell.flash) cell.flash--;
  // end conditions
  if (G.killer) { G.killer = false; G.balls = []; loseLife(); return; }
  if (!G.balls.length) { loseLife(); return; }
  let left = 0; for (const row of G.grid) for (const cell of row) if (cell && !cell.gold && !cell.regen && !cell.extra) left++;
  if (G.counter <= 0 || (!G.boss && left === 0)) roundCleared();   // boss rounds have no bricks, so end only when the boss is beaten
}

function loseLife() { const g = batGeom(); SFX.vanish((g.l + g.r) / 2); FX.lost(); go('dead'); }
function roundCleared() { go('clear'); }


/* ============================================================
   The demons bonus stage (after rounds 5, 10, 15, 20, 30, 35, 40, 45)
   Reconstructed from $752E4..$75C6E:
   1. "Choose level": shoot the ball up into box I..IV ($75326; ball rises 6 px/frame, stops at y $5A,
      the box is picked from its x: <=$41 I, <=$73 II, <$A6 III, else IV).
   2. Four demon heads ($75694). Level N = N catches in a row at {5, 8, 12, 14} px/frame ($75AC4).
      A random head ($BFD800 / 64) opens its mouth (sample 11, 2-frame steps), then spits the ball
      straight down from its mouth ($759C2: x $22/$58/$8D/$C3, y $38). Catch it on the bat
      (y $B5..$C1, |ball - bat| <= $11; sample 13) and it flies straight back up into the same
      mouth. Past y $CD it is lost (sample 16) and the stage is failed.
   3. Result ($74C4C): all N returned -> "N-jump spell": the next round is skipped ahead by N ($75310).
   ============================================================ */
const DEMON_HEAD_X = [15, 69, 122, 176], DEMON_HEAD_Y = 23;
const DEMON_BALL_X = [0x22, 0x58, 0x8D, 0xC3], DEMON_BALL_Y = 0x38;
const DEMON_SPEED = [5, 8, 12, 14];
const CHOOSE_X = 16, CHOOSE_Y = 32;
function batCentre() { const e = A.bat[G.batF].ext; return G.batX + (e.l + e.r) / 2; }
function demonBatInput() {
  const e = A.bat[G.batF].ext;
  if (INPUT.abs !== null) { G.batX = Math.round(INPUT.abs - (e.l + e.r) / 2); G.batFrac = 0; INPUT.abs = null; }
  G.batX += (G.batFrac || 0) + INPUT.dx; INPUT.dx = 0;
  if (keys.has('ArrowLeft')) G.batX -= 4;
  if (keys.has('ArrowRight')) G.batX += 4;
  { const want = Math.max(PL - e.l, Math.min(PR - 1 - e.r, G.batX)); G.batX = Math.round(want); G.batFrac = want - G.batX; }
}
function startDemons() { if (!G.dem) setupDemonStage(); G.fire = false; go('dchoose'); }
function setupDemonStage() {
  const pal = G.pal;
  G.dem = { target: G.round, n: 0, fired: false, picked: -1, head: (Math.random() * 4) | 0, mouth: 0, open: false,
    state: 0, wait: 0, speed: 5, left: 0, returned: 0, over: -1, success: false, nextPal: pal };
  // the stage has its own background and no bricks
  const p = PAL.normal.slice(); const set = PAL.bgsets[(BGTAB[43].set - 1) % 12]; for (let i = 0; i < 6; i++) p[6 + i] = set[i];
  G.pal = p; G.bg = G.interBg || bgMap(44);
  Object.assign(G, GRID_STD); setField(); G.grid = Array.from({ length: 18 }, () => new Array(13).fill(null)); G.roundId = (G.roundId || 0) + 1;
  G.boss = null; G.capsule = null; G.shots = []; G.bossShots = []; G.bossQueue = [];
  G.batF = 9; G.batTarget = 9; G.laser = false; G.catching = false; G.warp = false;
  const e = A.bat[9].ext; G.batX = Math.round((PL + PR) / 2 - (e.l + e.r) / 2);
  G.balls = [{ x: 0, y: 0, a: 0, sx: 0, sy: 0, demon: true }];
}
function updateChoose() {
  const D = G.dem, b = G.balls[0];
  demonBatInput();
  if (D.picked >= 0) { if (G.t - D.pickT > 45) beginDemonGame(); return; }
  if (!D.fired) {
    b.x = batCentre() - 2.5; b.y = BAT_Y + A.bat[G.batF].ext.top - 5; b.ox = b.x; b.oy = b.y;
    if (G.fire) { G.fire = false; D.fired = true; sfx(13, 3, batCentre()); }
    return;
  }
  G.fire = false;
  b.y -= 6;
  if (b.y < 0x5A) {
    b.y = 0x5A; sfx(10, 2, b.x + 2);
    D.n = b.x <= 0x41 ? 1 : b.x >= 0xA6 ? 4 : b.x <= 0x73 ? 2 : 3;
    D.picked = D.n; D.pickT = G.t;
  }
}
function beginDemonGame() {
  const D = G.dem;
  D.left = D.n; D.speed = DEMON_SPEED[D.n - 1];
  D.state = 0; D.open = false; D.mouth = 0; D.wait = 120 + 20;
  G.balls = [];
  // the heads stage has its own palette and background 8 ($756B2, $75C12)
  G.pal = PAL.demon.slice(); G.bg = bgMap(8); G.roundId = (G.roundId || 0) + 1;
  go('demons');
}
function updateDemons() {
  const D = G.dem;
  demonBatInput();
  G.fire = false;
  // mouth animation, one step every 2 frames ($7590E)
  if ((G.frame & 1) === 0) {
    if (D.open && D.mouth < 2) { if (D.mouth === 0) sfx(11, 2, DEMON_BALL_X[D.head] + 2); D.mouth++; }
    else if (!D.open && D.mouth > 0) D.mouth--;
  }
  if (D.over >= 0) { if (G.t - D.over > 60) go('dresult'); return; }
  if (D.wait > 0) { D.wait--; return; }
  if (D.state === 0) {
    D.open = true;
    if (D.mouth === 2) { D.state = 1; G.balls = [{ x: DEMON_BALL_X[D.head], y: DEMON_BALL_Y, a: 0, sx: 0, sy: 1, demon: true }]; G.balls[0].ox = G.balls[0].x; G.balls[0].oy = G.balls[0].y; }
    return;
  }
  const b = G.balls[0];
  if (D.state === 1) {
    b.y += D.speed;
    const e = A.bat[G.batF].ext;
    if (b.y >= 0xB5 && b.y <= 0xC1 && Math.abs(b.x + 2.5 - batCentre()) <= (e.r - e.l) / 2 + 3) {
      b.y = 0xB7; b.sy = -1; D.state = 2; sfx(13, 3, b.x + 2);
    } else if (b.y >= 0xCD) {
      sfx(16, 3, b.x + 2); D.success = false; D.open = false; D.over = G.t; G.balls = [];
    }
  } else if (D.state === 2) {
    b.y -= D.speed;
    if (b.y < DEMON_BALL_Y) {
      G.balls = []; D.returned++; D.left--; D.open = false; addScore(1000);
      if (D.left <= 0) { D.success = true; D.over = G.t; }
      else { D.head = (Math.random() * 4) | 0; D.state = 0; D.wait = 20; }
    }
  }
}
function finishDemons() {
  const D = G.dem;
  const target = D.success ? Math.min(50, D.target + D.n) : D.target;
  G.dem = null;
  buildRound(target); newLife();
  go('intro');
}

function update() {
  G.frame++; G.t++;
  G.obx = G.batX; for (const b of G.balls) { b.ox = b.x; b.oy = b.y; }
  switch (G.mode) {
    case 'intro': if (G.t > (G.bossNo ? 200 : 120) || (G.fire && G.t > 20)) { G.fire = false; go('play'); } break;
    case 'play': updatePlay(); break;
    case 'dead':
      if (G.t > 60) {
        if (G.lives <= 0) go('over');
        else { G.lives--; newLife(); go('intro'); }
      }
      break;
    case 'warp':
      if (G.t <= 90) { G.batX += 1; addScore(100); bonusTick(); }
      else if (G.t === 91) SFX.vanish();
      else if (G.t > 110) {
        const r = G.round;
        if (r >= lastRound()) { go('win'); break; }
        buildRound(r + 1); newLife();
        go(SET.classic && INTERMISSION.has(r) ? 'inter' : 'intro');   // the demons bonus stage only in Classic mode
      }
      break;
    case 'clear':
      if (G.t > 20 && G.t <= 120) { addScore(100); bonusTick(); }
      if (G.t > 150) {
        const r = G.round;
        if (r >= lastRound()) { go('win'); break; }
        buildRound(r + 1); newLife();
        go(SET.classic && INTERMISSION.has(r) ? 'inter' : 'intro');   // the demons bonus stage only in Classic mode
      }
      break;
    case 'inter': if (G.t > 200 || (G.fire && G.t > 30)) { G.fire = false; startDemons(); } break;
    case 'dchoose': updateChoose(); break;
    case 'demons': updateDemons(); break;
    case 'dresult': if (G.t > 250 || (G.fire && G.t > 40)) { G.fire = false; finishDemons(); } break;
  }
}


export {
  batScale, getMine, setMine, previewRound, loadPackText, loadArkanoidAdf, clearPacks, packInfo, lastRound, roundLabel,
  DEMON_HEAD_X, DEMON_HEAD_Y, DEMON_BALL_X, DEMON_BALL_Y, CHOOSE_X, CHOOSE_Y, startDemons, finishDemons,
  ANGLES, ANG, setPalette, toggleMute, TRANSP, W, H, be32, be16, adfFind, firstCodeHunk, unpack, M, setMem, A, SPD_ORIG, PAL, LEVELS, SPD, BGTAB, FONT, COP, SND, SET, SET_DEFAULTS, saveSettings, startAngle, rebuildSpeed, copperWithBase, planar, mask, crop, sprite, words, extents, batProfile, parseCopper, decodeAssets, bgCache, bgMap, PAULA, AC, master, muted, chan, bufCache, audioInit, setReverb, musicSetVol, setSfx, setLowAudio, applyEq, eqState, eqFlat, EQ_FREQS, CUSTOM, soundKey, soundEntry, applyCustomSounds, sampleBuf, PAN, stopChan, play, sfx, SFX, tickCount, bonusTick, PL, PR, PT, BAT_Y, PANEL_X, BRICK, INTERMISSION, START_ROUND, LIFE_EVERY, G, batGeom, buildRound, newLife, startGame, go, cellAt, brickUnder, bossUnder, addScore, hitBrick, ZONE, ZONE_B, batSurface, overlapsBat, batBounce, stepX, stepY, moveBall, hitBoss, takeCapsule, keys, INPUT, updatePlay, loseLife, roundCleared, update, amegasOpen, GRID_STD, GRID_WIDE, tilt, repGeom, musicStartLevel
};
