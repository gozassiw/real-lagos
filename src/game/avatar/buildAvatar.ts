// Original procedural low-poly human, skinned onto a standard humanoid (Mixamo-style) skeleton so it can
// play motion-captured idle / walk / run / dance clips. No third-party character mesh is used — only the
// skeleton + animation data in public/models/rig.glb (see scripts/make_rig.py).
import * as THREE from 'three';

export type HairStyle = 'low' | 'afro' | 'bun' | 'cornrows' | 'bald' | 'gele';
export type Outfit = 'tee' | 'shirt' | 'kaftan' | 'wrapper';

export interface AvatarLook {
  skin: string;
  top: string;
  topAccent: string;
  bottom: string;
  shoes: string;
  hair: string;
  hairStyle: HairStyle;
  outfit: Outfit;
  build: 'm' | 'f';
  /** ankara-style print on the top (tee/shirt) or on the wrapper */
  print?: boolean;
}

export const AVATAR_PRESETS: { id: string; label: string; look: AvatarLook }[] = [
  { id: 'tunde', label: 'Tunde', look: { skin: '#6b4430', top: '#e2702a', topAccent: '#1b5e8c', bottom: '#2b3a55', shoes: '#f2f2ee', hair: '#151110', hairStyle: 'low', outfit: 'shirt', build: 'm', print: true } },
  { id: 'amaka', label: 'Amaka', look: { skin: '#7a4e35', top: '#1b8a8c', topAccent: '#f2c14e', bottom: '#1f1f24', shoes: '#f2f2ee', hair: '#141010', hairStyle: 'bun', outfit: 'tee', build: 'f' } },
  { id: 'emeka', label: 'Emeka', look: { skin: '#4a2f20', top: '#f1ede4', topAccent: '#0b8a57', bottom: '#f1ede4', shoes: '#5a3b22', hair: '#120e0d', hairStyle: 'low', outfit: 'kaftan', build: 'm' } },
  { id: 'zainab', label: 'Zainab', look: { skin: '#5a3a26', top: '#7b2a6e', topAccent: '#f2a03d', bottom: '#2a4fb0', shoes: '#22201e', hair: '#e8b23a', hairStyle: 'gele', outfit: 'wrapper', build: 'f', print: true } },
  { id: 'kola', label: 'Kola', look: { skin: '#3d271b', top: '#2f8f4e', topAccent: '#f4f1ea', bottom: '#b39b72', shoes: '#22201e', hair: '#0f0c0b', hairStyle: 'afro', outfit: 'tee', build: 'm' } },
  { id: 'ada', label: 'Ada', look: { skin: '#6b4430', top: '#e0a526', topAccent: '#8a2342', bottom: '#3a4a6b', shoes: '#c8452f', hair: '#141010', hairStyle: 'cornrows', outfit: 'tee', build: 'f', print: true } },
];

type W = [number, number][]; // [boneIndex, weight]
type V = THREE.Vector3;
type ColFn = (p: V) => THREE.Color;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const WHITE = new THREE.Color('#ffffff');

interface Ring { c: V; a: V; b: V; ra: number; rb: number; col: THREE.Color | ColFn; w: W | ((p: V) => W); ex?: number; pat?: boolean | ((p: V) => boolean) }

class Builder {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  tris: [number, number, number, number][] = []; // a, b, c, material (0 plain, 1 print)

  vert(p: V, c: THREE.Color, w: W, u = 0, v = 0) {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    this.uv.push(u, v);
    const ws = [...w].filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = ws.reduce((s, e) => s + e[1], 0) || 1;
    for (let i = 0; i < 4; i++) {
      this.si.push(ws[i] ? ws[i][0] : 0);
      this.sw.push(ws[i] ? ws[i][1] / sum : 0);
    }
    return this.pos.length / 3 - 1;
  }

  /** Loft through rings (ellipse / superellipse cross-sections). */
  loft(rings: Ring[], seg: number, capStart = true, capEnd = true) {
    const start = this.pos.length / 3;
    const tan = rings[rings.length - 1].c.clone().sub(rings[0].c);
    const flip = new THREE.Vector3().crossVectors(rings[0].a, rings[0].b).dot(tan) > 0;
    const patOf: boolean[] = [];
    let along = 0;
    rings.forEach((r, ri) => {
      if (ri > 0) along += r.c.distanceTo(rings[ri - 1].c);
      for (let k = 0; k < seg; k++) {
        const t = (k / seg) * Math.PI * 2;
        const ex = r.ex ?? 2;
        const ca = Math.cos(t), sa = Math.sin(t);
        const ea = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / ex);
        const eb = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / ex);
        const p = r.c.clone().addScaledVector(r.a, r.ra * ea).addScaledVector(r.b, r.rb * eb);
        const pat = typeof r.pat === 'function' ? r.pat(p) : !!r.pat;
        const c = pat ? WHITE : typeof r.col === 'function' ? r.col(p) : r.col;
        const w = typeof r.w === 'function' ? r.w(p) : r.w;
        // cylindrical UVs, ~ 1 tile per 22cm
        this.vert(p, c, w, (k / seg) * Math.max(1, Math.round(((r.ra + r.rb) * Math.PI) / 0.22)), along / 0.22);
        patOf.push(pat);
      }
    });
    const tri = (a: number, b: number, c: number) => {
      const m = patOf[a - start] && patOf[b - start] && patOf[c - start] ? 1 : 0;
      this.tris.push([a, b, c, m]);
    };
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const a = start + i * seg + k;
        const b = start + i * seg + ((k + 1) % seg);
        const c = a + seg;
        const d = b + seg;
        if (flip) { tri(a, b, c); tri(b, d, c); } else { tri(a, c, b); tri(b, c, d); }
      }
    }
    const cap = (ri: number, startCap: boolean) => {
      const fl = startCap !== flip;
      const r = rings[ri];
      const c = typeof r.col === 'function' ? r.col(r.c) : r.col;
      const w = typeof r.w === 'function' ? r.w(r.c) : r.w;
      const ci = this.vert(r.c, c, w);
      // own perimeter vertices so caps never inherit print colours from the side walls
      const base = this.pos.length / 3;
      for (let k = 0; k < seg; k++) {
        const src = start + ri * seg + k;
        const p = new THREE.Vector3(this.pos[src * 3], this.pos[src * 3 + 1], this.pos[src * 3 + 2]);
        this.vert(p, c, typeof r.w === 'function' ? r.w(p) : r.w);
      }
      for (let k = 0; k < seg; k++) {
        const a = base + k;
        const b = base + ((k + 1) % seg);
        if (fl) this.tris.push([ci, a, b, 0]);
        else this.tris.push([ci, b, a, 0]);
      }
    };
    if (capStart) cap(0, true);
    if (capEnd) cap(rings.length - 1, false);
  }

  ellipsoid(
    c: V, r: V, col: THREE.Color | ((p: V, n: V) => THREE.Color), w: W,
    rows = 8, seg = 12, keep?: (n: V) => boolean, shape?: (n: V, p: V) => void, pat = false,
  ) {
    const start = this.pos.length / 3;
    const kept: boolean[] = [];
    for (let i = 0; i <= rows; i++) {
      const phi = (i / rows) * Math.PI;
      for (let k = 0; k <= seg; k++) {
        const th = (k / seg) * Math.PI * 2;
        const n = v3(Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th));
        const p = v3(c.x + n.x * r.x, c.y + n.y * r.y, c.z + n.z * r.z);
        if (shape) shape(n, p);
        this.vert(p, pat ? WHITE : typeof col === 'function' ? col(p, n) : col, w, (k / seg) * 4, (i / rows) * 2);
        kept.push(keep ? keep(n) : true);
      }
    }
    const row = seg + 1;
    const m = pat ? 1 : 0;
    for (let i = 0; i < rows; i++)
      for (let k = 0; k < seg; k++) {
        const a = start + i * row + k, b = a + 1, cc = a + row, d = cc + 1;
        const ka = kept[a - start], kb = kept[b - start], kc = kept[cc - start], kd = kept[d - start];
        if (ka && kc && kb) this.tris.push([a, cc, b, m]);
        if (kb && kc && kd) this.tris.push([b, cc, d, m]);
      }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const plain = this.tris.filter((t) => t[3] === 0);
    const print = this.tris.filter((t) => t[3] === 1);
    const idx: number[] = [];
    for (const t of plain) idx.push(t[0], t[1], t[2]);
    for (const t of print) idx.push(t[0], t[1], t[2]);
    g.setIndex(idx);
    g.addGroup(0, plain.length * 3, 0);
    if (print.length) g.addGroup(plain.length * 3, print.length * 3, 1);
    g.computeVertexNormals();
    return g;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Interpolated profile rings + duplicated rings at colour boundaries (keeps colour edges crisp). */
function profile(keys: { y: number; ra: number; rb: number; ex?: number }[], cuts: number[]) {
  const ys = new Set<number>(keys.map((k) => k.y));
  const lo = Math.min(keys[0].y, keys[keys.length - 1].y), hi = Math.max(keys[0].y, keys[keys.length - 1].y);
  for (const c of cuts) {
    if (c <= lo || c >= hi) continue;
    ys.add(c - 0.0012);
    ys.add(c + 0.0012);
  }
  const sorted = [...ys].sort((a, b) => (keys[0].y < keys[keys.length - 1].y ? a - b : b - a));
  return sorted.map((y) => {
    let i = 0;
    const asc = keys[0].y < keys[keys.length - 1].y;
    while (i < keys.length - 2 && (asc ? y > keys[i + 1].y : y < keys[i + 1].y)) i++;
    const k0 = keys[i], k1 = keys[i + 1];
    const t = Math.min(1, Math.max(0, (y - k0.y) / (k1.y - k0.y)));
    return { y, ra: lerp(k0.ra, k1.ra, t), rb: lerp(k0.rb, k1.rb, t), ex: lerp(k0.ex ?? 2, k1.ex ?? 2, t) };
  });
}

const patternCache = new Map<string, THREE.Texture>();
/** Small ankara-style repeating print, drawn on a canvas in the avatar's colours. */
export function printTexture(base: string, accent: string): THREE.Texture {
  const key = base + accent;
  const hit = patternCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const b = new THREE.Color(base), a = new THREE.Color(accent);
  const light = b.clone().lerp(new THREE.Color('#fff4dc'), 0.65);
  g.fillStyle = '#' + b.getHexString();
  g.fillRect(0, 0, 128, 128);
  const ring = (x: number, y: number, r: number, col: string, lw: number) => {
    g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  };
  for (const [x, y] of [[32, 32], [96, 96], [96, 32], [32, 96], [0, 0], [128, 0], [0, 128], [128, 128], [64, 64], [0, 64], [64, 0], [128, 64], [64, 128]] as const) {
    const big = (x + y) % 64 === 0;
    if (big) {
      g.fillStyle = '#' + a.getHexString();
      g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.fill();
      ring(x, y, 11, '#' + light.getHexString(), 4);
      g.fillStyle = '#' + b.getHexString();
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = '#' + light.getHexString();
      g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x + 7, y); g.lineTo(x, y + 10); g.lineTo(x - 7, y); g.closePath(); g.fill();
      g.fillStyle = '#' + a.getHexString();
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  patternCache.set(key, tex);
  return tex;
}

/**
 * Build a skinned avatar mesh for `skeleton` (bones in bind / T-pose, character standing at the origin,
 * facing +Z, metres). Call mesh.bind(skeleton) afterwards with the rig still at the origin.
 */
export function buildAvatarMesh(skeleton: THREE.Skeleton, look: AvatarLook): THREE.SkinnedMesh {
  const bones = skeleton.bones;
  const bi = (suffix: string) => {
    const i = bones.findIndex((b) => b.name.replace(/^mixamorig:?/, '') === suffix);
    if (i < 0) throw new Error('bone missing: ' + suffix);
    return i;
  };
  const wp = (suffix: string) => bones[bi(suffix)].getWorldPosition(new THREE.Vector3());

  const C = (hex: string) => new THREE.Color(hex);
  const skin = C(look.skin);
  const skinShade = skin.clone().multiplyScalar(0.8);
  const top = C(look.top);
  const accent = C(look.topAccent);
  const bottom = C(look.bottom);
  const shoes = C(look.shoes);
  const sole = C('#ebe6dc');
  const hair = C(look.hair);
  const dark = C('#1a1210');
  const white = C('#f4f1ea');
  const lip = skin.clone().lerp(C('#5a2420'), 0.4);
  const f = look.build === 'f';
  const printTop = !!look.print && (look.outfit === 'tee' || look.outfit === 'shirt');
  const printWrap = !!look.print && look.outfit === 'wrapper';

  const B = new Builder();
  const X = v3(1, 0, 0), Y = v3(0, 1, 0), Z = v3(0, 0, 1);

  const hips = bi('Hips'), spine = bi('Spine'), spine1 = bi('Spine1'), spine2 = bi('Spine2'), neck = bi('Neck'), head = bi('Head');
  const yH = wp('Hips').y;
  const yNeck = wp('Neck').y;
  const yHead = wp('Head').y;
  const s = yH / 1.04; // proportion scale relative to the reference rig
  const spinePts = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck'].map((n) => wp(n));
  const zAt = (y: number) => {
    if (y <= spinePts[0].y) return spinePts[0].z;
    for (let i = 0; i < spinePts.length - 1; i++)
      if (y <= spinePts[i + 1].y) return lerp(spinePts[i].z, spinePts[i + 1].z, (y - spinePts[i].y) / (spinePts[i + 1].y - spinePts[i].y));
    return spinePts[spinePts.length - 1].z;
  };

  // ---------- torso ----------
  const ySp = spinePts[1].y, ySp1 = spinePts[2].y, ySp2 = spinePts[3].y;
  const torsoW = (y: number): W => {
    if (y < ySp) { const k = smooth(yH, ySp, y) * 0.5; return [[hips, 1 - k], [spine, k]]; }
    if (y < ySp1) { const t = (y - ySp) / (ySp1 - ySp); return [[spine, 1 - t * 0.5], [spine1, t * 0.5]]; }
    if (y < ySp2) { const t = (y - ySp1) / (ySp2 - ySp1); return [[spine1, 1 - t * 0.5], [spine2, t * 0.5]]; }
    const t = Math.min(1, (y - ySp2) / (yNeck - ySp2));
    return [[spine2, 1 - t * 0.6], [neck, t * 0.6]];
  };
  const lShoulder = bi('LeftShoulder'), rShoulder = bi('RightShoulder');
  const torsoWeights = (p: V): W => {
    const w = torsoW(p.y);
    if (p.y > yH + 0.3 * s && Math.abs(p.x) > 0.1 * s) {
      const k = smooth(0.1 * s, 0.18 * s, Math.abs(p.x)) * 0.45;
      return [...w.map(([b, x]) => [b, x * (1 - k)] as [number, number]), [p.x > 0 ? lShoulder : rShoulder, k]];
    }
    return w;
  };
  const longTop = look.outfit === 'kaftan';
  const wrapper = look.outfit === 'wrapper';
  const waistY = yH + 0.03 * s;
  const collar0 = yNeck - 0.035 * s;
  const band0 = yH + 0.2 * s, band1 = yH + 0.24 * s;
  const torsoCol: ColFn = (p) => {
    if (p.y < waistY && !longTop) return wrapper ? (printWrap ? bottom : accent) : bottom;
    if (p.y > collar0) return look.outfit === 'tee' ? accent : look.outfit === 'kaftan' ? accent : top;
    if (look.outfit === 'tee' && !printTop && p.y > band0 && p.y < band1) return accent;
    return top;
  };
  const torsoPat = (p: V) => printTop && p.y >= waistY && p.y <= collar0;
  const tw = f ? 0.92 : 1;
  const keys = [
    { y: yH - 0.13 * s, ra: 0.12 * s, rb: 0.085 * s },
    { y: yH - 0.07 * s, ra: (f ? 0.17 : 0.158) * s, rb: (f ? 0.11 : 0.105) * s },
    { y: yH + 0.0 * s, ra: (f ? 0.165 : 0.152) * s, rb: 0.104 * s, ex: 2.3 },
    { y: yH + 0.1 * s, ra: (f ? 0.126 : 0.142) * s, rb: 0.098 * s, ex: 2.3 },
    { y: yH + 0.2 * s, ra: 0.152 * tw * s, rb: (f ? 0.122 : 0.108) * s, ex: 2.4 },
    { y: yH + 0.28 * s, ra: 0.168 * tw * s, rb: (f ? 0.125 : 0.115) * s, ex: 2.5 },
    { y: yH + 0.36 * s, ra: 0.18 * tw * s, rb: 0.11 * s, ex: 2.7 },
    { y: yH + 0.415 * s, ra: 0.172 * tw * s, rb: 0.096 * s, ex: 2.8 },
    { y: yH + 0.445 * s, ra: 0.125 * tw * s, rb: 0.08 * s, ex: 2.4 },
    { y: yNeck + 0.008 * s, ra: 0.074 * s, rb: 0.068 * s },
  ];
  B.loft(
    profile(keys, [waistY, band0, band1, collar0]).map((r) => ({ c: v3(0, r.y, zAt(r.y)), a: X, b: Z, ra: r.ra, rb: r.rb, ex: r.ex, col: torsoCol, w: torsoWeights, pat: torsoPat })),
    16,
  );

  // long tops (kaftan) and wrappers: a flared skirt-like tube around the legs
  if (longTop || wrapper) {
    const lUp = bi('LeftUpLeg'), rUp = bi('RightUpLeg');
    const skirtW = (p: V): W => {
      const k = smooth(yH, yH - 0.45 * s, p.y) * 0.5;
      if (Math.abs(p.x) < 0.03 * s) return [[hips, 1 - k * 0.5], [lUp, k * 0.25], [rUp, k * 0.25]];
      return [[hips, 1 - k], [p.x > 0 ? lUp : rUp, k]];
    };
    const yTop = waistY + 0.01 * s;
    const yBot = wrapper ? yH - 0.87 * s : yH - 0.44 * s;
    const stripes = wrapper && !printWrap ? [0.2, 0.35, 0.65, 0.8].map((t) => lerp(yTop, yBot, t)) : [];
    const hemBand = lerp(yTop, yBot, 0.93);
    const prof = profile(
      [
        { y: yTop, ra: 0.168 * s, rb: 0.112 * s, ex: 2.2 },
        { y: lerp(yTop, yBot, 0.35), ra: (wrapper ? 0.185 : 0.2) * s, rb: (wrapper ? 0.135 : 0.15) * s, ex: 2.2 },
        { y: yBot, ra: (wrapper ? 0.19 : 0.225) * s, rb: (wrapper ? 0.15 : 0.175) * s, ex: 2.2 },
      ],
      [...stripes, hemBand],
    );
    const sc: ColFn = (p) => {
      if (p.y < hemBand) return accent;
      if (wrapper && !printWrap) { const i = stripes.filter((y) => p.y < y).length; return i % 2 ? accent : bottom; }
      return longTop ? top : bottom;
    };
    B.loft(prof.map((r) => ({ c: v3(0, r.y, zAt(yH) - 0.005), a: X, b: Z, ra: r.ra, rb: r.rb, ex: r.ex, col: sc, w: skirtW, pat: (p: V) => printWrap && p.y >= hemBand })), 16, false, false);
  }

  // ---------- neck + head ----------
  const headP = wp('Head');
  B.loft(
    [
      { c: v3(0, yNeck - 0.03 * s, zAt(yNeck)), a: X, b: Z, ra: 0.063 * s, rb: 0.06 * s, col: skin, w: [[neck, 1]] },
      { c: v3(0, yHead + 0.03 * s, headP.z), a: X, b: Z, ra: 0.06 * s, rb: 0.058 * s, col: skin, w: [[head, 0.7], [neck, 0.3]] },
    ],
    10, false, false,
  );
  const hc = v3(0, yHead + 0.084 * s, headP.z + 0.02 * s);
  const hr = v3(0.1 * s, 0.125 * s, 0.114 * s);
  B.ellipsoid(hc, hr, skin, [[head, 1]], 10, 16, undefined, (n, p) => {
    if (n.y < 0) p.x = hc.x + (p.x - hc.x) * (1 + n.y * 0.22);
    if (n.z < -0.2) p.z = hc.z + (p.z - hc.z) * 0.93;
  });
  for (const sx of [1, -1]) B.ellipsoid(v3(sx * 0.097 * s, hc.y - 0.012 * s, hc.z - 0.008 * s), v3(0.015 * s, 0.027 * s, 0.019 * s), skinShade, [[head, 1]], 4, 8);
  for (const sx of [1, -1]) {
    B.ellipsoid(v3(sx * 0.035 * s, hc.y + 0.012 * s, hc.z + 0.101 * s), v3(0.017 * s, 0.011 * s, 0.006 * s), white, [[head, 1]], 4, 8);
    B.ellipsoid(v3(sx * 0.035 * s, hc.y + 0.011 * s, hc.z + 0.106 * s), v3(0.0085 * s, 0.0095 * s, 0.004 * s), dark, [[head, 1]], 3, 6);
    B.ellipsoid(v3(sx * 0.037 * s, hc.y + 0.037 * s, hc.z + 0.1 * s), v3(0.023 * s, 0.0045 * s, 0.006 * s), hair.clone().lerp(dark, 0.5), [[head, 1]], 3, 6);
  }
  B.ellipsoid(v3(0, hc.y - 0.012 * s, hc.z + 0.111 * s), v3(0.019 * s, 0.022 * s, 0.018 * s), skinShade, [[head, 1]], 4, 8);
  B.ellipsoid(v3(0, hc.y - 0.054 * s, hc.z + 0.097 * s), v3(0.028 * s, 0.0075 * s, 0.008 * s), lip, [[head, 1]], 3, 8);

  const hs = look.hairStyle;
  if (hs === 'gele') {
    const gc = hc.clone().add(v3(0, 0.07 * s, -0.012 * s));
    B.ellipsoid(gc, v3(0.13 * s, 0.085 * s, 0.135 * s), hair, [[head, 1]], 7, 16, (n) => n.y > -0.3, (n, p) => {
      p.y += Math.max(0, n.y) * 0.05 * s + Math.abs(Math.sin(Math.atan2(n.x, n.z) * 3)) * 0.014 * s;
    }, !!look.print);
    B.ellipsoid(hc.clone().add(v3(0.0, 0.15 * s, -0.045 * s)), v3(0.08 * s, 0.05 * s, 0.072 * s), hair.clone().multiplyScalar(0.88), [[head, 1]], 5, 10);
  } else if (hs !== 'bald') {
    const grow = hs === 'afro' ? 0.042 : 0.007;
    const hairR = v3(hr.x + grow * s, hr.y + grow * s * (hs === 'afro' ? 1.1 : 1), hr.z + grow * s);
    const hcen = hc.clone().add(v3(0, hs === 'afro' ? 0.028 * s : 0.004 * s, hs === 'afro' ? -0.012 * s : -0.004 * s));
    const keep = (n: V) => {
      const back = 1 - Math.cos(Math.atan2(n.x, n.z));
      return n.y > (hs === 'afro' ? 0.12 - back * 0.3 : 0.34 - back * 0.33);
    };
    const hcol = (_p: V, n: V) => (hs === 'cornrows' && Math.abs(Math.sin(Math.atan2(n.x, n.y + 0.9) * 10)) < 0.28 ? skinShade : hair);
    B.ellipsoid(hcen, hairR, hcol, [[head, 1]], 10, 18, keep);
    if (hs === 'bun') B.ellipsoid(hc.clone().add(v3(0, 0.1 * s, -0.085 * s)), v3(0.052 * s, 0.047 * s, 0.052 * s), hair, [[head, 1]], 6, 10);
  }

  // ---------- arms ----------
  for (const side of ['Left', 'Right'] as const) {
    const sx = side === 'Left' ? 1 : -1;
    const sh = bi(side + 'Shoulder'), arm = bi(side + 'Arm'), fore = bi(side + 'ForeArm'), hand = bi(side + 'Hand');
    const pA = wp(side + 'Arm'), pF = wp(side + 'ForeArm'), pH = wp(side + 'Hand');
    const L1 = Math.abs(pF.x - pA.x), L2 = Math.abs(pH.x - pF.x);
    const ax = (t: number) => v3(lerp(pA.x, pH.x, t), lerp(pA.y, pH.y, t), lerp(pA.z, pH.z, t));
    const tE = L1 / (L1 + L2);
    const sleeveEnd = longTop ? 0.93 : look.outfit === 'shirt' ? 0.39 : 0.36;
    const armW = (t: number): W => {
      if (t < 0.04) return [[sh, 0.4], [arm, 0.6]];
      if (t < tE - 0.06) return [[arm, 1]];
      if (t < tE + 0.06) { const k = (t - (tE - 0.06)) / 0.12; return [[arm, 1 - k], [fore, k]]; }
      if (t < 0.97) return [[fore, 1]];
      return [[fore, 0.5], [hand, 0.5]];
    };
    const ring = (t: number, r: number, col: THREE.Color, rz = r, pat = false): Ring => ({ c: ax(t), a: Y, b: Z, ra: r, rb: rz, col, w: armW(t), pat });
    const sp = printTop;
    const rs: Ring[] = [
      ring(-0.08, 0.062 * s, top, 0.062 * s, sp),
      ring(0.02, 0.066 * s, top, 0.066 * s, sp),
      ring(0.16, 0.062 * s, top, 0.062 * s, sp),
      ring(sleeveEnd - 0.03, (longTop ? 0.056 : 0.059) * s, top, (longTop ? 0.056 : 0.059) * s, sp),
      ring(sleeveEnd, (longTop ? 0.056 : 0.059) * s, longTop ? accent : top, (longTop ? 0.056 : 0.059) * s, sp && !longTop),
      ring(sleeveEnd + 0.001, (longTop ? 0.034 : 0.046) * s, skin),
    ];
    for (const [t, r, rz] of [[tE - 0.05, 0.043, 0.045], [tE, 0.04, 0.04], [tE + 0.06, 0.041, 0.043], [0.8, 0.036, 0.038], [1.0, 0.027, 0.034]] as const)
      if (t > sleeveEnd + 0.002) rs.push(ring(t, r * s, skin, rz * s));
    B.loft(rs, 10, true, true);
    const hcx = pH.x + sx * 0.075 * s;
    B.ellipsoid(v3(hcx, pH.y - 0.004 * s, pH.z - 0.005 * s), v3(0.07 * s, 0.025 * s, 0.046 * s), skin, [[hand, 1]], 6, 10);
    B.ellipsoid(v3(pH.x + sx * 0.045 * s, pH.y - 0.018 * s, pH.z + 0.036 * s), v3(0.036 * s, 0.018 * s, 0.018 * s), skinShade, [[hand, 1]], 4, 8);
  }

  // ---------- legs + shoes ----------
  for (const side of ['Left', 'Right'] as const) {
    const up = bi(side + 'UpLeg'), leg = bi(side + 'Leg'), foot = bi(side + 'Foot'), toe = bi(side + 'ToeBase');
    const pU = wp(side + 'UpLeg'), pL = wp(side + 'Leg'), pF = wp(side + 'Foot'), pT = wp(side + 'ToeBase'), pE = wp(side + 'Toe_End');
    const at = (y: number) => {
      if (y >= pL.y) { const t = (pU.y - y) / (pU.y - pL.y); return v3(lerp(pU.x, pL.x, t), y, lerp(pU.z, pL.z, t)); }
      const t = (pL.y - y) / (pL.y - pF.y);
      return v3(lerp(pL.x, pF.x, t), y, lerp(pL.z, pF.z, t));
    };
    const legW = (y: number): W => {
      if (y > pU.y - 0.04 * s) return [[hips, 0.45], [up, 0.55]];
      if (y > pL.y + 0.05 * s) return [[up, 1]];
      if (y > pL.y - 0.05 * s) { const k = (pL.y + 0.05 * s - y) / (0.1 * s); return [[up, 1 - k], [leg, k]]; }
      if (y > pF.y + 0.03 * s) return [[leg, 1]];
      return [[leg, 0.5], [foot, 0.5]];
    };
    const legCol = wrapper ? skin : bottom;
    const hem = pF.y + 0.03 * s;
    const ys = [pU.y + 0.05 * s, pU.y - 0.03 * s, pU.y - 0.18 * s, pL.y + 0.07 * s, pL.y + 0.02 * s, pL.y - 0.03 * s, pL.y - 0.16 * s, pF.y + 0.12 * s, hem];
    const rads: [number, number][] = [[0.092, 0.098], [0.09, 0.096], [0.078, 0.084], [0.063, 0.067], [0.058, 0.062], [0.057, 0.062], [0.056, 0.062], [0.045, 0.05], [0.047, 0.052]];
    const ls = wrapper ? 0.82 : f ? 0.97 : 1;
    B.loft(ys.map((y, i) => ({ c: at(y), a: X, b: Z, ra: rads[i][0] * s * ls, rb: rads[i][1] * s * ls, col: legCol, w: legW(y) })), 12, true, false);
    const sock = wrapper ? skin : C('#e9e4da');
    B.loft(
      [
        { c: at(hem + 0.005 * s), a: X, b: Z, ra: 0.036 * s, rb: 0.038 * s, col: sock, w: [[leg, 0.5], [foot, 0.5]] },
        { c: at(pF.y - 0.02 * s), a: X, b: Z, ra: 0.036 * s, rb: 0.038 * s, col: sock, w: [[foot, 1]] },
      ],
      8, false, false,
    );
    const zs = [pF.z - 0.06 * s, pF.z - 0.035 * s, pF.z + 0.02 * s, pT.z - 0.01 * s, pT.z + 0.045 * s, pE.z + 0.015 * s];
    const prof: [number, number, number][] = [[0.035, 0.035, 0.038], [0.044, 0.05, 0.05], [0.048, 0.058, 0.058], [0.052, 0.045, 0.046], [0.048, 0.035, 0.036], [0.03, 0.022, 0.026]];
    const footW = (z: number): W => (z < pT.z - 0.03 * s ? [[foot, 1]] : z < pT.z + 0.02 * s ? [[foot, 0.5], [toe, 0.5]] : [[toe, 1]]);
    B.loft(
      zs.map((z, i) => ({ c: v3(pF.x, prof[i][2] * s, z), a: X, b: Y, ra: prof[i][0] * s, rb: prof[i][1] * s, ex: 2.6, col: (p: V) => (p.y < 0.016 * s ? sole : shoes), w: footW(z) })),
      12,
    );
  }

  const geom = B.geometry();
  const plain = new THREE.MeshLambertMaterial({ vertexColors: true });
  const printBase = printWrap ? look.bottom : look.hairStyle === 'gele' && !printTop ? look.hair : look.top;
  const printed = new THREE.MeshLambertMaterial({ vertexColors: true, map: printTexture(printBase, look.topAccent) });
  const mesh = new THREE.SkinnedMesh(geom, [plain, printed]);
  mesh.name = 'avatar';
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
