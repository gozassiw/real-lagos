// Streams the real-Lagos map around the player: 500 m chunks of OSM buildings / minor roads / walls / trees,
// built in a Web Worker, plus the always-loaded major road network and rail lines. Nearby chunks also get
// Rapier colliders (building walls, bridge decks + parapets).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { mapData, DATA_BASE } from '../map/mapData';
import { buildRoads, type ChunkBuild, type RoadIn } from '../map/geometry';
import { materials } from '../map/materials';
import { toGeometry, palmGeometry, broadleafGeometry, roundTreeGeometry, mangroveGeometry, streetLightGeometry, waterTankGeometry, domeGeometry, powerPoleGeometry, kioskGeometry, carGeometry, kekeGeometry, umbrellaGeometry } from '../map/props';
import { worldState } from '../worldState';
import { useGame } from '../../store/gameStore';

interface ChunkObj {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
  detail: THREE.Object3D[]; // hidden when far
  casters: THREE.Object3D[]; // cast shadows only when close (the sun's shadow box is ~140 m)
  shadowOn: boolean;
  colliderData: { v: Float32Array; i: Uint32Array }[];
  colliders: unknown[];
  roadLines: ChunkBuild['roadLines'];
  dispose: () => void;
}

const sharedGeo = () => ({
  trees: [palmGeometry(), broadleafGeometry(), roundTreeGeometry(), mangroveGeometry()],
  lamp: streetLightGeometry(),
  tankBlack: waterTankGeometry('#1e1e20'),
  tankBlue: waterTankGeometry('#2d5fa0'),
  dome: domeGeometry(),
  // street props by kind id (see geometry.ts streetProps)
  props: [
    powerPoleGeometry(),
    kioskGeometry('#2a6fb0'),
    kioskGeometry('#c8452f'),
    kioskGeometry('#2f8f4e'),
    kioskGeometry('#e0a526'),
    carGeometry('#8a8f96'),
    kekeGeometry(),
    umbrellaGeometry('#d9412b'),
  ],
});
let SG: ReturnType<typeof sharedGeo> | null = null;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: number[], stride: number, fn: (i: number) => { x: number; y: number; z: number; s: number; r: number; tint?: THREE.Color }) {
  const n = Math.floor(list.length / stride);
  if (!n) return null;
  const im = new THREE.InstancedMesh(geo, mat, n);
  for (let i = 0; i < n; i++) {
    const p = fn(i);
    tmpQ.setFromAxisAngle(UP, p.r);
    tmpS.set(p.s, p.s, p.s);
    tmpP.set(p.x, p.y, p.z);
    tmpM.compose(tmpP, tmpQ, tmpS);
    im.setMatrixAt(i, tmpM);
    if (p.tint) im.setColorAt(i, p.tint);
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = false;
  im.receiveShadow = false;
  return im;
}

export function LagosMap() {
  const root = useRef<THREE.Group>(null!);
  const { world, rapier } = useRapier();
  const { gl } = useThree();
  const quality = useGame((s) => s.lowPower);
  const mats = useMemo(() => materials(), []);
  if (!SG) SG = sharedGeo();
  const sg = SG;

  // ---- static: major roads (1 km tiles), rail, streetlights
  const statics = useMemo(() => {
    const TILE = 1000;
    const tiles = new Map<string, RoadIn[]>();
    // split every road into per-tile pieces (sharing the boundary vertex) so distance culling works for
    // long roads such as the Third Mainland Bridge
    const put = (k: string, r: (typeof mapData.majorRoads)[number], i0: number, i1: number) => {
      if (i1 <= i0) return;
      let a = tiles.get(k);
      if (!a) tiles.set(k, (a = []));
      a.push({ cls: r.cls, width: r.width, oneway: r.oneway, bridge: r.bridge, link: r.link, pts: r.pts.slice(i0 * 2, i1 * 2 + 2), h: r.h ? r.h.slice(i0, i1 + 1) : null });
    };
    for (const r of mapData.majorRoads) {
      const n = r.pts.length / 2;
      const tileOf = (i: number) => {
        const mx = (r.pts[i * 2] + r.pts[i * 2 + 2]) / 2, mz = (r.pts[i * 2 + 1] + r.pts[i * 2 + 3]) / 2;
        return `${Math.floor(mx / TILE)},${Math.floor(mz / TILE)}`;
      };
      let start = 0;
      let cur = tileOf(0);
      for (let i = 1; i < n - 1; i++) {
        const k = tileOf(i);
        if (k !== cur) {
          put(cur, r, start, i);
          start = i;
          cur = k;
        }
      }
      put(cur, r, start, n - 1);
    }
    const group = new THREE.Group();
    group.name = 'major-roads';
    const lampTiles: { mesh: THREE.InstancedMesh; cx: number; cz: number }[] = [];
    const roadTiles: { objs: THREE.Object3D[]; cx: number; cz: number }[] = [];
    const colliders: { v: Float32Array; i: Uint32Array }[] = [];
    for (const [k, roads] of tiles) {
      const b = buildRoads(roads, { lamps: true });
      const surf = new THREE.Mesh(toGeometry(b.surface, 'aLayer'), mats.road);
      surf.receiveShadow = true;
      surf.name = 'roads-' + k;
      group.add(surf);
      const [tx, tz] = k.split(',').map(Number);
      const tile = { objs: [surf] as THREE.Object3D[], cx: (tx + 0.5) * TILE, cz: (tz + 0.5) * TILE };
      roadTiles.push(tile);
      if (b.bridge.index.length) {
        const br = new THREE.Mesh(toGeometry(b.bridge), mats.bridge);
        br.castShadow = true;
        br.receiveShadow = true;
        group.add(br);
        tile.objs.push(br);
      }
      if (b.collider) colliders.push({ v: b.collider.vertices, i: b.collider.indices });
      const im = instanced(sg.lamp, mats.plain, b.lamps, 4, (i) => ({ x: b.lamps[i * 4], y: b.lamps[i * 4 + 1], z: b.lamps[i * 4 + 2], s: 1, r: b.lamps[i * 4 + 3] }));
      if (im) {
        const [cx, cz] = k.split(',').map(Number);
        im.visible = false;
        group.add(im);
        lampTiles.push({ mesh: im, cx: (cx + 0.5) * TILE, cz: (cz + 0.5) * TILE });
      }
    }
    // rail: ballast strip + two rails
    const railRoads: RoadIn[] = mapData.rail.map((r) => ({ cls: 10, width: 3.4, oneway: true, bridge: r.bridge, pts: r.pts, h: r.h }));
    if (railRoads.length) {
      const rb = buildRoads(railRoads.map((r) => ({ ...r, cls: 9, width: 3.6 })));
      const rm = new THREE.Mesh(toGeometry(rb.surface, 'aLayer'), mats.road);
      rm.receiveShadow = true;
      group.add(rm);
      for (const off of [-0.72, 0.72]) {
        const rails = buildRoads(
          mapData.rail.map((r) => {
            const pts = new Float32Array(r.pts.length);
            const n = r.pts.length / 2;
            for (let i = 0; i < n; i++) {
              const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1);
              const dx = r.pts[c * 2] - r.pts[a * 2], dz = r.pts[c * 2 + 1] - r.pts[a * 2 + 1];
              const l = Math.hypot(dx, dz) || 1;
              pts[i * 2] = r.pts[i * 2] - (dz / l) * off;
              pts[i * 2 + 1] = r.pts[i * 2 + 1] + (dx / l) * off;
            }
            return { cls: 7, width: 0.14, oneway: true, bridge: false, pts, h: r.h ? r.h.map((v) => v + 0.12) : null };
          }),
        );
        const m = new THREE.Mesh(toGeometry(rails.surface, 'aLayer'), mats.road);
        const cAttr = m.geometry.attributes.color as THREE.BufferAttribute;
        for (let i = 0; i < cAttr.count; i++) cAttr.setXYZ(i, 0.25, 0.25, 0.27);
        group.add(m);
      }
      if (rb.bridge.index.length) group.add(new THREE.Mesh(toGeometry(rb.bridge), mats.bridge));
      if (rb.collider) colliders.push({ v: rb.collider.vertices, i: rb.collider.indices });
    }
    return { group, lampTiles, roadTiles, colliders };
  }, [mats, sg]);

  // bridge colliders for the whole network (static)
  useEffect(() => {
    const created = statics.colliders.map((c) => world.createCollider(rapier.ColliderDesc.trimesh(c.v, c.i)));
    return () => {
      for (const c of created) world.removeCollider(c, false);
    };
  }, [statics, world, rapier]);

  // ---- streamed chunks
  const state = useRef({
    chunks: new Map<string, ChunkObj>(),
    pending: new Set<string>(),
    worker: null as Worker | null,
    lastScan: 0,
    focus: new THREE.Vector3(),
  });

  useEffect(() => {
    const w = new Worker(new URL('../map/chunkWorker.ts', import.meta.url), { type: 'module' });
    state.current.worker = w;
    w.onmessage = (e: MessageEvent<{ key: string; ok: boolean; out?: ChunkBuild; error?: string }>) => {
      const st = state.current;
      st.pending.delete(e.data.key);
      if (!e.data.ok || !e.data.out) {
        console.warn('chunk failed', e.data.key, e.data.error);
        return;
      }
      if (st.chunks.has(e.data.key)) return;
      const obj = makeChunk(e.data.out);
      st.chunks.set(obj.key, obj);
      root.current.add(obj.group);
      worldState.roadLines.set(obj.key, obj.roadLines);
    };
    const st = state.current;
    return () => {
      w.terminate();
      for (const c of st.chunks.values()) {
        for (const col of c.colliders) world.removeCollider(col as never, false);
        c.dispose();
      }
      st.chunks.clear();
      st.pending.clear();
      worldState.roadLines.clear();
    };
  }, [world]);

  function makeChunk(out: ChunkBuild): ChunkObj {
    const [cx, cz] = out.key.split(',').map(Number);
    const group = new THREE.Group();
    group.name = 'chunk-' + out.key;
    const detail: THREE.Object3D[] = [];
    const casters: THREE.Object3D[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const add = (o: THREE.Object3D, isDetail = false) => {
      group.add(o);
      if (isDetail) detail.push(o);
      if ((o as THREE.Mesh).geometry && !(o as THREE.InstancedMesh).isInstancedMesh) geos.push((o as THREE.Mesh).geometry);
    };
    if (out.buildings.walls.index.length) {
      const m = new THREE.Mesh(toGeometry(out.buildings.walls, 'aCell'), mats.walls);
      m.receiveShadow = true;
      casters.push(m);
      add(m);
    }
    if (out.buildings.roofs.index.length) {
      const m = new THREE.Mesh(toGeometry(out.buildings.roofs), mats.roofs);
      m.receiveShadow = true;
      casters.push(m);
      add(m);
    }
    if (out.roads.surface.index.length) {
      const m = new THREE.Mesh(toGeometry(out.roads.surface, 'aLayer'), mats.road);
      m.receiveShadow = true;
      add(m);
    }
    if (out.roads.bridge.index.length) add(new THREE.Mesh(toGeometry(out.roads.bridge), mats.bridge));
    if (out.walls.index.length) {
      const m = new THREE.Mesh(toGeometry(out.walls), mats.barriers);
      m.receiveShadow = true;
      add(m, true);
    }
    // trees
    const kinds = [0, 1, 2, 3];
    const tint = new THREE.Color();
    for (const k of kinds) {
      const idx: number[] = [];
      for (let i = 0; i < out.trees.length; i += 5) {
        if (out.trees[i + 2] === k) idx.push(i);
      }
      if (!idx.length) continue;
      const im = instanced(sg.trees[k], mats.plain, idx, 1, (j) => {
        const i = idx[j];
        const v = 0.85 + ((i * 7919) % 100) / 400;
        tint.setRGB(v, v, v * 0.95);
        return { x: out.trees[i], y: 0, z: out.trees[i + 1], s: out.trees[i + 3], r: out.trees[i + 4], tint };
      });
      if (im) {
        casters.push(im);
        add(im, true);
      }
    }
    // roof tanks & domes
    const tk = out.buildings.tanks;
    for (const kind of [0, 1]) {
      const idx: number[] = [];
      for (let i = 0; i < tk.length; i += 4) if (tk[i + 3] === kind) idx.push(i);
      const im = instanced(kind ? sg.tankBlue : sg.tankBlack, mats.plain, idx, 1, (j) => ({ x: tk[idx[j]], y: tk[idx[j] + 1], z: tk[idx[j] + 2], s: 0.9, r: idx[j] }));
      if (im) add(im, true);
    }
    // street furniture
    for (let kind = 0; kind < sg.props.length; kind++) {
      const idx: number[] = [];
      for (let i = 0; i < out.props.length; i += 4) if (out.props[i + 3] === kind) idx.push(i);
      const im = instanced(sg.props[kind], mats.plain, idx, 1, (j) => ({ x: out.props[idx[j]], y: 0, z: out.props[idx[j] + 1], s: 1, r: out.props[idx[j] + 2] }));
      if (im) add(im, true);
    }
    const dm = out.buildings.domes;
    const dIm = instanced(sg.dome, mats.plain, dm, 4, (i) => ({ x: dm[i * 4], y: dm[i * 4 + 1], z: dm[i * 4 + 2], s: dm[i * 4 + 3], r: 0 }));
    if (dIm) add(dIm);

    const colliderData = [{ v: out.buildings.collider.vertices, i: out.buildings.collider.indices }];
    if (out.roads.collider) colliderData.push({ v: out.roads.collider.vertices, i: out.roads.collider.indices });
    return {
      key: out.key,
      cx: (cx + 0.5) * 500,
      cz: (cz + 0.5) * 500,
      group,
      detail,
      casters,
      shadowOn: false,
      colliderData,
      colliders: [],
      roadLines: out.roadLines,
      dispose() {
        for (const g of geos) g.dispose();
        group.traverse((o) => {
          if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        });
      },
    };
  }

  useFrame((_, dt) => {
    const st = state.current;
    const focus = worldState.focus;
    st.lastScan -= dt;
    const low = quality;
    const LOAD_R = low ? 620 : 820;
    const DETAIL_R = low ? 220 : 320;
    const PHYS_R = 260;
    if (st.lastScan <= 0 && st.worker) {
      st.lastScan = 0.35;
      const C = mapData.manifest.chunkSize;
      const want: { key: string; d: number; cx: number; cz: number }[] = [];
      const r = Math.ceil(LOAD_R / C);
      const fcx = Math.floor(focus.x / C), fcz = Math.floor(focus.z / C);
      for (let i = -r; i <= r; i++)
        for (let j = -r; j <= r; j++) {
          const key = `${fcx + i},${fcz + j}`;
          if (!mapData.manifest.chunks[key]) continue;
          const cx = (fcx + i + 0.5) * C, cz = (fcz + j + 0.5) * C;
          const d = Math.hypot(cx - focus.x, cz - focus.z) - C * 0.7;
          if (d < LOAD_R) want.push({ key, d, cx: fcx + i, cz: fcz + j });
        }
      want.sort((a, b) => a.d - b.d);
      for (const w of want) {
        if (st.pending.size >= 3) break;
        if (st.chunks.has(w.key) || st.pending.has(w.key)) continue;
        st.pending.add(w.key);
        st.worker.postMessage({ key: w.key, url: `${new URL(DATA_BASE, location.href).href}chunks/${w.cx}_${w.cz}.json`, ox: w.cx * C, oz: w.cz * C });
      }
      // unload far chunks, toggle detail + physics
      for (const [k, c] of st.chunks) {
        const d = Math.hypot(c.cx - focus.x, c.cz - focus.z) - C * 0.7;
        if (d > LOAD_R + 200) {
          for (const col of c.colliders) world.removeCollider(col as never, false);
          root.current.remove(c.group);
          c.dispose();
          st.chunks.delete(k);
          worldState.roadLines.delete(k);
          continue;
        }
        const showDetail = d < DETAIL_R;
        for (const o of c.detail) o.visible = showDetail;
        const shadow = !low && d < 60;
        if (shadow !== c.shadowOn) {
          c.shadowOn = shadow;
          for (const o of c.casters) o.castShadow = shadow;
        }
        const needPhys = d < PHYS_R;
        if (needPhys && !c.colliders.length) {
          c.colliders = c.colliderData.filter((cd) => cd.i.length).map((cd) => world.createCollider(rapier.ColliderDesc.trimesh(cd.v, cd.i)));
        } else if (!needPhys && c.colliders.length) {
          for (const col of c.colliders) world.removeCollider(col as never, false);
          c.colliders = [];
        }
      }
      for (const lt of statics.lampTiles) lt.mesh.visible = Math.hypot(lt.cx - focus.x, lt.cz - focus.z) < (low ? 600 : 850);
      // major roads: tiles out in the haze are hidden (long bridges are split into several tiles anyway)
      const roadR = (low ? 1300 : 1800) + (worldState.riding ? 600 : 0);
      for (const rt of statics.roadTiles) {
        const vis = Math.hypot(rt.cx - focus.x, rt.cz - focus.z) < roadR;
        for (const o of rt.objs) o.visible = vis;
      }
      worldState.loadedChunks = st.chunks.size;
      worldState.pendingChunks = st.pending.size;
    }
  });

  void gl;
  return (
    <group>
      <primitive object={statics.group} />
      <group ref={root} />
    </group>
  );
}
