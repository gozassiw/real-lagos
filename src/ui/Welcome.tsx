import { useState } from 'react';
import { AVATAR_PRESETS } from '../game/avatar/buildAvatar';
import { useGame, naira, START_CASH } from '../store/gameStore';
import { gameplay } from '../game/gameplay';

function Swatch({ look }: { look: (typeof AVATAR_PRESETS)[number]['look'] }) {
  // a tiny flat portrait in the avatar's colours
  return (
    <svg viewBox="0 0 40 56" width="40" height="56" aria-hidden>
      <rect x="11" y="44" width="7" height="12" rx="2" fill={look.outfit === 'wrapper' ? look.skin : look.bottom} />
      <rect x="22" y="44" width="7" height="12" rx="2" fill={look.outfit === 'wrapper' ? look.skin : look.bottom} />
      {look.outfit === 'wrapper' && <path d="M9 30h22l2 18H7z" fill={look.bottom} />}
      {look.outfit === 'kaftan' && <path d="M9 22h22l2 26H7z" fill={look.top} />}
      <rect x="9" y="20" width="22" height="18" rx="5" fill={look.top} />
      <rect x="9" y="20" width="22" height="3" rx="1.5" fill={look.topAccent} />
      <circle cx="20" cy="12" r="8" fill={look.skin} />
      {look.hairStyle === 'gele' ? <ellipse cx="20" cy="5.5" rx="11" ry="6" fill={look.hair} /> : look.hairStyle === 'afro' ? <circle cx="20" cy="8" r="9.5" fill={look.hair} opacity="0.95" /> : <path d="M12 10a8 8 0 0 1 16 0z" fill={look.hair} />}
      {look.hairStyle === 'bun' && <circle cx="20" cy="2.5" r="3.2" fill={look.hair} />}
    </svg>
  );
}

export function Welcome() {
  const setAvatar = useGame((s) => s.setAvatar);
  const [pick, setPick] = useState(AVATAR_PRESETS[0].id);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1 className="brand">Real Lagos</h1>
        <p className="welcome-lead">
          You just landed in {gameplay.spawn.zone || 'Lagos'} with {naira(START_CASH)} in your pocket. Find work, chop, catch a danfo across the lagoon and enjoy the city — every road, bridge and shoreline here comes from the real map.
        </p>
        <h2 className="welcome-h">Pick your look</h2>
        <div className="presets" role="radiogroup" aria-label="Character">
          {AVATAR_PRESETS.map((p) => (
            <button key={p.id} role="radio" aria-checked={pick === p.id} className={`preset ${pick === p.id ? 'on' : ''}`} onClick={() => setPick(p.id)}>
              <Swatch look={p.look} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => setAvatar(pick)}>
          Start in {gameplay.spawn.zone || 'Lagos'}
        </button>
        <p className="welcome-keys">Phone: left thumb to move, drag right side to look. Desktop: WASD, Shift to run, E to use, M for map.</p>
      </div>
    </div>
  );
}
