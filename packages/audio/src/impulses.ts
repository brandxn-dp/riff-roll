/**
 * Synthesised impulse responses. We ship no third-party IR files (no clearly redistributable CC0 cab set was
 * confirmed), so cabinets are modelled: an impulse plus a few early cabinet reflections, run through the speaker's
 * frequency response (resonance, cone break-up peaks, steep top-end roll-off) and rendered offline once.
 * Users can load their own IR WAVs instead (cab.ir = "user:<asset>").
 */

type Filter = { type: BiquadFilterType; f: number; q?: number; g?: number };

export const CABS: Record<string, { name: string; filters: Filter[]; reflections: [number, number][] }> = {
  'builtin:4x12-closed': {
    name: '4x12 closed back',
    filters: [
      { type: 'highpass', f: 72, q: 0.8 },
      { type: 'highpass', f: 60, q: 0.6 },
      { type: 'peaking', f: 105, q: 1.4, g: 4.5 },
      { type: 'peaking', f: 420, q: 0.9, g: -3 },
      { type: 'peaking', f: 2300, q: 1.6, g: 3.5 },
      { type: 'peaking', f: 3600, q: 2.2, g: 2.5 },
      { type: 'lowpass', f: 5200, q: 0.75 },
      { type: 'lowpass', f: 6200, q: 0.6 },
      { type: 'lowpass', f: 9000, q: 0.5 },
    ],
    reflections: [
      [0.00031, 0.35],
      [0.00074, -0.22],
      [0.0012, 0.14],
      [0.0021, 0.08],
    ],
  },
  'builtin:2x12-open': {
    name: '2x12 open back',
    filters: [
      { type: 'highpass', f: 85, q: 0.7 },
      { type: 'peaking', f: 140, q: 1.0, g: 2 },
      { type: 'peaking', f: 700, q: 0.8, g: -1.5 },
      { type: 'peaking', f: 1700, q: 1.2, g: 2.5 },
      { type: 'peaking', f: 3000, q: 1.8, g: 3 },
      { type: 'lowpass', f: 5800, q: 0.7 },
      { type: 'lowpass', f: 7500, q: 0.6 },
    ],
    reflections: [
      [0.00045, 0.25],
      [0.0011, 0.12],
      [0.0019, -0.08],
    ],
  },
  'builtin:1x12-combo': {
    name: '1x12 combo',
    filters: [
      { type: 'highpass', f: 95, q: 0.7 },
      { type: 'peaking', f: 160, q: 1.2, g: 2.5 },
      { type: 'peaking', f: 1300, q: 1.0, g: 2 },
      { type: 'peaking', f: 2700, q: 1.5, g: 3 },
      { type: 'lowpass', f: 5000, q: 0.7 },
      { type: 'lowpass', f: 7000, q: 0.6 },
    ],
    reflections: [
      [0.0004, 0.3],
      [0.0009, -0.15],
    ],
  },
  'builtin:bass-4x10': {
    name: 'Bass 4x10',
    filters: [
      { type: 'highpass', f: 38, q: 0.7 },
      { type: 'peaking', f: 80, q: 1.0, g: 3 },
      { type: 'peaking', f: 650, q: 0.8, g: -2 },
      { type: 'peaking', f: 2400, q: 1.4, g: 2 },
      { type: 'lowpass', f: 4800, q: 0.7 },
      { type: 'lowpass', f: 7000, q: 0.6 },
    ],
    reflections: [
      [0.0005, 0.25],
      [0.0013, 0.1],
    ],
  },
};

async function renderOffline(
  sampleRate: number,
  seconds: number,
  channels: number,
  build: (ctx: OfflineAudioContext) => AudioNode,
): Promise<AudioBuffer> {
  const len = Math.ceil(sampleRate * seconds);
  const ctx = new OfflineAudioContext(channels, len, sampleRate);
  build(ctx).connect(ctx.destination);
  return ctx.startRendering();
}

const irCache = new Map<string, Promise<AudioBuffer>>();

export function cabIR(id: string, sampleRate: number): Promise<AudioBuffer> {
  const key = `${id}@${sampleRate}`;
  let p = irCache.get(key);
  if (p) return p;
  const cab = CABS[id] ?? CABS['builtin:4x12-closed'];
  p = renderOffline(sampleRate, 0.05, 1, (ctx) => {
    const imp = ctx.createBuffer(1, Math.ceil(sampleRate * 0.01), sampleRate);
    const d = imp.getChannelData(0);
    d[0] = 1;
    for (const [t, a] of cab.reflections) d[Math.round(t * sampleRate)] += a;
    const src = ctx.createBufferSource();
    src.buffer = imp;
    let node: AudioNode = src;
    for (const f of cab.filters) {
      const b = ctx.createBiquadFilter();
      b.type = f.type;
      b.frequency.value = f.f;
      if (f.q !== undefined) b.Q.value = f.q;
      if (f.g !== undefined) b.gain.value = f.g;
      node.connect(b);
      node = b;
    }
    src.start(0);
    return node;
  }).then((buf) => normalize(buf, 1));
  irCache.set(key, p);
  return p;
}

/** Room reverb: decaying stereo noise with high-frequency damping. */
export function reverbIR(sampleRate: number, seconds = 2.2): Promise<AudioBuffer> {
  const key = `reverb:${seconds}@${sampleRate}`;
  let p = irCache.get(key);
  if (p) return p;
  p = renderOffline(sampleRate, seconds, 2, (ctx) => {
    const len = Math.ceil(sampleRate * seconds);
    const noise = ctx.createBuffer(2, len, sampleRate);
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let ch = 0; ch < 2; ch++) {
      const d = noise.getChannelData(ch);
      const pre = Math.floor(sampleRate * 0.012);
      for (let i = pre; i < len; i++) d[i] = rnd() * Math.exp((-6.9 * (i - pre)) / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5500;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    src.connect(lp).connect(hp);
    src.start(0);
    return hp;
  }).then((buf) => normalize(buf, 0.25));
  irCache.set(key, p);
  return p;
}

/** Scale an IR so its energy is `target` (keeps cab swaps at a similar loudness). */
function normalize(buf: AudioBuffer, target: number): AudioBuffer {
  let e = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) e += v * v;
  const k = e > 0 ? target / Math.sqrt(e / buf.numberOfChannels) : 1;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buf;
}
