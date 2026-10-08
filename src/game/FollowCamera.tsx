// Damped third-person follow / orbit camera. Drag (mouse or right-side touch) to orbit, wheel / pinch to zoom
// (zooming far out gives an aerial view of the real map). Ray-casts against colliders so it doesn't clip walls.
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { input } from './input';
import { worldState } from './worldState';
import { useGame } from '../store/gameStore';

const MIN_D = 2.6, MAX_D = 600;

export function FollowCamera() {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const st = useRef({
    yaw: worldState.camYaw,
    pitch: 0.32,
    dist: 6.5,
    distSmoothed: 6.5,
    target: new THREE.Vector3(),
    init: false,
    idle: 0,
  });
  const ray = useRef<InstanceType<typeof rapier.Ray> | null>(null);
  // QA hook: set camera distance / pitch / yaw
  (window as unknown as { __lagosCam: (d: number, p?: number, y?: number) => void }).__lagosCam = (d, p, y) => {
    st.current.dist = d;
    st.current.distSmoothed = d;
    if (p !== undefined) st.current.pitch = p;
    if (y !== undefined) st.current.yaw = y;
  };
  const tmp = new THREE.Vector3();

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = st.current;
    const g = useGame.getState();
    const interior = g.player?.region === 'interior';
    const riding = worldState.riding;

    // input
    const dragging = Math.abs(input.dYaw) + Math.abs(input.dPitch) > 0;
    s.yaw += input.dYaw;
    s.pitch = THREE.MathUtils.clamp(s.pitch + input.dPitch, -0.15, 1.35);
    s.dist = THREE.MathUtils.clamp(s.dist * Math.pow(1.12, input.dZoom), MIN_D, interior ? 5 : MAX_D);
    input.dYaw = input.dPitch = input.dZoom = 0;

    // gentle auto-follow behind the player when moving and not dragging
    s.idle = dragging ? 0 : s.idle + dt;
    if (!riding && s.idle > 1.2 && worldState.playerSpeed > 1.0 && s.dist < 20) {
      const behind = worldState.playerHeading + Math.PI;
      let d = behind - s.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yaw += d * Math.min(1, dt * 0.9) * Math.min(1, worldState.playerSpeed / 4);
    }
    if (riding) {
      const behind = worldState.rideHeading + Math.PI;
      let d = behind - s.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yaw += d * Math.min(1, dt * 1.5);
    }
    worldState.camYaw = s.yaw;
    worldState.camPitch = s.pitch;

    // target
    const focus = riding ? worldState.ridePos : worldState.player;
    const headY = riding ? 2.2 : 1.55;
    tmp.set(focus.x, focus.y + headY, focus.z);
    if (!s.init) {
      s.target.copy(tmp);
      s.init = true;
    }
    const k = 1 - Math.exp(-dt * (riding ? 6 : 14));
    s.target.lerp(tmp, k);
    // teleports: snap
    if (s.target.distanceTo(tmp) > 60) s.target.copy(tmp);

    // far zoom = more top-down
    const want = riding ? Math.max(s.dist, 70) : s.dist;
    const pitch = want > 25 ? Math.max(s.pitch, THREE.MathUtils.mapLinear(Math.min(want, 140), 25, 140, 0.55, 1.05)) : s.pitch;
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const dir = new THREE.Vector3(Math.sin(s.yaw) * cosP, sinP, Math.cos(s.yaw) * cosP);

    // collision: cast from target toward camera
    let d = want;
    if (!ray.current) ray.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const r = ray.current;
    r.origin = { x: s.target.x, y: s.target.y, z: s.target.z };
    r.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = world.castRay(r, want, true, undefined, undefined, undefined, undefined, (c) => !c.parent()?.isKinematic());
    // collisions matter for the close follow camera; the zoomed-out aerial view flies over the city
    if (hit && hit.timeOfImpact < want && !riding && want < 45) d = Math.max(0.6, hit.timeOfImpact - 0.25);
    // smooth zoom-in fast, zoom-out slow
    s.distSmoothed += (d - s.distSmoothed) * Math.min(1, dt * (d < s.distSmoothed ? 18 : 4));

    camera.position.copy(s.target).addScaledVector(dir, s.distSmoothed);
    if (!interior) camera.position.y = Math.max(camera.position.y, 0.5);
    camera.lookAt(s.target);
  });
  return null;
}
