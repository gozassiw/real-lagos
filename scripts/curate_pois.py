#!/usr/bin/env python3
"""
Pick the gameplay points of interest from REAL OpenStreetMap features and write public/data/lagos/gameplay.json.

Each spot is anchored to a real OSM feature (searched by name/category near a known location). The interaction
marker is then moved just outside the building it sits in (onto the street side) so the player can reach it.

  python3 scripts/curate_pois.py --data public/data/lagos [--list]
"""
import argparse, json, math, os, re

ORIGIN_LAT, ORIGIN_LON = 6.45, 3.41
M_LAT = 6378137.0 * math.pi / 180
M_LON = M_LAT * math.cos(math.radians(ORIGIN_LAT))
CHUNK = 500.0


def xz(lat, lon):
    return ((lon - ORIGIN_LON) * M_LON, -(lat - ORIGIN_LAT) * M_LAT)


def ll(x, z):
    return (ORIGIN_LAT - z / M_LAT, ORIGIN_LON + x / M_LON)


# kind, id, zone, label, search: (regex on name, category regex, near lat, lon, radius m), params
SPOTS = [
    # ---- Ikoyi (home, danfo)
    dict(id='ikoyi-home', kind='home', zone='Ikoyi', label='Your flat', search=(None, r'building=(apartments|residential)|^building', 6.4466, 3.4328, 260), building=True),
    dict(id='stop-falomo', kind='danfo', zone='Ikoyi', label='Falomo bus stop', search=(r'falomo', r'highway=bus_stop|public_transport', 6.4440, 3.4300, 700)),
    # ---- Victoria Island (office job, food)
    dict(id='vi-office', kind='work', zone='Victoria Island', label='VI office', search=(r'.', r'office=|building=office|building=commercial', 6.4335, 3.4225, 450), pay=2000, energy=18, seconds=4),
    dict(id='vi-suya', kind='eat', zone='Victoria Island', label='Suya spot', search=(r'.', r'amenity=(fast_food|restaurant|cafe)', 6.4320, 3.4220, 600), price=1500, meal='Suya & cold zobo', hunger=40),
    dict(id='stop-vi', kind='danfo', zone='Victoria Island', label='Ozumba Mbadiwe bus stop', search=(r'ozumba|mbadiwe|vi\b|victoria|bonny|ahmadu|1004|bar beach', r'highway=bus_stop|public_transport', 6.4350, 3.4290, 900)),
    # ---- Lagos Island (market, danfo)
    dict(id='balogun', kind='shop', zone='Lagos Island', label='Balogun Market', search=(r'balogun', r'marketplace|shop|amenity', 6.4552, 3.3890, 900), items=[
        dict(id='ankara', name='Ankara fabric (6 yards)', price=3000),
        dict(id='charger', name='Phone charger', price=1500),
        dict(id='slippers', name='Pam slippers', price=800),
        dict(id='aso-oke', name='Aso-oke cap', price=2500),
        dict(id='speaker', name='Small Bluetooth speaker', price=4500),
    ]),
    dict(id='island-buka', kind='eat', zone='Lagos Island', label='Mama Put buka', search=(r'.', r'amenity=(restaurant|fast_food)', 6.4545, 3.3920, 700), price=1000, meal='Rice & ofada stew', hunger=45),
    dict(id='stop-cms', kind='danfo', zone='Lagos Island', label='CMS bus stop', search=(r'\bcms\b|marina|idumota|tinubu', r'highway=bus_stop|public_transport', 6.4515, 3.3925, 900)),
    # ---- Yaba (tech / student work, buka, danfo)
    dict(id='yaba-hub', kind='work', zone='Yaba', label='Yaba tech hub', search=(r'hub|tech|cchub|co-creation|andela|innovation|herbert macaulay', r'office|building|amenity|shop', 6.5070, 3.3780, 700), pay=2500, energy=20, seconds=4.5),
    dict(id='yaba-buka', kind='eat', zone='Yaba', label='Yaba buka', search=(r'.', r'amenity=(restaurant|fast_food)', 6.5060, 3.3790, 700), price=1200, meal='Amala, ewedu & gbegiri', hunger=45),
    dict(id='stop-yaba', kind='danfo', zone='Yaba', label='Yaba bus stop', search=(r'yaba|tejuosho|sabo|ojuelegba|jibowu', r'highway=bus_stop|public_transport', 6.5045, 3.3765, 900)),
    # ---- Lekki Phase 1 (lounge, food, danfo)
    dict(id='lekki-lounge', kind='social', zone='Lekki Phase 1', label='Admiralty Way lounge', search=(r'.', r'amenity=(bar|pub|nightclub)|leisure=dance', 6.4470, 3.4725, 900), price=1000),
    dict(id='lekki-food', kind='eat', zone='Lekki Phase 1', label='Lekki restaurant', search=(r'.', r'amenity=(restaurant|fast_food|cafe)', 6.4480, 3.4710, 900), price=2000, meal='Jollof rice & plantain', hunger=50),
    dict(id='stop-lekki', kind='danfo', zone='Lekki Phase 1', label='Lekki Phase 1 bus stop', search=(r'lekki|admiralty|phase|oniru|chevron|toll', r'highway=bus_stop|public_transport', 6.4400, 3.4650, 1400)),
    # ---- Surulere (danfo)
    dict(id='stop-ojuelegba', kind='danfo', zone='Surulere', label='Ojuelegba bus stop', search=(r'ojuelegba|surulere|stadium|barracks|lawanson|ojuelegba', r'highway=bus_stop|public_transport', 6.5090, 3.3650, 1200)),
    # ---- Ikeja (separate district chunk)
    dict(id='computer-village', kind='shop', zone='Ikeja', label='Computer Village', search=(r'computer village|otigba|ola ayeni|pepple', r'shop|marketplace|amenity|building', 6.5950, 3.3415, 900), items=[
        dict(id='earbuds', name='Wireless earbuds', price=3500),
        dict(id='powerbank', name='Power bank 20,000 mAh', price=6000),
        dict(id='screen-guard', name='Screen guard (fixed)', price=1000),
        dict(id='sim', name='New SIM card', price=500),
    ]),
    dict(id='stop-ikeja', kind='danfo', zone='Ikeja', label='Ikeja Along bus stop', search=(r'ikeja|allen|along|obafemi|awolowo', r'highway=bus_stop|public_transport', 6.6040, 3.3500, 1500)),
]


def load_buildings_near(data, x, z, radius):
    out = []
    c0 = (math.floor((x - radius) / CHUNK), math.floor((z - radius) / CHUNK))
    c1 = (math.floor((x + radius) / CHUNK), math.floor((z + radius) / CHUNK))
    for cx in range(c0[0], c1[0] + 1):
        for cz in range(c0[1], c1[1] + 1):
            p = os.path.join(data, 'chunks', f'{cx}_{cz}.json')
            if not os.path.exists(p):
                continue
            j = json.load(open(p))
            ox, oz = cx * CHUNK, cz * CHUNK
            for rec in j['b']:
                n = rec[5]
                pts = [(ox + rec[6 + 2 * i] / 10, oz + rec[7 + 2 * i] / 10) for i in range(n)]
                out.append((rec, pts))
    return out


def inside(pt, poly):
    x, z = pt
    c = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1 + 1e-12) + x1:
            c = not c
    return c


def nearest_edge(pt, poly):
    best = None
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dz * dz or 1e-9
        t = max(0, min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / L2))
        q = (a[0] + dx * t, a[1] + dz * t)
        d = math.hypot(q[0] - pt[0], q[1] - pt[1])
        L = math.sqrt(L2)
        n = (dz / L, -dx / L)  # outward for CCW polygons
        if best is None or d < best[0]:
            best = (d, q, n)
    return best


class Terrain:
    def __init__(self, data, manifest):
        from PIL import Image
        import numpy as np
        self.t = {}
        for k, info in manifest['terrain'].items():
            self.t[k] = (info, np.array(Image.open(os.path.join(data, info['file']))))

    def sdf(self, x, z):
        for info, arr in self.t.values():
            i = int((x - info['x0']) / info['res'])
            j = int((z - info['z0']) / info['res'])
            if 0 <= i < arr.shape[1] and 0 <= j < arr.shape[0]:
                return (int(arr[j, i]) - 128) / 127 * info['range']
        return -999


def road_heading(majors, x, z):
    """direction toward the nearest major road (used to face the street)"""
    best = None
    for r in majors:
        n = r[4]
        pts = r[5:5 + 2 * n]
        for i in range(0, 2 * n - 2, 2):
            ax, az, bx, bz = pts[i] / 10, pts[i + 1] / 10, pts[i + 2] / 10, pts[i + 3] / 10
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz or 1e-9
            t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2))
            qx, qz = ax + dx * t, az + dz * t
            d = math.hypot(qx - x, qz - z)
            if best is None or d < best[0]:
                best = (d, qx, qz)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='public/data/lagos')
    ap.add_argument('--list', action='store_true', help='print candidates instead of writing')
    a = ap.parse_args()
    manifest = json.load(open(os.path.join(a.data, 'manifest.json')))
    pois = json.load(open(os.path.join(a.data, 'pois.json')))['pois']
    named_b = json.load(open(os.path.join(a.data, 'buildings_named.json')))
    majors = json.load(open(os.path.join(a.data, 'roads_major.json')))['roads']
    names = manifest['roadNames']
    terr = Terrain(a.data, manifest)
    out = []
    for s in SPOTS:
        name_re, cat_re, lat, lon, rad = s['search']
        cx, cz = xz(lat, lon)
        cands = []
        for p in pois:
            d = math.hypot(p['x'] - cx, p['z'] - cz)
            if d > rad:
                continue
            if cat_re and not re.search(cat_re, p['cat']):
                continue
            if name_re and not re.search(name_re, p['name'] or '', re.I):
                continue
            score = d - (300 if name_re and name_re != '.' and re.search(name_re, p['name'] or '', re.I) else 0) - (60 if p['name'] else 0)
            cands.append((score, d, p['name'], p['cat'], p['x'], p['z'], p['id']))
        if s.get('building') or not cands:
            for b in named_b:
                d = math.hypot(b['x'] - cx, b['z'] - cz)
                if d > rad:
                    continue
                if name_re and name_re != '.' and not re.search(name_re, b['name'], re.I):
                    continue
                cands.append((d + 40, d, b['name'], 'building=' + str(b.get('building')), b['x'], b['z'], b['osm']))
        cands.sort()
        if a.list:
            print(f"\n== {s['id']} ({s['zone']})")
            for c in cands[:8]:
                print(f'   {c[1]:6.0f} m  {c[2]!r:40} {c[3]:28} {c[6]}')
            continue
        if cands:
            _, _, nm, cat, x, z, osm = cands[0]
            place = nm or cat
        else:
            x, z, osm, place = cx, cz, None, 'OSM location'
            print(f"  ! {s['id']}: no OSM match, using reference point")
        # move the marker out of any building, onto the street side
        blds = load_buildings_near(a.data, x, z, 80)
        heading = 0.0
        for rec, poly in blds:
            if inside((x, z), poly):
                d, q, n = nearest_edge((x, z), poly)
                x, z = q[0] + n[0] * 2.6, q[1] + n[1] * 2.6
                heading = math.atan2(n[0], n[1])
                break
        else:
            # not inside: face away from the closest building
            best = None
            for rec, poly in blds:
                e = nearest_edge((x, z), poly)
                if best is None or e[0] < best[0]:
                    best = e
            if best and best[0] < 6:
                d, q, n = best
                if d < 2.4:
                    x, z = q[0] + n[0] * 2.6, q[1] + n[1] * 2.6
                heading = math.atan2(n[0], n[1])
        # make sure we're on land and not inside another building
        for _ in range(12):
            bad = terr.sdf(x, z) < 2 or any(inside((x, z), poly) for _, poly in blds)
            if not bad:
                break
            r = road_heading(majors, x, z)
            if r:
                x, z = x + (r[1] - x) * 0.25, z + (r[2] - z) * 0.25
        la, lo = ll(x, z)
        rec = {k: v for k, v in s.items() if k not in ('search', 'label', 'building')}
        rec.update({'name': s['label'] if not (s['kind'] == 'danfo' and cands and cands[0][2]) else (cands[0][2] if 'stop' in cands[0][2].lower() or 'park' in cands[0][2].lower() else cands[0][2] + ' bus stop'),
                    'place': place, 'x': round(x, 2), 'z': round(z, 2), 'lat': round(la, 6), 'lon': round(lo, 6), 'heading': round(heading, 3), 'osm': osm})
        if s['kind'] in ('work', 'eat', 'social', 'shop') and cands and cands[0][2]:
            rec['name'] = f"{s['label']} · {cands[0][2]}" if s['kind'] != 'shop' or not re.search(name_re or 'x', cands[0][2], re.I) else cands[0][2]
        out.append(rec)
        print(f"  {s['id']:18} -> {rec['name']!r:48} {la:.5f},{lo:.5f}  ({place})")
    if a.list:
        return
    home = next(p for p in out if p['kind'] == 'home')
    spawn = {'x': home['x'] + math.sin(home['heading']) * 3, 'z': home['z'] + math.cos(home['heading']) * 3, 'heading': home['heading'], 'zone': home['zone']}
    json.dump({'spawn': spawn, 'pois': out, 'attribution': 'Positions from OpenStreetMap features © OpenStreetMap contributors (ODbL)'},
              open(os.path.join(a.data, 'gameplay.json'), 'w'), indent=1)
    print('wrote gameplay.json')


if __name__ == '__main__':
    main()
