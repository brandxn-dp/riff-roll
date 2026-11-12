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
  for (let k = 0; k < 2; k++)
    for (let i = 1; i < period; i++) buf[i] = buf[i] * bright + buf[i - 1] * (1 - bright);
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
    .map(
      (k) =>
        `<region> lokey=${k - 2} hikey=${k + 1} pitch_keycenter=${k} ampeg_release=0.15 sample=ks/${kind}-${k}.wav`,
    )
    .join('\n');
}

export async function fallbackFetch(url: string): Promise<ArrayBuffer> {
  const d = /ks\/drum-(\d+)\.wav$/.exec(decodeURIComponent(url));
  if (d) {
    const [kind, p] = DRUM_KEYS[Number(d[1])] ?? ['snare', 0];
    return encodeWav([drumSample(kind, p)], SR, 16).buffer as ArrayBuffer;
  }
  const m = /ks\/(guitar|bass)-(\d+)\.wav$/.exec(decodeURIComponent(url));
  if (!m) throw new Error('not a fallback sample: ' + url);
  const key = Number(m[2]);
  const freq = 440 * Math.pow(2, (key - 69) / 12);
  const data = pluck(freq, m[1] === 'bass' ? 3 : 2.5, m[1] === 'bass' ? 0.35 : 0.6, key * 7919 + 17);
  return encodeWav([data], SR, 16).buffer as ArrayBuffer;
}

// ---------------- fallback drum kit (synthesised one-shots in the Riff Roll drum keymap) ----------------
type DrumSynth =
  'kick' | 'snare' | 'rim' | 'stick' | 'hhc' | 'hho' | 'hhp' | 'ride' | 'bell' | 'crash' | 'choke' | 'tom';
const DRUM_KEYS: Record<number, [DrumSynth, number]> = {
  36: ['kick', 0],
  35: ['kick', 0],
  38: ['snare', 0],
  40: ['rim', 0],
  37: ['stick', 0],
  42: ['hhc', 0],
  44: ['hhp', 0],
  26: ['hho', 0.5],
  46: ['hho', 1],
  51: ['ride', 0],
  53: ['bell', 0],
  49: ['crash', 0],
  57: ['crash', 1],
  52: ['crash', 2],
  55: ['crash', 3],
  24: ['choke', 0],
  25: ['choke', 0],
  50: ['tom', 165],
  48: ['tom', 130],
  43: ['tom', 100],
  41: ['tom', 78],
};

export function fallbackDrumSfz(): string {
  const groups: Record<number, string> = {
    42: ' group=1',
    44: ' group=1',
    26: ' group=2 off_by=1',
    46: ' group=2 off_by=1',
    49: ' group=3 off_by=4',
    24: ' group=4',
  };
  return Object.keys(DRUM_KEYS)
    .map(
      (k) =>
        `<region> key=${k} pitch_keytrack=0 loop_mode=one_shot amp_veltrack=70${groups[Number(k)] ?? ''} sample=ks/drum-${k}.wav`,
    )
    .join('\n');
}

function drumSample(kind: DrumSynth, p: number): Float32Array {
  const len = {
    kick: 0.5,
    snare: 0.35,
    rim: 0.3,
    stick: 0.12,
    hhc: 0.09,
    hhp: 0.07,
    hho: 0.6,
    ride: 1.6,
    bell: 1.2,
    crash: 2.2,
    choke: 0.15,
    tom: 0.6,
  }[kind];
  const n = Math.floor(SR * len);
  const out = new Float32Array(n);
  let seed = 99 + p * 31 + kind.length;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let ph = 0,
    lpPrev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const noise = rnd();
    let y: number;
    switch (kind) {
      case 'kick': {
        const f = 48 + 120 * Math.exp(-t * 28);
        ph += (2 * Math.PI * f) / SR;
        y = Math.sin(ph) * Math.exp(-t * 7) + noise * 0.15 * Math.exp(-t * 120);
        break;
      }
      case 'tom': {
        const f = p * (1 + 0.4 * Math.exp(-t * 18));
        ph += (2 * Math.PI * f) / SR;
        y = Math.sin(ph) * Math.exp(-t * 6) + noise * 0.08 * Math.exp(-t * 60);
        break;
      }
      case 'snare':
      case 'rim':
        ph += (2 * Math.PI * 190) / SR;
        y = Math.sin(ph) * 0.5 * Math.exp(-t * 25) + noise * (kind === 'rim' ? 0.9 : 0.7) * Math.exp(-t * 14);
        break;
      case 'stick':
        ph += (2 * Math.PI * 900) / SR;
        y = Math.sin(ph) * Math.exp(-t * 60) * 0.8;
        break;
      default: {
        // metallic: high-passed noise with different decays
        const hp = noise - lpPrev;
        lpPrev = noise * 0.4 + lpPrev * 0.6;
        const dec = { hhc: 60, hhp: 70, hho: p === 1 ? 4 : 9, ride: 2.6, bell: 3.5, crash: 1.8, choke: 30 }[
          kind as 'hhc'
        ];
        y = hp * Math.exp(-t * dec) * (kind === 'ride' ? 0.35 : 0.6);
        if (kind === 'bell') {
          ph += (2 * Math.PI * 2200) / SR;
          y = y * 0.3 + Math.sin(ph) * 0.4 * Math.exp(-t * 4);
        }
      }
    }
    out[i] = y * 0.8;
  }
  return out;
}
