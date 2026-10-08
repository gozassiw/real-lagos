// A few animated locals around the gameplay spots (sellers, office workers, dancers, danfo conductors).
// Spawned only when the player is near, so only a handful of skinned meshes exist at once.
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loadRig, createAvatar, type AvatarInstance, type Rig } from '../avatar/rig';
import { AVATAR_PRESETS, type AvatarLook } from '../avatar/buildAvatar';
import { gameplay, type GamePoi } from '../gameplay';
import { worldState } from '../worldState';

const RIG_URL = `${import.meta.env.BASE_URL}models/rig.glb`;
const NEAR = 110, FAR = 150;

const TOPS = ['#e2702a', '#1b8a8c', '#7b2a6e', '#2f8f4e', '#e0a526', '#c8452f', '#2a4fb0', '#f1ede4', '#8a2342'];
const SKINS = ['#6b4430', '#7a4e35', '#4a2f20', '#5a3a26', '#3d271b'];

function lookFor(seed: number, role: string): AvatarLook {
  const base = AVATAR_PRESETS[seed % AVATAR_PRESETS.length].look;
  const r = (k: number) => (seed * 9301 + k * 49297) % 233280 / 233280;
  const office = role === 'office';
  return {
    ...base,
    skin: SKINS[Math.floor(r(1) * SKINS.length)],
    top: office ? (r(2) < 0.5 ? '#f4f4f0' : '#cfe0ef') : TOPS[Math.floor(r(2) * TOPS.length)],
    topAccent: TOPS[Math.floor(r(3) * TOPS.length)],
    bottom: office ? '#23283a' : base.bottom,
    outfit: office ? 'shirt' : base.outfit,
    print: office ? false : r(4) < 0.45,
  };
}

interface Spot { poi: GamePoi; npcs: { inst: AvatarInstance; clip: string }[]; group: THREE.Group }

function layout(p: GamePoi): { dx: number; dz: number; rot: number; clip: string; role: string }[] {
  switch (p.kind) {
    case 'social':
      return [
        { dx: 2.4, dz: 1.2, rot: -2.2, clip: 'dance', role: '' },
        { dx: -2.2, dz: 1.8, rot: 2.4, clip: 'dance', role: '' },
        { dx: 0.6, dz: 3.2, rot: 3.1, clip: 'dance', role: '' },
        { dx: -3.4, dz: 0.6, rot: 1.4, clip: 'idle', role: '' },
      ];
    case 'shop':
      return [
        { dx: 2.2, dz: 1.4, rot: -0.6, clip: 'idle', role: '' },
        { dx: -2.6, dz: 1.0, rot: 0.6, clip: 'nod', role: '' },
        { dx: 3.6, dz: 1.6, rot: -1.6, clip: 'idle', role: '' },
      ];
    case 'eat':
      return [
        { dx: 1.8, dz: 1.6, rot: -0.4, clip: 'idle', role: '' },
        { dx: -2.4, dz: 0.8, rot: 1.8, clip: 'nod', role: '' },
      ];
    case 'work':
      return [
        { dx: 2.4, dz: 0.8, rot: -1.2, clip: 'idle', role: 'office' },
        { dx: -2.2, dz: 1.6, rot: 0.8, clip: 'nod', role: 'office' },
      ];
    case 'danfo':
      return [{ dx: 2.2, dz: 0.4, rot: -1.6, clip: 'nod', role: '' }];
    default:
      return [];
  }
}

export function Npcs() {
  const root = useRef<THREE.Group>(null!);
  const rig = useRef<Rig | null>(null);
  const spots = useRef(new Map<string, Spot>());
  const t = useRef(0);

  useEffect(() => {
    loadRig(RIG_URL).then((r) => (rig.current = r));
    const s = spots.current;
    return () => {
      for (const sp of s.values()) sp.npcs.forEach((n) => n.inst.dispose());
      s.clear();
    };
  }, []);

  useFrame((_, dt) => {
    const p = worldState.player;
    t.current -= dt;
    if (t.current <= 0 && rig.current) {
      t.current = 0.6;
      for (const poi of gameplay.pois) {
        const d = Math.hypot(poi.x - p.x, poi.z - p.z);
        const have = spots.current.get(poi.id);
        if (d < NEAR && !have) {
          const group = new THREE.Group();
          group.position.set(poi.x, 0, poi.z);
          group.rotation.y = poi.heading ?? 0;
          const npcs = layout(poi).map((l, i) => {
            const inst = createAvatar(rig.current!, lookFor(poi.id.length * 13 + i * 7 + poi.name.length, l.role));
            inst.root.position.set(l.dx, 0.02, l.dz);
            inst.root.rotation.y = l.rot;
            inst.root.traverse((o) => (o.castShadow = true));
            inst.play(l.clip, 0);
            inst.mixer.setTime(i * 1.37);
            group.add(inst.root);
            return { inst, clip: l.clip };
          });
          root.current.add(group);
          spots.current.set(poi.id, { poi, npcs, group });
        } else if (d > FAR && have) {
          have.npcs.forEach((n) => n.inst.dispose());
          root.current.remove(have.group);
          spots.current.delete(poi.id);
        }
      }
    }
    for (const sp of spots.current.values())
      for (const n of sp.npcs) {
        n.inst.mixer.update(dt);
      }
  });
  return <group ref={root} />;
}
