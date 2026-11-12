/**
 * Read individual files out of a remote .zip with HTTP range requests, without downloading the whole archive.
 * Used to take a trimmed subset (one or two mics, a few round robins) of very large sample packs.
 */
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

class Remote {
  private final: string | null = null;
  constructor(private url: string) {}
  private async resolve(force = false) {
    if (!this.final || force) {
      const r = await fetch(this.url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': 'riffroll-fetch-instruments' } });
      if (!r.ok) throw new Error(`HEAD ${r.status} ${this.url}`);
      this.final = r.url;
      this.size = Number(r.headers.get('content-length'));
    }
    return this.final;
  }
  size = 0;
  async range(a: number, b: number, attempt = 0): Promise<Uint8Array> {
    const url = await this.resolve(attempt > 0);
    const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}`, 'user-agent': 'riffroll-fetch-instruments' } });
    if (r.status === 206) return new Uint8Array(await r.arrayBuffer());
    // signed CDN URLs expire: re-resolve and retry a few times
    if (attempt < 3) return this.range(a, b, attempt + 1);
    throw new Error(`range request failed: ${r.status} (server must support HTTP Range)`);
  }
  async init() {
    await this.resolve();
  }
}

export class RemoteZip {
  private remote: Remote;
  entries: ZipEntry[] = [];
  constructor(url: string) {
    this.remote = new Remote(url);
  }

  async open(): Promise<ZipEntry[]> {
    await this.remote.init();
    const size = this.remote.size;
    const tailLen = Math.min(size, 65557);
    const tail = await this.remote.range(size - tailLen, size - 1);
    let i = tail.length - 22;
    while (i >= 0 && !(tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6)) i--;
    if (i < 0) throw new Error('not a zip file (no end of central directory)');
    const eocd = new DataView(tail.buffer, tail.byteOffset + i);
    const count = eocd.getUint16(10, true);
    const cdSize = eocd.getUint32(12, true);
    const cdOff = eocd.getUint32(16, true);
    const cd = await this.remote.range(cdOff, cdOff + cdSize - 1);
    const v = new DataView(cd.buffer, cd.byteOffset);
    const dec = new TextDecoder();
    let p = 0;
    for (let k = 0; k < count && p + 46 <= cd.length; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt central directory');
      const method = v.getUint16(p + 10, true);
      const compressedSize = v.getUint32(p + 20, true);
      const size = v.getUint32(p + 24, true);
      const nl = v.getUint16(p + 28, true),
        el = v.getUint16(p + 30, true),
        cl = v.getUint16(p + 32, true);
      const localOffset = v.getUint32(p + 42, true);
      this.entries.push({ name: dec.decode(cd.subarray(p + 46, p + 46 + nl)), method, compressedSize, size, localOffset });
      p += 46 + nl + el + cl;
    }
    return this.entries;
  }

  async read(e: ZipEntry): Promise<Uint8Array> {
    const head = await this.remote.range(e.localOffset, e.localOffset + 29);
    const hv = new DataView(head.buffer, head.byteOffset);
    if (hv.getUint32(0, true) !== 0x04034b50) throw new Error(`bad local header for ${e.name}`);
    const start = e.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
    const data = e.compressedSize ? await this.remote.range(start, start + e.compressedSize - 1) : new Uint8Array();
    if (e.method === 0) return data;
    if (e.method === 8) return new Uint8Array(inflateRawSync(data));
    throw new Error(`unsupported zip compression method ${e.method} for ${e.name}`);
  }
}

/** Run async jobs with bounded concurrency. */
export async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}
