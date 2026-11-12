/** Read a song's title out of a .riff (a zip with song.json) without unpacking the rest. */
import { inflateRawSync } from 'node:zlib';

export function riffTitle(zip: Buffer): string {
  try {
    // end of central directory: last 22+ bytes, signature 0x06054b50
    let eocd = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--)
      if (zip.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) return '';
    const count = zip.readUInt16LE(eocd + 10);
    let p = zip.readUInt32LE(eocd + 16);
    for (let n = 0; n < count && zip.readUInt32LE(p) === 0x02014b50; n++) {
      const method = zip.readUInt16LE(p + 10);
      const size = zip.readUInt32LE(p + 20);
      const nameLen = zip.readUInt16LE(p + 28);
      const extraLen = zip.readUInt16LE(p + 30);
      const commentLen = zip.readUInt16LE(p + 32);
      const local = zip.readUInt32LE(p + 42);
      const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
      if (name === 'song.json') {
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const raw = zip.subarray(start, start + size);
        const json = method === 8 ? inflateRawSync(raw) : raw;
        const title = (JSON.parse(json.toString('utf8')) as { title?: unknown }).title;
        return typeof title === 'string' ? title.slice(0, 200) : '';
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
  } catch {
    /* not a readable .riff: no title */
  }
  return '';
}
