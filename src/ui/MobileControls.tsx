// Left: floating virtual joystick (appears where the thumb lands in the left zone).
// Right: drag anywhere on the 3D view to orbit the camera (handled by the canvas), Run toggle + Use button.
import { useEffect, useRef, useState } from 'react';
import { input } from '../game/input';
import { useGame } from '../store/gameStore';
import { perform } from '../game/gameplay';

const R = 54;
const VERB: Record<string, string> = { work: 'Work', eat: 'Eat', shop: 'Shop', social: 'Dance', home: 'Enter', danfo: 'Board', sleep: 'Sleep', exit: 'Exit', info: 'Look' };

export function MobileControls() {
  const zone = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState<{ x: number; y: number; kx: number; ky: number } | null>(null);
  const [run, setRun] = useState(input.runToggle);
  const [touchUi, setTouchUi] = useState(false);
  const nearby = useGame((s) => s.nearby);
  const busy = useGame((s) => s.busy);

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    setTouchUi(coarse);
    const onTouch = () => setTouchUi(true);
    window.addEventListener('touchstart', onTouch, { once: true, passive: true });
    const el = zone.current!;
    let id: number | null = null;
    let ox = 0, oy = 0;
    const down = (e: PointerEvent) => {
      if (id !== null) return;
      id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      ox = e.clientX;
      oy = e.clientY;
      setTouchUi(true);
      setStick({ x: ox, y: oy, kx: 0, ky: 0 });
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // drag the base along so the stick never feels stuck
        const over = d - R;
        ox += (dx / d) * over;
        oy += (dy / d) * over;
        dx = e.clientX - ox;
        dy = e.clientY - oy;
      }
      input.jx = dx / R;
      input.jy = -dy / R;
      setStick({ x: ox, y: oy, kx: dx, ky: dy });
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      input.jx = input.jy = 0;
      setStick(null);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('touchstart', onTouch);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('touch-ui', touchUi);
  }, [touchUi]);

  const toggleRun = () => {
    input.runToggle = !input.runToggle;
    setRun(input.runToggle);
  };

  return (
    <>
      <div ref={zone} className={`joy-zone ${touchUi ? 'is-touch' : ''}`} aria-label="Movement joystick">
        {!stick && touchUi && (
          <div className="joy-hint" aria-hidden>
            <span className="joy-base ghost" />
          </div>
        )}
      </div>
      {stick && (
        <div className="joy" style={{ left: stick.x, top: stick.y }} aria-hidden>
          <span className="joy-base" />
          <span className="joy-knob" style={{ transform: `translate(${stick.kx}px, ${stick.ky}px)` }} />
        </div>
      )}
      <div className={`action-btns ${touchUi ? 'is-touch' : ''}`}>
        <button className={`run-btn ${run ? 'on' : ''}`} onClick={toggleRun} aria-pressed={run} aria-label="Run (Shift / R)">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9.8 8.9 7 22h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 12v-2a5.2 5.2 0 0 1-4.5-2.5l-1-1.6a2.1 2.1 0 0 0-2.6-.8L6 7.3V12h2V8.6l1.8-.7Z" fill="currentColor" />
          </svg>
          <span>Run</span>
        </button>
        <button
          className={`use-btn ${nearby && !nearby.disabledReason && !busy ? 'ready' : ''}`}
          disabled={!nearby || !!busy}
          onClick={() => nearby && perform(nearby)}
          aria-label={nearby ? `${nearby.title}: ${nearby.subtitle}` : 'Nothing to use here'}
        >
          {nearby ? VERB[nearby.kind] ?? 'Use' : 'Use'}
        </button>
      </div>
    </>
  );
}
