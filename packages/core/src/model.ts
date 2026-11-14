/**
 * The song model. Every track owns ONE list of musical events (notes or drum hits);
 * piano roll, tab, notation and drum grid are views of that same data.
 * All objects are treated as immutable: edits go through commands (see history.ts).
 */

export const PPQ = 960; // ticks per quarter note
export const SCHEMA_VERSION = 1;

export type Id = string;
/** 'other': any pitched instrument without strings (piano, synth, strings…): piano roll and score, no tab or amp. */
export type TrackType = 'guitar' | 'bass' | 'drums' | 'other';

/** Guitar and bass: strings, tab, fingering, amp, pedal. */
export const isFretted = (type: TrackType) => type === 'guitar' || type === 'bass';

/** A point on a bend / whammy curve. `pos` 0..1 across the note, `value` in semitones (negative = dip). */
export interface CurvePoint {
  pos: number;
  value: number;
}

export type SlideKind = 'in-below' | 'in-above' | 'out-down' | 'out-up' | 'legato' | 'shift';
export type HarmonicKind = 'natural' | 'artificial' | 'pinch' | 'tapped';

export interface Techniques {
  hammer?: boolean; // hammer-on / pull-off from the previous note on the same string (direction from pitch)
  slide?: SlideKind;
  bend?: CurvePoint[];
  vibrato?: 'normal' | 'wide';
  palmMute?: boolean;
  letRing?: boolean;
  dead?: boolean;
  harmonic?: HarmonicKind;
  tap?: boolean;
  tremolo?: 8 | 16 | 32;
  ghost?: boolean;
  accent?: 'normal' | 'heavy';
  staccato?: boolean;
  pick?: 'down' | 'up';
  whammy?: CurvePoint[];
  fadeIn?: boolean;
  trill?: { fret: number; speed: 16 | 32 };
  tieFromPrevious?: boolean;
}

export interface Note {
  id: Id;
  pitch: number; // MIDI
  start: number; // ticks
  duration: number; // ticks
  velocity: number; // 1..127
  /** String the user explicitly chose (0 = lowest string). null/undefined = let the fingering engine decide. */
  pinnedString?: number | null;
  tech?: Techniques;
}

export type DrumPiece =
  | 'kick'
  | 'snare'
  | 'hihat'
  | 'ride'
  | 'crash1'
  | 'crash2'
  | 'china'
  | 'splash'
  | 'tom1'
  | 'tom2'
  | 'tom3'
  | 'tom4';

export interface DrumHit {
  id: Id;
  start: number;
  piece: DrumPiece;
  articulation: string; // see drums.ts for the per-piece list
  velocity: number;
}

export interface Tuning {
  name: string;
  /** Open-string MIDI pitches, lowest string first. */
  strings: number[];
}

// ---------- tone (amp chain) settings: data only; the audio package interprets them ----------
export interface ToneChain {
  gate: { on: boolean; threshold: number; release: number };
  comp: { on: boolean; threshold: number; ratio: number };
  drive: { on: boolean; gain: number; tone: number; level: number };
  amp: {
    /** false = amp bypassed: the signal goes straight on to the cab (or past it if the cab is off). Default on. */
    on?: boolean;
    gain: number; // 0..10
    bass: number; // 0..10
    mid: number;
    treble: number;
    presence: number;
    master: number;
    character: 'clean' | 'crunch' | 'high-gain';
  };
  cab: { on: boolean; ir: string; mix: number };
  eq: { low: number; mid: number; high: number }; // dB
  chorus: { on: boolean; rate: number; depth: number; mix: number };
  delay: { on: boolean; time: number; feedback: number; mix: number };
  reverb: { on: boolean; size: number; mix: number };
  /** Bass only: split frequency below which the signal stays clean. 0 = off. */
  lowSplit?: number;
}

export interface Tone {
  id: Id;
  name: string;
  color: string;
  chain: ToneChain;
  /**
   * Sampled tone: play this instrument (e.g. a recorded overdriven guitar) instead of the track's DI through the
   * amp. Its chain still adds gate, EQ and effects; amp and cab are usually off because the samples have them.
   */
  instrument?: string;
}

export interface Stomp {
  id: Id;
  tick: number;
  /** Advanced mode only: tone to switch to. Simple mode toggles between the two `toggle` tones. */
  toneId?: Id;
}

export interface Pedal {
  mode: 'simple' | 'advanced';
  startTone: Id;
  /** The two tones a simple-mode stomp toggles between. */
  toggle: [Id, Id];
  stomps: Stomp[];
}

export interface Track {
  id: Id;
  name: string;
  type: TrackType;
  color: string;
  tuning: Tuning;
  capo: number;
  maxFret: number;
  volume: number; // linear gain 0..1.5
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
  instrument: string; // instrument id from the manifest
  tones: Tone[];
  pedal: Pedal;
  notes: Note[];
  hits: DrumHit[];
  /** Drum mixer: per-piece volume (linear). */
  drumMix?: Partial<Record<DrumPiece, number>>;
  /** Drum mixer: mic balance (linear) for kits with several mic positions. */
  drumMics?: { close: number; oh: number };
  /** Drum mixer: kit-wide bus compressor amount 0..1. */
  drumComp?: number;
}

export interface TempoPoint {
  tick: number;
  bpm: number;
  /** Ramp linearly from this point's bpm to the next point's bpm (gradual tempo change). */
  ramp?: boolean;
}

export interface TimeSig {
  bar: number; // 0-based bar index where it takes effect
  num: number;
  den: number;
}

export interface Section {
  id: Id;
  tick: number;
  name: string;
}

export interface Repeat {
  id: Id;
  startBar: number;
  endBar: number; // inclusive
  times: number; // total plays, >= 2
  /** Alternate endings: bar index -> which passes (1-based) play it. */
  endings?: { bar: number; passes: number[] }[];
}

export interface Song {
  schemaVersion: number;
  id: Id;
  title: string;
  artist: string;
  ppq: number;
  bars: number;
  tempos: TempoPoint[];
  timeSigs: TimeSig[];
  keySig: { fifths: number; minor: boolean };
  /** scale for the piano roll shading and snap to scale (see SCALES); default: major/minor from keySig */
  scale?: string;
  sections: Section[];
  repeats: Repeat[];
  loop: { start: number; end: number; on: boolean } | null;
  metronome: { on: boolean; countIn: number; volume: number };
  humanize: { timingMs: number; velocity: number };
  /** master fader after the master compressor and limiter (linear, 0..1.5; default 1) */
  master?: { volume: number };
  tracks: Track[];
}

let counter = 0;
/** Short unique id. Random part avoids collisions between sessions/merged files. */
export function newId(prefix = ''): Id {
  counter = (counter + 1) % 1679616;
  return (
    prefix + Date.now().toString(36).slice(-5) + counter.toString(36) + Math.random().toString(36).slice(2, 6)
  );
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const pitchClassName = (p: number) => NOTE_NAMES[((p % 12) + 12) % 12];
export const pitchName = (p: number) => pitchClassName(p) + (Math.floor(p / 12) - 1);

/** Parse "E2", "F#3", "Bb1" to MIDI. */
export function parsePitch(s: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s.trim());
  if (!m) throw new Error(`bad pitch ${s}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C'];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}
