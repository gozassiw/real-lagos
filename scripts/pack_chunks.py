#!/usr/bin/env python3
"""Group the 500 m map chunks into 2 km pack files (4 x 4 chunks each).

~1,200 tiny files become ~110 packs: fewer requests on a phone, and the whole game fits hosts that cap the
number of files per site. The client fetches a pack once and reads the chunks it needs from it.

    python3 scripts/pack_chunks.py public/data/lagos
"""
import json, math, os, shutil, sys
from collections import defaultdict

PACK = 4


def pack(out):
    src = os.path.join(out, 'chunks')
    dst = os.path.join(out, 'packs')
    if not os.path.isdir(src):
        print('no chunks/ folder — nothing to pack')
        return
    packs = defaultdict(dict)
    for fn in os.listdir(src):
        if not fn.endswith('.json'):
            continue
        cx, cz = map(int, fn[:-5].split('_'))
        with open(os.path.join(src, fn)) as f:
            packs[(math.floor(cx / PACK), math.floor(cz / PACK))][f'{cx},{cz}'] = json.load(f)
    shutil.rmtree(dst, ignore_errors=True)
    os.makedirs(dst)
    for (px, pz), chunks in packs.items():
        with open(os.path.join(dst, f'p{px}_{pz}.json'), 'w') as f:
            json.dump(chunks, f, separators=(',', ':'))
    shutil.rmtree(src)
    mp = os.path.join(out, 'manifest.json')
    with open(mp) as f:
        manifest = json.load(f)
    manifest['chunkPack'] = PACK
    with open(mp, 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))
    print(f'packed {sum(len(c) for c in packs.values())} chunks into {len(packs)} packs')


if __name__ == '__main__':
    pack(sys.argv[1] if len(sys.argv) > 1 else 'public/data/lagos')
