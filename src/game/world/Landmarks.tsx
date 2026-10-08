// Art-directed touches on top of the OSM data: green road signs at both ends of named bridges, the cable-stayed
// pylon of the Lekki–Ikoyi Link Bridge, and bus-stop shelters with parked danfos at the fast-travel stops.
import { useMemo } from 'react';
import * as THREE from 'three';
import { mapData } from '../map/mapData';
import { gameplay } from '../gameplay';
import { busShelterGeometry, danfoGeometry, kioskGeometry, umbrellaGeometry } from '../map/props';
import { materials } from '../map/materials';

function signTexture(text: string) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#17643a';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#f4f4f0';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#f4f4f0';
  g.font = '600 52px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 52;
  while (g.measureText(text).width > 470 && size > 26) {
    size -= 2;
    g.font = `600 ${size}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  }
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function Landmarks() {
  const group = useMemo(() => {
    const root = new THREE.Group();
    root.name = 'landmarks';
    const mats = materials();
    const pole = new THREE.MeshLambertMaterial({ color: '#8d9399' });

    // --- bridge name signs (one per named bridge, at the start of its longest elevated way)
    const best = new Map<string, { r: (typeof mapData.majorRoads)[number]; len: number }>();
    for (const r of mapData.majorRoads) {
      if (!r.bridge || !r.name || !r.h) continue;
      let len = 0;
      for (let i = 2; i < r.pts.length; i += 2) len += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]);
      if (len < 120 || !/bridge/i.test(r.name)) continue;
      const cur = best.get(r.name);
      if (!cur || len > cur.len) best.set(r.name, { r, len });
    }
    for (const [name, { r }] of best) {
      const tex = signTexture(name);
      const n = r.pts.length / 2;
      for (const end of [0, n - 1]) {
        const i = end;
        const j = end === 0 ? 1 : n - 2;
        const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
        const dx = r.pts[j * 2] - x, dz = r.pts[j * 2 + 1] - z;
        const L = Math.hypot(dx, dz) || 1;
        const side = r.width / 2 + 2.5;
        const sx = x + (-dz / L) * side, sz = z + (dx / L) * side;
        const g = new THREE.Group();
        g.position.set(sx, r.h ? r.h[i] : 0, sz);
        g.rotation.y = Math.atan2(dx, dz) + Math.PI;
        const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 6), pole);
        p1.position.set(-1.4, 2.1, 0);
        const p2 = p1.clone();
        p2.position.x = 1.4;
        const board = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
        board.position.set(0, 3.9, 0.1);
        g.add(p1, p2, board);
        root.add(g);
      }
    }

    // --- Lekki–Ikoyi Link Bridge: single tall pylon with cable stays (art-directed, at the real bridge)
    const link = mapData.majorRoads.filter((r) => r.bridge && /lekki\s*[-–]?\s*ikoyi|link bridge/i.test(r.name) && r.h);
    if (link.length) {
      // longest segment midpoint ≈ the pylon
      let best: { x: number; z: number; y: number; ang: number; L: number } | null = null;
      for (const r of link) {
        const n = r.pts.length / 2;
        let tot = 0;
        for (let i = 1; i < n; i++) tot += Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]);
        let acc = 0;
        for (let i = 1; i < n; i++) {
          const L = Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]);
          if (acc + L >= tot / 2) {
            const k = (tot / 2 - acc) / L;
            const x = r.pts[i * 2 - 2] + (r.pts[i * 2] - r.pts[i * 2 - 2]) * k;
            const z = r.pts[i * 2 - 1] + (r.pts[i * 2 + 1] - r.pts[i * 2 - 1]) * k;
            const y = r.h![i - 1] + (r.h![i] - r.h![i - 1]) * k;
            if (!best || tot > best.L) best = { x, z, y, ang: Math.atan2(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]), L: tot };
            break;
          }
          acc += L;
        }
      }
      if (best) {
        const g = new THREE.Group();
        g.position.set(best.x, 0, best.z);
        g.rotation.y = best.ang;
        const white = new THREE.MeshLambertMaterial({ color: '#e9e8e2' });
        const H = 85;
        const pyl = new THREE.Mesh(new THREE.BoxGeometry(2.2, H, 3.2), white);
        pyl.position.y = H / 2 - 2;
        g.add(pyl);
        const cable = new THREE.LineBasicMaterial({ color: '#f2f2ee' });
        const pts: THREE.Vector3[] = [];
        for (let i = 1; i <= 9; i++) {
          for (const dir of [-1, 1]) {
            const top = new THREE.Vector3(0, H - 12 - i * 3.5, 0);
            const deck = new THREE.Vector3(0, best.y + 1, dir * (14 + i * 15));
            for (const sx of [-1.2, 1.2]) {
              pts.push(top.clone().setX(sx * 0.5), deck.clone().setX(sx * 6));
            }
          }
        }
        const lg = new THREE.BufferGeometry().setFromPoints(pts);
        g.add(new THREE.LineSegments(lg, cable));
        root.add(g);
      }
    }

    // --- danfo stops: shelter + parked danfo + a kiosk; markets get umbrellas
    const shelter = busShelterGeometry();
    const danfo = danfoGeometry();
    const kiosks = ['#2a6fb0', '#c8452f', '#2f8f4e', '#e0a526'].map((c) => kioskGeometry(c));
    const umbrellas = ['#d9412b', '#2a6fb0', '#f2c230', '#2f8f4e', '#f4f1ea'].map((c) => umbrellaGeometry(c));
    gameplay.pois.forEach((p, idx) => {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.heading ?? 0;
      if (p.kind === 'danfo') {
        const s = new THREE.Mesh(shelter, mats.plain);
        s.position.set(-3.2, 0, 1.2);
        s.castShadow = true;
        const d = new THREE.Mesh(danfo, mats.plain);
        d.position.set(3.0, 0, 3.6);
        d.rotation.y = Math.PI / 2;
        d.castShadow = true;
        g.add(s, d);
      }
      if (p.kind === 'eat' || p.kind === 'danfo') {
        const k = new THREE.Mesh(kiosks[idx % kiosks.length], mats.plain);
        k.position.set(-4.5, 0, 4.5);
        k.rotation.y = Math.PI / 2;
        k.castShadow = true;
        g.add(k);
      }
      if (p.kind === 'shop') {
        for (let i = 0; i < 9; i++) {
          const u = new THREE.Mesh(umbrellas[(i + idx) % umbrellas.length], mats.plain);
          const a = (i / 9) * Math.PI * 2;
          u.position.set(Math.cos(a) * (6 + (i % 3)), 0, 4 + Math.sin(a) * 4 + 3);
          u.rotation.y = a;
          u.castShadow = true;
          g.add(u);
        }
      }
      root.add(g);
    });
    return root;
  }, []);
  return <primitive object={group} />;
}
