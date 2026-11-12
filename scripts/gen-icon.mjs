// Rasterises the Riff Roll logo (same shapes as packages/ui/public/icon.svg) to a 512×512 PNG for installers.
// No dependencies: rounded rectangles with 4×4 supersampling, encoded with zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = 512;
const k = S / 64;
// [x, y, w, h, r, color] in the SVG's 64-unit space
const shapes = [
  [0, 0, 64, 64, 12, '#121419'],
  [10, 14, 22, 7, 2, '#ff5a5a'],
  [24, 25, 16, 7, 2, '#f3cf48'],
  [34, 36, 20, 7, 2, '#47bfee'],
  [14, 47, 12, 7, 2, '#b38bff'],
];
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const inside = (px, py, [x, y, w, h, r]) => {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r && px >= x && px <= x + w && py >= y && py <= y + h;
};
const px = Buffer.alloc(S * S * 4);
const SS = 4;
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    let rr = 0,
      gg = 0,
      bb = 0,
      aa = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const u = (x + (sx + 0.5) / SS) / k,
          v = (y + (sy + 0.5) / SS) / k;
        let col = null;
        for (const s of shapes) if (inside(u, v, s)) col = hex(s[5]);
        if (col) {
          rr += col[0];
          gg += col[1];
          bb += col[2];
          aa += 255;
        }
      }
    const n = SS * SS,
      o = (y * S + x) * 4,
      a = aa / n;
    px[o] = a ? rr / (aa / 255) : 0;
    px[o + 1] = a ? gg / (aa / 255) : 0;
    px[o + 2] = a ? bb / (aa / 255) : 0;
    px[o + 3] = a;
  }
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
for (const out of ['apps/desktop/build/icon.png', 'packages/ui/public/icon-512.png']) {
  mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
  writeFileSync(path.join(root, out), png);
}
console.log('wrote icon.png', png.length, 'bytes');
