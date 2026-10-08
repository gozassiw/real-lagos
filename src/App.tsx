import { useEffect, useMemo, useState } from 'react';
import { GameCanvas } from './game/GameCanvas';
import { Hud } from './ui/Hud';
import { LoadingScreen } from './ui/LoadingScreen';
import { mapData } from './game/map/mapData';
import { loadGameplay, gameplay } from './game/gameplay';
import { loadRig } from './game/avatar/rig';
import { installKeyboard, input } from './game/input';
import { useGame } from './store/gameStore';
import { audio } from './game/audio';
import { INTERIOR } from './game/interiorLayout';
import { worldState } from './game/worldState';

// debugging / automated QA hook
(window as unknown as { __lagos: () => unknown }).__lagos = () => {
  const g = useGame.getState();
  const p = worldState.player;
  return {
    player: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
    heading: +worldState.playerHeading.toFixed(2),
    speed: +worldState.playerSpeed.toFixed(2),
    chunks: worldState.loadedChunks,
    pending: worldState.pendingChunks,
    area: g.area,
    nearby: g.nearby?.id ?? null,
    cash: g.cash,
    energy: Math.round(g.energy),
    hunger: Math.round(g.hunger),
    xp: g.xp,
    quest: g.quest,
    fps: g.fps,
    lowPower: g.lowPower,
    riding: worldState.riding,
    sdf: +mapData.sdf(p.x, p.z).toFixed(1),
    render: worldState.render,
    dbg: (worldState as unknown as { dbg: unknown }).dbg,
    ground: (() => {
      const sc = (window as unknown as { __scene?: import('three').Scene }).__scene;
      const g = sc?.getObjectByName('ground-core') as import('three').Mesh | undefined;
      if (!g) return 'missing';
      const m = g.material as import('three').Material & { program?: unknown };
      return { visible: g.visible, inScene: !!g.parent, pos: g.position.toArray(), bbox: g.geometry.boundingBox?.min.toArray(), mat: m.type, version: m.version };
    })(),
  };
};

// QA: triangle budget by object kind (visible objects only)
(window as unknown as { __lagosTris: () => Record<string, number> }).__lagosTris = () => {
  const sc = (window as unknown as { __scene?: import('three').Scene }).__scene;
  const out: Record<string, number> = {};
  sc?.traverseVisible((o) => {
    const m = o as import('three').Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const inst = (o as import('three').InstancedMesh).isInstancedMesh ? (o as import('three').InstancedMesh).count : 1;
    let k = o.parent?.name?.startsWith('chunk-') ? (inst > 1 || (o as import('three').InstancedMesh).isInstancedMesh ? 'chunk-instanced' : (Array.isArray(m.material) ? 'mat' : (m.material as import('three').Material).type) + ':' + (g.attributes.aCell ? 'walls' : g.attributes.aLayer ? 'roads' : 'other')) : o.parent?.name || o.name || o.type;
    if ((o as import('three').InstancedMesh).isInstancedMesh && o.parent?.name?.startsWith('chunk-')) k = 'inst:' + g.attributes.position.count;
    out[k] = (out[k] || 0) + tris * inst;
  });
  return out;
};
(window as unknown as { __lagosTp: (x: number, z: number, y?: number) => void }).__lagosTp = (x, z, y) => {
  worldState.teleport = { x, z, y };
};

export function App() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState({ p: 0, label: 'Starting' });
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      mapData.load((p, label) => alive && setProgress({ p, label })),
      loadGameplay(),
      loadRig(`${import.meta.env.BASE_URL}models/rig.glb`),
    ])
      .then(() => {
        if (!alive) return;
        setProgress({ p: 1, label: 'Oya, enter Lagos' });
        setPhase('ready');
        useGame.getState().patch({ ready: true, lowPower: useGame.getState().settings.quality === 'low' || new URLSearchParams(location.search).has('lite') });
      })
      .catch((e) => {
        console.error(e);
        if (alive) {
          setError(String(e?.message || e));
          setPhase('error');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // keyboard shortcuts + first-gesture audio start
  useEffect(() => {
    const off = installKeyboard((code) => {
      const g = useGame.getState();
      if (code === 'KeyM') g.setUi(g.ui === 'map' ? null : 'map');
      if (code === 'Escape') g.setUi(null);
      if (code === 'KeyR') input.runToggle = !input.runToggle;
    });
    const first = () => {
      audio.setMuted(useGame.getState().settings.muted);
      audio.start();
    };
    window.addEventListener('pointerdown', first, { once: true });
    window.addEventListener('keydown', first, { once: true });
    return () => {
      off();
      window.removeEventListener('pointerdown', first);
      window.removeEventListener('keydown', first);
    };
  }, []);

  const spawn = useMemo(() => {
    if (phase !== 'ready') return null;
    const saved = useGame.getState().player;
    if (saved) {
      const inInterior = saved.region === 'interior' && Math.abs(saved.x - INTERIOR.x) < 50;
      const inMap = saved.region === 'world' && mapData.regionAt(saved.x, saved.z) && mapData.sdf(saved.x, saved.z) > 0;
      if (inInterior || inMap) return { x: saved.x, z: saved.z, heading: saved.heading };
    }
    useGame.getState().savePlayer(null);
    return { x: gameplay.spawn.x, z: gameplay.spawn.z, heading: gameplay.spawn.heading };
  }, [phase]);

  if (phase === 'error')
    return (
      <div className="loading">
        <div className="loading-inner">
          <h1 className="brand">Real Lagos</h1>
          <p className="loading-err">The map didn’t load: {error}. Check your connection and reload the page.</p>
          <button className="btn-primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  if (phase !== 'ready' || !spawn) return <LoadingScreen progress={progress.p} label={progress.label} />;
  return (
    <div className="app">
      <GameCanvas spawn={spawn} />
      <Hud />
    </div>
  );
}
