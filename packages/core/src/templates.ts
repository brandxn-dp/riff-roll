import { PPQ, SCHEMA_VERSION, newId, type Note, type Song, type Track, type TrackType } from './model';
import { BASS_PRESETS, GUITAR_PRESETS, makeTone } from './tones';
import { tuningByName } from './tunings';

export const TRACK_COLORS = [
  '#e8365d',
  '#47bfee',
  '#f3cf48',
  '#5fd17c',
  '#ff9a3c',
  '#b38bff',
  '#ff6fb5',
  '#8aa4c8',
];

export function makeTrack(type: TrackType, name: string, color: string, opts: Partial<Track> = {}): Track {
  const tones =
    type === 'guitar'
      ? // distorted tone: the sampled overdriven guitar (real palm mutes, lighter on the CPU than an amp chain)
        [makeTone(GUITAR_PRESETS.clean), makeTone(GUITAR_PRESETS.overdrive)]
      : type === 'bass'
        ? [makeTone(BASS_PRESETS.clean), makeTone(BASS_PRESETS.driven)]
        : [];
  const tuning =
    type === 'guitar'
      ? tuningByName('Standard E')!
      : type === 'bass'
        ? tuningByName('Bass Standard E')!
        : { name: type === 'drums' ? 'Drums' : 'None', strings: [] };
  const toneA = tones[0]?.id ?? '';
  const toneB = tones[1]?.id ?? toneA;
  return {
    id: newId('trk'),
    name,
    type,
    color,
    tuning,
    capo: 0,
    maxFret: type === 'bass' ? 21 : 24, // unused by drums and other tracks
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    instrument:
      type === 'guitar'
        ? 'guitar-fsbs-direct'
        : type === 'bass'
          ? 'bass-yr-picked'
          : type === 'drums'
            ? 'drums-bread'
            : '', // other: the first installed instrument of that kind
    tones,
    pedal: { mode: 'simple', startTone: toneA, toggle: [toneA, toneB], stomps: [] },
    notes: [],
    hits: [],
    ...opts,
  };
}

/** New-song template: Drums, Guitar 1, Guitar 2, Bass. Each guitar does clean + distorted through its pedal lane. */
export function newSong(title = 'Untitled'): Song {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('song'),
    title,
    artist: '',
    ppq: PPQ,
    bars: 8,
    tempos: [{ tick: 0, bpm: 120 }],
    timeSigs: [{ bar: 0, num: 4, den: 4 }],
    keySig: { fifths: 0, minor: true },
    sections: [],
    repeats: [],
    loop: null,
    metronome: { on: false, countIn: 0, volume: 0.6 },
    humanize: { timingMs: 3, velocity: 6 },
    tracks: [
      makeTrack('drums', 'Drums', TRACK_COLORS[2]),
      makeTrack('guitar', 'Guitar 1', TRACK_COLORS[0], { pan: -0.35 }),
      makeTrack('guitar', 'Guitar 2', TRACK_COLORS[1], { pan: 0.35 }),
      makeTrack('bass', 'Bass', TRACK_COLORS[3]),
    ],
  };
}

/** A basic rock beat matching the example riff: 8th hats, kick on 1 and 3 (+ the "and" of 3), snare on 2 and 4. */
export function exampleBeat(track: Track, bars = 4): Track {
  const E = PPQ / 2;
  const hits: Track['hits'] = [];
  const add = (
    piece: Track['hits'][number]['piece'],
    articulation: string,
    start: number,
    velocity: number,
  ) => hits.push({ id: newId('h'), start, piece, articulation, velocity });
  for (let b = 0; b < bars; b++) {
    const bar = b * PPQ * 4;
    for (let k = 0; k < 8; k++) {
      if (b === 0 && k === 0) add('crash1', 'hit', bar, 110);
      else if (b >= 2) add('ride', 'bow', bar + k * E, k % 2 ? 84 : 104);
      else add('hihat', 'closed', bar + k * E, k % 2 ? 78 : 102);
    }
    if (b === 2) add('crash1', 'hit', bar, 118);
    add('kick', 'right', bar, 112);
    add('kick', 'right', bar + 4 * E, 108);
    add('kick', 'right', bar + 5 * E, 96);
    add('snare', 'center', bar + 2 * E, 112);
    add('snare', 'center', bar + 6 * E, 116);
    if (b === bars - 1) {
      add('tom1', 'hit', bar + 7 * E - E / 2, 100);
      add('tom3', 'hit', bar + 7 * E, 106);
    }
  }
  return { ...track, hits: hits.sort((a, b) => a.start - b.start) };
}

/** Root notes in 8ths under the example riff (E, C, then the power-chord roots). */
export function exampleBass(track: Track): Track {
  const E = PPQ / 2;
  const notes: Note[] = [];
  const add = (p: number, s: number, l = E, v = 100) =>
    notes.push({ id: newId('n'), pitch: p, start: s, duration: l, velocity: v });
  for (let k = 0; k < 8; k++) add(28, k * E, E, k % 2 ? 88 : 104); // E1
  for (let k = 0; k < 8; k++) add(36, PPQ * 4 + k * E, E, k % 2 ? 88 : 104); // C2
  const roots = [28, 28, 31, 28, 33, 33, 31, 31, 36, 36, 35, 35, 28, 28, 28, 28];
  roots.forEach((p, k) => add(p, PPQ * 8 + k * E, E, k % 2 ? 92 : 108));
  return { ...track, notes };
}

/** The prototype's example riff: clean Em/C arpeggios, then a distorted power-chord riff with a stomp at bar 3. */
export function exampleRiff(track: Track): Track {
  const S = PPQ / 4; // one 1/16 step
  const notes: Note[] = [];
  const add = (p: number, s: number, l: number) =>
    notes.push({ id: newId('n'), pitch: p, start: s * S, duration: l * S, velocity: 100 });
  for (const [p, s] of [
    [40, 0],
    [47, 2],
    [52, 4],
    [55, 6],
    [59, 8],
    [55, 10],
    [52, 12],
    [47, 14],
  ])
    add(p, s, 2);
  for (const [p, s] of [
    [48, 16],
    [55, 18],
    [60, 20],
    [64, 22],
    [60, 24],
    [55, 26],
    [50, 28],
    [47, 30],
  ])
    add(p, s, 2);
  const pc = (r: number, s: number, l: number) => {
    add(r, s, l);
    add(r + 7, s, l);
  };
  pc(40, 32, 2);
  add(40, 34, 1);
  add(40, 35, 1);
  pc(43, 36, 2);
  add(40, 38, 1);
  add(40, 39, 1);
  pc(45, 40, 4);
  add(40, 44, 1);
  add(40, 45, 1);
  pc(43, 46, 2);
  pc(48, 48, 4);
  pc(47, 52, 4);
  pc(40, 56, 8);
  return { ...track, notes, pedal: { ...track.pedal, stomps: [{ id: newId('stomp'), tick: 32 * S }] } };
}
