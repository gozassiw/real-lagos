import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const START_CASH = 5000;

export type Region = 'world' | 'interior';

export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

export interface Interaction {
  id: string; // poi id
  kind: 'work' | 'eat' | 'shop' | 'social' | 'home' | 'danfo' | 'sleep' | 'exit' | 'info';
  title: string;
  subtitle: string;
  price?: number;
  reward?: number;
  disabledReason?: string;
}

export const QUEST_STEPS = [
  { id: 'find-work', title: 'Find work', hint: 'Danfo from Bourdillon to the VI office — or walk over Falomo Bridge' },
  { id: 'earn', title: 'Earn some naira', hint: 'Do a shift at the job' },
  { id: 'eat', title: 'Buy food', hint: 'Eat at a buka or restaurant' },
  { id: 'social', title: 'Visit a social spot', hint: 'Take a danfo to Admiralty Way, Lekki Phase 1 — dance at the lounge' },
  { id: 'done', title: 'You dey Lagos now!', hint: 'Explore, shop at Balogun, rest at home in Ikoyi' },
] as const;

export type QuestId = (typeof QUEST_STEPS)[number]['id'];

interface Persisted {
  version: number;
  avatarId: string | null;
  cash: number;
  energy: number;
  hunger: number;
  xp: number;
  inventory: string[];
  quest: number; // index into QUEST_STEPS
  stats: { shifts: number; meals: number; dances: number; rides: number; rests: number; earned: number; spent: number };
  player: { x: number; z: number; y: number; heading: number; region: Region } | null;
  visited: string[]; // area names seen
  settings: { muted: boolean; quality: 'auto' | 'low' | 'high'; showFps: boolean };
}

interface Transient {
  ready: boolean;
  area: string;
  nearby: Interaction | null;
  busy: null | { label: string; until: number; started: number };
  emote: null | 'dance' | 'nod';
  toasts: Toast[];
  ui: null | 'map' | 'settings' | 'danfo' | 'welcome' | 'stats';
  ride: null | { from: string; to: string; fare: number };
  fps: number;
  lowPower: boolean;
}

export interface GameState extends Persisted, Transient {
  level: () => number;
  setAvatar: (id: string) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dropToast: (id: number) => void;
  setNearby: (i: Interaction | null) => void;
  setArea: (a: string) => void;
  setUi: (u: Transient['ui']) => void;
  savePlayer: (p: Persisted['player']) => void;
  tick: (dt: number, running: boolean, moving: boolean) => void;
  spend: (amount: number, what: string) => boolean;
  earn: (amount: number, what: string) => void;
  addXp: (n: number) => void;
  completeQuest: (id: QuestId) => void;
  setBusy: (b: Transient['busy']) => void;
  setEmote: (e: Transient['emote']) => void;
  setRide: (r: Transient['ride']) => void;
  patch: (p: Partial<Persisted & Transient>) => void;
  reset: () => void;
}

const fresh = (): Persisted => ({
  version: 1,
  avatarId: null,
  cash: START_CASH,
  energy: 80,
  hunger: 30,
  xp: 0,
  inventory: [],
  quest: 0,
  stats: { shifts: 0, meals: 0, dances: 0, rides: 0, rests: 0, earned: 0, spent: 0 },
  player: null,
  visited: [],
  settings: { muted: false, quality: 'auto', showFps: false },
});

let toastId = 1;
const clamp = (v: number, a = 0, b = 100) => Math.min(b, Math.max(a, v));

export const useGame = create<GameState>()(
  persist(
    (set, get) => ({
      ...fresh(),
      ready: false,
      area: '',
      nearby: null,
      busy: null,
      emote: null,
      toasts: [],
      ui: null,
      ride: null,
      fps: 0,
      lowPower: false,

      level: () => Math.floor(get().xp / 100) + 1,
      setAvatar: (id) => set({ avatarId: id }),
      toast: (text, tone = 'info') => {
        const id = toastId++;
        set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
        setTimeout(() => get().dropToast(id), 3200);
      },
      dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      setNearby: (i) => {
        const cur = get().nearby;
        if (cur === i || (cur && i && cur.id === i.id && cur.disabledReason === i.disabledReason && cur.subtitle === i.subtitle)) return;
        set({ nearby: i });
      },
      setArea: (a) => {
        if (a === get().area) return;
        const visited = get().visited.includes(a) || !a ? get().visited : [...get().visited, a];
        set({ area: a, visited });
      },
      setUi: (u) => set({ ui: u }),
      savePlayer: (p) => set({ player: p }),
      tick: (dt, running, moving) => {
        const s = get();
        const hungerRate = 0.05 + (running ? 0.06 : 0) + (moving ? 0.01 : 0);
        let energyRate = -(0.015 + (running ? 0.09 : moving ? 0.012 : 0));
        if (s.hunger > 85) energyRate *= 2.2;
        set({ hunger: clamp(s.hunger + hungerRate * dt), energy: clamp(s.energy + energyRate * dt) });
      },
      spend: (amount, what) => {
        const s = get();
        if (s.cash < amount) {
          s.toast(`Not enough cash for ${what} — you need ₦${amount.toLocaleString()}`, 'bad');
          return false;
        }
        set({ cash: s.cash - amount, stats: { ...s.stats, spent: s.stats.spent + amount } });
        return true;
      },
      earn: (amount) => {
        const s = get();
        set({ cash: s.cash + amount, stats: { ...s.stats, earned: s.stats.earned + amount } });
      },
      addXp: (n) => {
        const before = get().level();
        set((s) => ({ xp: s.xp + n }));
        const after = get().level();
        if (after > before) get().toast(`Level up! You're now level ${after}`, 'good');
      },
      completeQuest: (id) => {
        const s = get();
        const cur = QUEST_STEPS[s.quest];
        if (!cur || cur.id !== id) return;
        const next = s.quest + 1;
        set({ quest: next });
        s.addXp(20);
        const n = QUEST_STEPS[next];
        if (n) s.toast(n.id === 'done' ? 'Quest complete! +20 XP' : `Next: ${n.title}`, 'good');
      },
      setBusy: (b) => set({ busy: b }),
      setEmote: (e) => set({ emote: e }),
      setRide: (r) => set({ ride: r }),
      patch: (p) => set(p as Partial<GameState>),
      reset: () => {
        set({ ...fresh(), area: '', nearby: null, busy: null, emote: null, ui: null, ride: null });
      },
    }),
    {
      name: 'real-lagos-save-v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s): Persisted => ({
        version: s.version,
        avatarId: s.avatarId,
        cash: s.cash,
        energy: s.energy,
        hunger: s.hunger,
        xp: s.xp,
        inventory: s.inventory,
        quest: s.quest,
        stats: s.stats,
        player: s.player,
        visited: s.visited,
        settings: s.settings,
      }),
    },
  ),
);

export const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
