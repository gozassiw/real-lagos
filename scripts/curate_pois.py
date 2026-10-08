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


# Every gameplay spot is anchored to a specific real OSM feature (name, type/id, its lat/lon). The marker is then
# nudged out of any building onto the street side. `search` is only a fallback if the anchor is missing.
SPOTS = [
    # ---- Ikoyi: home + iconic suya + danfo
    dict(id='ikoyi-home', kind='home', zone='Ikoyi', label='Your flat · Falomo Close', anchor=('Falomo Close', 'way/129730330', 6.44451, 3.43975)),
    dict(id='ikoyi-suya', kind='eat', zone='Ikoyi', label='Glover Court Suya', anchor=('Glover Court Suya', 'node/4946299659', 6.452123, 3.435486), price=1500, meal='Suya & cold zobo', hunger=40),
    dict(id='stop-bourdillon', kind='danfo', zone='Ikoyi', label='Bourdillon bus stop', anchor=('Bourdillon Road stop (platform)', 'node/5676295240', 6.4458661, 3.435917)),
    dict(id='stop-falomo', kind='danfo', zone='Ikoyi', label='Falomo bus stop', anchor=('Falomo (bus stop)', 'node/5661711556', 6.444413, 3.426035)),
    dict(id='stop-obalende', kind='danfo', zone='Obalende', label='Obalende motor park', anchor=('Obalende Motor Park', 'node/4755897332', 6.449635, 3.407376)),
    # ---- Victoria Island: office job + food
    dict(id='vi-office', kind='work', zone='Victoria Island', label='Office shift · Civic Towers', anchor=('Civic Towers', 'way/531627775', 6.439918, 3.429473), pay=2000, energy=18, seconds=4),
    dict(id='stop-civic', kind='danfo', zone='Victoria Island', label='Civic Centre bus stop', anchor=('Ozumba Mbadiwe Avenue', None, 6.439345, 3.428134)),
    dict(id='vi-food', kind='eat', zone='Victoria Island', label='Mama Cass', anchor=('Mama Cass', 'node/1513600883', 6.431264, 3.432662), price=1800, meal='Jollof rice & chicken', hunger=50),
    # ---- Lagos Island: Balogun market + buka + danfo
    dict(id='balogun', kind='shop', zone='Lagos Island', label='Balogun Market', anchor=('Balogun Street', 'way/215113173', 6.455758, 3.383674), items=[
        dict(id='ankara', name='Ankara fabric (6 yards)', price=3000),
        dict(id='charger', name='Phone charger', price=1500),
        dict(id='slippers', name='Pam slippers', price=800),
        dict(id='aso-oke', name='Aso-oke cap', price=2500),
        dict(id='speaker', name='Small Bluetooth speaker', price=4500),
    ]),
    dict(id='island-buka', kind='eat', zone='Lagos Island', label='Mama Put buka · Idumota', anchor=('Idumota (bus stop)', 'node/2541613435', 6.46294, 3.386691), price=1000, meal='Rice & ofada stew', hunger=45),
    dict(id='stop-cms', kind='danfo', zone='Lagos Island', label='CMS bus stop', anchor=('Marina/CMS', 'node/6274484744', 6.449149, 3.389803)),
    # ---- Yaba: tech / student work + buka + danfo
    dict(id='yaba-hub', kind='work', zone='Yaba', label='Gig at Co-Creation Hub', anchor=('Co-Creation Hub, Nigeria', 'node/3631633695', None, None), search=(r'co-creation', r'office', 6.5070, 3.3780, 900), pay=2500, energy=20, seconds=4.5),
    dict(id='yaba-buka', kind='eat', zone='Yaba', label='Mama Put buka · Tejuosho', anchor=('Tejuosho Shopping Centre', 'way/671850898', 6.508149, 3.369753), price=1200, meal='Amala, ewedu & gbegiri', hunger=45),
    dict(id='stop-yaba', kind='danfo', zone='Yaba', label='Yaba bus terminal', anchor=('Yaba Bus Terminal', 'way/707609369', 6.510815, 3.370799)),
    dict(id='stop-surulere', kind='danfo', zone='Surulere', label='Stadium bus stop', anchor=('Teslim Balogun Stadium', 'way/1434311438', 6.499705, 3.360769)),
    # ---- Lekki Phase 1: lounge + food + danfo (toll gate)
    dict(id='lekki-lounge', kind='social', zone='Lekki Phase 1', label='Medusa Lounge', anchor=('MEDUSA LAGOS (bar)', 'way/996863575', 6.4475298, 3.4574966), price=1000),
    dict(id='lekki-food', kind='eat', zone='Lekki Phase 1', label='Amala Sky', anchor=('Amala Sky Lagos', 'node/9685011127', 6.445727, 3.4578142), price=1800, meal='Amala, gbegiri & ewedu', hunger=50),
    dict(id='stop-lekki', kind='danfo', zone='Lekki Phase 1', label='Admiralty Way bus stop', anchor=('Admiralty Way', 'way/216882041', 6.445776, 3.458383)),
    dict(id='stop-tollgate', kind='danfo', zone='Lekki toll gate', label='Lekki toll gate bus stop', anchor=('Admiralty Toll Plaza', 'way/216689333', 6.435933, 3.447211)),
    # ---- Ikeja (separate district chunk)
    dict(id='computer-village', kind='shop', zone='Ikeja', label='Computer Village', anchor=('Otigba Street / Computer Village', 'way/134404813', 6.594116, 3.341905), items=[
        dict(id='earbuds', name='Wireless earbuds', price=3500),
        dict(id='powerbank', name='Power bank 20,000 mAh', price=6000),
        dict(id='screen-guard', name='Screen guard (fixed)', price=1000),
        dict(id='sim', name='New SIM card', price=500),
    ]),
    dict(id='stop-ikeja', kind='danfo', zone='Ikeja', label='Ikeja Along bus stop', anchor=('Ikeja Along', 'node/9127712617', 6.598683, 3.334536)),
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
        aname, aosm, alat, alon = s.get('anchor', (None, None, None, None))
        cands = []
        if alat is None and aosm:
            # look the anchor up by OSM id
            for p in pois:
                if p['id'] == aosm:
                    alat, alon = p['lat'], p['lon']
        if alat is not None:
            x, z = xz(alat, alon)
            cands = [(0, 0, aname, aosm, x, z, aosm)]
        elif s.get('search'):
            name_re, cat_re, lat, lon, rad = s['search']
            cx, cz = xz(lat, lon)
            for p in pois:
                d = math.hypot(p['x'] - cx, p['z'] - cz)
                if d > rad or not re.search(cat_re, p['cat']) or not re.search(name_re, p['name'] or '', re.I):
                    continue
                cands.append((d, d, p['name'], p['cat'], p['x'], p['z'], p['id']))
            for b in named_b:
                d = math.hypot(b['x'] - cx, b['z'] - cz)
                if d < rad and re.search(name_re, b['name'], re.I):
                    cands.append((d + 40, d, b['name'], 'building', b['x'], b['z'], b['osm']))
            cands.sort()
        if a.list:
            print(f"== {s['id']}: {cands[:3]}")
            continue
        if cands:
            _, _, nm, cat, x, z, osm = cands[0]
            place = f'{nm} ({osm})' if nm else str(cat)
        elif s.get('search'):
            _, _, lat, lon, _ = s['search']
            x, z = xz(lat, lon)
            osm, place = None, 'reference point'
            print(f"  ! {s['id']}: no OSM match, using reference point")
        else:
            print(f"  ! {s['id']}: skipped (no anchor)")
            continue
        # move the marker out of any building, onto the street side
        blds = load_buildings_near(a.data, x, z, 80)
        heading = 0.0
        if s['kind'] == 'home' and blds:
            # the anchor is a street: put "your flat" at the door of the nearest house / apartment block on it
            best = None
            for rec, poly in blds:
                if rec[0] not in (0, 1, 3, 5):
                    continue
                e = nearest_edge((x, z), poly)
                if best is None or e[0] < best[0]:
                    best = e
            if best and best[0] < 35:
                d, q, n = best
                x, z = q[0] + n[0] * 2.6, q[1] + n[1] * 2.6
                heading = math.atan2(n[0], n[1])
                blds = load_buildings_near(a.data, x, z, 80)
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
        rec = {k: v for k, v in s.items() if k not in ('search', 'label', 'building', 'anchor')}
        rec.update({'name': s['label'], 'place': place, 'x': round(x, 2), 'z': round(z, 2), 'lat': round(la, 6), 'lon': round(lo, 6), 'heading': round(heading, 3), 'osm': osm})
        out.append(rec)
        print(f"  {s['id']:18} -> {rec['name']!r:48} {la:.5f},{lo:.5f}  ({place})")
    if a.list:
        return
    home = next(p for p in out if p['kind'] == 'home')
    spawn = {'x': home['x'] + math.sin(home['heading']) * 7, 'z': home['z'] + math.cos(home['heading']) * 7, 'heading': home['heading'], 'zone': home['zone']}
    json.dump({'spawn': spawn, 'pois': out, 'attribution': 'Positions from OpenStreetMap features © OpenStreetMap contributors (ODbL)'},
              open(os.path.join(a.data, 'gameplay.json'), 'w'), indent=1)
    print('wrote gameplay.json')


if __name__ == '__main__':
    main()
