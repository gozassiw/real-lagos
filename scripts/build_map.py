#!/usr/bin/env python3
"""
OSM extracts  ->  game map assets.

  python3 scripts/build_map.py --raw osm-raw --out public/data/lagos

Reads the gzipped Overpass exports produced by scripts/fetch-osm.mjs and writes small, chunked assets that the
game streams at runtime (the game never calls Overpass):

  manifest.json          origin + transform, regions, chunk index, attribution, OSM data timestamp
  terrain_<region>.png   8-bit signed distance to the shoreline (land > 128 > water), 6 m/px
  landuse_<region>.png   8-bit landuse class per 8 m cell (parks, wetland, beach, industrial, ...)
  roads_major.json       motorways..tertiary (+links) for the whole map, with bridge deck heights
  rail.json              railway lines (Blue/Red line + NRC), with bridge heights
  chunks/<cx>_<cz>.json  500 m cells: building footprints + archetypes, minor roads, walls, trees
  places.json            district / neighbourhood labels
  pois.json              named points of interest (amenity / shop / office / ... ) with lat/lon
  geo/*.geojson          simplified lat/lon GeoJSON of the major road network, water edge and POIs (reference)

Coordinates: local metres, +X east, -Z north, origin 6.45N 3.41E (see src/game/map/geoToWorld.ts).
Map data © OpenStreetMap contributors, ODbL 1.0.
"""
import argparse, gzip, json, math, os, hashlib, re, time
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ORIGIN_LAT, ORIGIN_LON = 6.45, 3.41
R = 6378137.0
M_LAT = R * math.pi / 180
M_LON = M_LAT * math.cos(math.radians(ORIGIN_LAT))
CHUNK = 500.0

REGIONS = {
    'core': {'s': 6.395, 'w': 3.325, 'n': 6.555, 'e': 3.505},
    'ikeja': {'s': 6.575, 'w': 3.325, 'n': 6.625, 'e': 3.375},
}
TERRAIN_RES = 6.0
LANDUSE_RES = 8.0
FINE_RES = 3.0
SDF_RANGE = 48.0  # metres mapped to 0..255 around the shoreline


def xz(lat, lon):
    return ((lon - ORIGIN_LON) * M_LON, -(lat - ORIGIN_LAT) * M_LAT)


def ll(x, z):
    return (ORIGIN_LAT - z / M_LAT, ORIGIN_LON + x / M_LON)


def load(raw, name):
    """Load an export; also merges split parts such as core_buildings_p1.json.gz, core_buildings_p2..."""
    paths = [os.path.join(raw, name + '.json.gz')] if os.path.exists(os.path.join(raw, name + '.json.gz')) else []
    paths += sorted(os.path.join(raw, f) for f in os.listdir(raw) if (f.startswith(name + '_p') or f.startswith(name + '_t')) and f.endswith('.json.gz'))
    if not paths:
        print('  (missing', name, ')')
        return {'elements': []}
    out, seen = {'elements': []}, set()
    for p in paths:
        with gzip.open(p, 'rt') as f:
            j = json.load(f)
        out['osm3s'] = j.get('osm3s')
        for el in j['elements']:
            k = (el['type'], el['id'])
            if k not in seen:
                seen.add(k)
                out['elements'].append(el)
    return out


def seed_of(*parts):
    h = hashlib.md5(('|'.join(str(p) for p in parts)).encode()).digest()
    return int.from_bytes(h[:4], 'little')


# ---------------------------------------------------------------- geometry helpers
def dp_simplify(pts, tol):
    """Douglas-Peucker on a list of (x, z)."""
    if len(pts) < 3:
        return pts
    a = np.asarray(pts)
    keep = np.zeros(len(a), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = a[i], a[j]
        d = q - p
        L = math.hypot(*d)
        seg = a[i + 1:j]
        if L < 1e-9:
            dist = np.hypot(*(seg - p).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack.append((i, m))
            stack.append((m, j))
    return [tuple(v) for v in a[keep]]


def poly_area(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        a += x1 * z2 - x2 * z1
    return a / 2


def centroid(pts):
    a = np.asarray(pts)
    return float(a[:, 0].mean()), float(a[:, 1].mean())


def assemble_rings(ways):
    """Join member ways (lists of (x,z) with endpoint keys) into closed rings."""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    key = lambda p: (round(p[0], 2), round(p[1], 2))
    while segs:
        cur = segs.pop()
        changed = True
        while key(cur[0]) != key(cur[-1]) and changed:
            changed = False
            for i, s in enumerate(segs):
                if key(s[0]) == key(cur[-1]):
                    cur += s[1:]
                elif key(s[-1]) == key(cur[-1]):
                    cur += s[::-1][1:]
                elif key(s[-1]) == key(cur[0]):
                    cur = s + cur[1:]
                elif key(s[0]) == key(cur[0]):
                    cur = s[::-1] + cur[1:]
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(cur) >= 4 and key(cur[0]) == key(cur[-1]):
            rings.append(cur)
        elif len(cur) >= 3:
            rings.append(cur + [cur[0]])  # close open rings (clipped at the export bbox)
    return rings


def geom_xz(g):
    return [xz(p['lat'], p['lon']) for p in g if p is not None]


def element_polygons(el):
    """Return list of (outer, [inners]) in xz for a way or multipolygon relation."""
    if el['type'] == 'way':
        g = geom_xz(el.get('geometry', []))
        if len(g) >= 4 and g[0] == g[-1]:
            return [(g, [])]
        if len(g) >= 3 and el.get('tags', {}).get('area') != 'no':
            return [(g + [g[0]], [])]
        return []
    if el['type'] == 'relation':
        outers = [geom_xz(m.get('geometry', [])) for m in el.get('members', []) if m.get('type') == 'way' and m.get('role') in ('outer', '')]
        inners = [geom_xz(m.get('geometry', [])) for m in el.get('members', []) if m.get('type') == 'way' and m.get('role') == 'inner']
        orings = assemble_rings(outers)
        irings = assemble_rings(inners)
        return [(o, irings) for o in orings] if orings else []
    return []


class Grid:
    def __init__(self, region, res):
        b = REGIONS[region]
        x0, z1 = xz(b['s'], b['w'])
        x1, z0 = xz(b['n'], b['e'])
        self.x0, self.z0 = math.floor(x0 / res) * res, math.floor(z0 / res) * res
        self.res = res
        self.w = int(math.ceil((x1 - self.x0) / res)) + 1
        self.h = int(math.ceil((z1 - self.z0) / res)) + 1

    def px(self, pts):
        return [((x - self.x0) / self.res, (z - self.z0) / self.res) for x, z in pts]

    def image(self, fill=0):
        return Image.new('L', (self.w, self.h), fill)


# ---------------------------------------------------------------- water / terrain
def build_terrain(raw, region, out, report):
    t0 = time.time()
    water = load(raw, f'{region}_water')
    grid = Grid(region, FINE_RES)
    W, H = grid.w, grid.h
    print(f'  terrain grid {W}x{H} @ {FINE_RES} m')

    # 1. sea from coastline: rasterise coastlines as barriers, flood-fill from an open-ocean seed
    barrier = grid.image(0)
    db = ImageDraw.Draw(barrier)
    coast_n = 0
    for el in water['elements']:
        if el['type'] == 'way' and el.get('tags', {}).get('natural') == 'coastline':
            pts = grid.px(geom_xz(el.get('geometry', [])))
            if len(pts) >= 2:
                db.line(pts, fill=1, width=2)
                coast_n += 1
    B = np.array(barrier, bool)
    sea = np.zeros((H, W), bool)
    if coast_n:
        lab, n = ndimage.label(~B)
        seeds = [(6.3965, 3.47), (6.3965, 3.44), (6.3965, 3.50)] if region == 'core' else []
        for slat, slon in seeds:
            sx, sz = xz(slat, slon)
            i, j = int((sz - grid.z0) / FINE_RES), int((sx - grid.x0) / FINE_RES)
            if 0 <= i < H and 0 <= j < W and lab[i, j] > 0:
                sea |= lab == lab[i, j]
        # coastline pixels themselves: half land, half sea -> give them to the side they touch most
        sea |= B & (ndimage.uniform_filter(sea.astype(np.float32), 3) > 0.34)
        frac = sea.mean()
        print(f'  coastline ways {coast_n}, sea fraction {frac:.2f}')
        if frac > 0.85:
            print('  !! sea flood leaked everywhere — ignoring coastline flood')
            sea[:] = False

    # 2. water polygons (lakes, lagoon, docks, riverbanks, basins) and wide waterways
    wimg = grid.image(0)
    dw = ImageDraw.Draw(wimg)
    holes = []
    for el in water['elements']:
        t = el.get('tags', {})
        if t.get('natural') == 'coastline':
            continue
        is_area = (t.get('natural') in ('water', 'bay', 'strait') or t.get('waterway') in ('riverbank', 'dock')
                   or t.get('landuse') in ('basin', 'reservoir') or ('water' in t and el['type'] == 'relation'))
        if t.get('water') in ('wastewater',) or t.get('intermittent') == 'yes':
            continue
        if is_area:
            for outer, inners in element_polygons(el):
                if len(outer) >= 4:
                    dw.polygon(grid.px(outer), fill=1)
                    holes += inners
        elif el['type'] == 'way' and t.get('waterway') in ('river', 'canal'):
            pts = grid.px(geom_xz(el.get('geometry', [])))
            width = float(re.sub('[^0-9.]', '', t.get('width', '') or '0') or 0) or (14 if t['waterway'] == 'river' else 9)
            if len(pts) >= 2:
                dw.line(pts, fill=1, width=max(1, int(width / FINE_RES)))
    for ring in holes:
        if len(ring) >= 4:
            dw.polygon(grid.px(ring), fill=0)
    wpoly = np.array(wimg, bool)

    # 3. land that must stay land: piers / breakwaters / islands mapped as place=island are already holes
    land_force = grid.image(0)
    dl = ImageDraw.Draw(land_force)
    lu = load(raw, f'{region}_landuse')
    for el in lu['elements']:
        t = el.get('tags', {})
        if t.get('man_made') in ('pier', 'breakwater', 'groyne'):
            if el['type'] == 'way':
                g = geom_xz(el.get('geometry', []))
                if len(g) >= 4 and g[0] == g[-1]:
                    dl.polygon(grid.px(g), fill=1)
                elif len(g) >= 2:
                    dl.line(grid.px(g), fill=1, width=max(2, int(6 / FINE_RES)))
    lforce = np.array(land_force, bool)

    is_water = (sea | wpoly) & ~lforce
    # remove tiny specks (< ~250 m²) of water and of land
    lab, n = ndimage.label(is_water)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        small = np.isin(lab, np.where(sizes < 250 / FINE_RES ** 2)[0] + 1)
        is_water &= ~small
    lab, n = ndimage.label(~is_water)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        small = np.isin(lab, np.where(sizes < 120 / FINE_RES ** 2)[0] + 1)
        is_water |= small

    # 4. signed distance (metres): + land, - water
    d_land = ndimage.distance_transform_edt(~is_water) * FINE_RES
    d_water = ndimage.distance_transform_edt(is_water) * FINE_RES
    sdf = np.where(is_water, -d_water, d_land) - np.where(is_water, 0, FINE_RES * 0.5) + np.where(is_water, FINE_RES * 0.5, 0)
    # resample to TERRAIN_RES (area mean keeps the zero crossing in place)
    k = int(round(TERRAIN_RES / FINE_RES))
    H2, W2 = H // k, W // k
    sdf2 = sdf[:H2 * k, :W2 * k].reshape(H2, k, W2, k).mean(axis=(1, 3))
    enc = np.clip(128 + sdf2 / SDF_RANGE * 127, 0, 255).astype(np.uint8)
    Image.fromarray(enc, 'L').save(os.path.join(out, f'terrain_{region}.png'), optimize=True)
    report['terrain'][region] = {
        'file': f'terrain_{region}.png', 'x0': grid.x0, 'z0': grid.z0, 'res': TERRAIN_RES, 'w': W2, 'h': H2,
        'range': SDF_RANGE, 'waterFraction': round(float(is_water.mean()), 3),
    }
    print(f'  terrain done in {time.time() - t0:.0f}s, water {is_water.mean():.2f}')
    return is_water, grid


# ---------------------------------------------------------------- landuse
LU_CLASSES = {
    'urban': 0, 'grass': 1, 'wood': 2, 'wetland': 3, 'sand': 4, 'residential': 5, 'commercial': 6, 'industrial': 7,
    'farmland': 8, 'pitch': 9, 'paved': 10, 'rail': 11, 'cemetery': 12, 'school': 13, 'military': 14, 'construction': 15,
}


def lu_class(t):
    lu, le, na, am = t.get('landuse'), t.get('leisure'), t.get('natural'), t.get('amenity')
    if le in ('pitch', 'stadium', 'sports_centre', 'playground'):
        return 'pitch'
    if le in ('park', 'garden', 'golf_course', 'recreation_ground', 'common', 'nature_reserve'):
        return 'grass'
    if na in ('wood',) or lu in ('forest',):
        return 'wood'
    if na in ('scrub', 'heath', 'grassland') or lu in ('grass', 'meadow', 'village_green', 'recreation_ground', 'greenfield'):
        return 'grass'
    if na in ('wetland', 'mud'):
        return 'wetland'
    if na in ('beach', 'sand', 'bare_rock'):
        return 'sand'
    if lu in ('residential',):
        return 'residential'
    if lu in ('commercial', 'retail') or am == 'marketplace':
        return 'commercial'
    if lu in ('industrial', 'port', 'depot', 'harbour', 'warehouse', 'quarry', 'landfill'):
        return 'industrial'
    if lu in ('farmland', 'farmyard', 'orchard', 'plant_nursery', 'allotments'):
        return 'farmland'
    if lu in ('railway',):
        return 'rail'
    if lu in ('cemetery',) or am == 'grave_yard':
        return 'cemetery'
    if am in ('school', 'university', 'college', 'hospital') or lu in ('education', 'institutional', 'religious'):
        return 'school'
    if lu in ('military',):
        return 'military'
    if lu in ('construction', 'brownfield'):
        return 'construction'
    if am in ('parking', 'bus_station') or t.get('aeroway'):
        return 'paved'
    return None


def build_landuse(raw, region, out, report):
    lu = load(raw, f'{region}_landuse')
    grid = Grid(region, LANDUSE_RES)
    img = grid.image(LU_CLASSES['urban'])
    d = ImageDraw.Draw(img)
    items = []
    for el in lu['elements']:
        c = lu_class(el.get('tags', {}))
        if not c:
            continue
        for outer, inners in element_polygons(el):
            a = abs(poly_area(outer))
            items.append((a, c, outer, inners))
    # big areas first so detailed small areas paint on top
    items.sort(key=lambda it: -it[0])
    for a, c, outer, inners in items:
        d.polygon(grid.px(outer), fill=LU_CLASSES[c])
        for ring in inners:
            if len(ring) >= 4:
                d.polygon(grid.px(ring), fill=LU_CLASSES['urban'])
    img.save(os.path.join(out, f'landuse_{region}.png'), optimize=True)
    report['landuse'][region] = {'file': f'landuse_{region}.png', 'x0': grid.x0, 'z0': grid.z0, 'res': LANDUSE_RES, 'w': grid.w, 'h': grid.h, 'classes': LU_CLASSES}
    return np.array(img), grid


# ---------------------------------------------------------------- roads
ROAD_CLASS = {
    'motorway': 0, 'motorway_link': 0, 'trunk': 1, 'trunk_link': 1, 'primary': 2, 'primary_link': 2,
    'secondary': 3, 'secondary_link': 3, 'tertiary': 4, 'tertiary_link': 4, 'unclassified': 5, 'road': 5,
    'residential': 6, 'living_street': 6, 'service': 7, 'pedestrian': 8, 'footway': 9, 'path': 9, 'cycleway': 9,
    'steps': 9, 'track': 10, 'busway': 2,
}
# default carriageway width (m): two-way / one-way
ROAD_W = {0: (22, 11.5), 1: (16, 10), 2: (13, 8), 3: (10.5, 7), 4: (8.5, 6), 5: (7, 5), 6: (6, 4.5), 7: (4.2, 3.6), 8: (5, 5), 9: (2.2, 2.2), 10: (3.2, 3.2)}
MAJOR = {0, 1, 2, 3, 4}


def road_width(t, cls):
    oneway = t.get('oneway') in ('yes', '1', '-1') or t.get('junction') == 'roundabout'
    w = ROAD_W[cls][1 if oneway else 0]
    if t.get('highway', '').endswith('_link'):
        w = min(w, 7.5)
    try:
        lanes = int(str(t.get('lanes', '')).split(';')[0])
        if 1 <= lanes <= 8 and cls <= 6:
            w = lanes * 3.4 + (0.8 if oneway else 1.2)
    except ValueError:
        pass
    try:
        w2 = float(re.sub('[^0-9.]', '', t.get('width', '')))
        if 2 <= w2 <= 40:
            w = w2
    except ValueError:
        pass
    return w, oneway


def bridge_heights(ways, all_node_use):
    """ways: list of dicts with 'nodes' (ids), 'pts' (xz), 'bridge' bool. Returns {way_index: [h per vertex]}.

    Deck height rises from the 'grounded' bridge ends (nodes shared with non-bridge ways or dead ends) using
    multi-source Dijkstra over the bridge sub-graph, so long bridges split into many OSM ways stay level."""
    import heapq
    adj = defaultdict(list)
    node_pos = {}
    bridge_nodes = set()
    for wi, w in enumerate(ways):
        if not w['bridge']:
            continue
        ns, ps = w['nodes'], w['pts']
        for i in range(len(ns)):
            node_pos[ns[i]] = ps[i]
            bridge_nodes.add(ns[i])
            if i:
                L = math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1])
                adj[ns[i]].append((ns[i - 1], L))
                adj[ns[i - 1]].append((ns[i], L))
    # grounded = bridge endpoints used by a non-bridge way, or bridge dead-ends
    grounded = set()
    for n in bridge_nodes:
        if all_node_use.get(n, (0, 0))[1] > 0:  # used by a non-bridge way
            grounded.add(n)
        elif len(adj[n]) == 1:
            grounded.add(n)
    dist = {n: 0.0 for n in grounded}
    pq = [(0.0, n) for n in grounded]
    heapq.heapify(pq)
    while pq:
        d, n = heapq.heappop(pq)
        if d > dist.get(n, 1e18):
            continue
        for m, L in adj[n]:
            nd = d + L
            if nd < dist.get(m, 1e18):
                dist[m] = nd
                heapq.heappush(pq, (nd, m))
    # component lengths (to size the deck height)
    comp = {}
    comp_len = {}
    cid = 0
    for n in bridge_nodes:
        if n in comp:
            continue
        stack = [n]
        comp[n] = cid
        total = 0.0
        while stack:
            a = stack.pop()
            for b, L in adj[a]:
                total += L
                if b not in comp:
                    comp[b] = cid
                    stack.append(b)
        comp_len[cid] = total / 2
        cid += 1
    out = {}
    for wi, w in enumerate(ways):
        if not w['bridge']:
            continue
        hs = []
        for n in w['nodes']:
            L = comp_len.get(comp.get(n), 0)
            if L < 45:
                hs.append(0.0)
                continue
            hmax = min(9.0, max(2.5, L * 0.03)) if w.get('layer', 1) >= 0 else 0
            ramp = min(140.0, max(18.0, L * 0.22))
            d = dist.get(n, ramp)
            t = min(1.0, d / ramp)
            hs.append(hmax * (t * t * (3 - 2 * t)))
        out[wi] = hs
    return out


def clip_polyline_to_chunks(pts, extra=None):
    """Split a polyline at chunk borders. Returns {(cx,cz): [ [ (x,z,(extra)) ...], ...]}"""
    res = defaultdict(list)
    if len(pts) < 2:
        return res
    cur = [pts[0] + ((extra[0],) if extra else ())]
    ck = (math.floor(pts[0][0] / CHUNK), math.floor(pts[0][1] / CHUNK))
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        ea = extra[i - 1] if extra else None
        eb = extra[i] if extra else None
        ta = 0.0
        # walk across chunk borders between a and b
        while True:
            bk = (math.floor(b[0] / CHUNK), math.floor(b[1] / CHUNK))
            if bk == ck:
                cur.append(b + ((eb,) if extra else ()))
                break
            # find exit t from current chunk ck along a->b
            dx, dz = b[0] - a[0], b[1] - a[1]
            cand = []
            if dx > 0:
                cand.append(((ck[0] + 1) * CHUNK - a[0]) / dx)
            elif dx < 0:
                cand.append((ck[0] * CHUNK - a[0]) / dx)
            if dz > 0:
                cand.append(((ck[1] + 1) * CHUNK - a[1]) / dz)
            elif dz < 0:
                cand.append((ck[1] * CHUNK - a[1]) / dz)
            t = min([c for c in cand if c > ta - 1e-9] or [1.0])
            t = min(max(t, ta), 1.0)
            p = (a[0] + dx * t, a[1] + dz * t)
            e = (ea + (eb - ea) * t) if extra else None
            cur.append(p + ((e,) if extra else ()))
            if len(cur) >= 2:
                res[ck].append(cur)
            nx, nz = p[0] + dx * 1e-6, p[1] + dz * 1e-6
            ck = (math.floor(nx / CHUNK), math.floor(nz / CHUNK))
            cur = [p + ((e,) if extra else ())]
            ta = t
            if t >= 1.0:
                break
    if len(cur) >= 2:
        res[ck].append(cur)
    return res


def build_roads(raw, regions, out, chunks, report, names):
    ways = []
    node_use = defaultdict(lambda: [0, 0])  # node -> [bridge uses, non-bridge uses]
    for region in regions:
        data = load(raw, f'{region}_roads')
        for el in data['elements']:
            if el['type'] != 'way':
                continue
            t = el.get('tags', {})
            hw = t.get('highway')
            if hw not in ROAD_CLASS or t.get('area') == 'yes' or t.get('tunnel') in ('yes', 'building_passage'):
                continue
            if t.get('access') in ('private', 'no') and ROAD_CLASS[hw] >= 7:
                continue
            g = el.get('geometry', [])
            ns = el.get('nodes', [])
            if len(g) < 2 or len(g) != len(ns):
                continue
            pts = [xz(p['lat'], p['lon']) for p in g]
            cls = ROAD_CLASS[hw]
            br = t.get('bridge') not in (None, 'no') or t.get('man_made') == 'bridge'
            try:
                layer = int(str(t.get('layer', '1' if br else '0')).split(';')[0])
            except ValueError:
                layer = 1 if br else 0
            w, oneway = road_width(t, cls)
            unpaved = t.get('surface') in ('unpaved', 'dirt', 'ground', 'sand', 'gravel', 'compacted', 'earth', 'mud', 'fine_gravel', 'laterite')
            ways.append({'id': el['id'], 'cls': cls, 'hw': hw, 'pts': pts, 'nodes': ns, 'bridge': br, 'layer': layer, 'w': w,
                         'oneway': oneway, 'name': t.get('name') or t.get('ref') or '', 'link': hw.endswith('_link'), 'unpaved': unpaved})
            for n in ns:
                node_use[n][0 if br else 1] += 1
    print(f'  roads: {len(ways)} ways')
    bh = bridge_heights(ways, node_use)
    major_out = []
    geo_feats = []
    graph_edges = []
    for wi, w in enumerate(ways):
        hs = bh.get(wi)
        pts = w['pts']
        tol = 0.9 if w['cls'] in MAJOR else 0.6
        if hs is None:
            simp = dp_simplify(pts, tol)
            hsimp = None
        else:
            # keep vertices where height changes too: simplify in 3D by keeping every point with distinct height
            keep_idx = set(range(len(pts)))
            simp = [pts[i] for i in sorted(keep_idx)]
            hsimp = [hs[i] for i in sorted(keep_idx)]
        ni = names.idx(w['name'])
        flags = (1 if w['bridge'] else 0) | (2 if w['oneway'] else 0) | (4 if w['link'] else 0) | (8 if w['unpaved'] else 0)
        if w['cls'] in MAJOR:
            rec = [w['cls'], int(round(w['w'] * 10)), ni, flags, len(simp)]
            for x, z in simp:
                rec += [int(round(x * 10)), int(round(z * 10))]
            if hsimp:
                rec += [int(round(h * 10)) for h in hsimp]
            major_out.append(rec)
            geo_feats.append({'type': 'Feature', 'properties': {'highway': w['hw'], 'name': w['name'], 'bridge': w['bridge'], 'osm_id': w['id']},
                              'geometry': {'type': 'LineString', 'coordinates': [[round(ll(x, z)[1], 6), round(ll(x, z)[0], 6)] for x, z in dp_simplify(pts, 2.0)]}})
        else:
            parts = clip_polyline_to_chunks(simp, hsimp)
            for ck, lines in parts.items():
                for line in lines:
                    rec = [w['cls'], int(round(w['w'] * 10)), flags, len(line)]
                    ox, oz = ck[0] * CHUNK, ck[1] * CHUNK
                    for p in line:
                        rec += [int(round((p[0] - ox) * 10)), int(round((p[1] - oz) * 10))]
                    if hsimp:
                        rec += [int(round(p[2] * 10)) for p in line]
                    chunks[ck]['roads'].append((rec, w['name']))
        if w['cls'] <= 7 and w['hw'] not in ('service',) or w['cls'] <= 6:
            graph_edges.append(w)
    with open(os.path.join(out, 'roads_major.json'), 'w') as f:
        json.dump({'format': 'cls,widthDm,nameIdx,flags(1 bridge,2 oneway,4 link),n,x0,z0..(dm)[,h0..hn (dm) if bridge]', 'roads': major_out}, f, separators=(',', ':'))
    os.makedirs(os.path.join(out, 'geo'), exist_ok=True)
    with open(os.path.join(out, 'geo', 'roads_major.geojson'), 'w') as f:
        json.dump({'type': 'FeatureCollection', 'attribution': '© OpenStreetMap contributors (ODbL)', 'features': geo_feats}, f, separators=(',', ':'))
    report['roads'] = {'major': len(major_out), 'all': len(ways), 'bridges': sum(1 for w in ways if w['bridge'])}
    return ways, bh


def build_rail(raw, regions, out):
    ways = []
    node_use = defaultdict(lambda: [0, 0])
    for region in regions:
        for el in load(raw, f'{region}_rail')['elements']:
            if el['type'] != 'way':
                continue
            t = el.get('tags', {})
            g, ns = el.get('geometry', []), el.get('nodes', [])
            if len(g) < 2 or len(g) != len(ns) or t.get('railway') == 'construction' and not t.get('construction'):
                continue
            if t.get('service') in ('yard', 'siding', 'spur') or t.get('tunnel') == 'yes':
                continue
            br = t.get('bridge') not in (None, 'no')
            ways.append({'pts': [xz(p['lat'], p['lon']) for p in g], 'nodes': ns, 'bridge': br, 'layer': 1, 'kind': t.get('railway'), 'name': t.get('name', '')})
            for n in ns:
                node_use[n][0 if br else 1] += 1
    bh = bridge_heights(ways, node_use)
    recs = []
    for wi, w in enumerate(ways):
        pts = w['pts'] if wi in bh else dp_simplify(w['pts'], 0.8)
        rec = [1 if w['bridge'] else 0, len(pts)]
        for x, z in pts:
            rec += [int(round(x * 10)), int(round(z * 10))]
        if wi in bh:
            rec += [int(round(h * 10)) for h in bh[wi]]
        recs.append(rec)
    with open(os.path.join(out, 'rail.json'), 'w') as f:
        json.dump({'format': 'bridge,n,x0,z0..(dm)[,h..]', 'rail': recs}, f, separators=(',', ':'))
    return len(recs)


# ---------------------------------------------------------------- districts & buildings
HIGH = ['ikoyi', 'victoria island', 'lekki', 'oniru', 'banana island', 'parkview', 'eko atlantic', 'osborne', 'dolphin', 'maroko', 'onikan', 'falomo', 'awolowo']
CBD = ['marina', 'broad street', 'lagos island', 'idumota', 'balogun', 'tinubu', 'obalende', 'victoria island', 'campos', 'isale eko', 'lafiaji', 'olowogbowo']
PORT = ['apapa', 'tin can', 'ijora', 'iganmu', 'costain', 'ebute ero', 'iddo', 'otto', 'kirikiri', 'liverpool', 'wharf', 'creek road']
DENSE = ['mushin', 'ajegunle', 'makoko', 'oyingbo', 'ebute metta', 'ebute-metta', 'olaleye', 'itire', 'lawanson', 'idi araba', 'iwaya', 'otto', 'oko baba', 'alagomeji', 'jibowu', 'onipanu', 'shomolu', 'bariga', 'akoka', 'fadeyi', 'ilasamaja', 'ijesha', 'aguda', 'ojuelegba', 'idi oro']


def district_profile(name):
    n = (name or '').lower()
    for k in PORT:
        if k in n:
            return 'port'
    for k in HIGH:
        if k in n:
            return 'high'
    for k in CBD:
        if k in n:
            return 'cbd'
    for k in DENSE:
        if k in n:
            return 'dense'
    return 'mainland'


class Places:
    def __init__(self, raw):
        self.items = []
        data = load(raw, 'places')
        for el in data['elements']:
            t = el.get('tags', {})
            name = t.get('name:en') or t.get('name')
            if not name:
                continue
            lat = el.get('lat') or (el.get('center') or {}).get('lat')
            lon = el.get('lon') or (el.get('center') or {}).get('lon')
            if lat is None:
                continue
            x, z = xz(lat, lon)
            kind = t.get('place')
            self.items.append({'name': name, 'kind': kind, 'x': x, 'z': z, 'lat': lat, 'lon': lon, 'type': el['type']})
        self.arr = np.array([[p['x'], p['z']] for p in self.items]) if self.items else np.zeros((0, 2))
        self.rank = np.array([{'city': 0, 'town': 1, 'suburb': 2, 'quarter': 3, 'neighbourhood': 4, 'island': 3, 'islet': 5, 'village': 3, 'hamlet': 5, 'locality': 5}.get(p['kind'], 6) for p in self.items])

    def nearest(self, x, z, kinds=('suburb', 'quarter', 'neighbourhood', 'village', 'town')):
        if not len(self.arr):
            return ''
        d = np.hypot(self.arr[:, 0] - x, self.arr[:, 1] - z)
        mask = np.array([p['kind'] in kinds for p in self.items])
        d = np.where(mask, d, 1e12)
        i = int(np.argmin(d))
        return self.items[i]['name'] if d[i] < 4000 else ''


ARCH = {'bungalow': 0, 'house': 1, 'shophouse': 2, 'apartment': 3, 'tower': 4, 'villa': 5, 'warehouse': 6, 'stall': 7, 'worship': 8, 'civic': 9}


def parse_height(t):
    h = None
    for k in ('height', 'building:height'):
        v = t.get(k)
        if v:
            try:
                h = float(re.sub('[^0-9.]', '', v.split(';')[0]))
                break
            except ValueError:
                pass
    lv = None
    v = t.get('building:levels')
    if v:
        try:
            lv = float(re.sub('[^0-9.]', '', v.split(';')[0]))
        except ValueError:
            lv = None
    return h, lv


def classify_building(t, area, prof, lu, rnd):
    b = t.get('building', 'yes')
    h, lv = parse_height(t)
    am = t.get('amenity')
    if b in ('mosque', 'church', 'cathedral', 'chapel', 'temple') or am == 'place_of_worship':
        arch = 'worship'
    elif b in ('warehouse', 'industrial', 'hangar', 'storage_tank', 'factory', 'manufacture', 'shed', 'garage', 'garages', 'container') or lu == 'industrial':
        arch = 'warehouse' if area > 120 or b in ('warehouse', 'industrial', 'hangar') else 'bungalow'
    elif b in ('kiosk', 'retail') and area < 40 or (am == 'marketplace') or b == 'roof' and area < 60:
        arch = 'stall'
    elif b in ('school', 'university', 'college', 'hospital', 'government', 'public', 'civic', 'train_station', 'transportation', 'stadium', 'grandstand'):
        arch = 'civic'
    elif b in ('office', 'commercial') and (area > 500 or (lv or 0) >= 6) or (lv or 0) >= 9 or (h or 0) >= 27:
        arch = 'tower'
    elif b in ('apartments', 'dormitory', 'hotel') or (prof == 'high' and area > 350):
        arch = 'apartment'
    elif prof == 'high' and 90 < area <= 350 and b in ('house', 'detached', 'semidetached_house', 'residential', 'yes', 'terrace'):
        arch = 'villa'
    elif b in ('commercial', 'retail', 'office', 'supermarket') or lu == 'commercial' or prof == 'cbd':
        arch = 'shophouse' if area < 1500 else 'tower'
    elif area < 70 or b in ('hut', 'cabin', 'bungalow'):
        arch = 'bungalow'
    elif prof == 'dense':
        arch = 'house' if area > 110 or rnd < 0.35 else 'bungalow'
    elif prof == 'port':
        arch = 'warehouse' if area > 300 else 'bungalow'
    else:
        arch = 'house' if rnd < 0.55 or area > 220 else 'bungalow'

    # floors
    if lv is None and h:
        lv = max(1, round(h / 3.2))
    if lv is None:
        r2 = (rnd * 7.31) % 1
        lv = {
            'bungalow': 1, 'stall': 1, 'warehouse': 1, 'worship': 2,
            'house': 2 + (r2 > 0.55) + (r2 > 0.88),
            'shophouse': 2 + int(r2 * 3) + (1 if prof == 'cbd' else 0),
            'apartment': 3 + int(r2 * 4) + (2 if area > 900 else 0),
            'villa': 2,
            'tower': 6 + int(r2 * 10) + (6 if area > 1500 else 0),
            'civic': 2 + int(r2 * 2),
        }[arch]
    lv = int(max(1, min(lv, 60)))
    if arch in ('bungalow', 'house') and lv >= 5:
        arch = 'apartment'
    if arch == 'apartment' and lv >= 11:
        arch = 'tower'
    if h is None:
        h = lv * (3.1 if arch != 'warehouse' else 7.0) + (0.6 if arch in ('bungalow', 'house', 'villa') else 0.3)
    roof = 1 if arch in ('bungalow', 'villa') or (arch == 'house' and area < 260 and rnd > 0.3) else (2 if arch == 'warehouse' else 0)
    return ARCH[arch], h, lv, roof


def build_buildings(raw, regions, places, landuse, chunks, report, poi_buildings):
    total = 0
    skipped = 0
    for region in regions:
        data = load(raw, f'{region}_buildings')
        lu_img, lu_grid = landuse.get(region, (None, None))
        inv_lu = {v: k for k, v in LU_CLASSES.items()}
        for el in data['elements']:
            t = el.get('tags', {})
            if t.get('building') in ('construction', 'ruins', 'no', 'roof') and not t.get('name'):
                if t.get('building') != 'roof':
                    skipped += 1
                    continue
            if t.get('location') == 'underground' or t.get('layer', '0').startswith('-'):
                continue
            polys = element_polygons(el)
            for outer, inners in polys:
                pts = dp_simplify(outer[:-1] if outer[0] == outer[-1] else outer, 0.3)
                if len(pts) < 3:
                    continue
                area = abs(poly_area(pts))
                if area < 9 or area > 250000:
                    skipped += 1
                    continue
                if poly_area(pts) < 0:  # store counter-clockwise in x/z (z south) -> consistent winding
                    pts = pts[::-1]
                cx, cz = centroid(pts)
                rnd = (seed_of(el['id']) % 10000) / 10000
                district = places.nearest(cx, cz)
                prof = district_profile(district)
                lu = None
                if lu_img is not None:
                    i, j = int((cz - lu_grid.z0) / lu_grid.res), int((cx - lu_grid.x0) / lu_grid.res)
                    if 0 <= i < lu_img.shape[0] and 0 <= j < lu_img.shape[1]:
                        lu = inv_lu.get(int(lu_img[i, j]))
                arch, h, lv, roof = classify_building(t, area, prof, lu, rnd)
                ck = (math.floor(cx / CHUNK), math.floor(cz / CHUNK))
                ox, oz = ck[0] * CHUNK, ck[1] * CHUNK
                rec = [arch, int(round(h * 10)), lv, roof, seed_of(el['id']) % 997, len(pts)]
                for x, z in pts:
                    rec += [int(round((x - ox) * 10)), int(round((z - oz) * 10))]
                name = t.get('name', '')
                chunks[ck]['buildings'].append((rec, name, el['id']))
                if name:
                    poi_buildings.append({'name': name, 'x': cx, 'z': cz, 'osm': f"{el['type']}/{el['id']}", 'building': t.get('building'), 'levels': lv})
                total += 1
    report['buildings'] = {'count': total, 'skipped': skipped}
    print(f'  buildings: {total} (skipped {skipped})')


def build_barriers(raw, regions, chunks):
    n = 0
    for region in regions:
        for el in load(raw, f'{region}_barriers')['elements']:
            if el['type'] != 'way':
                continue
            t = el.get('tags', {})
            kind = {'wall': 0, 'city_wall': 0, 'retaining_wall': 0, 'fence': 1, 'gate': 2}.get(t.get('barrier'))
            if kind is None:
                continue
            pts = dp_simplify(geom_xz(el.get('geometry', [])), 0.4)
            for ck, lines in clip_polyline_to_chunks(pts).items():
                for line in lines:
                    ox, oz = ck[0] * CHUNK, ck[1] * CHUNK
                    rec = [kind, len(line)]
                    for x, z in line:
                        rec += [int(round((x - ox) * 10)), int(round((z - oz) * 10))]
                    chunks[ck]['walls'].append(rec)
                    n += 1
    print(f'  walls/fences: {n}')


def build_trees(regions, landuse, terrain_water, chunks, raw):
    """Scatter trees on vegetated landuse cells (and OSM natural=tree nodes), away from buildings and roads."""
    n = 0
    dens = {LU_CLASSES['grass']: 0.006, LU_CLASSES['wood']: 0.022, LU_CLASSES['wetland']: 0.012, LU_CLASSES['residential']: 0.0005,
            LU_CLASSES['school']: 0.002, LU_CLASSES['farmland']: 0.004, LU_CLASSES['cemetery']: 0.005, LU_CLASSES['urban']: 0.00012,
            LU_CLASSES['military']: 0.003}
    for region in regions:
        if region not in landuse:
            continue
        lu, g = landuse[region]
        water, wg = terrain_water.get(region, (None, None))
        # occupancy raster of buildings + roads at landuse resolution
        occ = Image.new('L', (g.w, g.h), 0)
        d = ImageDraw.Draw(occ)
        for ck, c in chunks.items():
            ox, oz = ck[0] * CHUNK, ck[1] * CHUNK
            for rec, _, _ in c['buildings']:
                n_ = rec[5]
                pts = [((ox + rec[6 + 2 * i] / 10 - g.x0) / g.res, (oz + rec[7 + 2 * i] / 10 - g.z0) / g.res) for i in range(n_)]
                d.polygon(pts, fill=1)
            for rec, _ in c['roads']:
                n_ = rec[3]
                pts = [((ox + rec[4 + 2 * i] / 10 - g.x0) / g.res, (oz + rec[5 + 2 * i] / 10 - g.z0) / g.res) for i in range(n_)]
                d.line(pts, fill=1, width=max(1, int(rec[1] / 10 / g.res + 1)))
        occ = np.array(occ, bool)
        rng = np.random.default_rng(1234)
        H, W = lu.shape
        p = np.zeros((H, W), np.float32)
        for cls, v in dens.items():
            p[lu == cls] = v * g.res * g.res
        p[occ] = 0
        if water is not None:
            # landuse grid and terrain grid differ in resolution: sample water at cell centres
            ii = ((np.arange(H)[:, None] + 0.5) * g.res + g.z0 - wg.z0) / wg.res
            jj = ((np.arange(W)[None, :] + 0.5) * g.res + g.x0 - wg.x0) / wg.res
            ii = np.clip(ii.astype(int), 0, water.shape[0] - 1)
            jj = np.clip(jj.astype(int), 0, water.shape[1] - 1)
            p[water[ii, jj]] = 0
        # expected count per cell can exceed 1 for dense woods
        cnt = rng.poisson(p)
        ys, xs = np.nonzero(cnt)
        for i, j in zip(ys, xs):
            for _ in range(int(cnt[i, j])):
                x = g.x0 + (j + rng.random()) * g.res
                z = g.z0 + (i + rng.random()) * g.res
                kind = 3 if lu[i, j] in (LU_CLASSES['wetland'],) else int(rng.integers(0, 3))
                ck = (math.floor(x / CHUNK), math.floor(z / CHUNK))
                chunks[ck]['trees'] += [int(round((x - ck[0] * CHUNK) * 10)), int(round((z - ck[1] * CHUNK) * 10)), kind]
                n += 1
        # OSM-mapped individual trees
        for el in load(raw, f'{region}_pois')['elements']:
            if el['type'] == 'node' and el.get('tags', {}).get('natural') == 'tree':
                x, z = xz(el['lat'], el['lon'])
                ck = (math.floor(x / CHUNK), math.floor(z / CHUNK))
                chunks[ck]['trees'] += [int(round((x - ck[0] * CHUNK) * 10)), int(round((z - ck[1] * CHUNK) * 10)), 1]
                n += 1
    print(f'  trees: {n}')


# ---------------------------------------------------------------- POIs
POI_KEEP = ('amenity', 'shop', 'office', 'tourism', 'leisure', 'historic', 'public_transport', 'railway', 'highway', 'man_made')


def build_pois(raw, regions, out, poi_buildings):
    pois = []
    seen = set()
    for region in regions:
        for el in load(raw, f'{region}_pois')['elements']:
            t = el.get('tags', {})
            if t.get('natural') == 'tree':
                continue
            lat = el.get('lat') or (el.get('center') or {}).get('lat')
            lon = el.get('lon') or (el.get('center') or {}).get('lon')
            if lat is None:
                continue
            name = t.get('name') or ''
            cat = next((f'{k}={t[k]}' for k in POI_KEEP if k in t), None)
            if not cat:
                continue
            if not name and not (t.get('highway') == 'bus_stop' or t.get('amenity') in ('fuel', 'bank', 'atm', 'restaurant', 'fast_food', 'bar', 'pub', 'cafe', 'marketplace', 'place_of_worship')):
                continue
            key = (el['type'], el['id'])
            if key in seen:
                continue
            seen.add(key)
            x, z = xz(lat, lon)
            pois.append({'id': f"{el['type']}/{el['id']}", 'name': name, 'cat': cat, 'lat': round(lat, 7), 'lon': round(lon, 7), 'x': round(x, 1), 'z': round(z, 1)})
    with open(os.path.join(out, 'pois.json'), 'w') as f:
        json.dump({'attribution': '© OpenStreetMap contributors (ODbL)', 'pois': pois}, f, separators=(',', ':'))
    with open(os.path.join(out, 'geo', 'pois.geojson'), 'w') as f:
        json.dump({'type': 'FeatureCollection', 'attribution': '© OpenStreetMap contributors (ODbL)', 'features': [
            {'type': 'Feature', 'properties': {'id': p['id'], 'name': p['name'], 'category': p['cat']}, 'geometry': {'type': 'Point', 'coordinates': [p['lon'], p['lat']]}} for p in pois]}, f, separators=(',', ':'))
    print(f'  pois: {len(pois)}')
    return pois


# ---------------------------------------------------------------- names
class Names:
    def __init__(self):
        self.list = ['']
        self.map = {'': 0}

    def idx(self, n):
        if n not in self.map:
            self.map[n] = len(self.list)
            self.list.append(n)
        return self.map[n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', default='osm-raw')
    ap.add_argument('--out', default='public/data/lagos')
    ap.add_argument('--regions', default='core,ikeja')
    ap.add_argument('--skip-terrain', action='store_true')
    a = ap.parse_args()
    regions = [r for r in a.regions.split(',') if os.path.exists(os.path.join(a.raw, f'{r}_roads.json.gz'))]
    os.makedirs(os.path.join(a.out, 'chunks'), exist_ok=True)
    os.makedirs(os.path.join(a.out, 'geo'), exist_ok=True)
    report = {'terrain': {}, 'landuse': {}}
    manifest_raw = json.load(open(os.path.join(a.raw, 'manifest.json'))) if os.path.exists(os.path.join(a.raw, 'manifest.json')) else {}
    chunks = defaultdict(lambda: {'buildings': [], 'roads': [], 'walls': [], 'trees': []})
    names = Names()

    t0 = time.time()
    places = Places(a.raw)
    print(f'places: {len(places.items)}')
    terrain_water = {}
    landuse = {}
    for region in regions:
        print(f'[{region}]')
        if not a.skip_terrain:
            water, g = build_terrain(a.raw, region, a.out, report)
            terrain_water[region] = (water, g)
        landuse[region] = build_landuse(a.raw, region, a.out, report)
    print('[roads]')
    build_roads(a.raw, regions, a.out, chunks, report, names)
    report['rail'] = build_rail(a.raw, regions, a.out)
    print('[buildings]')
    poi_buildings = []
    build_buildings(a.raw, regions, places, landuse, chunks, report, poi_buildings)
    build_barriers(a.raw, regions, chunks)
    build_trees(regions, landuse, terrain_water, chunks, a.raw)
    print('[pois]')
    build_pois(a.raw, regions, a.out, poi_buildings)
    with open(os.path.join(a.out, 'buildings_named.json'), 'w') as f:
        json.dump(poi_buildings, f, separators=(',', ':'))

    # places (labels)
    pl = [{'name': p['name'], 'kind': p['kind'], 'x': round(p['x'], 1), 'z': round(p['z'], 1), 'lat': p['lat'], 'lon': p['lon'],
           'profile': district_profile(p['name'])} for p in places.items]
    with open(os.path.join(a.out, 'places.json'), 'w') as f:
        json.dump(pl, f, separators=(',', ':'))

    # chunk files
    index = {}
    for f in os.listdir(os.path.join(a.out, 'chunks')):
        os.remove(os.path.join(a.out, 'chunks', f))
    for ck, c in chunks.items():
        if not (c['buildings'] or c['roads'] or c['walls'] or c['trees']):
            continue
        cn = Names()
        roads = []
        for rec, name in c['roads']:
            roads.append([rec[0], rec[1], cn.idx(name)] + rec[2:])
        data = {
            'b': [rec for rec, _, _ in c['buildings']],
            'r': roads,
            'w': c['walls'],
            't': c['trees'],
            'n': cn.list,
        }
        fn = f'{ck[0]}_{ck[1]}.json'
        with open(os.path.join(a.out, 'chunks', fn), 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        index[f'{ck[0]},{ck[1]}'] = [len(c['buildings']), len(roads), len(c['trees']) // 3]

    region_bounds = {}
    for r in regions:
        b = REGIONS[r]
        x0, z1 = xz(b['s'], b['w'])
        x1, z0 = xz(b['n'], b['e'])
        region_bounds[r] = {'bbox': b, 'x0': round(x0, 1), 'z0': round(z0, 1), 'x1': round(x1, 1), 'z1': round(z1, 1)}
    manifest = {
        'version': 1,
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'attribution': 'Map data © OpenStreetMap contributors',
        'attributionUrl': 'https://www.openstreetmap.org/copyright',
        'license': 'ODbL 1.0',
        'osmBase': next((v.get('osm_base') for v in manifest_raw.get('files', {}).values() if v.get('osm_base')), None),
        'origin': {'lat': ORIGIN_LAT, 'lon': ORIGIN_LON, 'mPerDegLat': M_LAT, 'mPerDegLon': M_LON, 'axes': '+x east, -z north, metres'},
        'chunkSize': CHUNK,
        'regions': region_bounds,
        'terrain': report['terrain'],
        'landuse': report['landuse'],
        'roadNames': names.list,
        'chunks': index,
        'stats': {k: v for k, v in report.items() if k not in ('terrain', 'landuse')},
    }
    with open(os.path.join(a.out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))
    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(a.out) for fn in fns)
    print(f'done in {time.time() - t0:.0f}s — {len(index)} chunks, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
