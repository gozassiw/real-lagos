#!/usr/bin/env node
// End-to-end smoke test of a deployed build (or a local `vite preview`):
//   node scripts/qa/smoke.mjs <url> <outDir>
// Runs in iPhone emulation with touch input, then checks the core loop and writes screenshots + report.json.
import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2];
const out = process.argv[3] || 'qa-out';
await mkdir(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  if (!sessionStorage.getItem('qa-init')) {
    localStorage.clear();
    sessionStorage.setItem('qa-init', '1');
  }
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text()) && errors.push(m.text()));

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const D = () => page.evaluate(() => window.__lagos && window.__lagos());
const tp = (x, z, y = 0.1) => page.evaluate(([a, b, c]) => window.__lagosTp(a, b, c), [x, z, y]);
async function waitFor(fn, ms = 60000, step = 500) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}
async function use() {
  const btn = page.locator('.use-btn');
  await btn.tap();
}

try {
  const res = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  check('page loads over HTTPS', res && res.ok() && url.startsWith(url.startsWith('http://127.') ? 'http' : 'https'), `status ${res && res.status()}`);
  const hud = await waitFor(() => page.locator('.hud').count(), 90000);
  check('game starts (HUD visible)', hud);
  const manifest = await page.evaluate(async () => {
    const r = await fetch(new URL('data/lagos/manifest.json', location.href));
    return r.ok ? r.json() : null;
  });
  check('real Lagos map data is in the deployed bundle', manifest && manifest.attribution?.includes('OpenStreetMap') && Object.keys(manifest.chunks).length > 500,
    manifest ? `${Object.keys(manifest.chunks).length} chunks, OSM base ${manifest.osmBase}, origin ${manifest.origin.lat}N ${manifest.origin.lon}E` : 'no manifest');
  const gameplay = await page.evaluate(async () => (await fetch(new URL('data/lagos/gameplay.json', location.href))).json());
  await sleep(2500);
  await shot('01-welcome');
  await page.locator('.preset').nth(1).tap();
  await page.locator('.welcome .btn-primary').tap();
  await sleep(2500);
  const ready = await waitFor(async () => { const d = await D(); return d && d.chunks > 0 ? d : null; }, 60000);
  check('map chunks stream in around the player', ready && ready.chunks > 0, ready ? `${ready.chunks} chunks, ${ready.render?.triangles} tris, ${ready.render?.calls} draw calls` : '');
  check('OSM attribution visible', await page.locator('.osm-attrib').isVisible());
  await shot('02-start');

  // ---- joystick (touch)
  const start = await D();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const vp = page.viewportSize();
  const jy = vp.height - 110;
  await touch('touchStart', [{ x: 80, y: jy, id: 1 }]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: 80, y: jy - i * 7, id: 1 }]); await sleep(40); }
  await sleep(5000);
  await shot('03-joystick');
  await touch('touchEnd', []);
  await sleep(800);
  const moved = await D();
  const dist = Math.hypot(moved.player[0] - start.player[0], moved.player[2] - start.player[2]);
  check('virtual joystick moves the character', dist > 1, `moved ${dist.toFixed(1)} m`);
  check('page does not scroll or zoom', await page.evaluate(() => window.scrollY === 0 && (window.visualViewport?.scale ?? 1) === 1));

  // ---- the loop: work -> eat -> shop -> dance -> home/sleep
  const P = (kind, zone) => gameplay.pois.find((p) => p.kind === kind && (!zone || p.zone === zone));
  const go = async (p) => { await tp(p.x, p.z); await sleep(2500); return D(); };
  const job = P('work', 'Victoria Island') || P('work');
  let d = await go(job);
  check('job marker reachable', d.nearby === job.id, `${job.name} at ${job.lat},${job.lon}`);
  const cash0 = d.cash;
  await use();
  await sleep(7000);
  d = await D();
  check('work earns NGN', d.cash > cash0, `₦${cash0} -> ₦${d.cash}`);
  await shot('04-work');
  const food = P('eat', job.zone) || P('eat');
  d = await go(food);
  const h0 = d.hunger, c1 = d.cash, e0 = d.energy;
  await use();
  await sleep(4500);
  d = await D();
  check('buying food costs money and reduces hunger', d.cash < c1 && d.hunger < h0, `hunger ${h0}->${d.hunger}, energy ${e0}->${d.energy}, ₦${c1}->₦${d.cash}`);
  const market = P('shop', 'Lagos Island') || P('shop');
  d = await go(market);
  await use();
  await sleep(1200);
  await shot('05-market');
  const c2 = d.cash;
  await page.locator('.btn-buy').first().tap();
  await sleep(800);
  await page.locator('.sheet .close').tap();
  d = await D();
  check('market purchase', d.cash < c2, `₦${c2} -> ₦${d.cash}`);
  const lounge = P('social');
  d = await go(lounge);
  await use();
  await sleep(5000);
  await shot('06-dance');
  d = await D();
  check('lounge dance interaction (quest chain)', d.quest >= 4, `quest step ${d.quest}`);
  const home = P('home');
  d = await go(home);
  await use();
  await sleep(3500);
  d = await D();
  const inside = Math.abs(d.player[0] + 40000) < 30;
  await tp(-40000 + 1.2, 40000 - 0.4, 0.05);
  await sleep(2500);
  await use();
  await sleep(5000);
  d = await D();
  check('enter home and rest restores energy', inside && d.energy >= 99, `energy ${d.energy}`);
  await shot('07-home');
  await tp(-40000 - 3.4, 40000 + 2.2, 0.05);
  await sleep(2000);
  await use();
  await sleep(3500);

  // ---- danfo across the lagoon (route uses real roads / bridges)
  const stopA = gameplay.pois.find((p) => p.id === 'stop-yaba') || P('danfo');
  const stopB = gameplay.pois.find((p) => p.id === 'stop-cms') || gameplay.pois.find((p) => p.kind === 'danfo' && p.id !== stopA.id);
  await go(stopA);
  await use();
  await sleep(1200);
  await page.locator('.items li', { hasText: stopB.zone }).locator('.btn-buy').tap();
  await sleep(6000);
  d = await D();
  check('danfo ride starts', d.riding, d.area);
  await shot('08-danfo-ride');
  await page.locator('.ride .btn-ghost').tap().catch(() => {});
  await sleep(4500);
  d = await D();
  check('danfo ride arrives', !d.riding && Math.hypot(d.player[0] - stopB.x, d.player[2] - stopB.z) < 15, d.area);

  // ---- minimap / map agree with the world position
  await page.locator('.minimap').tap();
  await sleep(1500);
  const txt = await page.locator('.map-title small').innerText();
  d = await D();
  const m = txt.match(/([\d.]+)°N, ([\d.]+)°E/);
  const lat = 6.45 - d.player[2] / (6378137 * Math.PI / 180), lon = 3.41 + d.player[0] / (6378137 * Math.PI / 180 * Math.cos(6.45 * Math.PI / 180));
  check('map position matches the 3D world', m && Math.abs(+m[1] - lat) < 0.0005 && Math.abs(+m[2] - lon) < 0.0005, txt);
  await shot('09-map');
  await page.locator('.map-top .close').tap();

  // ---- persistence
  const before = await D();
  await sleep(2500);
  await page.reload();
  await waitFor(() => page.locator('.hud').count(), 60000);
  await sleep(4000);
  const after = await D();
  check('reload preserves progress', after.cash === before.cash && after.quest === before.quest && Math.hypot(after.player[0] - before.player[0], after.player[2] - before.player[2]) < 10,
    `cash ₦${after.cash}, quest ${after.quest}`);
  await shot('10-after-reload');
  check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('smoke test ran to completion', false, String(e).slice(0, 300));
  await shot('zz-failure').catch(() => {});
}

await writeFile(`${out}/report.json`, JSON.stringify({ url, when: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`::notice::QA ${results.length - failed.length}/${results.length} passed${failed.length ? ' — failed: ' + failed.map((f) => f.name).join('; ') : ''}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
