import { z } from 'zod';
import { SCHEMA_VERSION, type Song } from './model';

/** Versioned song.json schema. Bump SCHEMA_VERSION and add a migration when the shape changes. */
const curve = z.array(z.object({ pos: z.number(), value: z.number() }));

const techniques = z
  .object({
    hammer: z.boolean(),
    slide: z.enum(['in-below', 'in-above', 'out-down', 'out-up', 'legato', 'shift']),
    bend: curve,
    vibrato: z.enum(['normal', 'wide']),
    palmMute: z.boolean(),
    letRing: z.boolean(),
    dead: z.boolean(),
    harmonic: z.enum(['natural', 'artificial', 'pinch', 'tapped']),
    tap: z.boolean(),
    tremolo: z.union([z.literal(8), z.literal(16), z.literal(32)]),
    ghost: z.boolean(),
    accent: z.enum(['normal', 'heavy']),
    staccato: z.boolean(),
    pick: z.enum(['down', 'up']),
    whammy: curve,
    fadeIn: z.boolean(),
    trill: z.object({ fret: z.number().int(), speed: z.union([z.literal(16), z.literal(32)]) }),
    tieFromPrevious: z.boolean(),
  })
  .partial();

const note = z.object({
  id: z.string(),
  pitch: z.number().int().min(0).max(127),
  start: z.number().int().min(0),
  duration: z.number().int().min(1),
  velocity: z.number().int().min(1).max(127),
  pinnedString: z.number().int().min(0).nullable().optional(),
  tech: techniques.optional(),
});

const drumPiece = z.enum([
  'kick',
  'snare',
  'hihat',
  'ride',
  'crash1',
  'crash2',
  'china',
  'splash',
  'tom1',
  'tom2',
  'tom3',
  'tom4',
]);

const hit = z.object({
  id: z.string(),
  start: z.number().int().min(0),
  piece: drumPiece,
  articulation: z.string(),
  velocity: z.number().int().min(1).max(127),
});

const toneChain = z.object({
  gate: z.object({ on: z.boolean(), threshold: z.number(), release: z.number() }),
  comp: z.object({ on: z.boolean(), threshold: z.number(), ratio: z.number() }),
  drive: z.object({ on: z.boolean(), gain: z.number(), tone: z.number(), level: z.number() }),
  amp: z.object({
    gain: z.number(),
    bass: z.number(),
    mid: z.number(),
    treble: z.number(),
    presence: z.number(),
    master: z.number(),
    character: z.enum(['clean', 'crunch', 'high-gain']),
  }),
  cab: z.object({ on: z.boolean(), ir: z.string(), mix: z.number() }),
  eq: z.object({ low: z.number(), mid: z.number(), high: z.number() }),
  chorus: z.object({ on: z.boolean(), rate: z.number(), depth: z.number(), mix: z.number() }),
  delay: z.object({ on: z.boolean(), time: z.number(), feedback: z.number(), mix: z.number() }),
  reverb: z.object({ on: z.boolean(), size: z.number(), mix: z.number() }),
  lowSplit: z.number().optional(),
});

const track = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['guitar', 'bass', 'drums', 'other']),
  color: z.string(),
  tuning: z.object({ name: z.string(), strings: z.array(z.number().int()).max(8) }),
  capo: z.number().int().min(0).max(24),
  maxFret: z.number().int().min(1).max(36),
  volume: z.number().min(0).max(2),
  pan: z.number().min(-1).max(1),
  mute: z.boolean(),
  solo: z.boolean(),
  instrument: z.string(),
  tones: z.array(z.object({ id: z.string(), name: z.string(), color: z.string(), chain: toneChain })),
  pedal: z.object({
    mode: z.enum(['simple', 'advanced']),
    startTone: z.string(),
    toggle: z.tuple([z.string(), z.string()]),
    stomps: z.array(
      z.object({ id: z.string(), tick: z.number().int().min(0), toneId: z.string().optional() }),
    ),
  }),
  notes: z.array(note),
  hits: z.array(hit),
  drumMix: z.record(z.string(), z.number()).optional(),
  drumMics: z.object({ close: z.number(), oh: z.number() }).optional(),
  drumComp: z.number().min(0).max(1).optional(),
});

export const songSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  ppq: z.number().int().positive(),
  bars: z.number().int().min(1),
  tempos: z
    .array(
      z.object({ tick: z.number().min(0), bpm: z.number().min(10).max(500), ramp: z.boolean().optional() }),
    )
    .min(1),
  timeSigs: z
    .array(
      z.object({ bar: z.number().int().min(0), num: z.number().int().min(1).max(32), den: z.number().int() }),
    )
    .min(1),
  keySig: z.object({ fifths: z.number().int().min(-7).max(7), minor: z.boolean() }),
  sections: z.array(z.object({ id: z.string(), tick: z.number().min(0), name: z.string() })),
  repeats: z.array(
    z.object({
      id: z.string(),
      startBar: z.number().int().min(0),
      endBar: z.number().int().min(0),
      times: z.number().int().min(2),
      endings: z.array(z.object({ bar: z.number().int(), passes: z.array(z.number().int()) })).optional(),
    }),
  ),
  loop: z.object({ start: z.number(), end: z.number(), on: z.boolean() }).nullable(),
  metronome: z.object({ on: z.boolean(), countIn: z.number().int().min(0).max(4), volume: z.number() }),
  humanize: z.object({ timingMs: z.number().min(0).max(30), velocity: z.number().min(0).max(40) }),
  tracks: z.array(track),
});

type Migration = (raw: any) => any;
/** migrations[n] upgrades a document from version n to n+1. */
const migrations: Record<number, Migration> = {
  // 0: the prototype's localStorage format → v1 is handled by importPrototype() in files.ts
};

export function migrate(raw: any): any {
  let doc = raw;
  let v = typeof doc?.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (v > SCHEMA_VERSION)
    throw new Error(`This song was saved by a newer version of Riff Roll (schema ${v}).`);
  while (v < SCHEMA_VERSION) {
    const m = migrations[v];
    if (!m) throw new Error(`No migration from schema version ${v}`);
    doc = m(doc);
    v = doc.schemaVersion;
  }
  return doc;
}

/** Validate + migrate an unknown JSON value into a Song. Throws with a readable message on failure. */
export function parseSong(raw: unknown): Song {
  const r = songSchema.safeParse(migrate(raw));
  if (!r.success) {
    const first = r.error.issues[0];
    throw new Error(`Invalid song file: ${first.path.join('.')}: ${first.message}`);
  }
  return r.data as Song;
}
