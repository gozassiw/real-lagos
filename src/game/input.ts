// Shared, frame-polled input state (keyboard, mouse, touch joystick). Kept outside React on purpose:
// the game loop reads it every frame without causing re-renders.

export const input = {
  // movement from keyboard (-1..1)
  kx: 0,
  ky: 0,
  // movement from the virtual joystick (-1..1, magnitude ≤ 1)
  jx: 0,
  jy: 0,
  shift: false,
  runToggle: false,
  // camera deltas accumulated since last frame (radians) + zoom
  dYaw: 0,
  dPitch: 0,
  dZoom: 0,
  interactPressed: false,
  lastPointerType: 'mouse' as 'mouse' | 'touch' | 'pen',
};

const keys = new Set<string>();

function recompute() {
  const f = keys.has('KeyW') || keys.has('ArrowUp');
  const b = keys.has('KeyS') || keys.has('ArrowDown');
  const l = keys.has('KeyA') || keys.has('ArrowLeft');
  const r = keys.has('KeyD') || keys.has('ArrowRight');
  input.ky = (f ? 1 : 0) - (b ? 1 : 0);
  input.kx = (r ? 1 : 0) - (l ? 1 : 0);
  input.shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
}

let installed = false;
export function installKeyboard(onKey: (code: string) => void) {
  if (installed) return () => {};
  installed = true;
  const down = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (!e.repeat) onKey(e.code);
    if (e.code === 'KeyE' || e.code === 'Enter') input.interactPressed = true;
    keys.add(e.code);
    recompute();
  };
  const up = (e: KeyboardEvent) => {
    keys.delete(e.code);
    recompute();
  };
  const blur = () => {
    keys.clear();
    recompute();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    installed = false;
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}

/** desired movement in camera space: x = right, y = forward; magnitude 0..1 */
export function moveVector() {
  let x = input.kx + input.jx;
  let y = input.ky + input.jy;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return { x, y, mag: Math.min(1, m) };
}

export function consumeInteract() {
  const v = input.interactPressed;
  input.interactPressed = false;
  return v;
}

/** Orbit the camera by dragging on the 3D view (mouse anywhere, touch on the right side / any free area). */
export function installCameraDrag(el: HTMLElement) {
  const active = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const down = (e: PointerEvent) => {
    input.lastPointerType = e.pointerType as typeof input.lastPointerType;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture?.(e.pointerId);
    if (active.size === 2) {
      const [a, b] = [...active.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const move = (e: PointerEvent) => {
    const p = active.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (active.size === 2) {
      const [a, b] = [...active.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) input.dZoom += (pinch - d) * 0.02;
      pinch = d;
      return;
    }
    const k = e.pointerType === 'mouse' ? 0.005 : 0.0075;
    input.dYaw -= dx * k;
    input.dPitch += dy * k * 0.8;
  };
  const up = (e: PointerEvent) => {
    active.delete(e.pointerId);
    if (active.size < 2) pinch = 0;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    input.dZoom += Math.sign(e.deltaY) * 0.9;
  };
  const ctx = (e: Event) => e.preventDefault();
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('contextmenu', ctx);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('contextmenu', ctx);
  };
}
