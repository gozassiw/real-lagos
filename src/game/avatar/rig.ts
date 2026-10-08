import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildAvatarMesh, type AvatarLook } from './buildAvatar';

export interface Rig {
  scene: THREE.Object3D;
  clips: Record<string, THREE.AnimationClip>;
}

let rigPromise: Promise<Rig> | null = null;

export function loadRig(url: string): Promise<Rig> {
  if (!rigPromise) {
    rigPromise = new GLTFLoader().loadAsync(url).then((g) => {
      const clips: Record<string, THREE.AnimationClip> = {};
      for (const c of g.animations) clips[c.name] = c;
      return { scene: g.scene, clips };
    });
  }
  return rigPromise;
}

export interface AvatarInstance {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  play: (name: string, fade?: number) => void;
  current: string;
  dispose: () => void;
}

/** Clone the skeleton, generate a mesh for `look`, bind, and set up an animation mixer. */
export function createAvatar(rig: Rig, look: AvatarLook): AvatarInstance {
  const skelRoot = SkeletonUtils.clone(rig.scene);
  const root = new THREE.Group();
  root.add(skelRoot);
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  skelRoot.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const skeleton = new THREE.Skeleton(bones);
  const mesh = buildAvatarMesh(skeleton, look);
  root.add(mesh);
  mesh.bind(skeleton);

  const mixer = new THREE.AnimationMixer(skelRoot);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const [name, clip] of Object.entries(rig.clips)) {
    const a = mixer.clipAction(clip);
    if (name === 'nod') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
    }
    actions[name] = a;
  }
  const inst: AvatarInstance = {
    root,
    mixer,
    actions,
    current: '',
    play(name, fade = 0.22) {
      if (inst.current === name) return;
      const next = actions[name];
      if (!next) return;
      const prev = actions[inst.current];
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
      if (prev) prev.fadeOut(fade);
      inst.current = name;
    },
    dispose() {
      mixer.stopAllAction();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material[]).forEach((m) => m.dispose());
    },
  };
  return inst;
}
