import { useGame } from '../store/gameStore';
import { perform } from '../game/gameplay';

const VERB: Record<string, string> = {
  work: 'Work', eat: 'Eat', shop: 'Browse', social: 'Dance', home: 'Enter', danfo: 'Board', sleep: 'Sleep', exit: 'Go out', info: 'Look',
};

/** Contextual card that appears only near a point of interest — styled like the side of a danfo. */
export function InteractionCard() {
  const it = useGame((s) => s.nearby);
  const busy = useGame((s) => s.busy);
  const ui = useGame((s) => s.ui);
  if (!it || busy || ui) return null;
  const disabled = !!it.disabledReason;
  return (
    <div className={`icard ${disabled ? 'is-off' : ''}`} role="dialog" aria-label={it.title}>
      <div className="icard-body">
        <div className="icard-title">{it.title}</div>
        <div className="icard-sub">{disabled ? it.disabledReason : it.subtitle}</div>
      </div>
      <button className="icard-go" onClick={() => perform(it)} disabled={disabled}>
        {VERB[it.kind] ?? 'Use'}
        <kbd>E</kbd>
      </button>
    </div>
  );
}
