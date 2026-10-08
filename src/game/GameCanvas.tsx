import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { Terrain } from './world/Terrain';
import { LagosMap } from './world/LagosMap';
import { Traffic } from './world/Traffic';
import { Interior } from './world/Interior';
import { Landmarks } from './world/Landmarks';
import { Npcs } from './world/Npcs';
import { Player } from './Player';
import { FollowCamera } from './FollowCamera';
import { InteractionSystem } from './InteractionSystem';
import { DanfoRide } from './DanfoRide';
import { installCameraDrag } from './input';
import { worldState } from './worldState';
import { mapData } from './map/mapData';
import { useGame } from '../store/gameStore';
import { audio } from './audio';

export const SUN_DIR = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
const HAZE = '#d9d6cb';

function Sky() {
  const mesh = useMemo(() => {
    const g = new THREE.SphereGeometry(5000, 24, 12);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { sun: { value: SUN_DIR }, top: { value: new THREE.Color('#5f9bd0') }, horizon: { value: new THREE.Color(HAZE) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 sun; uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
        void main(){ float h = max(vDir.y, 0.0);
          vec3 c = mix(horizon, top, pow(h, 0.55));
          float s = max(dot(normalize(vDir), sun), 0.0);
          c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.18);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
  }, []);
  useFrame(({ camera }) => mesh.position.copy(camera.position));
  return <primitive object={mesh} />;
}

function SunLight() {
  const light = useRef<THREE.DirectionalLight>(null!);
  const lowPower = useGame((s) => s.lowPower);
  const { scene } = useThree();
  useEffect(() => {
    scene.add(light.current.target);
  }, [scene]);
  useFrame(() => {
    const p = worldState.riding ? worldState.ridePos : worldState.player;
    const l = light.current;
    // snap the shadow frustum to texels to avoid shimmering
    const step = 1;
    const x = Math.round(p.x / step) * step, z = Math.round(p.z / step) * step;
    l.position.set(x + SUN_DIR.x * 150, p.y + SUN_DIR.y * 150, z + SUN_DIR.z * 150);
    l.target.position.set(x, p.y, z);
    l.target.updateMatrixWorld();
  });
  const size = 2048;
  const ext = 70;
  return (
    <directionalLight
      ref={light}
      intensity={2.5}
      color="#fff0d6"
      castShadow={!lowPower}
      shadow-mapSize-width={size}
      shadow-mapSize-height={size}
      shadow-camera-left={-ext}
      shadow-camera-right={ext}
      shadow-camera-top={ext}
      shadow-camera-bottom={-ext}
      shadow-camera-near={10}
      shadow-camera-far={400}
      shadow-bias={-0.0006}
      shadow-normalBias={0.04}
    />
  );
}

function Ground() {
  // one big flat collider for all land (water is blocked by the shoreline check, bridges have trimesh decks)
  const b = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of Object.values(mapData.manifest.regions)) {
      x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); z0 = Math.min(z0, r.z0); z1 = Math.max(z1, r.z1);
    }
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2 + 200, hz: (z1 - z0) / 2 + 200 };
  }, []);
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[b.hx, 1, b.hz]} position={[b.cx, -1, b.cz]} />
    </RigidBody>
  );
}

function Perf() {
  const acc = useRef({ t: 0, n: 0, slow: 0 });
  const { gl } = useThree();
  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt;
    a.n++;
    if (a.t > 1) {
      const fps = a.n / a.t;
      worldState.render = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures };
      const g = useGame.getState();
      g.patch({ fps: Math.round(fps) });
      // adaptive quality: drop to low power if we sit under ~28 fps for a few seconds
      if (g.settings.quality === 'auto') {
        a.slow = fps < 28 ? a.slow + 1 : Math.max(0, a.slow - 1);
        if (a.slow >= 5 && !g.lowPower) {
          g.patch({ lowPower: true });
          gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
        }
      }
      // ambience mix: near water + traffic
      const p = worldState.player;
      const sd = mapData.sdf(p.x, p.z);
      audio.mix(THREE.MathUtils.clamp(1 - Math.abs(sd) / 60, 0, 1), 0.7);
      a.t = 0;
      a.n = 0;
    }
  });
  return null;
}

function CameraDrag() {
  const { gl } = useThree();
  useEffect(() => installCameraDrag(gl.domElement), [gl]);
  return null;
}

export function GameCanvas({ spawn }: { spawn: { x: number; z: number; heading: number } }) {
  const quality = useGame((s) => s.settings.quality);
  const lowPower = useGame((s) => s.lowPower);
  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
  const dpr: [number, number] = quality === 'low' || lowPower ? [1, 1.25] : quality === 'high' ? [1, 2] : isMobile ? [1, 1.6] : [1, 1.75];
  return (
    <Canvas
      className="game-canvas"
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={dpr}
      gl={{ antialias: !isMobile, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 58, near: 0.3, far: 6000, position: [spawn.x, 6, spawn.z + 8] }}
      onCreated={({ gl, scene }) => {
        (window as unknown as { __scene: THREE.Scene }).__scene = scene;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.02;
        scene.fog = new THREE.Fog(HAZE, 260, lowPower || isMobile ? 1100 : 1500);
        scene.background = new THREE.Color(HAZE);
      }}
    >
      <Sky />
      <hemisphereLight args={['#dcecf7', '#7d6650', 1.25]} />
      <ambientLight intensity={0.18} />
      <SunLight />
      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]} timeStep="vary">
          <Ground />
          <Terrain />
          <LagosMap />
          <Landmarks />
          <Interior />
          <Player spawn={spawn} />
          <InteractionSystem />
          <DanfoRide />
          <FollowCamera />
        </Physics>
        <Traffic />
        <Npcs />
      </Suspense>
      <CameraDrag />
      <Perf />
    </Canvas>
  );
}
