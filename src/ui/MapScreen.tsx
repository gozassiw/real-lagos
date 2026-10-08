// Full-screen map of the playable area, drawn from the same OSM-derived assets as the 3D world.
import { useEffect, useRef, useState } from 'react';
import { mapData } from '../game/map/mapData';
import { worldState } from '../game/worldState';
import { gameplay, KIND_COLOR, type GamePoi } from '../game/gameplay';
import { questTarget } from '../game/InteractionSystem';
import { useGame } from '../store/gameStore';
import { waterCanvas, ROAD_W_MAP } from './MiniMap';
import { worldToGeo } from '../game/map/geoToWorld';

const LABEL_KINDS = new Set(['suburb', 'quarter', 'neighbourhood', 'island']);
const KIND_NAME: Record<GamePoi['kind'], string> = { work: 'Job', eat: 'Food', shop: 'Market', social: 'Lounge', home: 'Home', danfo: 'Danfo stop' };

export function MapScreen() {
  const ref = useRef<HTMLCanvasElement>(null);
  const setUi = useGame((s) => s.setUi);
  const [sel, setSel] = useState<GamePoi | null>(null);
  const view = useRef({ cx: worldState.player.x, cz: worldState.player.z, scale: 0.12 }); // px per metre
  const [, redraw] = useState(0);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;
    const resize = () => {
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = view.current;
      const k = v.scale * dpr;
      const W = (x: number) => (x - v.cx) * k + cv.width / 2;
      const Z = (z: number) => (z - v.cz) * k + cv.height / 2;
      g.fillStyle = '#cfc7b5';
      g.fillRect(0, 0, cv.width, cv.height);
      g.imageSmoothingEnabled = true;
      for (const [region, t] of Object.entries(mapData.terrain)) g.drawImage(waterCanvas(region), W(t.x0), Z(t.z0), t.w * t.res * k, t.h * t.res * k);
      // rail
      g.setLineDash([4 * dpr, 3 * dpr]);
      g.strokeStyle = '#6b5f73';
      g.lineWidth = 1.2 * dpr;
      for (const r of mapData.rail) {
        g.beginPath();
        for (let i = 0; i < r.pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, W(r.pts[i]), Z(r.pts[i + 1]));
        g.stroke();
      }
      g.setLineDash([]);
      // roads: casing then fill, minor classes faded when zoomed out
      const zoomK = Math.min(1.6, Math.max(0.5, v.scale / 0.12));
      for (const pass of [0, 1])
        for (const r of mapData.majorRoads) {
          if (r.cls >= 4 && v.scale < 0.06) continue;
          g.strokeStyle = pass ? (r.cls <= 1 ? '#f2c230' : '#fffaf0') : '#9c8657';
          g.lineWidth = (ROAD_W_MAP[r.cls] * 0.8 * zoomK + (pass ? 0 : 1.1)) * dpr;
          g.beginPath();
          for (let i = 0; i < r.pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, W(r.pts[i]), Z(r.pts[i + 1]));
          g.stroke();
        }
      // district labels (OSM place nodes)
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const p of mapData.places) {
        if (!LABEL_KINDS.has(p.kind)) continue;
        if (p.kind === 'neighbourhood' && v.scale < 0.18) continue;
        const big = p.kind === 'suburb' || p.kind === 'island';
        g.font = `${big ? 600 : 500} ${(big ? 14 : 11) * dpr}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        g.lineWidth = 3 * dpr;
        g.strokeStyle = 'rgba(255,252,244,0.85)';
        g.fillStyle = big ? '#2a2620' : '#5a5246';
        g.strokeText(p.name, W(p.x), Z(p.z));
        g.fillText(p.name, W(p.x), Z(p.z));
      }
      // POIs
      const target = questTarget();
      for (const q of gameplay.pois) {
        const x = W(q.x), z = Z(q.z);
        g.fillStyle = KIND_COLOR[q.kind];
        g.strokeStyle = '#1b1c1e';
        g.lineWidth = 2 * dpr;
        g.beginPath();
        g.arc(x, z, (target?.id === q.id ? 8 : 6) * dpr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        if (target?.id === q.id) {
          g.strokeStyle = KIND_COLOR[q.kind];
          g.lineWidth = 2 * dpr;
          g.beginPath();
          g.arc(x, z, (12 + 3 * Math.sin(performance.now() / 250)) * dpr, 0, Math.PI * 2);
          g.stroke();
        }
      }
      // player
      const p = worldState.player;
      const px = W(p.x), pz = Z(p.z);
      g.save();
      g.translate(px, pz);
      g.rotate(Math.PI - worldState.playerHeading);
      g.fillStyle = '#1b1c1e';
      g.strokeStyle = '#f2c230';
      g.lineWidth = 2.5 * dpr;
      g.beginPath();
      g.moveTo(0, -11 * dpr);
      g.lineTo(8 * dpr, 8 * dpr);
      g.lineTo(0, 4 * dpr);
      g.lineTo(-8 * dpr, 8 * dpr);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    };
    raf = requestAnimationFrame(draw);

    // pan / zoom
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const q = pts.get(e.pointerId);
      if (!q) return;
      const dx = e.clientX - q.x, dy = e.clientY - q.y;
      q.x = e.clientX;
      q.y = e.clientY;
      const v = view.current;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) v.scale = Math.min(1.2, Math.max(0.025, v.scale * (d / pinch)));
        pinch = d;
        moved += 10;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      v.cx -= dx / v.scale;
      v.cz -= dy / v.scale;
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (moved < 6) {
        // tap: select nearest POI within 22 px
        const r = cv.getBoundingClientRect();
        const v = view.current;
        const wx = v.cx + (e.clientX - r.left - r.width / 2) / v.scale;
        const wz = v.cz + (e.clientY - r.top - r.height / 2) / v.scale;
        let best: GamePoi | null = null, bd = 22 / v.scale;
        for (const q of gameplay.pois) {
          const d = Math.hypot(q.x - wx, q.z - wz);
          if (d < bd) { bd = d; best = q; }
        }
        setSel(best);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      v.scale = Math.min(1.2, Math.max(0.025, v.scale * (e.deltaY > 0 ? 0.88 : 1.14)));
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
    };
  }, []);

  const zoom = (f: number) => {
    view.current.scale = Math.min(1.2, Math.max(0.025, view.current.scale * f));
    redraw((n) => n + 1);
  };
  const me = () => {
    view.current.cx = worldState.player.x;
    view.current.cz = worldState.player.z;
  };
  const p = worldState.player;
  const ll = worldToGeo(p.x, p.z);
  return (
    <div className="mapscreen">
      <canvas ref={ref} className="mapcanvas" />
      <div className="map-top">
        <div className="map-title">
          <b>Lagos</b>
          <small>
            You are at {ll.lat.toFixed(4)}°N, {ll.lon.toFixed(4)}°E
          </small>
        </div>
        <button className="close" onClick={() => setUi(null)} aria-label="Close map">✕</button>
      </div>
      <div className="map-tools">
        <button onClick={() => zoom(1.3)} aria-label="Zoom in">+</button>
        <button onClick={() => zoom(1 / 1.3)} aria-label="Zoom out">−</button>
        <button onClick={me} aria-label="Centre on me">◎</button>
      </div>
      <div className="map-legend">
        {(Object.keys(KIND_NAME) as GamePoi['kind'][]).map((k) => (
          <span key={k}><i style={{ background: KIND_COLOR[k] }} />{KIND_NAME[k]}</span>
        ))}
      </div>
      {sel && (
        <div className="map-sel">
          <i style={{ background: KIND_COLOR[sel.kind] }} />
          <div>
            <b>{sel.name}</b>
            <small>
              {KIND_NAME[sel.kind]} · {sel.zone} · {(Math.hypot(sel.x - p.x, sel.z - p.z) / 1000).toFixed(1)} km · based on OSM: {sel.place}
            </small>
          </div>
        </div>
      )}
      <a className="map-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        Map data © OpenStreetMap contributors
      </a>
    </div>
  );
}
