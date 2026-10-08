// Proximity detection for gameplay POIs + their in-world markers (light beams + floating signs).
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { gameplay, describe, perform, interiorInteraction, KIND_COLOR, type GamePoi } from './gameplay';
import { worldState } from './worldState';
import { consumeInteract } from './input';
import { useGame, QUEST_STEPS } from '../store/gameStore';
import { mapData } from './map/mapData';

const RADIUS = 4.2;

export function questTarget(): GamePoi | null {
  const g = useGame.getState();
  const step = QUEST_STEPS[g.quest]?.id;
  const kinds: Record<string, GamePoi['kind'][]> = { 'find-work': ['work'], earn: ['work'], eat: ['eat'], social: ['social'] };
  const ks = kinds[step];
  if (!ks) return null;
  const p = worldState.player;
  let best: GamePoi | null = null, bd = Infinity;
  for (const q of gameplay.pois) {
    if (!ks.includes(q.kind)) continue;
    // the social quest specifically wants the Lekki lounge-type spot
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

export function InteractionSystem() {
  const t = useRef(0);
  useFrame((_, dt) => {
    const g = useGame.getState();
    const p = worldState.player;
    t.current += dt;
    // area label (district from OSM place nodes)
    if (t.current > 0.5) {
      t.current = 0;
      if (g.player?.region === 'interior') g.setArea('Home');
      else if (!worldState.riding) g.setArea(mapData.areaName(p.x, p.z));
      // "find work" completes when the player reaches any job
      if (QUEST_STEPS[g.quest]?.id === 'find-work') {
        for (const q of gameplay.pois) if (q.kind === 'work' && Math.hypot(q.x - p.x, q.z - p.z) < 25) g.completeQuest('find-work');
      }
    }
    let near: ReturnType<typeof describe> | null = null;
    if (!worldState.riding) {
      if (g.player?.region === 'interior') near = interiorInteraction(p.x, p.z);
      else {
        let bd = RADIUS;
        for (const q of gameplay.pois) {
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bd && Math.abs(p.y - 0) < 3) { bd = d; near = describe(q); }
        }
      }
    }
    g.setNearby(near);
    if (consumeInteract() && near && !g.busy && !g.ui) perform(near);
  });
  return <Markers />;
}

const ICON: Record<GamePoi['kind'], string> = { work: '💼', eat: '🍲', shop: '🛍️', social: '🎶', home: '🏠', danfo: '🚌' };

function Markers() {
  const pois = gameplay.pois;
  const beamGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.9, 0.9, 60, 12, 1, true);
    g.translate(0, 30, 0);
    return g;
  }, []);
  const ringGeo = useMemo(() => new THREE.RingGeometry(1.6, 2.1, 32).rotateX(-Math.PI / 2), []);
  const mats = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(KIND_COLOR).map(([k, c]) => [
          k,
          {
            beam: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }),
            ring: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false }),
          },
        ]),
      ) as Record<string, { beam: THREE.Material; ring: THREE.Material }>,
    [],
  );
  const refs = useRef<(THREE.Group | null)[]>([]);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  useFrame(({ clock }) => {
    const p = worldState.player;
    const target = questTarget();
    pois.forEach((q, i) => {
      const grp = refs.current[i];
      if (!grp) return;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      grp.visible = d < 1800;
      const beam = grp.children[0] as THREE.Mesh;
      beam.scale.set(1, d < 30 ? 0.08 : 1, 1);
      beam.visible = d > 12;
      const ring = grp.children[1] as THREE.Mesh;
      ring.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3 + i) * 0.06);
      const lab = labels.current[i];
      if (lab) {
        const show = d > 9 && d < 75 && !useGame.getState().ui;
        lab.style.opacity = show ? '1' : '0';
        lab.dataset.target = target?.id === q.id ? '1' : '0';
      }
    });
  });
  return (
    <group>
      {pois.map((q, i) => (
        <group key={q.id} position={[q.x, 0.06, q.z]} ref={(el) => { refs.current[i] = el; }}>
          <mesh geometry={beamGeo} material={mats[q.kind].beam} renderOrder={5} />
          <mesh geometry={ringGeo} material={mats[q.kind].ring} renderOrder={4} />
          <Html position={[0, 3.6, 0]} center distanceFactor={12} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div className="poi-tag" ref={(el) => { labels.current[i] = el; }} style={{ ['--k' as string]: KIND_COLOR[q.kind] }}>
              <span className="poi-icon">{ICON[q.kind]}</span>
              <span className="poi-name">{q.name}</span>
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}
