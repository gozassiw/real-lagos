// Procedurally painted facade atlas (canvas) — Lagos building language: plastered walls with burglar-proof
// window bars, louvres, rolled shop shutters with hand-painted signboards, AC units, balconies, glass towers.
// Alpha channel: 1 = plastered wall (tinted per building with vertex colour), ~0.5 = fixed colour (glass, metal...).
import * as THREE from 'three';

import { ATLAS_CELLS } from './facadeCells';
export { ATLAS_CELLS, FACADE, WALL_TINTS, ROOF_TINTS_ZINC } from './facadeCells';
const CELL = 128;
const SIZE = CELL * ATLAS_CELLS;

type Ctx = CanvasRenderingContext2D;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function wall(g: Ctx, x: number, y: number, r: () => number, dirt = 0) {
  g.fillStyle = 'rgba(240,236,228,1)';
  g.fillRect(x, y, CELL, CELL);
  // plaster mottling
  for (let i = 0; i < 70; i++) {
    const v = 225 + Math.floor(r() * 22);
    g.fillStyle = `rgba(${v},${v - 3},${v - 8},1)`;
    g.fillRect(x + r() * CELL, y + r() * CELL, 2 + r() * 7, 2 + r() * 5);
  }
  if (dirt) {
    const grd = g.createLinearGradient(0, y + CELL - dirt, 0, y + CELL);
    grd.addColorStop(0, 'rgba(240,236,228,1)');
    grd.addColorStop(1, 'rgba(150,130,110,1)');
    g.fillStyle = grd;
    g.fillRect(x, y + CELL - dirt, CELL, dirt);
  }
  // rain streak
  if (r() < 0.6) {
    g.fillStyle = 'rgba(200,192,180,1)';
    g.fillRect(x + r() * CELL, y + 8, 2, CELL * (0.3 + r() * 0.5));
  }
}

const FIX = 0.5; // alpha for non-tinted parts

function rect(g: Ctx, x: number, y: number, w: number, h: number, rgb: string, a = FIX) {
  g.fillStyle = `rgba(${rgb},${a})`;
  g.fillRect(x, y, w, h);
}

function window_(g: Ctx, x: number, y: number, w: number, h: number, r: () => number, opts: { bars?: boolean; louvre?: boolean; frame?: string; glass?: string } = {}) {
  const frame = opts.frame ?? (r() < 0.5 ? '245,245,240' : '92,62,40');
  rect(g, x - 3, y - 3, w + 6, h + 6, frame);
  rect(g, x, y, w, h, opts.glass ?? '44,58,68');
  // reflection
  g.fillStyle = `rgba(140,170,190,${FIX})`;
  g.beginPath();
  g.moveTo(x, y + h * 0.7);
  g.lineTo(x + w * 0.5, y);
  g.lineTo(x + w * 0.7, y);
  g.lineTo(x, y + h);
  g.closePath();
  g.fill();
  if (opts.louvre) for (let i = 4; i < h; i += 6) rect(g, x, y + i, w, 2, '170,180,186');
  rect(g, x + w / 2 - 1, y, 2, h, frame);
  if (opts.bars) {
    for (let i = 5; i < w; i += 8) rect(g, x + i, y - 2, 2, h + 4, '30,30,32');
    rect(g, x - 2, y + h / 2 - 1, w + 4, 2, '30,30,32');
  }
  rect(g, x - 5, y + h + 3, w + 10, 4, '210,205,196'); // sill
}

function shutter(g: Ctx, x: number, y: number, r: () => number, open: boolean) {
  const cols = ['54,94,150', '40,120,82', '160,52,44', '120,124,130', '200,150,40', '60,60,66'];
  const c = cols[Math.floor(r() * cols.length)];
  // signboard band
  const sign = ['220,40,40', '30,90,170', '250,200,30', '20,140,90', '240,240,235', '120,30,120'][Math.floor(r() * 6)];
  rect(g, x + 4, y + 10, CELL - 8, 26, sign);
  for (let i = 0; i < 3; i++) rect(g, x + 12 + r() * 20, y + 15 + i * 7, 40 + r() * 50, 4, r() < 0.5 ? '255,255,255' : '20,20,20');
  if (open) {
    rect(g, x + 10, y + 42, CELL - 20, CELL - 44, '58,46,38');
    // goods on shelves
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 6; i++) {
        const gc = ['230,90,40', '250,210,60', '60,150,220', '240,240,240', '40,170,90', '200,60,120'][Math.floor(r() * 6)];
        rect(g, x + 14 + i * 17, y + 48 + row * 19, 13, 12, gc);
      }
    rect(g, x + 10, y + 40, CELL - 20, 5, '30,30,30');
  } else {
    rect(g, x + 10, y + 42, CELL - 20, CELL - 44, c);
    for (let i = 46; i < CELL - 4; i += 5) rect(g, x + 10, y + i, CELL - 20, 1.5, '20,20,20');
  }
  // pillar edges
  rect(g, x, y + 40, 8, CELL - 40, '205,198,186');
  rect(g, x + CELL - 8, y + 40, 8, CELL - 40, '205,198,186');
}

function glass(g: Ctx, x: number, y: number, tint: string, r: () => number, mullion = '170,180,190', lobby = false) {
  rect(g, x, y, CELL, CELL, tint);
  // sky reflection: lighter towards the top of each floor, a soft diagonal sheen
  const v = g.createLinearGradient(x, y, x, y + CELL);
  v.addColorStop(0, `rgba(215,232,242,${FIX * 0.55})`);
  v.addColorStop(0.55, `rgba(215,232,242,0)`);
  g.fillStyle = v;
  g.fillRect(x, y, CELL, CELL);
  const d = g.createLinearGradient(x, y + CELL, x + CELL, y);
  d.addColorStop(0.35, 'rgba(255,255,255,0)');
  d.addColorStop(0.5, `rgba(255,255,255,${0.16 + r() * 0.08})`);
  d.addColorStop(0.62, 'rgba(255,255,255,0)');
  g.fillStyle = d;
  g.fillRect(x, y, CELL, CELL);
  // a few lit / blind panes
  for (let i = 0; i < 3; i++) {
    const px = Math.floor(r() * 4) * 32, w = 32;
    g.fillStyle = r() < 0.5 ? `rgba(30,36,40,${FIX * 0.5})` : `rgba(240,236,220,${FIX * 0.35})`;
    g.fillRect(x + px + 3, y + 14, w - 6, CELL - 30);
  }
  rect(g, x, y + CELL - 12, CELL, 12, mullion);
  for (let i = 0; i <= CELL; i += lobby ? 64 : 32) rect(g, x + i - 2, y, 4, CELL, mullion);
  if (lobby) rect(g, x + 40, y + 50, 48, 78, '30,36,40');
}

function balcony(g: Ctx, x: number, y: number) {
  rect(g, x + 4, y + CELL - 26, CELL - 8, 6, '200,196,188');
  for (let i = 8; i < CELL - 8; i += 7) rect(g, x + i, y + CELL - 46, 2, 20, '45,45,48');
  rect(g, x + 4, y + CELL - 48, CELL - 8, 3, '45,45,48');
}

function ac(g: Ctx, x: number, y: number) {
  rect(g, x, y, 30, 20, '232,232,228');
  for (let i = 3; i < 28; i += 4) rect(g, x + i, y + 4, 2, 12, '150,150,150');
}

function corrugated(g: Ctx, x: number, y: number, col: string) {
  rect(g, x, y, CELL, CELL, col);
  for (let i = 0; i < CELL; i += 6) rect(g, x + i, y, 2, CELL, '0,0,0', 0.18 * FIX + 0.25);
}

export function createFacadeAtlas(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d')!;
  const at = (cell: number) => [(cell % ATLAS_CELLS) * CELL, Math.floor(cell / ATLAS_CELLS) * CELL] as const;
  const draw = (cell: number, fn: (x: number, y: number, r: () => number) => void) => {
    const [x, y] = at(cell);
    g.save();
    g.beginPath();
    g.rect(x, y, CELL, CELL);
    g.clip();
    fn(x, y, rng(cell * 7919 + 13));
    g.restore();
  };
  // 0 bungalow ground: door + window with bars
  draw(0, (x, y, r) => { wall(g, x, y, r, 18); rect(g, x + 14, y + 40, 34, 88, '92,58,36'); rect(g, x + 18, y + 46, 26, 36, '70,44,28'); window_(g, x + 66, y + 44, 44, 44, r, { bars: true, louvre: true }); });
  // 1 house ground: two barred windows
  draw(1, (x, y, r) => { wall(g, x, y, r, 18); window_(g, x + 14, y + 40, 40, 46, r, { bars: true }); window_(g, x + 74, y + 40, 40, 46, r, { bars: true }); });
  // 2 shop ground (closed shutter + sign) / 3 open shop
  draw(2, (x, y, r) => { wall(g, x, y, r); shutter(g, x, y, r, false); });
  draw(3, (x, y, r) => { wall(g, x, y, r); shutter(g, x, y, r, true); });
  // 4 tower lobby glass
  draw(4, (x, y, r) => glass(g, x, y, '58,84,100', r, '190,195,200', true));
  // 5 villa ground: large window
  draw(5, (x, y, r) => { wall(g, x, y, r, 8); window_(g, x + 14, y + 30, 100, 70, r, { frame: '250,250,248', glass: '50,70,80' }); });
  // 6 warehouse ground: roller door
  draw(6, (x, y) => { corrugated(g, x, y, '150,152,150'); rect(g, x + 14, y + 30, 100, 98, '110,116,120'); for (let i = 34; i < CELL; i += 6) rect(g, x + 14, y + i, 100, 2, '60,60,60'); });
  // 7 market stall front: awning + goods
  draw(7, (x, y, r) => {
    rect(g, x, y, CELL, CELL, '90,70,52');
    const aw = ['220,60,40', '30,120,200', '250,190,40', '40,150,80'][Math.floor(r() * 4)];
    for (let i = 0; i < CELL; i += 16) rect(g, x + i, y + 20, 16, 22, i % 32 ? aw : '245,240,230');
    for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) rect(g, x + 6 + i * 17, y + 56 + row * 22, 14, 16, ['230,100,40', '250,220,70', '70,160,230', '240,240,240', '60,180,90'][Math.floor(r() * 5)]);
  });
  // 8 bungalow upper (unused mostly) / 9 house upper with balcony / 10 shophouse upper / 11 apartment upper
  draw(8, (x, y, r) => { wall(g, x, y, r); window_(g, x + 40, y + 36, 48, 46, r, { bars: true, louvre: true }); });
  draw(9, (x, y, r) => { wall(g, x, y, r); window_(g, x + 22, y + 26, 84, 54, r, { bars: true, louvre: r() < 0.5 }); balcony(g, x, y); });
  draw(10, (x, y, r) => { wall(g, x, y, r); window_(g, x + 18, y + 30, 40, 50, r, { louvre: true }); window_(g, x + 72, y + 30, 40, 50, r, { louvre: true }); if (r() < 0.6) ac(g, x + 84, y + 92); });
  draw(11, (x, y, r) => { wall(g, x, y, r); window_(g, x + 16, y + 28, 64, 56, r, { frame: '245,245,240' }); ac(g, x + 88, y + 52); rect(g, x, y + CELL - 10, CELL, 10, '205,200,192'); });
  // 12 glass blue, 15 glass green
  draw(12, (x, y, r) => glass(g, x, y, '52,92,128', r));
  draw(15, (x, y, r) => glass(g, x, y, '46,104,96', r));
  // 13 villa upper
  draw(13, (x, y, r) => { wall(g, x, y, r); window_(g, x + 24, y + 26, 80, 62, r, { frame: '250,250,248', glass: '56,76,86' }); rect(g, x + 10, y + CELL - 18, CELL - 20, 8, '250,250,248'); });
  // 14 corrugated wall
  draw(14, (x, y) => corrugated(g, x, y, '168,170,166'));
  // 16 bungalow ground variant: window + louvre, no door
  draw(16, (x, y, r) => { wall(g, x, y, r, 18); window_(g, x + 30, y + 42, 68, 44, r, { bars: true, louvre: true }); });
  // 17 house ground variant with a gate-door
  draw(17, (x, y, r) => { wall(g, x, y, r, 18); rect(g, x + 36, y + 34, 56, 94, '40,40,44'); for (let i = 40; i < 90; i += 7) rect(g, x + i, y + 36, 2, 90, '120,120,124'); });
  // 18 shop ground with pharmacy-green / phone shop vibe (open)
  draw(18, (x, y, r) => { wall(g, x, y, r); shutter(g, x, y, r, true); });
  // 19 apartment ground: lobby door + window
  draw(19, (x, y, r) => { wall(g, x, y, r, 10); rect(g, x + 14, y + 36, 40, 92, '40,48,54'); rect(g, x + 10, y + 30, 48, 6, '200,196,188'); window_(g, x + 72, y + 44, 40, 44, r, { bars: true }); });
  // 20 tower ground: darker glass with canopy
  draw(20, (x, y, r) => { glass(g, x, y, '40,56,64', r, '200,200,200', true); rect(g, x, y + 20, CELL, 8, '220,220,220'); });
  // 21 shophouse upper with signboard remnants
  draw(21, (x, y, r) => { wall(g, x, y, r); rect(g, x + 8, y + 8, CELL - 16, 28, ['200,40,40', '40,90,170', '240,190,30'][Math.floor(r() * 3)]); window_(g, x + 30, y + 50, 68, 46, r, { bars: true }); });
  // 22 kiosk front (closed)
  draw(22, (x, y, r) => { wall(g, x, y, r); shutter(g, x, y, r, false); });
  // 23 apartment upper with balcony
  draw(23, (x, y, r) => { wall(g, x, y, r); window_(g, x + 20, y + 22, 88, 60, r, { frame: '245,245,240' }); balcony(g, x, y); });
  // 24 worship ground: arched door, 26 arched window
  const arch = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = `rgba(${col},${FIX})`; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill(); };
  draw(24, (x, y, r) => { wall(g, x, y, r, 10); arch(x + 34, y + 20, 60, 108, '110,70,40'); });
  draw(26, (x, y, r) => { wall(g, x, y, r); arch(x + 40, y + 20, 48, 84, '60,110,140'); });
  // 25 house upper variant: louvres no balcony
  draw(25, (x, y, r) => { wall(g, x, y, r); window_(g, x + 14, y + 32, 42, 50, r, { louvre: true, bars: true }); window_(g, x + 72, y + 32, 42, 50, r, { louvre: true, bars: true }); });
  // 27 civic ground (school / hospital) and 30 civic upper
  draw(27, (x, y, r) => { wall(g, x, y, r, 12); rect(g, x, y + 100, CELL, 28, '120,140,160'); window_(g, x + 18, y + 30, 92, 50, r, { frame: '240,240,240' }); });
  draw(30, (x, y, r) => { wall(g, x, y, r); window_(g, x + 12, y + 30, 46, 52, r, { frame: '240,240,240' }); window_(g, x + 70, y + 30, 46, 52, r, { frame: '240,240,240' }); });
  // 28 glass dark, 29 glass with spandrel bands
  draw(28, (x, y, r) => glass(g, x, y, '36,48,60', r));
  draw(29, (x, y, r) => { glass(g, x, y, '70,110,130', r); rect(g, x, y, CELL, 24, '210,212,214'); });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

