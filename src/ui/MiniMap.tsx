// North-up minimap drawn from the same real-Lagos data the 3D world uses (shoreline raster, OSM roads),
// so the marker always agrees with the player's position in the game.
import { useEffect, useRef } from 'react';
import { mapData } from '../game/map/mapData';
import { worldState } from '../game/worldState';
import { gameplay, KIND_COLOR } from '../game/gameplay';
import { questTarget } from '../game/InteractionSystem';
import { useGame } from '../store/gameStore';

/** Pre-render the land/water raster of each region into a canvas once (shared with the full map). */
const waterCanvases = new Map<string, HTMLCanvasElement>();
export function waterCanvas(region: string) {
  let cv = waterCanvases.get(region);
  if (cv) return cv;
  const t = mapData.terrain[region];
  cv = document.createElement('canvas');
  cv.width = t.w;
  cv.height = t.h;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(t.w, t.h);
  const lu = mapData.landuse[region];
  for (let j = 0; j < t.h; j++)
    for (let i = 0; i < t.w; i++) {
      const v = t.data[j * t.w + i];
      const o = (j * t.w + i) * 4;
      if (v < 128) {
        const deep = Math.min(1, (128 - v) / 60);
        img.data[o] = 64 - deep * 20;
        img.data[o + 1] = 128 - deep * 30;
        img.data[o + 2] = 140 - deep * 18;
      } else {
        // tint parks / wetlands green on the map
        let c = [222, 214, 196];
        if (lu) {
          const x = t.x0 + (i + 0.5) * t.res, z = t.z0 + (j + 0.5) * t.res;
          const li = Math.floor((x - lu.x0) / lu.res), lj = Math.floor((z - lu.z0) / lu.res);
          const cls = li >= 0 && lj >= 0 && li < lu.w && lj < lu.h ? lu.data[lj * lu.w + li] : 0;
          if (cls === 1 || cls === 2 || cls === 9 || cls === 12) c = [176, 204, 150];
          else if (cls === 3) c = [160, 186, 140];
          else if (cls === 4) c = [232, 218, 176];
          else if (cls === 7) c = [206, 202, 196];
        }
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
      }
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  waterCanvases.set(region, cv);
  return cv;
}

export const ROAD_W_MAP = [3.2, 2.8, 2.4, 2.0, 1.6];

export function MiniMap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const setUi = useGame((s) => s.setUi);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = 132;
    cv.width = S * dpr;
    cv.height = S * dpr;
    const g = cv.getContext('2d')!;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 100) return;
      last = now;
      const p = worldState.riding ? worldState.ridePos : worldState.player;
      const interior = useGame.getState().player?.region === 'interior';
      const R = worldState.riding ? 900 : 240; // metres from centre to edge
      const k = (S / 2 / R) * dpr;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.save();
      g.beginPath();
      g.arc(cv.width / 2, cv.height / 2, cv.width / 2, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = '#ded6c4';
      g.fillRect(0, 0, cv.width, cv.height);
      if (interior) {
        g.restore();
        g.fillStyle = '#1b1c1e';
        g.font = `${12 * dpr}px Barlow Condensed, sans-serif`;
        g.textAlign = 'center';
        g.fillText('Inside', cv.width / 2, cv.height / 2 + 4 * dpr);
        return;
      }
      const W = (x: number) => (x - p.x) * k + cv.width / 2;
      const Z = (z: number) => (z - p.z) * k + cv.height / 2;
      for (const [region, t] of Object.entries(mapData.terrain)) {
        const wc = waterCanvas(region);
        g.imageSmoothingEnabled = true;
        g.drawImage(wc, W(t.x0), Z(t.z0), t.w * t.res * k, t.h * t.res * k);
      }
      // minor roads (loaded chunks)
      g.strokeStyle = '#ffffff';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const lines of worldState.roadLines.values())
        for (const l of lines) {
          if (l.cls > 7) continue;
          g.lineWidth = (l.cls <= 6 ? 1.1 : 0.7) * dpr * (worldState.riding ? 0.5 : 1);
          g.beginPath();
          for (let i = 0; i < l.pts.length; i += 2) {
            const x = W(l.pts[i]), z = Z(l.pts[i + 1]);
            if (i) g.lineTo(x, z);
            else g.moveTo(x, z);
          }
          g.stroke();
        }
      // major roads
      const near = mapData.roadsNear(p.x, p.z, R * 1.5);
      for (const pass of [0, 1]) {
        for (const ri of near) {
          const r = mapData.majorRoads[ri];
          g.strokeStyle = pass === 0 ? '#b49a5e' : r.cls <= 1 ? '#f2c230' : '#fff4d6';
          g.lineWidth = (ROAD_W_MAP[r.cls] + (pass === 0 ? 1.2 : 0)) * dpr * (worldState.riding ? 0.6 : 1);
          g.beginPath();
          for (let i = 0; i < r.pts.length; i += 2) {
            const x = W(r.pts[i]), z = Z(r.pts[i + 1]);
            if (i) g.lineTo(x, z);
            else g.moveTo(x, z);
          }
          g.stroke();
        }
      }
      // POIs
      const target = questTarget();
      for (const q of gameplay.pois) {
        let x = W(q.x), z = Z(q.z);
        const dx = x - cv.width / 2, dz = z - cv.height / 2;
        const d = Math.hypot(dx, dz);
        const lim = cv.width / 2 - 7 * dpr;
        const isT = target?.id === q.id;
        if (d > lim) {
          if (!isT) continue;
          x = cv.width / 2 + (dx / d) * lim;
          z = cv.height / 2 + (dz / d) * lim;
        }
        g.fillStyle = KIND_COLOR[q.kind];
        g.strokeStyle = '#1b1c1e';
        g.lineWidth = 1.5 * dpr;
        g.beginPath();
        g.arc(x, z, (isT ? 5.5 : 4) * dpr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.restore();
      // view cone + player arrow (centre)
      const cx = cv.width / 2, cz = cv.height / 2;
      const yaw = worldState.camYaw;
      const fa = Math.atan2(-Math.sin(yaw), -Math.cos(yaw)); // camera forward in canvas space (x right, y down)
      g.fillStyle = 'rgba(27,28,30,0.16)';
      g.beginPath();
      g.moveTo(cx, cz);
      g.arc(cx, cz, 36 * dpr, Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) - 0.5, Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) + 0.5);
      g.closePath();
      g.fill();
      void fa;
      const h = worldState.riding ? worldState.rideHeading : worldState.playerHeading;
      g.save();
      g.translate(cx, cz);
      g.rotate(Math.PI - h);
      g.fillStyle = '#1b1c1e';
      g.strokeStyle = '#f2c230';
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.moveTo(0, -8 * dpr);
      g.lineTo(6 * dpr, 6 * dpr);
      g.lineTo(0, 3 * dpr);
      g.lineTo(-6 * dpr, 6 * dpr);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <button className="minimap" onClick={() => setUi('map')} aria-label="Minimap — tap to open the full map">
      <canvas ref={ref} style={{ width: 132, height: 132 }} />
      <span className="minimap-n" aria-hidden>N</span>
    </button>
  );
}
