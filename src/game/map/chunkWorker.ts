/// <reference lib="webworker" />
// Fetches a 500 m map chunk and turns it into transferable geometry off the main thread.
import { buildChunk, type ChunkBuild, type PackedGeo } from './geometry';

function buffersOf(g: PackedGeo, out: Transferable[]) {
  for (const a of [g.position, g.normal, g.color, g.uv, g.extra, g.index]) if (a) out.push(a.buffer);
}

// Chunks arrive in pack files (4 x 4 chunks). Keep the most recently used packs parsed in memory.
const MAX_PACKS = 10;
const packs = new Map<string, Promise<Record<string, unknown>>>();

function getPack(url: string) {
  let p = packs.get(url);
  if (p) {
    packs.delete(url); // refresh LRU order
  } else {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => packs.delete(url));
  }
  packs.set(url, p);
  while (packs.size > MAX_PACKS) packs.delete(packs.keys().next().value!);
  return p;
}

async function getChunk(key: string, url: string, pack: boolean) {
  if (pack) {
    const chunk = (await getPack(url))[key];
    if (!chunk) throw new Error(`chunk ${key} missing from pack`);
    return chunk;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

self.onmessage = async (e: MessageEvent<{ key: string; url: string; pack?: boolean; ox: number; oz: number }>) => {
  const { key, url, pack, ox, oz } = e.data;
  try {
    const json = await getChunk(key, url, !!pack);
    const out: ChunkBuild = buildChunk(key, json, ox, oz);
    const tr: Transferable[] = [];
    buffersOf(out.buildings.walls, tr);
    buffersOf(out.buildings.roofs, tr);
    buffersOf(out.roads.surface, tr);
    buffersOf(out.roads.bridge, tr);
    buffersOf(out.walls, tr);
    tr.push(out.buildings.collider.vertices.buffer, out.buildings.collider.indices.buffer);
    if (out.roads.collider) tr.push(out.roads.collider.vertices.buffer, out.roads.collider.indices.buffer);
    (self as unknown as Worker).postMessage({ key, ok: true, out }, tr);
  } catch (err) {
    (self as unknown as Worker).postMessage({ key, ok: false, error: String(err) });
  }
};
