// Lightweight traffic on the real major-road network near the player: yellow danfos (most of them), big
// yellow buses, private cars, and kekes on smaller roads. Vehicles drive on the right, follow OSM geometry
// (including bridge decks), stop for the player, and are recycled as the player moves.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mapData, type Road } from '../map/mapData';
import { danfoGeometry, busGeometry, carGeometry, kekeGeometry } from '../map/props';
import { materials } from '../map/materials';
import { worldState } from '../worldState';
import { audio } from '../audio';

type Kind = 0 | 1 | 2 | 3 | 4 | 5; // danfo, bus, car red, car silver, car dark, keke
const KINDS: Kind[] = [0, 0, 0, 0, 1, 2, 3, 4, 0, 5, 5];
const MAX = 34;

interface Veh {
  active: boolean;
  kind: Kind;
  road: Road | null;
  seg: number;
  t: number; // distance along segment
  dir: 1 | -1;
  speed: number;
  cruise: number;
  lane: number;
  x: number;
  y: number;
  z: number;
  rot: number;
}

const spawnRand = () => Math.random();

export function Traffic() {
  const mats = materials();
  const geos = useMemo(() => [danfoGeometry(), busGeometry(), carGeometry('#a8322a'), carGeometry('#b9bec4'), carGeometry('#2d3742'), kekeGeometry()], []);
  const meshes = useMemo(
    () =>
      geos.map((g) => {
        const m = new THREE.InstancedMesh(g, mats.plain, MAX);
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = true;
        return m;
      }),
    [geos, mats],
  );
  const vehicles = useRef<Veh[]>(Array.from({ length: MAX }, () => ({ active: false, kind: 0, road: null, seg: 0, t: 0, dir: 1, speed: 0, cruise: 10, lane: 0, x: 0, y: 0, z: 0, rot: 0 })));
  const timer = useRef(0);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();

  function segLen(r: Road, i: number) {
    return Math.hypot(r.pts[i * 2 + 2] - r.pts[i * 2], r.pts[i * 2 + 3] - r.pts[i * 2 + 1]);
  }

  function spawn(v: Veh, fx: number, fz: number) {
    const near = mapData.roadsNear(fx, fz, 420);
    if (!near.length) return false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = mapData.majorRoads[near[Math.floor(spawnRand() * near.length)]];
      if (r.cls > 4 || r.link || r.pts.length < 4) continue;
      const n = r.pts.length / 2;
      const seg = Math.floor(spawnRand() * (n - 1));
      const x = r.pts[seg * 2], z = r.pts[seg * 2 + 1];
      const d = Math.hypot(x - fx, z - fz);
      if (d < 70 || d > 420) continue;
      v.active = true;
      v.road = r;
      v.seg = seg;
      v.t = spawnRand() * segLen(r, seg);
      v.dir = r.oneway ? 1 : spawnRand() < 0.5 ? 1 : -1;
      if (v.dir === -1) { v.seg = seg; }
      let kind = KINDS[Math.floor(spawnRand() * KINDS.length)];
      if (kind === 5 && r.cls <= 2) kind = 0; // kekes are banned on the big highways
      if (kind === 1 && r.cls >= 4) kind = 0;
      v.kind = kind;
      v.cruise = (r.cls <= 1 ? 17 : r.cls <= 3 ? 12 : 9) * (0.8 + spawnRand() * 0.4) * (kind === 5 ? 0.6 : 1);
      v.speed = v.cruise;
      const lanes = Math.max(1, Math.round(r.width / 3.5 / (r.oneway ? 1 : 2)));
      v.lane = Math.floor(spawnRand() * lanes);
      return true;
    }
    return false;
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const f = worldState.focus;
    const pl = worldState.player;
    timer.current -= dt;
    const vs = vehicles.current;
    if (timer.current <= 0) {
      timer.current = 0.25;
      let spawned = 0;
      for (const v of vs) {
        if (v.active && Math.hypot(v.x - f.x, v.z - f.z) > 560) v.active = false;
        if (!v.active && spawned < 3) {
          if (spawn(v, f.x, f.z)) spawned++;
        }
      }
    }
    const counts = [0, 0, 0, 0, 0, 0];
    let honk = false;
    for (const v of vs) {
      if (!v.active || !v.road) continue;
      const r = v.road;
      const n = r.pts.length / 2;
      // advance
      const toPlayer = Math.hypot(v.x - pl.x, v.z - pl.z);
      const ahead = (pl.x - v.x) * Math.sin(v.rot) + (pl.z - v.z) * Math.cos(v.rot);
      const blocked = toPlayer < 9 && ahead > 0 && Math.abs(pl.y - v.y) < 2;
      const target = blocked ? 0 : v.cruise;
      v.speed += (target - v.speed) * Math.min(1, dt * (blocked ? 4 : 0.8));
      if (blocked && toPlayer < 6 && Math.random() < dt * 0.5) honk = true;
      let move = v.speed * dt;
      while (move > 0 && v.active) {
        const L = segLen(r, v.seg);
        const remain = v.dir === 1 ? L - v.t : v.t;
        if (move < remain) {
          v.t += move * v.dir;
          move = 0;
        } else {
          move -= remain;
          if (v.dir === 1) {
            v.seg++;
            if (v.seg >= n - 1) { v.active = false; break; }
            v.t = 0;
          } else {
            v.seg--;
            if (v.seg < 0) { v.active = false; break; }
            v.t = segLen(r, v.seg);
          }
        }
      }
      if (!v.active) continue;
      const L = segLen(r, v.seg) || 1;
      const a = v.seg, b = v.seg + 1;
      const k = v.t / L;
      const ax = r.pts[a * 2], az = r.pts[a * 2 + 1], bx = r.pts[b * 2], bz = r.pts[b * 2 + 1];
      let dx = (bx - ax) / L, dz = (bz - az) / L;
      if (v.dir === -1) { dx = -dx; dz = -dz; }
      // drive on the right: lanes are offset to the right of the travel direction (x east, z south)
      const laneW = 3.4;
      const rx = -dz, rz = dx;
      const off = r.oneway ? Math.min(r.width / 2 - 1.2, -r.width / 2 + laneW * (v.lane + 0.5)) : Math.min(r.width / 2 - 1.2, laneW * (v.lane + 0.5));
      const x = ax + (bx - ax) * k + rx * off;
      const z = az + (bz - az) * k + rz * off;
      const h = r.h ? r.h[a] + (r.h[b] - r.h[a]) * k : 0;
      v.x = x; v.z = z; v.y = h + 0.03;
      const rot = Math.atan2(dx, dz);
      let dr = rot - v.rot;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      v.rot += dr * Math.min(1, dt * 8);
      const mesh = meshes[v.kind];
      const i = counts[v.kind]++;
      q.setFromAxisAngle(up, v.rot);
      p.set(v.x, v.y, v.z);
      m4.compose(p, q, one);
      mesh.setMatrixAt(i, m4);
    }
    meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
    if (honk) audio.honk();
  });

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
