// Your Ikoyi apartment: a small cut-away room (no ceiling, Sims-style) with a bed to rest in.
import { useMemo } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { INTERIOR as I } from '../interiorLayout';
import { printTexture } from '../avatar/buildAvatar';

function windowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 160;
  const g = cv.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 160);
  sky.addColorStop(0, '#7fb3d9');
  sky.addColorStop(1, '#e9dcc4');
  g.fillStyle = sky;
  g.fillRect(0, 0, 256, 160);
  // lagoon + skyline silhouette
  g.fillStyle = '#4c7f86';
  g.fillRect(0, 118, 256, 42);
  g.fillStyle = '#5d6b74';
  let x = 0;
  while (x < 256) {
    const w = 10 + Math.random() * 22;
    const h = 20 + Math.random() * (x > 90 && x < 170 ? 70 : 30);
    g.fillRect(x, 118 - h, w - 2, h);
    x += w;
  }
  g.strokeStyle = '#f4f1ea';
  g.lineWidth = 8;
  g.strokeRect(0, 0, 256, 160);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 160);
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function Interior() {
  const tex = useMemo(() => ({ win: windowTexture(), rug: printTexture('#8a2342', '#f2c14e'), bed: printTexture('#1b5e8c', '#e2702a') }), []);
  const H = I.h;
  const wallMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#efe3cc' }), []);
  return (
    <group position={[I.x, I.y, I.z]}>
      {/* floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[I.w, I.d]} />
        <meshLambertMaterial color="#c9b79a" />
      </mesh>
      {/* tiles */}
      <gridHelper args={[Math.max(I.w, I.d), 12, '#b19f82', '#b19f82']} position={[0, 0.005, 0]} />
      {/* walls: back (-z), left (-x), right (+x); front is open toward the camera */}
      <mesh position={[0, H / 2, -I.d / 2]} material={wallMat}>
        <boxGeometry args={[I.w, H, 0.15]} />
      </mesh>
      <mesh position={[-I.w / 2, H / 2, 0]} material={wallMat}>
        <boxGeometry args={[0.15, H, I.d]} />
      </mesh>
      <mesh position={[I.w / 2, H / 2, 0]} material={wallMat}>
        <boxGeometry args={[0.15, H, I.d]} />
      </mesh>
      <mesh position={[0, 0.45, I.d / 2]}>
        <boxGeometry args={[I.w, 0.9, 0.12]} />
        <meshLambertMaterial color="#e6d8bd" />
      </mesh>
      {/* windows with a view of the lagoon */}
      <mesh position={[-1.2, 1.7, -I.d / 2 + 0.09]}>
        <planeGeometry args={[2.2, 1.35]} />
        <meshBasicMaterial map={tex.win} toneMapped={false} />
      </mesh>
      <mesh position={[I.w / 2 - 0.09, 1.7, -0.6]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[2.0, 1.25]} />
        <meshBasicMaterial map={tex.win} toneMapped={false} />
      </mesh>
      {/* bed with an ankara bedspread */}
      <group position={[I.bed.x, 0, I.bed.z]}>
        <mesh position={[0, 0.25, 0]} castShadow>
          <boxGeometry args={[2.0, 0.5, 2.2]} />
          <meshLambertMaterial color="#6b4a33" />
        </mesh>
        <mesh position={[0, 0.56, 0.05]}>
          <boxGeometry args={[1.9, 0.14, 2.0]} />
          <meshLambertMaterial map={tex.bed} />
        </mesh>
        <mesh position={[0, 0.7, -0.8]}>
          <boxGeometry args={[1.5, 0.16, 0.4]} />
          <meshLambertMaterial color="#f4f1ea" />
        </mesh>
        <mesh position={[0, 0.8, -1.12]}>
          <boxGeometry args={[2.1, 1.1, 0.1]} />
          <meshLambertMaterial color="#5a3d2a" />
        </mesh>
      </group>
      {/* sofa + TV + rug */}
      <mesh position={[-2.2, 0.3, -2.6]}>
        <boxGeometry args={[2.4, 0.6, 0.9]} />
        <meshLambertMaterial color="#2e5e4e" />
      </mesh>
      <mesh position={[-2.2, 0.75, -3.0]}>
        <boxGeometry args={[2.4, 0.6, 0.2]} />
        <meshLambertMaterial color="#2a5546" />
      </mesh>
      <mesh position={[-2.2, 0.012, -1.2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[2.6, 1.8]} />
        <meshLambertMaterial map={tex.rug} />
      </mesh>
      <mesh position={[-2.2, 0.35, 0.2]}>
        <boxGeometry args={[1.6, 0.7, 0.4]} />
        <meshLambertMaterial color="#3a2c22" />
      </mesh>
      <mesh position={[-2.2, 1.05, 0.25]}>
        <boxGeometry args={[1.3, 0.75, 0.06]} />
        <meshLambertMaterial color="#111316" />
      </mesh>
      {/* fridge, plant, standing fan */}
      <mesh position={[I.w / 2 - 0.5, 0.85, 2.2]}>
        <boxGeometry args={[0.7, 1.7, 0.7]} />
        <meshLambertMaterial color="#e8e8e6" />
      </mesh>
      <mesh position={[I.w / 2 - 0.5, 0.25, -3.0]}>
        <cylinderGeometry args={[0.25, 0.2, 0.5, 10]} />
        <meshLambertMaterial color="#a0522d" />
      </mesh>
      <mesh position={[I.w / 2 - 0.5, 0.85, -3.0]}>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshLambertMaterial color="#3f7a34" flatShading />
      </mesh>
      <group position={[0.6, 0, 1.4]}>
        <mesh position={[0, 0.65, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1.3, 6]} />
          <meshLambertMaterial color="#888" />
        </mesh>
        <mesh position={[0, 1.35, 0]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.28, 0.28, 0.12, 14]} />
          <meshLambertMaterial color="#d9dce0" />
        </mesh>
      </group>
      {/* door */}
      <mesh position={[I.door.x - 0.4, 1.05, I.door.z]}>
        <boxGeometry args={[0.08, 2.1, 1.0]} />
        <meshLambertMaterial color="#6b4428" />
      </mesh>
      <pointLight position={[0, 2.6, 0]} intensity={8} distance={12} color="#ffe2b8" />
      {/* physics: floor + walls */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[I.w / 2, 0.25, I.d / 2]} position={[0, -0.25, 0]} />
        <CuboidCollider args={[I.w / 2, H / 2, 0.1]} position={[0, H / 2, -I.d / 2]} />
        <CuboidCollider args={[0.1, H / 2, I.d / 2]} position={[-I.w / 2, H / 2, 0]} />
        <CuboidCollider args={[0.1, H / 2, I.d / 2]} position={[I.w / 2, H / 2, 0]} />
        <CuboidCollider args={[I.w / 2, 0.6, 0.1]} position={[0, 0.6, I.d / 2]} />
        <CuboidCollider args={[1.0, 0.4, 1.1]} position={[I.bed.x, 0.4, I.bed.z]} />
        <CuboidCollider args={[1.2, 0.4, 0.5]} position={[-2.2, 0.4, -2.7]} />
      </RigidBody>
    </group>
  );
}
