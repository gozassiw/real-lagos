// Ground + water from the real OSM shoreline: one land plane per region whose fragment shader samples the
// signed-distance raster (land/water) and the landuse raster, plus one animated water plane.
import { useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mapData, type Raster } from '../map/mapData';

function rasterTexture(r: Raster, linear: boolean) {
  const t = new THREE.DataTexture(r.data, r.w, r.h, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.unpackAlignment = 1; // rows are not 4-byte aligned
  t.needsUpdate = true;
  return t;
}

// landuse palette (sRGB hex) — index = class id from scripts/build_map.py
const LU_COLORS = [
  '#9d8468', // urban ground (laterite dust + concrete)
  '#7c9a4b', // grass / park
  '#55753a', // wood
  '#5a7444', // wetland / mangrove
  '#dccaa1', // beach sand
  '#a48d72', // residential compounds
  '#a09889', // commercial paving
  '#8e8b84', // industrial / port
  '#8f8f52', // farmland
  '#5e9a45', // pitch
  '#706e69', // parking / paved
  '#7c7064', // rail ballast
  '#728d55', // cemetery
  '#9a8c74', // school / institutional
  '#7f8b5f', // military
  '#b48b5e', // construction / bare earth
];

export function Terrain() {
  const regions = useMemo(() => Object.keys(mapData.manifest.terrain), []);
  return (
    <group>
      {regions.map((r) => (
        <RegionGround key={r} region={r} />
      ))}
      <Water />
    </group>
  );
}

function RegionGround({ region }: { region: string }) {
  const { mesh, mat } = useMemo(() => {
    const sdf = mapData.terrain[region];
    const lu = mapData.landuse[region];
    const tS = rasterTexture(sdf, true);
    const tL = rasterTexture(lu, false);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const pal = LU_COLORS.map((h) => new THREE.Color(h));
    const uniforms = {
      tSdf: { value: tS },
      tLu: { value: tL },
      sdfRect: { value: new THREE.Vector4(sdf.x0, sdf.z0, sdf.w * sdf.res, sdf.h * sdf.res) },
      luRect: { value: new THREE.Vector4(lu.x0, lu.z0, lu.w * lu.res, lu.h * lu.res) },
      luTexel: { value: new THREE.Vector2(1 / lu.w, 1 / lu.h) },
      sdfRange: { value: sdf.range ?? 48 },
      pal: { value: pal },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vW;
uniform sampler2D tSdf; uniform sampler2D tLu;
uniform vec4 sdfRect; uniform vec4 luRect; uniform vec2 luTexel; uniform float sdfRange;
uniform vec3 pal[16];
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec2 uvS = (vW - sdfRect.xy) / sdfRect.zw;
  float sd = (texture2D(tSdf, uvS).r * 255.0 - 128.0) / 127.0 * sdfRange;
  vec3 dbg = vec3(texture2D(tSdf, uvS).r, fract(uvS.x * 10.0), fract(uvS.y * 10.0));
  #ifndef DBG_GROUND
  if (sd < 0.0) discard;
  #endif
  float n1 = vnoise(vW * 0.08), n2 = vnoise(vW * 0.013 + 7.0), n3 = vnoise(vW * 0.45);
  vec2 jit = (vec2(n1, vnoise(vW*0.08+3.1)) - 0.5) * 6.0;
  vec2 uvL = (vW + jit - luRect.xy) / luRect.zw;
  float cls = floor(texture2D(tLu, uvL).r * 255.0 + 0.5);
  vec3 c = pal[0];
  for (int i = 1; i < 16; i++) { if (abs(cls - float(i)) < 0.5) c = pal[i]; }
  // mottled ground: red laterite patches, grass tufts, concrete stains
  c *= 0.86 + 0.22 * n2 + 0.08 * n3;
  c = mix(c, vec3(0.42, 0.26, 0.15), smoothstep(0.62, 0.9, n2) * 0.18 * step(cls, 0.5));
  c = mix(c, vec3(0.30, 0.42, 0.18), smoothstep(0.7, 0.95, n1) * 0.22 * (1.0 - step(9.5, cls)));
  // shoreline: sand band, then darker wet edge
  float sandW = 5.0 + 6.0 * n2;
  c = mix(vec3(0.66, 0.58, 0.43), c, smoothstep(sandW * 0.4, sandW, sd));
  c = mix(vec3(0.42, 0.36, 0.27), c, smoothstep(0.0, 1.4, sd));
  diffuseColor.rgb *= c;
  #ifdef DBG_GROUND
  diffuseColor.rgb = dbg;
  #endif
}`,
        );
    };
    if (location.search.includes('dbgground')) mat.defines = { DBG_GROUND: 1 };
    mat.customProgramCacheKey = () => 'ground-' + region;
    // plane covering the region + margin (edge texels repeat beyond the data: ocean south, mainland north)
    const b = mapData.manifest.regions[region];
    const others = Object.entries(mapData.manifest.regions).filter(([k]) => k !== region);
    let north = 3500, south = 3500;
    for (const [, o] of others) {
      if (o.z1 <= b.z0) north = Math.min(north, (b.z0 - o.z1) / 2);
      if (o.z0 >= b.z1) south = Math.min(south, (o.z0 - b.z1) / 2);
    }
    const x0 = b.x0 - 3500, x1 = b.x1 + 3500, z0 = b.z0 - north, z1 = b.z1 + south;
    // subdivided: giant 2-triangle planes lose depth precision on some GPUs (the water showed through)
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.ceil((x1 - x0) / 400), Math.ceil((z1 - z0) / 400));
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'ground-' + region;
    return { mesh, mat };
  }, [region]);
  useEffect(() => () => { mesh.geometry.dispose(); mat.dispose(); }, [mesh, mat]);
  return <primitive object={mesh} />;
}

function Water() {
  const { mesh, uniforms } = useMemo(() => {
    const core = mapData.terrain.core ?? Object.values(mapData.terrain)[0];
    const tS = rasterTexture(core, true);
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        tSdf: { value: null },
        sdfRect: { value: new THREE.Vector4(core.x0, core.z0, core.w * core.res, core.h * core.res) },
        sdfRange: { value: core.range ?? 48 },
        time: { value: 0 },
        sunDir: { value: new THREE.Vector3(-0.45, 0.75, 0.4).normalize() },
        deep: { value: new THREE.Color('#1f4f5c') },
        shallow: { value: new THREE.Color('#4d8a86') },
        sky: { value: new THREE.Color('#bcd6e4') },
      },
    ]);
    uniforms.tSdf.value = tS;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      fog: true,
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vW;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D tSdf; uniform vec4 sdfRect; uniform float sdfRange; uniform float time;
        uniform vec3 sunDir; uniform vec3 deep; uniform vec3 shallow; uniform vec3 sky;
        varying vec3 vW;
        float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec2 uvS = (vW.xz - sdfRect.xy) / sdfRect.zw;
          float sd = (texture2D(tSdf, uvS).r * 255.0 - 128.0) / 127.0 * sdfRange; // negative in water
          float depth = clamp(-sd / 40.0, 0.0, 1.0);
          vec2 p = vW.xz * 0.06;
          float w1 = vn(p + vec2(time * 0.05, time * 0.03));
          float w2 = vn(p * 2.3 - vec2(time * 0.04, -time * 0.06));
          vec3 n = normalize(vec3((w1 - 0.5) * 0.35 + (w2 - 0.5) * 0.2, 1.0, (w2 - 0.5) * 0.35 - (w1 - 0.5) * 0.2));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 1.0, depth));
          col = mix(col, sky, fres * 0.55);
          vec3 H = normalize(sunDir + V);
          float spec = pow(max(dot(n, H), 0.0), 140.0) * 1.4;
          col += vec3(1.0, 0.95, 0.85) * spec;
          // foam line at the shore
          float foam = smoothstep(-3.5, -0.6, sd) * (0.55 + 0.45 * sin(time * 1.3 + sd * 2.2 + w1 * 6.0));
          col = mix(col, vec3(0.86, 0.88, 0.84), foam * 0.55);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const b of Object.values(mapData.manifest.regions)) {
      x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); z0 = Math.min(z0, b.z0); z1 = Math.max(z1, b.z1);
    }
    const g = new THREE.PlaneGeometry(x1 - x0 + 16000, z1 - z0 + 16000, 48, 48);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, -0.45, (z0 + z1) / 2);
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    mesh.name = 'water';
    return { mesh, uniforms };
  }, []);
  useFrame((_, dt) => {
    uniforms.time.value += dt;
  });
  return <primitive object={mesh} />;
}
