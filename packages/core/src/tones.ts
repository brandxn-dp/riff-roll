import { newId, type Tone, type ToneChain } from './model';

const base = (): ToneChain => ({
  gate: { on: false, threshold: -60, release: 0.08 },
  comp: { on: false, threshold: -24, ratio: 3 },
  drive: { on: false, gain: 5, tone: 5, level: 5 },
  amp: { gain: 3, bass: 5, mid: 5, treble: 5, presence: 5, master: 5, character: 'clean' },
  cab: { on: true, ir: 'builtin:2x12-open', mix: 1 },
  eq: { low: 0, mid: 0, high: 0 },
  chorus: { on: false, rate: 0.8, depth: 0.3, mix: 0.3 },
  delay: { on: false, time: 0.38, feedback: 0.3, mix: 0.2 },
  reverb: { on: true, size: 0.4, mix: 0.12 },
});

/** A tone preset. `instrument`: a sampled tone (plays that instrument instead of the DI through the amp). */
export type Preset = { name: string; color: string; chain: (c: ToneChain) => ToneChain; instrument?: string };

/** Bread Bread's Overdriven Guitar: recorded through its own amp and cab, with real palm-mute and legato layers. */
export const SAMPLED_OVERDRIVE = 'guitar-bread-overdrive';

/** Shipped guitar tone presets. Values are tuned by ear against a palm-muted E5 chug and an open Em chord. */
export const GUITAR_PRESETS: Record<string, Preset> = {
  clean: {
    name: 'Clean',
    color: '#8aa4c8',
    chain: (c) => ({
      ...c,
      comp: { on: true, threshold: -26, ratio: 2.5 },
      amp: { gain: 2.2, bass: 5.5, mid: 5, treble: 6, presence: 5.5, master: 5, character: 'clean' },
      reverb: { on: true, size: 0.45, mix: 0.14 },
    }),
  },
  crunch: {
    name: 'Crunch',
    color: '#f0a050',
    chain: (c) => ({
      ...c,
      amp: { gain: 5, bass: 5, mid: 6.5, treble: 6, presence: 6, master: 5, character: 'crunch' },
      reverb: { on: true, size: 0.35, mix: 0.08 },
    }),
  },
  dist: {
    name: 'Dist',
    color: '#e8365d',
    chain: (c) => ({
      ...c,
      gate: { on: true, threshold: -48, release: 0.05 },
      drive: { on: true, gain: 2, tone: 6.5, level: 7 },
      amp: { gain: 7.5, bass: 6, mid: 4, treble: 6.5, presence: 6.5, master: 5, character: 'high-gain' },
      cab: { on: true, ir: 'builtin:4x12-closed', mix: 1 },
      reverb: { on: true, size: 0.3, mix: 0.05 },
    }),
  },
  overdrive: {
    name: 'Overdrive',
    color: '#ff7a45',
    instrument: SAMPLED_OVERDRIVE,
    // the samples carry the amp and cabinet: the chain only adds a light gate and some room
    chain: (c) => ({
      ...c,
      gate: { on: true, threshold: -62, release: 0.08 },
      // amp off (the samples have one); 'crunch' labels it as overdriven for MIDI and score exports
      amp: { ...c.amp, on: false, character: 'crunch' },
      cab: { ...c.cab, on: false },
      reverb: { on: true, size: 0.3, mix: 0.06 },
    }),
  },
  lead: {
    name: 'Lead',
    color: '#c070ff',
    chain: (c) => ({
      ...c,
      gate: { on: true, threshold: -55, release: 0.1 },
      drive: { on: true, gain: 4, tone: 6, level: 6 },
      amp: { gain: 8.5, bass: 5, mid: 6.5, treble: 6, presence: 6, master: 5, character: 'high-gain' },
      cab: { on: true, ir: 'builtin:4x12-closed', mix: 1 },
      delay: { on: true, time: 0.36, feedback: 0.32, mix: 0.18 },
      reverb: { on: true, size: 0.55, mix: 0.12 },
    }),
  },
};

export const BASS_PRESETS: Record<string, Preset> = {
  clean: {
    name: 'Clean',
    color: '#8aa4c8',
    chain: (c) => ({
      ...c,
      comp: { on: true, threshold: -22, ratio: 4 },
      amp: { gain: 2.5, bass: 6, mid: 5, treble: 5, presence: 4.5, master: 5, character: 'clean' },
      cab: { on: true, ir: 'builtin:bass-4x10', mix: 0.8 },
      reverb: { on: false, size: 0.2, mix: 0 },
    }),
  },
  driven: {
    name: 'Driven',
    color: '#e8365d',
    chain: (c) => ({
      ...c,
      comp: { on: true, threshold: -22, ratio: 4 },
      drive: { on: true, gain: 6, tone: 6, level: 5 },
      amp: { gain: 6, bass: 6, mid: 6, treble: 6, presence: 5, master: 5, character: 'crunch' },
      cab: { on: true, ir: 'builtin:bass-4x10', mix: 0.9 },
      reverb: { on: false, size: 0.2, mix: 0 },
      lowSplit: 180,
    }),
  },
};

export function makeTone(preset: Preset, id = newId('tone')): Tone {
  return {
    id,
    name: preset.name,
    color: preset.color,
    chain: preset.chain(base()),
    ...(preset.instrument ? { instrument: preset.instrument } : {}),
  };
}

export function defaultChain(): ToneChain {
  return base();
}
