// Danfo fast travel: the bus drives the real road route (time-compressed) with an aerial chase camera, so a
// Yaba -> Lagos Island trip actually crosses the lagoon on the bridge. Skippable.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { danfoGeometry } from './map/props';
import { materials } from './map/materials';
import { route, type Route } from './map/routing';
import { worldState } from './worldState';
import { useGame, naira } from '../store/gameStore';
import { gameplay, fade, type GamePoi } from './gameplay';
import { mapData } from './map/mapData';

interface Ride {
  to: GamePoi;
  r: Route;
  s: number;
  seg: number;
  segStart: number;
  duration: number;
  t: number;
  skip: boolean;
}

let current: Ride | null = null;

export function startRide(from: GamePoi, to: GamePoi, fare: number) {
  const g = useGame.getState();
  if (!g.spend(fare, 'the danfo fare')) return false;
  const crossRegion = mapData.regionAt(from.x, from.z) !== mapData.regionAt(to.x, to.z);
  const r = crossRegion ? null : route(from.x, from.z, to.x, to.z);
  if (!r) {
    // Ikeja is a separate map chunk: the ride between districts happens off-screen
    g.patch({ stats: { ...g.stats, rides: g.stats.rides + 1 } });
    g.toast(`Paid ${naira(fare)} · the danfo takes Ikorodu Road to ${to.zone}…`, 'info');
    fade(() => {
      worldState.teleport = { x: to.x, z: to.z, y: 0.1, heading: to.heading ?? 0 };
      useGame.getState().savePlayer({ x: to.x, z: to.z, y: 0.1, heading: to.heading ?? 0, region: 'world' });
      setTimeout(() => useGame.getState().toast(`Welcome to ${to.zone}!`, 'good'), 600);
    });
    return true;
  }
  current = { to, r, s: 0, seg: 0, segStart: 0, duration: THREE.MathUtils.clamp(r.length / 260, 14, 40), t: 0, skip: false };
  worldState.riding = true;
  g.patch({ ride: { from: from.name, to: to.name, fare }, stats: { ...g.stats, rides: g.stats.rides + 1 }, nearby: null });
  g.toast(`Paid ${naira(fare)} · ${from.zone} → ${to.zone}`, 'info');
  return true;
}

export function skipRide() {
  if (current) current.skip = true;
}

export function DanfoRide() {
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(danfoGeometry(), materials().plain);
    m.castShadow = true;
    m.visible = false;
    return m;
  }, []);
  const prog = useRef(0);

  useFrame((_, dt) => {
    const R = current;
    if (!R) {
      mesh.visible = false;
      return;
    }
    const p = R.r.pts;
    const n = p.length / 3;
    R.t += Math.min(dt, 0.05);
    // ease in/out over the ride duration
    const u = THREE.MathUtils.clamp(R.t / R.duration, 0, 1);
    const eased = u < 0.1 ? (u / 0.1) ** 2 * 0.05 : u > 0.9 ? 1 - ((1 - u) / 0.1) ** 2 * 0.05 : 0.05 + ((u - 0.1) / 0.8) * 0.9;
    const target = eased * R.r.length;
    while (R.seg < n - 2) {
      const L = Math.hypot(p[(R.seg + 1) * 3] - p[R.seg * 3], p[(R.seg + 1) * 3 + 2] - p[R.seg * 3 + 2]);
      if (R.segStart + L >= target) break;
      R.segStart += L;
      R.seg++;
    }
    const a = R.seg, b = Math.min(n - 1, R.seg + 1);
    const L = Math.hypot(p[b * 3] - p[a * 3], p[b * 3 + 2] - p[a * 3 + 2]) || 1;
    const k = THREE.MathUtils.clamp((target - R.segStart) / L, 0, 1);
    const x = p[a * 3] + (p[b * 3] - p[a * 3]) * k;
    const y = p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * k;
    const z = p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * k;
    const heading = Math.atan2(p[b * 3] - p[a * 3], p[b * 3 + 2] - p[a * 3 + 2]);
    let dh = heading - worldState.rideHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    worldState.rideHeading += dh * Math.min(1, dt * 5);
    worldState.ridePos.set(x, y, z);
    worldState.focus.set(x, y, z);
    mesh.position.set(x - Math.cos(worldState.rideHeading) * 1.7, y + 0.03, z + Math.sin(worldState.rideHeading) * 1.7);
    mesh.rotation.y = worldState.rideHeading;
    mesh.visible = true;
    prog.current += dt;
    if (prog.current > 0.4) {
      prog.current = 0;
      const g = useGame.getState();
      const area = mapData.areaName(x, z);
      if (area) g.setArea(area);
      const road = mapData.nearestMajorRoad(x, z, 30);
      g.patch({ ride: g.ride ? { ...g.ride, from: road?.road.name || g.ride.from } : null });
    }
    if (u >= 1 || R.skip) {
      const to = R.to;
      current = null;
      const finish = () => {
        worldState.riding = false;
        worldState.teleport = { x: to.x, z: to.z, y: 0.1, heading: to.heading ?? 0 };
        const g = useGame.getState();
        g.savePlayer({ x: to.x, z: to.z, y: 0.1, heading: to.heading ?? 0, region: 'world' });
        g.patch({ ride: null });
        g.toast(`Welcome to ${to.zone}!`, 'good');
      };
      if (R.skip) fade(finish);
      else finish();
    }
  });

  void gameplay;
  return <primitive object={mesh} />;
}
