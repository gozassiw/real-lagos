// Reusable low-poly prop meshes built in code (original assets): trees, palms, street lights, water tanks,
// domes, danfo buses, BRT-style buses, kekes, kiosks, umbrellas, power poles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PackedGeo } from './geometry';

export function toGeometry(p: PackedGeo, extraName?: string): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(p.color, 3));
  if (p.uv) g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2));
  if (p.extra && extraName) g.setAttribute(extraName, new THREE.BufferAttribute(p.extra, p.extraSize));
  g.setIndex(new THREE.BufferAttribute(p.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const lin = (hex: string) => new THREE.Color(hex);

function colored(g: THREE.BufferGeometry, hex: string | THREE.Color, jitter = 0): THREE.BufferGeometry {
  const c = typeof hex === 'string' ? lin(hex) : hex;
  const out = g.index ? g.toNonIndexed() : g;
  const m = out.attributes.position.count;
  const a = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) {
    // per-triangle jitter gives low-poly foliage a faceted, painterly look
    const k = jitter ? 1 + (((Math.sin(Math.floor(i / 3) * 12.9898) * 43758.5453) % 1) - 0.5) * jitter * 2 : 1;
    a[i * 3] = c.r * k;
    a[i * 3 + 1] = c.g * k;
    a[i * 3 + 2] = c.b * k;
  }
  out.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (out.attributes.uv) out.deleteAttribute('uv');
  return out;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
};

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ vegetation
export function palmGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // gently curved trunk from 4 tapered segments
  let x = 0, y = 0;
  for (let i = 0; i < 4; i++) {
    const seg = colored(new THREE.CylinderGeometry(0.16 - i * 0.015, 0.2 - i * 0.015, 2.15, 5, 1, true), i % 2 ? '#7d6a52' : '#8a765c');
    at(seg, x, y + 1.07, 0, 0, 0, -0.06 - i * 0.02);
    parts.push(seg);
    y += 2.1;
    x += 0.12 + i * 0.05;
  }
  // fronds
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const leaf = colored(new THREE.ConeGeometry(0.55, 3.8, 3, 1), k % 2 ? '#3f7a34' : '#4c8a3b');
    leaf.scale(1, 1, 0.18);
    leaf.translate(0, 1.9, 0);
    leaf.rotateZ(-1.2 + (k % 3) * 0.14);
    leaf.rotateY(a);
    leaf.translate(x, y, 0);
    parts.push(leaf);
  }
  parts.push(at(colored(new THREE.IcosahedronGeometry(0.35, 0), '#6b5a2e'), x, y - 0.1, 0));
  return merge(parts);
}

export function broadleafGeometry() {
  // Lagos "umbrella" almond tree: tiered flat canopies
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.CylinderGeometry(0.2, 0.32, 4.2, 5, 1, true), '#6b5440'), 0, 2.1, 0));
  const tiers = [[3.6, 3.4, '#3d7a3a'], [4.8, 2.6, '#4a8a3f'], [5.8, 1.7, '#5a9a46']] as const;
  for (const [y, r, c] of tiers) {
    const t = colored(new THREE.CylinderGeometry(r * 0.75, r, 0.9, 6), c, 0.1);
    at(t, 0, y, 0, 0, y);
    parts.push(t);
  }
  return merge(parts);
}

export function roundTreeGeometry() {
  // mango / neem: rounded canopy
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.CylinderGeometry(0.22, 0.3, 3, 5, 1, true), '#5e4a38'), 0, 1.5, 0));
  parts.push(at(colored(new THREE.IcosahedronGeometry(2.6, 0), '#356e31', 0.12), 0, 4.6, 0));
  parts.push(at(colored(new THREE.IcosahedronGeometry(1.9, 0), '#427d37', 0.12), 1.3, 4.0, 0.6));
  parts.push(at(colored(new THREE.IcosahedronGeometry(1.7, 0), '#3b7434', 0.12), -1.1, 4.2, -0.8));
  return merge(parts);
}

export function mangroveGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.IcosahedronGeometry(1.6, 0), '#2f5e2c', 0.15), 0, 1.6, 0));
  parts.push(at(colored(new THREE.IcosahedronGeometry(1.2, 0), '#386a31', 0.15), 1.1, 1.2, 0.4));
  for (let i = 0; i < 4; i++) parts.push(at(colored(new THREE.CylinderGeometry(0.05, 0.08, 1.4, 4), '#4a3c2e'), Math.cos(i) * 0.6, 0.6, Math.sin(i) * 0.6, 0.3 * Math.sin(i), 0, 0.3 * Math.cos(i)));
  return merge(parts);
}

// ------------------------------------------------------------------ street furniture
export function streetLightGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.CylinderGeometry(0.08, 0.12, 8, 6), '#8b9096'), 0, 4, 0));
  parts.push(at(colored(new THREE.BoxGeometry(2.4, 0.1, 0.1), '#8b9096'), 1.1, 7.9, 0));
  parts.push(at(colored(new THREE.BoxGeometry(0.7, 0.14, 0.3), '#d9dcdf'), 2.2, 7.82, 0));
  parts.push(at(colored(new THREE.BoxGeometry(0.4, 0.5, 0.4), '#444'), 0, 0.25, 0));
  return merge(parts);
}

export function powerPoleGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.CylinderGeometry(0.11, 0.15, 9, 6), '#8a8580'), 0, 4.5, 0));
  parts.push(at(colored(new THREE.BoxGeometry(1.8, 0.12, 0.12), '#5a4a3a'), 0, 8.4, 0));
  for (const x of [-0.75, 0, 0.75]) parts.push(at(colored(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 5), '#e8e4dc'), x, 8.55, 0));
  parts.push(at(colored(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 7), '#7a7f84'), 0.25, 6.8, 0)); // transformer can
  return merge(parts);
}

export function waterTankGeometry(color: string) {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.BoxGeometry(1.5, 1.1, 1.5), '#6d6a64'), 0, 0.55, 0));
  parts.push(at(colored(new THREE.CylinderGeometry(0.75, 0.8, 1.5, 10), color), 0, 1.85, 0));
  parts.push(at(colored(new THREE.CylinderGeometry(0.3, 0.75, 0.25, 10), color), 0, 2.72, 0));
  return merge(parts);
}

export function domeGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.CylinderGeometry(1, 1, 0.5, 14), '#e8e2d2'), 0, 0.25, 0));
  parts.push(at(colored(new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), '#2f8a5a'), 0, 0.5, 0));
  parts.push(at(colored(new THREE.ConeGeometry(0.06, 0.6, 5), '#d8b240'), 0, 1.75, 0));
  return merge(parts);
}

// ------------------------------------------------------------------ vehicles
/** Yellow Lagos danfo minibus with black stripes. Faces +Z, length ~4.9 m. */
export function danfoGeometry() {
  const Y = '#f2c230', K = '#151515';
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.BoxGeometry(1.9, 1.15, 4.6), Y), 0, 1.05, 0));
  parts.push(at(colored(new THREE.BoxGeometry(1.86, 0.75, 3.5), Y), 0, 1.98, -0.45));
  // windscreen slope + windows
  parts.push(at(colored(new THREE.BoxGeometry(1.8, 0.7, 0.9), '#2a3a44'), 0, 1.92, 1.6, -0.35));
  parts.push(at(colored(new THREE.BoxGeometry(1.92, 0.52, 3.3), '#25313a'), 0, 2.02, -0.45));
  // the black stripes
  parts.push(at(colored(new THREE.BoxGeometry(1.94, 0.12, 4.64), K), 0, 1.55, 0));
  parts.push(at(colored(new THREE.BoxGeometry(1.94, 0.1, 4.64), K), 0, 0.78, 0));
  // roof rack
  parts.push(at(colored(new THREE.BoxGeometry(1.6, 0.06, 2.6), '#3a3a3a'), 0, 2.42, -0.6));
  // bumpers & lights
  parts.push(at(colored(new THREE.BoxGeometry(1.95, 0.25, 0.15), '#2a2a2a'), 0, 0.55, 2.33));
  parts.push(at(colored(new THREE.BoxGeometry(1.95, 0.25, 0.15), '#2a2a2a'), 0, 0.55, -2.33));
  for (const s of [-1, 1]) {
    parts.push(at(colored(new THREE.BoxGeometry(0.28, 0.18, 0.06), '#fff6d0'), s * 0.68, 0.95, 2.31));
    parts.push(at(colored(new THREE.BoxGeometry(0.22, 0.2, 0.06), '#c0281e'), s * 0.75, 1.05, -2.31));
  }
  // wheels
  for (const [x, z] of [[0.86, 1.5], [-0.86, 1.5], [0.86, -1.5], [-0.86, -1.5]])
    parts.push(at(colored(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10), '#161616'), x, 0.38, z, 0, 0, Math.PI / 2));
  // open sliding door (dark gap) on the right side
  parts.push(at(colored(new THREE.BoxGeometry(0.04, 1.3, 0.9), '#1a1a1a'), 0.96, 1.4, 0.55));
  return merge(parts);
}

/** Large yellow commercial / BRT-style bus, faces +Z, ~11 m */
export function busGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.BoxGeometry(2.5, 2.6, 11), '#f0b92a'), 0, 1.75, 0));
  parts.push(at(colored(new THREE.BoxGeometry(2.54, 0.9, 10.2), '#253038'), 0, 2.2, -0.2));
  parts.push(at(colored(new THREE.BoxGeometry(2.3, 1.2, 0.08), '#253038'), 0, 2.1, 5.52));
  parts.push(at(colored(new THREE.BoxGeometry(2.56, 0.35, 11.04), '#1d5fa8'), 0, 0.85, 0));
  for (const [x, z] of [[1.15, 3.6], [-1.15, 3.6], [1.15, -3.4], [-1.15, -3.4]])
    parts.push(at(colored(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 10), '#151515'), x, 0.5, z, 0, 0, Math.PI / 2));
  return merge(parts);
}

/** Keke NAPEP tricycle (yellow + green), faces +Z */
export function kekeGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.BoxGeometry(1.25, 0.6, 2.1), '#f2c230'), 0, 0.75, 0));
  parts.push(at(colored(new THREE.BoxGeometry(1.25, 0.08, 2.1), '#1f7a3a'), 0, 1.07, 0));
  parts.push(at(colored(new THREE.BoxGeometry(1.2, 0.06, 1.9), '#1d1d1d'), 0, 1.85, -0.05));
  for (const [x, z] of [[0.55, 0.85], [-0.55, 0.85], [0.55, -0.85], [-0.55, -0.85]])
    parts.push(at(colored(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 4), '#2a2a2a'), x, 1.45, z));
  parts.push(at(colored(new THREE.BoxGeometry(0.9, 0.5, 0.05), '#2b3a44'), 0, 1.5, 0.98, -0.2));
  parts.push(at(colored(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 8), '#151515'), 0, 0.28, 1.0, 0, 0, Math.PI / 2));
  for (const x of [0.6, -0.6]) parts.push(at(colored(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 8), '#151515'), x, 0.28, -0.7, 0, 0, Math.PI / 2));
  return merge(parts);
}

export function carGeometry(color: string) {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.BoxGeometry(1.8, 0.7, 4.3), color), 0, 0.7, 0));
  parts.push(at(colored(new THREE.BoxGeometry(1.6, 0.6, 2.2), '#28323a'), 0, 1.33, -0.2));
  for (const [x, z] of [[0.82, 1.35], [-0.82, 1.35], [0.82, -1.35], [-0.82, -1.35]])
    parts.push(at(colored(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 9), '#151515'), x, 0.33, z, 0, 0, Math.PI / 2));
  return merge(parts);
}

// ------------------------------------------------------------------ market / roadside
export function kioskGeometry(color: string) {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.BoxGeometry(2.2, 2.2, 1.8), color), 0, 1.1, 0));
  parts.push(at(colored(new THREE.BoxGeometry(2.6, 0.08, 2.4), '#8f9396'), 0, 2.28, 0.25, 0.12));
  parts.push(at(colored(new THREE.BoxGeometry(1.8, 0.9, 0.05), '#3a2f28'), 0, 1.35, 0.91));
  parts.push(at(colored(new THREE.BoxGeometry(2.0, 0.08, 0.5), '#bfb7a5'), 0, 0.95, 1.1));
  return merge(parts);
}

export function umbrellaGeometry(color: string) {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), '#3a3a3a'), 0, 1.2, 0));
  parts.push(at(colored(new THREE.ConeGeometry(1.5, 0.6, 8, 1, true), color), 0, 2.45, 0));
  parts.push(at(colored(new THREE.BoxGeometry(1.4, 0.8, 0.8), '#9b7b55'), 0, 0.4, 0));
  for (let i = 0; i < 4; i++) parts.push(at(colored(new THREE.BoxGeometry(0.25, 0.18, 0.25), ['#e85a2a', '#f2cf3a', '#3a8fd8', '#f2f2f2'][i]), -0.45 + i * 0.3, 0.9, 0));
  return merge(parts);
}

export function busShelterGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-1.6, 1.6]) parts.push(at(colored(new THREE.BoxGeometry(0.1, 2.6, 0.1), '#9aa0a6'), x, 1.3, -0.6));
  parts.push(at(colored(new THREE.BoxGeometry(3.6, 0.1, 1.6), '#1f7a3a'), 0, 2.65, 0));
  parts.push(at(colored(new THREE.BoxGeometry(3.2, 0.1, 0.4), '#c9c3b6'), 0, 0.5, -0.5));
  parts.push(at(colored(new THREE.BoxGeometry(3.4, 1.3, 0.05), '#2a5d8f'), 0, 1.6, -0.72));
  return merge(parts);
}

export function signPoleGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(at(colored(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), '#8a8f94'), 0, 1.5, 0));
  parts.push(at(colored(new THREE.BoxGeometry(1.4, 0.5, 0.05), '#1d6b3a'), 0, 2.85, 0));
  return merge(parts);
}
