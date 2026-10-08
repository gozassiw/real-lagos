#!/usr/bin/env node
// Export the OpenStreetMap features the game needs for Lagos, ONCE, at development time.
// The game never calls Overpass at runtime — it loads the processed assets in public/data/lagos.
//
//   node scripts/fetch-osm.mjs --out osm-raw [--only core|ikeja] [--layers roads,water,...]
//
// Output: one gzipped Overpass JSON file per area/layer, e.g. osm-raw/core_roads.json.gz
// Map data © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const OUT = args.out || 'osm-raw';

// Bounding boxes (south, west, north, east). Core follows the brief: ~3.33E–3.50E, 6.40N–6.55N (+ a small margin).
export const AREAS = {
  core: { s: 6.395, w: 3.325, n: 6.555, e: 3.505 },
  ikeja: { s: 6.575, w: 3.325, n: 6.625, e: 3.375 },
};
const PLACES_BBOX = { s: 6.35, w: 3.25, n: 6.7, e: 3.6 };

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const bb = (b) => `${b.s},${b.w},${b.n},${b.e}`;
const head = '[out:json][timeout:900][maxsize:2000000000];';

const LAYERS = {
  roads: (b) => `${head}(way["highway"](${bb(b)}););out body geom qt;`,
  rail: (b) =>
    `${head}(way["railway"~"^(rail|light_rail|subway|tram|narrow_gauge|construction)$"](${bb(b)}););out body geom qt;`,
  water: (b) => `${head}(
      way["natural"="coastline"](${bb(b)});
      way["natural"~"^(water|bay|strait)$"](${bb(b)});
      rel["natural"~"^(water|bay|strait)$"](${bb(b)});
      way["waterway"~"^(riverbank|canal|river|dock|stream)$"](${bb(b)});
      rel["waterway"~"^(riverbank|dock)$"](${bb(b)});
      way["landuse"~"^(basin|reservoir)$"](${bb(b)});
      rel["landuse"~"^(basin|reservoir)$"](${bb(b)});
      way["water"](${bb(b)});
      rel["water"](${bb(b)});
    );out body geom qt;`,
  landuse: (b) => `${head}(
      way["landuse"](${bb(b)});
      rel["landuse"](${bb(b)});
      way["leisure"~"^(park|garden|pitch|golf_course|playground|stadium|recreation_ground|sports_centre|nature_reserve|common)$"](${bb(b)});
      rel["leisure"~"^(park|garden|pitch|golf_course|stadium|recreation_ground|nature_reserve)$"](${bb(b)});
      way["natural"~"^(wood|scrub|grassland|wetland|beach|sand|heath|bare_rock|mud)$"](${bb(b)});
      rel["natural"~"^(wood|scrub|grassland|wetland|beach|sand|mud)$"](${bb(b)});
      way["amenity"~"^(parking|school|university|college|hospital|marketplace|bus_station)$"](${bb(b)});
      way["man_made"~"^(pier|breakwater|groyne|bridge)$"](${bb(b)});
      way["aeroway"](${bb(b)});
    );out body geom qt;`,
  barriers: (b) => `${head}(way["barrier"~"^(wall|fence|retaining_wall|gate|city_wall)$"](${bb(b)}););out body geom qt;`,
  pois: (b) => `${head}(
      node["amenity"](${bb(b)});
      node["shop"](${bb(b)});
      node["office"](${bb(b)});
      node["tourism"](${bb(b)});
      node["leisure"](${bb(b)});
      node["historic"](${bb(b)});
      node["highway"="bus_stop"](${bb(b)});
      node["public_transport"](${bb(b)});
      node["railway"~"^(station|halt|tram_stop)$"](${bb(b)});
      node["natural"="tree"](${bb(b)});
      node["man_made"](${bb(b)});
      way["amenity"]["name"](${bb(b)});
      way["shop"]["name"](${bb(b)});
      way["office"]["name"](${bb(b)});
      way["tourism"]["name"](${bb(b)});
      way["leisure"]["name"](${bb(b)});
      way["building"]["name"](${bb(b)});
      way["historic"](${bb(b)});
      rel["amenity"]["name"](${bb(b)});
      rel["building"]["name"](${bb(b)});
    );out center tags qt;`,
  buildings: null, // tiled, see below
};

function tiles(b, step) {
  const out = [];
  for (let s = b.s; s < b.n - 1e-9; s += step)
    for (let w = b.w; w < b.e - 1e-9; w += step)
      out.push({ s: +s.toFixed(5), w: +w.toFixed(5), n: +Math.min(b.n, s + step).toFixed(5), e: +Math.min(b.e, w + step).toFixed(5) });
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, label) {
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'real-lagos-prototype/0.1 (one-off development export; github.com/gozassiw/real-lagos)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      const json = JSON.parse(text);
      if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new Error('Overpass remark: ' + json.remark);
      console.log(`  ✓ ${label} via ${new URL(url).host}: ${json.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`  ✗ ${label} attempt ${attempt + 1} (${new URL(url).host}): ${String(e.message || e).slice(0, 200)}`);
      await sleep(Math.min(60000, 5000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

async function save(name, json) {
  await writeFile(path.join(OUT, name + '.json.gz'), gzipSync(JSON.stringify(json), { level: 9 }));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const onlyAreas = args.only ? String(args.only).split(',') : Object.keys(AREAS);
  const onlyLayers = args.layers ? String(args.layers).split(',') : [...Object.keys(LAYERS), 'places'];
  const manifest = existsSync(path.join(OUT, 'manifest.json'))
    ? JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8'))
    : { source: 'OpenStreetMap via Overpass API', license: 'ODbL 1.0 — © OpenStreetMap contributors', areas: AREAS, files: {} };

  for (const area of onlyAreas) {
    const b = AREAS[area];
    console.log(`Area ${area} ${bb(b)}`);
    for (const layer of onlyLayers) {
      if (layer === 'places') continue;
      if (layer === 'buildings') {
        const ts = tiles(b, 0.04);
        const merged = { elements: [], osm3s: null };
        const seen = new Set();
        for (let i = 0; i < ts.length; i++) {
          const t = ts[i];
          const q = `${head}(way["building"](${bb(t)});rel["building"](${bb(t)}););out body geom qt;`;
          const j = await overpass(q, `${area} buildings tile ${i + 1}/${ts.length}`);
          merged.osm3s = j.osm3s;
          for (const el of j.elements) {
            const k = el.type + el.id;
            if (seen.has(k)) continue;
            seen.add(k);
            merged.elements.push(el);
          }
          await sleep(2000);
        }
        await save(`${area}_buildings`, merged);
        manifest.files[`${area}_buildings`] = { elements: merged.elements.length, osm_base: merged.osm3s?.timestamp_osm_base };
        continue;
      }
      const j = await overpass(LAYERS[layer](b), `${area} ${layer}`);
      await save(`${area}_${layer}`, j);
      manifest.files[`${area}_${layer}`] = { elements: j.elements.length, osm_base: j.osm3s?.timestamp_osm_base };
      await sleep(2000);
    }
  }
  if (onlyLayers.includes('places')) {
    const q = `${head}(node["place"~"^(city|town|suburb|quarter|neighbourhood|village|hamlet|island|islet|locality)$"](${bb(PLACES_BBOX)});way["place"~"^(island|islet|suburb|neighbourhood|quarter)$"](${bb(PLACES_BBOX)});rel["place"~"^(island|suburb|neighbourhood|quarter)$"](${bb(PLACES_BBOX)}););out center tags;`;
    const j = await overpass(q, 'places');
    await save('places', j);
    manifest.files.places = { elements: j.elements.length, osm_base: j.osm3s?.timestamp_osm_base };
  }
  manifest.exported_at = new Date().toISOString();
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
