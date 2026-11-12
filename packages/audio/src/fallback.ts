/**
 * Fallback instrument used ONLY when the sample packs are not installed yet (e.g. first start before
 * `pnpm fetch-instruments`). A Karplus-Strong plucked string rendered into buffers, played by the same SFZ sampler,
 * so the rest of the engine is identical. The UI shows a warning while it is in use.
 */
import { encodeWav } from './wav';

const SR = 44100;

function pluck(freq: number, seconds: number, bright: number, seed: number): Float32Array {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const period = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(period);
  let s = seed;
  for (let i = 0; i < period; i++) {
    s = (s * 16807) % 2147483647;
    buf[i] = (s / 2147483647) * 2 - 1;
  }
  // soften the excitation (pick position / brightness)
  for (let k = 0; k < 2; k++) for (let i = 1; i < period; i++) buf[i] = buf[i] * bright + buf[i - 1] * (1 - bright);
  let idx = 0;
  const decay = 0.996 + Math.min(0.0035, 30 / freq / 1000);
  for (let i = 0; i < n; i++) {
    const a = buf[idx];
    const b = buf[(idx + 1) % period];
    const y = 0.5 * (a + b) * decay;
    buf[idx] = y;
    out[i] = a * 0.5;
    idx = (idx + 1) % period;
  }
  return out;
}

const keys = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let k = lo; k <= hi; k += step) out.push(k);
  return out;
};

export function fallbackSfz(kind: 'guitar' | 'bass'): string {
  const ks = kind === 'bass' ? keys(23, 67, 4) : keys(34, 98, 4);
  return ks
    .map((k) => `<region> lokey=${k - 2} hikey=${k + 1} pitch_keycenter=${k} ampeg_release=0.15 sample=ks/${kind}-${k}.wav`)
    .join('\n');
}

export async function fallbackFetch(url: string): Promise<ArrayBuffer> {
  const m = /ks\/(guitar|bass)-(\d+)\.wav$/.exec(decodeURIComponent(url));
  if (!m) throw new Error('not a fallback sample: ' + url);
  const key = Number(m[2]);
  const freq = 440 * Math.pow(2, (key - 69) / 12);
  const data = pluck(freq, m[1] === 'bass' ? 3 : 2.5, m[1] === 'bass' ? 0.35 : 0.6, key * 7919 + 17);
  return encodeWav([data], SR, 16).buffer as ArrayBuffer;
}
