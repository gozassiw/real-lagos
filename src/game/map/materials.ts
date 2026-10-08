import * as THREE from 'three';
import { createFacadeAtlas } from './facades';
import { ATLAS_CELLS } from './facadeCells';

let cache: ReturnType<typeof create> | null = null;

function create() {
  // ---- roads: vertex colours + per-vertex depth layer (stable on mobile GPUs, no z-fighting)
  const road = new THREE.MeshLambertMaterial({ vertexColors: true });
  road.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLayer;')
      .replace('#include <project_vertex>', '#include <project_vertex>\ngl_Position.z -= aLayer * 1.6e-6 * gl_Position.w;');
  };
  road.customProgramCacheKey = () => 'road-layer-v1';

  // ---- building walls: facade atlas cells chosen per floor, tinted plaster
  const atlas = createFacadeAtlas();
  const walls = new THREE.MeshLambertMaterial({ map: atlas });
  walls.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aCell;
attribute vec3 color;
varying vec2 vCell;
varying vec2 vUvRaw;
varying vec3 vTint;`,
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCell = aCell; vUvRaw = uv; vTint = color;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vCell;
varying vec2 vUvRaw;
varying vec3 vTint;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  float fl = floor(vUvRaw.y + 0.001);
  float cell = fl < 0.5 ? vCell.x : vCell.y;
  float N = ${ATLAS_CELLS.toFixed(1)};
  float col = mod(cell, N), row = floor(cell / N + 0.001);
  vec2 local = clamp(fract(vUvRaw), 0.0, 1.0);
  local = mix(vec2(0.03), vec2(0.97), local);
  vec2 uvA = vec2((col + local.x) / N, 1.0 - (row + 1.0) / N + local.y / N);
  vec2 gx = dFdx(vUvRaw) / N * 0.94, gy = dFdy(vUvRaw) / N * 0.94;
  vec4 t = textureGrad(map, uvA, gx, gy);
  float tintMask = smoothstep(0.62, 0.95, t.a);
  diffuseColor.rgb *= t.rgb * mix(vec3(1.0), vTint, tintMask);
  // a touch of ambient occlusion at the foot of walls
  diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.35, vUvRaw.y));
}`,
      );
  };
  walls.customProgramCacheKey = () => 'facade-atlas-v1';

  const roofs = new THREE.MeshLambertMaterial({ vertexColors: true });
  const bridge = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const barriers = new THREE.MeshLambertMaterial({ vertexColors: true });
  const plain = new THREE.MeshLambertMaterial({ vertexColors: true });
  return { road, walls, roofs, bridge, barriers, plain, atlas };
}

export function materials() {
  if (!cache) cache = create();
  return cache;
}
