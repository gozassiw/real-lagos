// Minimal decoder for 8-bit greyscale, non-interlaced PNGs (what scripts/build_map.py writes).
// Avoids canvas colour management so the stored values (distance field, class ids) come back exact.

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

export async function decodeGrayPng(buf: ArrayBuffer): Promise<Gray> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let off = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  while (off < u8.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
    const body = u8.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(off + 8);
      height = dv.getUint32(off + 12);
      depth = u8[off + 16];
      ctype = u8[off + 17];
      interlace = u8[off + 20];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || ctype !== 0 || interlace) throw new Error(`unsupported png (depth ${depth}, type ${ctype})`);
  const total = idat.reduce((s, c) => s + c.length, 0);
  const z = new Uint8Array(total);
  let p = 0;
  for (const c of idat) {
    z.set(c, p);
    p += c.length;
  }
  const raw = await inflate(z);
  const out = new Uint8Array(width * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[src++];
    const row = y * width;
    const prev = row - width;
    for (let x = 0; x < width; x++) {
      const v = raw[src++];
      const a = x > 0 ? out[row + x - 1] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x > 0 && y > 0 ? out[prev + x - 1] : 0;
      let r: number;
      switch (f) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        default: r = v + paeth(a, b, c);
      }
      out[row + x] = r & 255;
    }
  }
  return { width, height, data: out };
}

/** Fallback through an <img>/canvas (used only if DecompressionStream is unavailable). */
export async function decodeViaCanvas(url: string): Promise<Gray> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const rgba = g.getImageData(0, 0, img.width, img.height).data;
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  return { width: img.width, height: img.height, data };
}

export async function loadGray(url: string): Promise<Gray> {
  if (typeof DecompressionStream !== 'undefined') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return decodeGrayPng(await res.arrayBuffer());
  }
  return decodeViaCanvas(url);
}
