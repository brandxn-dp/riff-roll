/**
 * MP3 export. LAME (via @breezystack/lamejs, LGPL-3.0) runs in a worker so the page stays responsive; it is its
 * own chunk, loaded only when someone exports. The file gets an ID3v2.3 tag with the song's title and artist.
 */
import { Mp3Encoder } from '@breezystack/lamejs';

export const MP3_BITRATES = [128, 192, 256, 320] as const;

const toInt16 = (f: Float32Array) => {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
};

/** ID3v2.3 tag with title (TIT2) and artist (TPE1), UTF-16 text. */
export function id3Tag(title: string, artist: string): Uint8Array {
  const frame = (id: string, text: string) => {
    // encoding 1 = UTF-16 with BOM
    const body = new Uint8Array(3 + text.length * 2);
    body[0] = 1;
    body[1] = 0xff;
    body[2] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      body[3 + i * 2] = c & 0xff;
      body[4 + i * 2] = c >> 8;
    }
    const f = new Uint8Array(10 + body.length);
    for (let i = 0; i < 4; i++) f[i] = id.charCodeAt(i);
    new DataView(f.buffer).setUint32(4, body.length);
    f.set(body, 10);
    return f;
  };
  const frames = [title && frame('TIT2', title), artist && frame('TPE1', artist)].filter(
    Boolean,
  ) as Uint8Array[];
  const size = frames.reduce((n, f) => n + f.length, 0);
  const tag = new Uint8Array(10 + size);
  tag.set([0x49, 0x44, 0x33, 3, 0, 0]); // "ID3" v2.3, no flags
  // syncsafe size: 7 bits per byte
  tag[6] = (size >> 21) & 0x7f;
  tag[7] = (size >> 14) & 0x7f;
  tag[8] = (size >> 7) & 0x7f;
  tag[9] = size & 0x7f;
  let o = 10;
  for (const f of frames) {
    tag.set(f, o);
    o += f.length;
  }
  return tag;
}

export interface Mp3Job {
  channels: Float32Array[];
  sampleRate: number;
  kbps: number;
  title?: string;
  artist?: string;
}

/** Encode PCM to MP3 (runs in the worker; also directly in tests). */
export function encodeMp3(job: Mp3Job, onProgress?: (f: number) => void): Uint8Array {
  const stereo = job.channels.length > 1;
  const enc = new Mp3Encoder(stereo ? 2 : 1, job.sampleRate, job.kbps);
  const l = toInt16(job.channels[0]);
  const r = stereo ? toInt16(job.channels[1]) : undefined;
  const block = 1152 * 8;
  const parts: Uint8Array[] = [id3Tag(job.title ?? '', job.artist ?? '')];
  for (let i = 0; i < l.length; i += block) {
    const out = enc.encodeBuffer(l.subarray(i, i + block), r?.subarray(i, i + block));
    if (out.length) parts.push(new Uint8Array(out));
    if (onProgress && (i / block) % 40 === 0) onProgress(i / l.length);
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return bytes;
}
