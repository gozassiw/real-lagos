// Bottom sheets: market stall, danfo destinations, settings.
import { useEffect, useState } from 'react';
import { useShop, useDanfo, buy, gameplay, fareBetween, type GamePoi } from '../game/gameplay';
import { startRide } from '../game/DanfoRide';
import { useGame, naira, QUEST_STEPS } from '../store/gameStore';
import { audio } from '../game/audio';
import { mapData } from '../game/map/mapData';

function useHub(h: typeof useShop) {
  const [v, setV] = useState<GamePoi | null>(h.get());
  useEffect(() => h.on(setV), [h]);
  return v;
}

function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={title}>
        <header className="sheet-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function ShopSheet({ p }: { p: GamePoi }) {
  const cash = useGame((s) => s.cash);
  const inv = useGame((s) => s.inventory);
  return (
    <Sheet title={p.name} sub={`${p.place.replace(/\s*\((node|way|relation)\/\d+\)/, '')}, ${p.zone} · you have ${naira(cash)}`} onClose={() => useShop.close()}>
      <ul className="items">
        {(p.items ?? []).map((it) => {
          const owned = inv.filter((x) => x === it.id).length;
          return (
            <li key={it.id}>
              <span className="item-name">
                {it.name}
                {owned > 0 && <small>You have {owned}</small>}
              </span>
              <button className="btn-buy" disabled={cash < it.price} onClick={() => buy(p, it)}>
                {naira(it.price)}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function DanfoSheet({ p }: { p: GamePoi }) {
  const cash = useGame((s) => s.cash);
  const stops = gameplay.pois.filter((q) => q.kind === 'danfo' && q.id !== p.id);
  return (
    <Sheet title="Where you dey go?" sub={`${p.name} · conductor dey call: “Enter with your change!”`} onClose={() => useDanfo.close()}>
      <ul className="items">
        {stops.map((q) => {
          const fare = fareBetween(p, q);
          const km = Math.hypot(p.x - q.x, p.z - q.z) / 1000;
          return (
            <li key={q.id}>
              <span className="item-name">
                {q.zone}
                <small>{q.name} · {km.toFixed(1)} km away</small>
              </span>
              <button
                className="btn-buy"
                disabled={cash < fare}
                onClick={() => {
                  useDanfo.close();
                  startRide(p, q, fare);
                }}
              >
                {naira(fare)}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function SettingsSheet() {
  const s = useGame();
  const [confirmReset, setConfirmReset] = useState(false);
  const set = (patch: Partial<typeof s.settings>) => s.patch({ settings: { ...s.settings, ...patch } });
  const base = mapData.manifest.osmBase ? new Date(mapData.manifest.osmBase).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return (
    <Sheet title="Settings" onClose={() => s.setUi(null)}>
      <div className="settings">
        <label className="row">
          <span>Sound</span>
          <input
            type="checkbox"
            checked={!s.settings.muted}
            onChange={(e) => {
              set({ muted: !e.target.checked });
              audio.setMuted(!e.target.checked);
              audio.start();
            }}
          />
        </label>
        <div className="row">
          <span>Graphics</span>
          <div className="seg">
            {(['auto', 'low', 'high'] as const).map((q) => (
              <button key={q} className={s.settings.quality === q ? 'on' : ''} onClick={() => { set({ quality: q }); s.patch({ lowPower: q === 'low' }); }}>
                {q === 'auto' ? 'Auto' : q === 'low' ? 'Battery saver' : 'Sharp'}
              </button>
            ))}
          </div>
        </div>
        <label className="row">
          <span>Show frame rate</span>
          <input type="checkbox" checked={s.settings.showFps} onChange={(e) => set({ showFps: e.target.checked })} />
        </label>
        <div className="row stats-row">
          <span>Progress</span>
          <small>
            {QUEST_STEPS[s.quest]?.title} · {s.stats.shifts} shifts · {s.stats.meals} meals · {s.stats.rides} danfo rides · earned {naira(s.stats.earned)}
          </small>
        </div>
        <div className="help">
          <b>Controls</b>
          <p>Phone: left thumb moves, drag on the right to look around, pinch to zoom out over the map. Desktop: WASD / arrows, Shift or R to run, drag to look, wheel to zoom, E to use, M for the map.</p>
        </div>
        <p className="attrib">
          Map data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, available under the ODbL.
          {base && ` OSM snapshot: ${base}.`} Roads, coastline, lagoon, bridges, buildings and places in this game are generated from that data.
        </p>
        {confirmReset ? (
          <div className="confirm-reset" role="alert">
            <p>Start over? Your cash, stats and quest progress go back to the beginning.</p>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmReset(false)}>Keep playing</button>
              <button
                className="btn-danger"
                onClick={() => {
                  s.reset();
                  location.reload();
                }}
              >
                Start over
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-danger" onClick={() => setConfirmReset(true)}>
            Reset progress
          </button>
        )}
      </div>
    </Sheet>
  );
}

export function Sheets() {
  const shop = useHub(useShop);
  const danfo = useHub(useDanfo);
  const ui = useGame((s) => s.ui);
  return (
    <>
      {shop && <ShopSheet p={shop} />}
      {danfo && <DanfoSheet p={danfo} />}
      {ui === 'settings' && <SettingsSheet />}
    </>
  );
}
