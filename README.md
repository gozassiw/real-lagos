# Real Lagos — 3D life-sim prototype

A playable browser prototype of a third-person life sim set on the **real map of Lagos, Nigeria**.
Roads, coastline, the lagoon, bridges, building footprints, district names and points of interest all come
from **OpenStreetMap** (exported once at development time, simplified, and shipped with the game as local
assets — the game never calls the Overpass API at runtime).

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL.

## Play

- **Phone:** left thumb = joystick, drag on the right side to look around, pinch to zoom (zoom far out for an
  aerial view of the real map), **Run** toggles sprint, **Use** interacts.
- **Desktop:** `WASD` / arrows to move, `Shift` (or `R` to toggle) to run, mouse drag to orbit, wheel to zoom,
  `E` to interact, `M` for the map.

Loop: start in Ikoyi with ₦5,000 → find work (VI office or Yaba tech hub) → earn naira → buy food at a buka →
dance at the Lekki Phase 1 lounge. Shop at Balogun Market or Computer Village (Ikeja), rest at your flat in
Ikoyi, and ride danfos between districts — rides follow the real road network, including the lagoon bridges.
Progress (cash, stats, quest, position) is saved in `localStorage`.

## Stack

React + TypeScript (Vite) · Three.js via `@react-three/fiber` · `@react-three/drei` · `@react-three/rapier`
(character + building/bridge collisions) · Zustand (game state + persistence).

```
src/
  App.tsx                     loading, spawn, keyboard
  game/
    GameCanvas.tsx            renderer, lights, sky, physics world
    Player.tsx                avatar + Rapier character controller + shoreline blocking
    FollowCamera.tsx          damped follow/orbit camera with collision ray
    InteractionSystem.tsx     POI proximity, markers, quest target
    DanfoRide.tsx             fast travel along routed real roads
    gameplay.ts               work / eat / shop / dance / home / sleep / danfo actions
    avatar/                   procedural (original) skinned characters on a humanoid rig
    map/
      geoToWorld.ts           lat/lon <-> local metres (single transform for everything)
      mapData.ts              loads assets; land/water, landuse, district & road-name queries
      geometry.ts             road strips, bridge decks, buildings, roofs, walls (worker-safe)
      chunkWorker.ts          builds 500 m chunks off the main thread
      routing.ts              shortest paths on the OSM major-road graph
      facades.ts / materials.ts / props.ts   Lagos facade atlas, shaders, low-poly props
    world/                    Terrain (ground + water shaders), LagosMap (chunk streaming),
                              Traffic (danfos, buses, kekes), Npcs, Interior, Landmarks
  ui/                         HUD, minimap, mobile controls, map screen, sheets
  store/gameStore.ts          Zustand store (persisted)
public/data/lagos/            processed OSM assets (see below)
public/models/rig.glb         humanoid skeleton + motion clips (no mesh)
scripts/
  fetch-osm.mjs               one-off Overpass export (run in CI: .github/workflows/osm-export.yml)
  build_map.py                raw OSM -> chunked game assets
  curate_pois.py              anchors gameplay spots to real OSM features
  make_rig.py                 builds rig.glb (retargets the dance clip)
```

### Map pipeline

1. `node scripts/fetch-osm.mjs --out osm-raw` — exports roads, rail, water + coastline, landuse, walls,
   buildings (tiled) and POIs for the Lagos core (3.325–3.505°E, 6.395–6.555°N) and an Ikeja district chunk.
2. `python3 scripts/build_map.py --raw osm-raw --out public/data/lagos` (needs `numpy scipy pillow`) —
   projects to local metres (origin 6.45°N 3.41°E), simplifies geometry, rasterises the shoreline into a signed
   distance field, computes bridge deck heights, classifies buildings into Lagos facade archetypes and splits
   everything into 500 m chunks, then packs them 4 × 4 into 2 km files (`scripts/pack_chunks.py`).
3. `python3 scripts/curate_pois.py --data public/data/lagos` — picks the gameplay spots from real OSM features.

Assets in `public/data/lagos`: `manifest.json` (transform, regions, chunk index, OSM timestamp),
`terrain_*.png` (shoreline distance field), `landuse_*.png`, `roads_major.json`, `rail.json`,
`packs/p*_*.json` (map chunks), `places.json`, `pois.json`, `gameplay.json`, and lat/lon GeoJSON copies in `geo/`.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

## Deploy

**GitHub Pages (default):** pushing to `main` runs `.github/workflows/deploy.yml`, which builds and publishes
to `https://<user>.github.io/real-lagos/`. One-time setup: repo *Settings → Pages → Source: GitHub Actions*.

**Cloudflare Pages:** create a Pages project from this repo with build command `npm run build` and output
directory `dist` (no other settings needed; the site works from the domain root).

**Vercel:** import the repo; framework preset *Vite*; build `npm run build`; output `dist`.

## Credits

- Map data © OpenStreetMap contributors (ODbL).
- Character meshes, buildings, vehicles and props are generated in code for this project.
- Skeleton and idle/walk/run/nod clips: the "Xbot" rig from the three.js examples; dance clip retargeted from
  the three.js "Michelle" example (both originally from Mixamo).
