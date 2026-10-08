// Gameplay points of interest (positions come from real OSM features — see scripts/curate_pois.py) and the
// actions behind them: work, eat, shop, social / dance, home & sleep, danfo fast travel.
import { DATA_BASE } from './map/mapData';
import { useGame, naira, type Interaction } from '../store/gameStore';
import { worldState } from './worldState';
import { INTERIOR } from './interiorLayout';

export type PoiKind = 'work' | 'eat' | 'shop' | 'social' | 'home' | 'danfo';

export interface ShopItem { id: string; name: string; price: number }

export interface GamePoi {
  id: string;
  kind: PoiKind;
  name: string; // what the player sees
  place: string; // real OSM feature / street it is based on
  zone: string; // district
  x: number;
  z: number;
  lat: number;
  lon: number;
  heading?: number;
  osm?: string;
  pay?: number;
  energy?: number;
  seconds?: number;
  price?: number;
  meal?: string;
  hunger?: number;
  items?: ShopItem[];
}

export interface Gameplay {
  spawn: { x: number; z: number; heading: number; zone: string };
  pois: GamePoi[];
}

export let gameplay: Gameplay = { spawn: { x: 0, z: 0, heading: 0, zone: '' }, pois: [] };

export async function loadGameplay() {
  const r = await fetch(DATA_BASE + 'gameplay.json');
  gameplay = await r.json();
  return gameplay;
}

export const KIND_COLOR: Record<PoiKind, string> = {
  work: '#3d8bd9',
  eat: '#e0622f',
  shop: '#b74fc4',
  social: '#e8b21f',
  home: '#2fa66a',
  danfo: '#f2c230',
};

export function fareBetween(a: GamePoi, b: GamePoi) {
  const d = Math.hypot(a.x - b.x, a.z - b.z) / 1000;
  return Math.round((150 + d * 60) / 50) * 50;
}

/** Turn a POI into the interaction the HUD shows when the player is close */
export function describe(p: GamePoi): Interaction {
  const g = useGame.getState();
  switch (p.kind) {
    case 'work': {
      const tired = g.energy < 15 ? 'Too tired to work — eat or rest first' : g.hunger > 92 ? 'Too hungry to work — find food' : undefined;
      return { id: p.id, kind: 'work', title: p.name, subtitle: `Work a shift · earn ${naira(p.pay ?? 2000)}`, reward: p.pay, disabledReason: tired };
    }
    case 'eat':
      return { id: p.id, kind: 'eat', title: p.name, subtitle: `${p.meal ?? 'Meal'} · ${naira(p.price ?? 1500)}`, price: p.price, disabledReason: g.cash < (p.price ?? 0) ? `You need ${naira(p.price ?? 0)}` : g.hunger < 8 ? 'You are full' : undefined };
    case 'shop':
      return { id: p.id, kind: 'shop', title: p.name, subtitle: `Browse ${p.items?.length ?? 0} items`, disabledReason: undefined };
    case 'social':
      return { id: p.id, kind: 'social', title: p.name, subtitle: `Dance · entry ${naira(p.price ?? 1000)}`, price: p.price, disabledReason: g.cash < (p.price ?? 0) ? `Entry is ${naira(p.price ?? 0)}` : g.energy < 8 ? 'Too tired to dance' : undefined };
    case 'home':
      return { id: p.id, kind: 'home', title: p.name, subtitle: 'Go inside', disabledReason: undefined };
    case 'danfo':
      return { id: p.id, kind: 'danfo', title: p.name, subtitle: 'Board a danfo to another district', disabledReason: undefined };
  }
}

const INTERIOR_POIS = {
  bed: { id: 'bed', kind: 'sleep' as const, title: 'Your bed', subtitle: 'Sleep · restores energy' },
  door: { id: 'door', kind: 'exit' as const, title: 'Front door', subtitle: 'Go back outside' },
};

export function interiorInteraction(x: number, z: number): Interaction | null {
  const bx = INTERIOR.x + INTERIOR.bed.x, bz = INTERIOR.z + INTERIOR.bed.z;
  const dx = INTERIOR.x + INTERIOR.door.x, dz = INTERIOR.z + INTERIOR.door.z;
  if (Math.hypot(x - bx, z - bz) < 2.0) {
    const g = useGame.getState();
    return { ...INTERIOR_POIS.bed, disabledReason: g.energy > 97 ? 'You are fully rested' : undefined };
  }
  if (Math.hypot(x - dx, z - dz) < 1.6) return INTERIOR_POIS.door;
  return null;
}

function busy(label: string, seconds: number, done: () => void) {
  const g = useGame.getState();
  const now = performance.now();
  g.setBusy({ label, started: now, until: now + seconds * 1000 });
  setTimeout(() => {
    useGame.getState().setBusy(null);
    done();
  }, seconds * 1000);
}

let homeReturn: { x: number; z: number; heading: number } | null = null;

export function perform(it: Interaction) {
  const g = useGame.getState();
  if (it.disabledReason) {
    g.toast(it.disabledReason, 'bad');
    return;
  }
  if (g.busy) return;
  const p = gameplay.pois.find((q) => q.id === it.id);
  switch (it.kind) {
    case 'work': {
      if (!p) return;
      busy('Working…', p.seconds ?? 4, () => {
        const s = useGame.getState();
        s.earn(p.pay ?? 2000, 'shift');
        s.patch({ energy: Math.max(0, s.energy - (p.energy ?? 18)), hunger: Math.min(100, s.hunger + 10), stats: { ...s.stats, shifts: s.stats.shifts + 1 } });
        s.addXp(25);
        s.toast(`Shift done! +${naira(p.pay ?? 2000)}`, 'good');
        s.completeQuest('find-work');
        s.completeQuest('earn');
      });
      return;
    }
    case 'eat': {
      if (!p || !g.spend(p.price ?? 1500, p.meal ?? 'food')) return;
      busy('Eating…', 2.5, () => {
        const s = useGame.getState();
        s.patch({ hunger: Math.max(0, s.hunger - (p.hunger ?? 45)), energy: Math.min(100, s.energy + 15), stats: { ...s.stats, meals: s.stats.meals + 1 } });
        s.addXp(8);
        s.toast(`You don chop ${p.meal ?? 'well'} 😋`, 'good');
        s.completeQuest('eat');
      });
      return;
    }
    case 'shop':
      useShop.open(p ?? null);
      return;
    case 'social': {
      if (!p || !g.spend(p.price ?? 1000, 'entry')) return;
      g.setEmote('dance');
      g.toast('Oya, dance! 🕺', 'good');
      setTimeout(() => {
        const s = useGame.getState();
        if (s.emote !== 'dance') return;
        s.patch({ energy: Math.max(0, s.energy - 6), stats: { ...s.stats, dances: s.stats.dances + 1 } });
        s.addXp(15);
        s.completeQuest('social');
      }, 3500);
      return;
    }
    case 'home': {
      if (!p) return;
      homeReturn = { x: p.x, z: p.z, heading: p.heading ?? 0 };
      fade(() => {
        const s = useGame.getState();
        s.savePlayer({ x: INTERIOR.x + INTERIOR.spawn.x, z: INTERIOR.z + INTERIOR.spawn.z, y: INTERIOR.y + 0.05, heading: INTERIOR.spawn.heading, region: 'interior' });
        worldState.teleport = { x: INTERIOR.x + INTERIOR.spawn.x, z: INTERIOR.z + INTERIOR.spawn.z, y: INTERIOR.y + 0.05, heading: INTERIOR.spawn.heading };
      });
      return;
    }
    case 'sleep': {
      busy('Sleeping…', 3, () => {
        const s = useGame.getState();
        s.patch({ energy: 100, hunger: Math.min(100, s.hunger + 12), stats: { ...s.stats, rests: s.stats.rests + 1 } });
        s.addXp(5);
        s.toast('Fully rested ✨', 'good');
      });
      return;
    }
    case 'exit': {
      const home = homeReturn ?? (() => {
        const h = gameplay.pois.find((q) => q.kind === 'home');
        return h ? { x: h.x, z: h.z, heading: h.heading ?? 0 } : { x: gameplay.spawn.x, z: gameplay.spawn.z, heading: 0 };
      })();
      fade(() => {
        const s = useGame.getState();
        s.savePlayer({ x: home.x, z: home.z, y: 0.1, heading: home.heading, region: 'world' });
        worldState.teleport = { x: home.x, z: home.z, y: 0.1, heading: home.heading };
      });
      return;
    }
    case 'danfo':
      useDanfo.open(p ?? null);
      return;
  }
}

// --- tiny event hubs for sheets (avoid circular store deps)
type Listener<T> = (v: T) => void;
function hub<T>() {
  let cur: T | null = null;
  const ls = new Set<Listener<T | null>>();
  return {
    open(v: T | null) { cur = v; ls.forEach((l) => l(cur)); },
    close() { cur = null; ls.forEach((l) => l(null)); },
    get() { return cur; },
    on(l: Listener<T | null>) { ls.add(l); return () => { ls.delete(l); }; },
  };
}
export const useShop = hub<GamePoi>();
export const useDanfo = hub<GamePoi>();

export const fadeHub = hub<number>();
export function fade(mid: () => void) {
  fadeHub.open(1);
  setTimeout(() => {
    mid();
    setTimeout(() => fadeHub.open(0), 350);
  }, 380);
}

export function buy(p: GamePoi, item: ShopItem) {
  const g = useGame.getState();
  if (!g.spend(item.price, item.name)) return;
  g.patch({ inventory: [...g.inventory, item.id] });
  g.addXp(10);
  g.toast(`Bought ${item.name} for ${naira(item.price)}`, 'good');
  void p;
}
