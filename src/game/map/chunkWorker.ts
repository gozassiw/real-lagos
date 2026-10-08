/// <reference lib="webworker" />
// Fetches a 500 m map chunk and turns it into transferable geometry off the main thread.
import { buildChunk, type ChunkBuild, type PackedGeo } from './geometry';

function buffersOf(g: PackedGeo, out: Transferable[]) {
  for (const a of [g.position, g.normal, g.color, g.uv, g.extra, g.index]) if (a) out.push(a.buffer);
}

self.onmessage = async (e: MessageEvent<{ key: string; url: string; ox: number; oz: number }>) => {
  const { key, url, ox, oz } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
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
