// Third-person player: original procedural avatar + motion clips, Rapier kinematic character controller
// (building / bridge collisions), real-shoreline water blocking, camera-relative movement.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { loadRig, createAvatar, type AvatarInstance } from './avatar/rig';
import { AVATAR_PRESETS } from './avatar/buildAvatar';
import { mapData } from './map/mapData';
import { input, moveVector } from './input';
import { worldState } from './worldState';
import { useGame } from '../store/gameStore';
import { INTERIOR } from './interiorLayout';

const WALK = 2.1;
const JOG = 3.6;
const RUN = 7.2;
const RIG_URL = `${import.meta.env.BASE_URL}models/rig.glb`;

export function Player({ spawn }: { spawn: { x: number; z: number; heading: number } }) {
  const body = useRef<RapierRigidBody>(null!);
  const colRef = useRef<Collider>(null!);
  const visual = useRef<THREE.Group>(null!);
  const { world } = useRapier();
  const avatarId = useGame((s) => s.avatarId);
  const [avatar, setAvatar] = useState<AvatarInstance | null>(null);

  useEffect(() => {
    let alive = true;
    let inst: AvatarInstance | null = null;
    const look = (AVATAR_PRESETS.find((p) => p.id === avatarId) ?? AVATAR_PRESETS[0]).look;
    loadRig(RIG_URL).then((rig) => {
      if (!alive) return;
      inst = createAvatar(rig, look);
      inst.root.traverse((o) => (o.castShadow = true));
      inst.play('idle', 0);
      setAvatar(inst);
    });
    return () => {
      alive = false;
      inst?.dispose();
    };
  }, [avatarId]);

  const ctrl = useMemo<KinematicCharacterController>(() => {
    const c = world.createCharacterController(0.04);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.disableAutostep();
    c.disableSnapToGround();
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    c.setSlideEnabled(true);
    c.setApplyImpulsesToDynamicBodies(false);
    return c;
  }, [world]);
  useEffect(() => () => world.removeCharacterController(ctrl), [world, ctrl]);

  const s = useRef({
    vy: 0,
    heading: spawn.heading,
    lastSafe: new THREE.Vector3(spawn.x, 0.1, spawn.z),
    saveT: 0,
    tickT: 0,
    speed: 0,
    grounded: true,
    stuckT: 0,
  });

  useEffect(() => {
    worldState.player.set(spawn.x, 0.1, spawn.z);
    worldState.focus.copy(worldState.player);
  }, [spawn]);

  const desired = new THREE.Vector3();
  const { rapier } = useRapier();
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), [rapier]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const rb = body.current;
    const col = colRef.current;
    if (!rb || !col) return;
    const st = s.current;
    const g = useGame.getState();

    // ---- teleports (fast travel, interiors)
    if (worldState.teleport) {
      const t = worldState.teleport;
      worldState.teleport = null;
      const y = t.y ?? 0.1;
      rb.setTranslation({ x: t.x, y, z: t.z }, true);
      rb.setNextKinematicTranslation({ x: t.x, y, z: t.z });
      if (t.heading !== undefined) st.heading = t.heading;
      st.vy = 0;
      st.lastSafe.set(t.x, y, t.z);
      worldState.player.set(t.x, y, t.z);
      worldState.focus.copy(worldState.player);
      return;
    }

    const pos = rb.translation();
    const interior = g.player?.region === 'interior';
    const riding = worldState.riding;
    const busy = !!g.busy || riding || g.ui === 'danfo';

    // ---- movement intent (camera relative)
    const mv = busy ? { x: 0, y: 0, mag: 0 } : moveVector();
    const yaw = worldState.camYaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let dx = fx * mv.y + rx * mv.x;
    let dz = fz * mv.y + rz * mv.x;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-4) { dx /= dl; dz /= dl; }
    const wantsRun = (input.shift || input.runToggle) && g.energy > 2;
    const target = mv.mag < 0.05 ? 0 : wantsRun ? RUN * Math.max(0.6, mv.mag) : mv.mag > 0.85 ? JOG : WALK * Math.max(0.45, mv.mag / 0.85);
    st.speed += (target - st.speed) * Math.min(1, dt * (target > st.speed ? 6 : 10));
    if (target === 0 && st.speed < 0.05) st.speed = 0;

    // cancel emotes when moving
    if (st.speed > 0.3 && g.emote) g.setEmote(null);

    desired.set(dx * st.speed * dt, 0, dz * st.speed * dt);

    // ---- real shoreline: don't walk into the lagoon / ocean (unless on a bridge deck)
    if (!interior) {
      // a bridge deck (trimesh collider) under the target spot makes water crossable
      const deckAt = (x: number, z: number) => {
        ray.origin = { x, y: pos.y + 1.1, z };
        const h = world.castRay(ray, 2.4, true, undefined, undefined, col);
        return !!h && h.collider.shape.type === rapier.ShapeType.TriMesh;
      };
      const blocked = (x: number, z: number) => (mapData.sdf(x, z) < 0.6 || !mapData.regionAt(x, z)) && !deckAt(x, z);
      if (desired.x || desired.z) {
        if (blocked(pos.x + desired.x * 3, pos.z + desired.z * 3)) {
          if (!blocked(pos.x + desired.x * 3, pos.z)) desired.z = 0;
          else if (!blocked(pos.x, pos.z + desired.z * 3)) desired.x = 0;
          else desired.set(0, 0, 0);
          if (!desired.x && !desired.z && st.speed > 1 && Math.random() < 0.02) useGame.getState().toast('That’s the lagoon — find a bridge or take a danfo', 'info');
        }
      }
    }

    // ---- horizontal collisions via the Rapier character controller (walls, parapets);
    // vertical placement via a downward ray onto the flat ground / bridge decks / interior floor.
    desired.y = 0;
    ctrl.computeColliderMovement(col, desired);
    const m = ctrl.computedMovement();
    let nx = pos.x + m.x, nz = pos.z + m.z;
    const probeTop = pos.y + 1.1;
    ray.origin = { x: nx, y: probeTop, z: nz };
    const hit = world.castRay(ray, 8, true, undefined, undefined, col);
    const floor = hit ? probeTop - hit.timeOfImpact : -Infinity;
    let ny: number;
    if (floor > pos.y - 0.45 && floor < pos.y + 1.0) {
      // walk up/down ramps and small steps; ease the step-ups a little
      ny = floor > pos.y ? pos.y + Math.min(floor - pos.y, Math.max(0.12, dt * 6)) : floor;
      st.vy = 0;
      st.grounded = true;
    } else {
      st.vy = Math.max(-30, st.vy - 22 * dt);
      ny = pos.y + st.vy * dt;
      if (ny < floor) { ny = floor; st.vy = 0; }
      st.grounded = ny <= floor + 0.01;
      if (floor >= pos.y + 1.0) { nx = pos.x; nz = pos.z; ny = pos.y; } // blocked by something above the knee
    }
    // fell into water from a bridge edge -> back to the last safe spot
    const onDeck = !!hit && hit.collider.shape.type === rapier.ShapeType.TriMesh;
    if (!interior && (ny < -1.5 || (!onDeck && ny < 0.3 && mapData.sdf(nx, nz) < -1))) {
      nx = st.lastSafe.x; ny = st.lastSafe.y + 0.3; nz = st.lastSafe.z;
      st.vy = 0;
      useGame.getState().toast('Careful! You no fit swim for lagoon 😅', 'bad');
    } else if (st.grounded) st.lastSafe.set(nx, ny, nz);
    if (interior) {
      nx = THREE.MathUtils.clamp(nx, INTERIOR.x - INTERIOR.w / 2 + 0.4, INTERIOR.x + INTERIOR.w / 2 - 0.4);
      nz = THREE.MathUtils.clamp(nz, INTERIOR.z - INTERIOR.d / 2 + 0.4, INTERIOR.z + INTERIOR.d / 2 - 0.4);
      ny = Math.max(INTERIOR.y + 0.02, ny);
    }
    rb.setNextKinematicTranslation({ x: nx, y: ny, z: nz });

    // ---- facing
    const actual = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
    if (dl > 1e-4 && st.speed > 0.15) {
      const th = Math.atan2(dx, dz);
      let d = th - st.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      st.heading += d * Math.min(1, dt * 12);
    }
    if (visual.current) {
      visual.current.position.set(nx, ny, nz);
      visual.current.rotation.y = st.heading;
      visual.current.visible = !riding;
    }

    worldState.player.set(nx, ny, nz);
    worldState.playerHeading = st.heading;
    worldState.playerSpeed = actual;
    worldState.onBridge = ny > 0.8 && !interior;
    if (!riding) worldState.focus.set(nx, ny, nz);

    // ---- animation
    if (avatar) {
      const a = avatar;
      let clip = 'idle';
      if (g.emote === 'dance') clip = 'dance';
      else if (g.busy) clip = 'nod';
      else if (actual > 4.2) clip = 'run';
      else if (actual > 0.25) clip = 'walk';
      if (g.busy && a.current === 'nod' && !a.actions.nod.isRunning()) a.actions.nod.reset().play();
      a.play(clip, clip === 'dance' ? 0.4 : 0.2);
      if (clip === 'walk') a.actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(actual / 1.45, 0.6, 2.2));
      if (clip === 'run') a.actions.run.setEffectiveTimeScale(THREE.MathUtils.clamp(actual / 5.4, 0.8, 1.6));
      a.mixer.update(dt);
    }

    // ---- needs + persistence
    st.tickT += dt;
    if (st.tickT > 0.5) {
      g.tick(st.tickT, actual > 4.2, actual > 0.3);
      st.tickT = 0;
    }
    st.saveT += dt;
    if (st.saveT > 2) {
      st.saveT = 0;
      if (st.grounded && !riding) g.savePlayer({ x: nx, z: nz, y: ny, heading: st.heading, region: g.player?.region ?? 'world' });
    }
  });

  return (
    <>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[spawn.x, 0.1, spawn.z]} enabledRotations={[false, false, false]}>
        <CapsuleCollider ref={colRef} args={[0.55, 0.3]} position={[0, 0.86, 0]} />
      </RigidBody>
      <group ref={visual} position={[spawn.x, 0.1, spawn.z]}>
        {avatar && <primitive object={avatar.root} />}
      </group>
    </>
  );
}
