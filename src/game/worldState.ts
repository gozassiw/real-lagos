// Mutable per-frame world state shared between systems (kept out of React / zustand to avoid re-renders).
import * as THREE from 'three';

export interface RoadLine {
  name: string;
  cls: number;
  pts: number[];
}

export const worldState = {
  /** streaming focus (player position, or the danfo during a ride) */
  focus: new THREE.Vector3(),
  player: new THREE.Vector3(),
  playerHeading: 0,
  playerSpeed: 0,
  onBridge: false,
  camYaw: 0,
  camPitch: 0.35,
  roadLines: new Map<string, RoadLine[]>(),
  loadedChunks: 0,
  pendingChunks: 0,
  /** request a teleport (fast travel / entering & leaving interiors) */
  teleport: null as null | { x: number; z: number; y?: number; heading?: number },
  /** while riding a danfo the player is hidden and the camera follows the bus */
  riding: false,
  ridePos: new THREE.Vector3(),
  rideHeading: 0,
  /** renderer stats for the QA hook */
  render: { calls: 0, triangles: 0, geometries: 0, textures: 0 },
};
