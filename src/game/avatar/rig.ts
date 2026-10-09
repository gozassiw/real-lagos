import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildAvatarMesh, type AvatarLook } from './buildAvatar';

export interface Rig {
  scene: THREE.Object3D;
  clips: Record<string, THREE.AnimationClip>;
}

let rigPromise: Promise<Rig> | null = null;

/** Some hosts don't serve .glb files; for those the same bytes ship base64-encoded as `<url>.json` ({ "glb": "…" }). */
async function loadGlbFromJson(url: string) {
  const r = await fetch(`${url}.json`);
  if (!r.ok) throw new Error(`rig: HTTP ${r.status}`);
  const bin = atob(((await r.json()) as { glb: string }).glb);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new GLTFLoader().parseAsync(bytes.buffer, '');
}

export function loadRig(url: string): Promise<Rig> {
  if (!rigPromise) {
    rigPromise = new GLTFLoader()
      .loadAsync(url)
      .catch(() => loadGlbFromJson(url))
      .then((g) => {
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
    // all clips loop (a one-shot clip that finishes would drop the skeleton back to its T-pose)
    a.setLoop(THREE.LoopRepeat, Infinity);
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
