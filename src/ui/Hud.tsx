import { useEffect, useState } from 'react';
import { useGame, naira, QUEST_STEPS } from '../store/gameStore';
import { MiniMap } from './MiniMap';
import { MobileControls } from './MobileControls';
import { InteractionCard } from './InteractionCard';
import { MapScreen } from './MapScreen';
import { Sheets } from './Sheets';
import { Welcome } from './Welcome';
import { fadeHub } from '../game/gameplay';
import { skipRide } from '../game/DanfoRide';
import { questTarget } from '../game/InteractionSystem';
import { worldState } from '../game/worldState';
import { mapData } from '../game/map/mapData';
import { headingDeg } from '../game/map/geoToWorld';

function Meter({ value, kind, label }: { value: number; kind: 'energy' | 'hunger'; label: string }) {
  return (
    <div className={`meter meter-${kind}`} title={`${label} ${Math.round(value)}%`}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${Math.round(value)}%` }} />
      </span>
    </div>
  );
}

function Stats() {
  const cash = useGame((s) => s.cash);
  const energy = useGame((s) => s.energy);
  const hunger = useGame((s) => s.hunger);
  const xp = useGame((s) => s.xp);
  const level = Math.floor(xp / 100) + 1;
  return (
    <div className="stats">
      <div className="cash" aria-label="Cash">
        <span className="cash-n">{naira(cash)}</span>
        <span className="lvl" title={`${xp % 100}/100 XP to next level`}>
          Lv {level}
          <span className="lvl-bar"><span style={{ width: `${xp % 100}%` }} /></span>
        </span>
      </div>
      <Meter value={energy} kind="energy" label="Energy" />
      <Meter value={hunger} kind="hunger" label="Hunger" />
    </div>
  );
}

function Quest() {
  const quest = useGame((s) => s.quest);
  const [info, setInfo] = useState<{ dist: number; arrow: number } | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const t = questTarget();
      if (!t || useGame.getState().player?.region === 'interior') return setInfo(null);
      const p = worldState.player;
      const dx = t.x - p.x, dz = t.z - p.z;
      // arrow relative to the camera's view direction
      const bearing = Math.atan2(dx, -dz);
      const camFwd = Math.atan2(-Math.sin(worldState.camYaw), Math.cos(worldState.camYaw));
      setInfo({ dist: Math.hypot(dx, dz), arrow: bearing - camFwd });
    }, 250);
    return () => clearInterval(id);
  }, []);
  const step = QUEST_STEPS[quest] ?? QUEST_STEPS[QUEST_STEPS.length - 1];
  return (
    <div className="quest" aria-live="polite">
      <span className="quest-step">{quest + 1 > QUEST_STEPS.length - 1 ? '✓' : `${quest + 1}/4`}</span>
      <span className="quest-text">
        <b>{step.title}</b>
        <small>{step.hint}</small>
      </span>
      {info && step.id !== 'done' && (
        <span className="quest-dir">
          <span className="quest-arrow" style={{ transform: `rotate(${info.arrow}rad)` }}>▲</span>
          <span className="quest-dist">{info.dist > 1000 ? `${(info.dist / 1000).toFixed(1)} km` : `${Math.round(info.dist)} m`}</span>
        </span>
      )}
    </div>
  );
}

function AreaLabel() {
  const area = useGame((s) => s.area);
  const [road, setRoad] = useState('');
  const [compass, setCompass] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const p = worldState.riding ? worldState.ridePos : worldState.player;
      const r = mapData.nearestMajorRoad(p.x, p.z, 25);
      let name = r?.road.name ?? '';
      if (!name) {
        // minor roads from loaded chunks
        let bd = 14;
        for (const lines of worldState.roadLines.values())
          for (const l of lines) {
            for (let i = 0; i + 3 < l.pts.length; i += 2) {
              const ax = l.pts[i], az = l.pts[i + 1], bx = l.pts[i + 2], bz = l.pts[i + 3];
              const dx = bx - ax, dz = bz - az;
              const L = dx * dx + dz * dz;
              let t = L ? ((p.x - ax) * dx + (p.z - az) * dz) / L : 0;
              t = Math.max(0, Math.min(1, t));
              const d = Math.hypot(ax + dx * t - p.x, az + dz * t - p.z);
              if (d < bd) { bd = d; name = l.name; }
            }
          }
      }
      setRoad(name);
      setCompass(headingDeg(-Math.sin(worldState.camYaw), -Math.cos(worldState.camYaw)));
    }, 600);
    return () => clearInterval(id);
  }, []);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return (
    <div className="area">
      <div className="area-name">{area || 'Lagos'}</div>
      <div className="area-road">
        {road && <span>{road}</span>}
        <span className="area-compass" title="Camera heading">{dirs[Math.round(compass / 45) % 8]}</span>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>
      ))}
    </div>
  );
}

function BusyBar() {
  const busy = useGame((s) => s.busy);
  const [, force] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => force((n) => n + 1), 50);
    return () => clearInterval(id);
  }, [busy]);
  if (!busy) return null;
  const k = Math.min(1, (performance.now() - busy.started) / (busy.until - busy.started));
  return (
    <div className="busy">
      <span>{busy.label}</span>
      <span className="busy-track"><span style={{ width: `${k * 100}%` }} /></span>
    </div>
  );
}

function RideBanner() {
  const ride = useGame((s) => s.ride);
  if (!ride) return null;
  return (
    <div className="ride">
      <div className="ride-plate">
        <span className="ride-kicker">Danfo to</span>
        <b>{ride.to}</b>
        <small>{ride.from}</small>
      </div>
      <button className="btn-ghost" onClick={skipRide}>Skip ride</button>
    </div>
  );
}

function Fade() {
  const [v, setV] = useState(0);
  useEffect(() => fadeHub.on((x) => setV(x ?? 0)), []);
  return <div className="fade" style={{ opacity: v }} />;
}

function TopButtons() {
  const setUi = useGame((s) => s.setUi);
  const fps = useGame((s) => s.fps);
  const showFps = useGame((s) => s.settings.showFps);
  return (
    <div className="topbtns">
      <button className="icon-btn" onClick={() => setUi('map')} aria-label="Open map (M)" title="Map (M)">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 2.2 6 2v11.6l-6-2V6.2Z" fill="currentColor" /></svg>
      </button>
      <button className="icon-btn" onClick={() => setUi('settings')} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.9 4.7-1.9-.4a7 7 0 0 1-.6 1.5l1.1 1.6-1.6 1.6-1.6-1.1c-.5.3-1 .5-1.5.6l-.4 1.9h-2.3l-.4-1.9a7 7 0 0 1-1.5-.6l-1.6 1.1-1.6-1.6 1.1-1.6a7 7 0 0 1-.6-1.5l-1.9-.4v-2.3l1.9-.4c.1-.5.3-1 .6-1.5L4.6 7.2l1.6-1.6 1.6 1.1c.5-.3 1-.5 1.5-.6l.4-1.9h2.3l.4 1.9c.5.1 1 .3 1.5.6l1.6-1.1 1.6 1.6-1.1 1.6c.3.5.5 1 .6 1.5l1.9.4v2.3Z" fill="currentColor" /></svg>
      </button>
      {showFps && <span className="fps">{fps} fps</span>}
    </div>
  );
}

export function Hud() {
  const ui = useGame((s) => s.ui);
  const avatarId = useGame((s) => s.avatarId);
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-left">
          <Stats />
          <Quest />
        </div>
        <AreaLabel />
        <div className="hud-right">
          <MiniMap />
          <TopButtons />
        </div>
      </div>
      <Toasts />
      <BusyBar />
      <RideBanner />
      <InteractionCard />
      <MobileControls />
      <a className="osm-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        Map data © OpenStreetMap contributors
      </a>
      {ui === 'map' && <MapScreen />}
      <Sheets />
      {!avatarId && <Welcome />}
      <Fade />
    </div>
  );
}
