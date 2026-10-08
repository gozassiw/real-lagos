#!/usr/bin/env python3
"""Build public/models/rig.glb: a skeleton + motion clips only (no mesh, no textures).

The visible characters are generated in code (src/game/avatar/buildAvatar.ts). This script takes the
standard humanoid skeleton and idle/walk/run/nod clips from the three.js example rig "Xbot" and retargets
the "SambaDance" clip from the three.js example "Michelle" onto the same skeleton for the dance emote.
(Both rigs/clips originate from Mixamo and are distributed with the three.js examples.)

  python3 scripts/make_rig.py --xbot path/Xbot.glb --michelle path/Michelle.glb --out public/models/rig.glb
"""
import argparse, json, struct
import numpy as np

COMP = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def load_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack('<I', b[off:off + 4])[0]
    binc = b[off + 8: off + 8 + bl]
    return j, binc


def accessor(j, binc, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    dt = COMP[a['componentType']]
    n = NCOMP[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(binc, dtype=dt, count=a['count'] * n, offset=start).astype(np.float64)
    return arr.reshape(a['count'], n) if n > 1 else arr


# ---- quaternion helpers (x, y, z, w) ----
def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], -1)


def qinv(q):
    return q * np.array([-1, -1, -1, 1.0])


def qrot(q, v):
    qv = np.concatenate([v, np.zeros(v.shape[:-1] + (1,))], -1)
    return qmul(qmul(q, qv), qinv(q))[..., :3]


def qnorm(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def sample(times, values, t):
    """linear / nlerp sampling of a keyframe track at times t"""
    if len(times) == 1:
        return np.repeat(values[:1], len(t), 0)
    idx = np.clip(np.searchsorted(times, t) - 1, 0, len(times) - 2)
    t0, t1 = times[idx], times[idx + 1]
    f = np.clip((t - t0) / np.maximum(t1 - t0, 1e-9), 0, 1)[:, None]
    a, b = values[idx], values[idx + 1]
    if values.shape[1] == 4:
        d = np.sum(a * b, -1, keepdims=True)
        b = np.where(d < 0, -b, b)
        return qnorm(a * (1 - f) + b * f)
    return a * (1 - f) + b * f


def node_tree(j):
    parent = {}
    for i, n in enumerate(j['nodes']):
        for c in n.get('children', []):
            parent[c] = i
    return parent


def clean(name):
    return name.replace('mixamorig:', '').replace('mixamorig', '')


def world_pose(j, parent, local_rot, local_pos):
    """local_rot/local_pos: dict node -> (F,4)/(F,3). Returns world rot/pos dicts (F,...), incl. scale."""
    F = next(iter(local_rot.values())).shape[0]
    wr, wp, ws = {}, {}, {}

    def get(i):
        if i in wr:
            return
        n = j['nodes'][i]
        lr = local_rot.get(i, np.repeat(np.array([n.get('rotation', [0, 0, 0, 1])], float), F, 0))
        lp = local_pos.get(i, np.repeat(np.array([n.get('translation', [0, 0, 0])], float), F, 0))
        ls = np.array(n.get('scale', [1, 1, 1]), float)
        if i in parent:
            p = parent[i]
            get(p)
            wr[i] = qnorm(qmul(wr[p], lr))
            wp[i] = wp[p] + qrot(wr[p], lp * ws[p])
            ws[i] = ws[p] * ls
        else:
            wr[i], wp[i], ws[i] = lr, lp, ls
    for i in range(len(j['nodes'])):
        get(i)
    return wr, wp, ws


def clip_tracks(j, binc, anim, F_times=None):
    chans = {}
    times_all = []
    for c in anim['channels']:
        s = anim['samplers'][c['sampler']]
        t = accessor(j, binc, s['input'])
        v = accessor(j, binc, s['output'])
        chans[(c['target']['node'], c['target']['path'])] = (t, v)
        times_all.append(t)
    return chans, times_all


SKIP = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky', 'Eye', 'HeadTop_End', 'Toe_End')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--xbot', required=True)
    ap.add_argument('--michelle', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--fps', type=float, default=30)
    a = ap.parse_args()

    X, Xb = load_glb(a.xbot)
    M, Mb = load_glb(a.michelle)
    xpar, mpar = node_tree(X), node_tree(M)
    xname = {i: n.get('name', '') for i, n in enumerate(X['nodes'])}
    mname = {i: n.get('name', '') for i, n in enumerate(M['nodes'])}
    xby = {clean(v): k for k, v in xname.items() if 'mixamorig' in v}
    mby = {clean(v): k for k, v in mname.items() if 'mixamorig' in v}
    bones = [b for b in xby if not any(s in b for s in SKIP) and b in mby]
    hips_x, hips_m = xby['Hips'], mby['Hips']

    out_clips = []  # (name, times, {(node,path): values})

    # ---- native clips from the X rig ----
    keep = {'idle': 'idle', 'walk': 'walk', 'run': 'run', 'agree': 'nod'}
    for anim in X['animations']:
        if anim['name'] not in keep:
            continue
        chans, _ = clip_tracks(X, Xb, anim)
        tracks = {}
        T = None
        for (node, path), (t, v) in chans.items():
            nm = clean(xname[node])
            if nm not in bones and nm != 'Hips':
                continue
            if path == 'scale' or (path == 'translation' and node != hips_x):
                continue
            if path == 'translation':
                v = v.copy()
                # remove any forward drift so clips play in place; keep bob/sway
                if anim['name'] in ('walk', 'run'):
                    for k in (0, 2):
                        trend = np.linspace(v[0, k], v[-1, k], len(v))
                        v[:, k] = v[:, k] - trend + v[0, k]
            tracks[(node, path)] = (t, v)
            T = t if T is None or len(t) > len(T) else T
        out_clips.append((keep[anim['name']], tracks))

    # ---- retarget SambaDance from the M rig ----
    samba = next(an for an in M['animations'] if an['name'] == 'SambaDance')
    tpose = next(an for an in M['animations'] if an['name'] == 'TPose')
    sch, _ = clip_tracks(M, Mb, samba)
    tch, _ = clip_tracks(M, Mb, tpose)
    dur = max(t[-1] for (t, v) in sch.values())
    times = np.arange(0, dur + 1e-6, 1 / a.fps)
    F = len(times)

    def local_from(chans, tt):
        lr, lp = {}, {}
        for (node, path), (t, v) in chans.items():
            if path == 'rotation':
                lr[node] = sample(t, v, tt)
            elif path == 'translation':
                lp[node] = sample(t, v, tt)
        return lr, lp

    mlr, mlp = local_from(sch, times)
    tlr, tlp = local_from(tch, np.zeros(1))
    mwr, mwp, _ = world_pose(M, mpar, mlr, mlp)
    rwr, rwp, _ = world_pose(M, mpar, tlr, tlp)  # reference (T-pose) world
    # X rest world
    xr0 = {i: np.array([X['nodes'][i].get('rotation', [0, 0, 0, 1])], float) for i in range(len(X['nodes']))}
    xp0 = {i: np.array([X['nodes'][i].get('translation', [0, 0, 0])], float) for i in range(len(X['nodes']))}
    xwr0, xwp0, xws0 = world_pose(X, xpar, xr0, xp0)

    # world rotation for each X bone over time
    xw = {}
    for b in bones:
        mi, xi = mby[b], xby[b]
        D = qmul(mwr[mi], qinv(rwr[mi]))  # world-space delta from the T-pose
        xw[xi] = qnorm(qmul(D, np.repeat(xwr0[xi], F, 0)))
    tracks = {}
    for b in bones:
        xi = xby[b]
        p = xpar[xi]
        pw = xw[p] if p in xw else np.repeat(xwr0[p], F, 0)
        tracks[(xi, 'rotation')] = (times, qnorm(qmul(qinv(pw), xw[xi])))
    # hips translation: world delta scaled by hip height ratio, mapped into X hips' parent space
    ratio = (xwp0[hips_x][0, 1]) / (rwp[hips_m][0, 1])
    dpos = (mwp[hips_m] - rwp[hips_m]) * ratio
    pp = xpar[hips_x]
    local = qrot(np.repeat(qinv(xwr0[pp]), F, 0), dpos) / xws0[pp] + xp0[hips_x]
    tracks[(hips_x, 'translation')] = (times, local)
    out_clips.append(('dance', tracks))

    # ---- write GLB: X nodes without meshes/skins + the clips ----
    nodes = []
    for n in X['nodes']:
        n = {k: v for k, v in n.items() if k not in ('mesh', 'skin')}
        nodes.append(n)
    joints = [i for i, nm in xname.items() if 'mixamorig' in nm]
    # a skin with no mesh: marks the joints as bones for loaders; meshes are built and bound at runtime
    out = {'asset': {'version': '2.0', 'generator': 'real-lagos make_rig.py'}, 'scene': 0, 'scenes': X['scenes'], 'nodes': nodes,
           'skins': [{'name': 'humanoid', 'joints': joints}],
           'accessors': [], 'bufferViews': [], 'buffers': [], 'animations': []}
    blob = bytearray()

    def add(arr, typ):
        nonlocal blob
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        while len(blob) % 4:
            blob += b'\0'
        off = len(blob)
        blob += arr.tobytes()
        out['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
        acc = {'bufferView': len(out['bufferViews']) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ}
        if typ == 'SCALAR':
            acc['min'] = [float(arr.min())]
            acc['max'] = [float(arr.max())]
        out['accessors'].append(acc)
        return len(out['accessors']) - 1

    for name, tracks in out_clips:
        an = {'name': name, 'channels': [], 'samplers': []}
        tcache = {}
        for (node, path), (t, v) in tracks.items():
            key = (len(t), float(t[0]), float(t[-1]))
            if key not in tcache:
                tcache[key] = add(np.asarray(t), 'SCALAR')
            o = add(np.asarray(v), 'VEC4' if path == 'rotation' else 'VEC3')
            an['samplers'].append({'input': tcache[key], 'output': o, 'interpolation': 'LINEAR'})
            an['channels'].append({'sampler': len(an['samplers']) - 1, 'target': {'node': node, 'path': path}})
        out['animations'].append(an)
        print(f'clip {name}: {len(an["channels"])} channels, {max(t[-1] for t, _ in tracks.values()):.2f}s')

    while len(blob) % 4:
        blob += b'\0'
    out['buffers'] = [{'byteLength': len(blob)}]
    js = json.dumps(out, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    open(a.out, 'wb').write(glb)
    print(f'wrote {a.out}: {len(glb) / 1024:.0f} KB, bones kept: {len(bones)}')


if __name__ == '__main__':
    main()
