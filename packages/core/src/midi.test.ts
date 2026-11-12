import { describe, expect, it } from 'vitest';
import { midiToSong, songToMidi } from './midi';
import { trackFingering } from './derived';

// --- a tiny MIDI writer for test files (960 PPQ) ---
type Ev = [tick: number, ...bytes: number[]];
const vlq = (n: number) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const txt = (s: string) => [...new TextEncoder().encode(s)];
const meta = (tick: number, type: number, data: number[]): Ev => [
  tick,
  0xff,
  type,
  ...vlq(data.length),
  ...data,
];
const on = (tick: number, ch: number, pitch: number, vel = 95): Ev => [tick, 0x90 | ch, pitch, vel];
const off = (tick: number, ch: number, pitch: number): Ev => [tick, 0x80 | ch, pitch, 0];
const note = (start: number, len: number, ch: number, pitch: number): Ev[] => [
  on(start, ch, pitch),
  off(start + len, ch, pitch),
];
const bend = (tick: number, ch: number, semis: number, range: number): Ev => {
  const v = Math.round(8192 + (semis / range) * 8192);
  return [tick, 0xe0 | ch, v & 0x7f, v >> 7];
};
function track(events: Ev[]): number[] {
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  const body: number[] = [];
  let last = 0;
  for (const [tick, ...bytes] of sorted) {
    body.push(...vlq(tick - last), ...bytes);
    last = tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const len = body.length;
  return [...txt('MTrk'), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}
function midi(tracks: Ev[][], format = 1): Uint8Array {
  const header = [...txt('MThd'), 0, 0, 0, 6, 0, format, 0, tracks.length, 960 >> 8, 960 & 255];
  return new Uint8Array([...header, ...tracks.flatMap(track)]);
}
/** What Songsterr puts at the top of every track: per-bar markers, time signature, tempo. */
const songsterrHeader = (name: string): Ev[] => [
  meta(0, 0x03, txt(name)),
  meta(0, 0x06, txt('MEASURE_0')),
  meta(0, 0x58, [4, 2, 24, 8]),
  meta(0, 0x51, [0x09, 0x27, 0xc0]), // 100 bpm
  meta(3840, 0x06, txt('MEASURE_1')),
  meta(7680, 0x06, txt('MEASURE_2')),
];
/** Program + pitch-bend range (RPN 0,0) on every string channel, as Songsterr does. */
const stringSetup = (program: number, range = 24): Ev[] =>
  Array.from({ length: 9 }, (_, ch) => [
    [0, 0xc0 | ch, program] as Ev,
    [0, 0xb0 | ch, 101, 0] as Ev,
    [0, 0xb0 | ch, 100, 0] as Ev,
    [0, 0xb0 | ch, 6, range] as Ev,
  ]).flat();

describe('MIDI import: Songsterr / Guitar Pro style files (one channel per string)', () => {
  const guitar = [
    ...songsterrHeader('Jane Doe | Gibson SG | Rhythm Guitar'),
    ...stringSetup(30),
    // strummed drop-D power chord: low string first, a few ticks apart (channel 5 = lowest string)
    ...note(0, 1920, 5, 43),
    ...note(7, 1913, 4, 50),
    ...note(14, 1906, 3, 55),
    // single note on the high E string (channel 0) and a whole-step bend on the B string (channel 1)
    ...note(1920, 960, 0, 65),
    ...note(2880, 960, 1, 62),
    bend(2880, 1, 0, 24),
    bend(3100, 1, 1, 24),
    bend(3360, 1, 2, 24),
    bend(3840, 1, 0, 24),
    // muted strum written as blips: dead notes, an eighth apart
    ...note(3840, 30, 3, 51),
    ...note(3847, 30, 2, 56),
    ...note(4320, 30, 3, 51),
    ...note(4327, 30, 2, 56),
    // the string the low D lives on: drop D (lowest note D2 = 38 on the 6th string)
    ...note(4800, 960, 5, 38),
  ];
  const bass = [
    ...songsterrHeader('Bassist | Jazz Bass'),
    ...stringSetup(34),
    ...note(0, 960, 3, 26),
    ...note(960, 960, 2, 33),
  ];
  const drums = [
    meta(0, 0x04, txt('Drums')),
    ...note(0, 60, 9, 36),
    ...note(480, 60, 9, 40), // GM 40 without any 38: the main snare
    ...note(960, 60, 9, 59), // ride 2
    ...note(1440, 60, 9, 81), // triangle → ride bell
  ];
  const song = midiToSong(midi([guitar, bass, drums]), 'Test');

  it('keeps each instrument as one track with a clean name', () => {
    expect(song.tracks.map((t) => [t.type, t.name])).toEqual([
      ['guitar', 'Rhythm Guitar'],
      ['bass', 'Jazz Bass'],
      ['drums', 'Drums'],
    ]);
  });

  it('works out the tuning from the notes on each string', () => {
    expect(song.tracks[0].tuning.name).toBe('Drop D');
    expect(song.tracks[1].tuning.name).toBe('Bass Drop D');
  });

  it('pins every note to the string it was written on', () => {
    const g = song.tracks[0];
    const f = trackFingering(g);
    const at = (start: number, pitch: number) => g.notes.find((n) => n.start === start && n.pitch === pitch)!;
    expect(f.get(at(0, 43).id)).toEqual({ string: 0, fret: 5 });
    expect(f.get(at(0, 50).id)).toEqual({ string: 1, fret: 5 });
    expect(f.get(at(1920, 65).id)).toEqual({ string: 5, fret: 1 });
    expect(f.get(at(2880, 62).id)).toEqual({ string: 4, fret: 3 });
    expect(g.notes.every((n) => n.pinnedString != null)).toBe(true);
  });

  it('lines up strummed chords without moving their ends', () => {
    const chord = song.tracks[0].notes.filter((n) => n.start === 0);
    expect(chord.map((n) => n.pitch)).toEqual([43, 50, 55]);
    expect(chord.every((n) => n.duration === 1920)).toBe(true);
  });

  it('turns pitch bends into a bend curve (using the RPN bend range)', () => {
    const b = song.tracks[0].notes.find((n) => n.start === 2880)!.tech?.bend;
    expect(b?.[0]).toEqual({ pos: 0, value: 0 });
    expect(Math.max(...b!.map((p) => p.value))).toBeCloseTo(2, 1);
  });

  it('reads blips as dead notes with their written length', () => {
    const dead = song.tracks[0].notes.filter((n) => n.tech?.dead);
    expect(dead.map((n) => n.start)).toEqual([3840, 3840, 4320, 4320]);
    expect(dead.every((n) => n.duration === 480)).toBe(true);
  });

  it('starts distortion-program guitars on the driven tone', () => {
    const g = song.tracks[0];
    expect(g.pedal.startTone).toBe(g.pedal.toggle[1]);
  });

  it('ignores per-bar MEASURE_n markers and repeated meta events', () => {
    expect(song.sections).toEqual([]);
    expect(song.timeSigs).toEqual([{ bar: 0, num: 4, den: 4 }]);
    expect(song.tempos).toEqual([{ tick: 0, bpm: 100 }]);
  });

  it('maps General MIDI drum keys without a lane of their own', () => {
    expect(song.tracks[2].hits.map((h) => `${h.piece}:${h.articulation}`)).toEqual([
      'kick:right',
      'snare:center',
      'ride:bow',
      'ride:bell',
    ]);
  });
});

describe('MIDI import: other files', () => {
  it('format 0: instruments on different channels become separate tracks', () => {
    const one = [
      [0, 0xc0, 30] as Ev,
      [0, 0xc1, 33] as Ev,
      ...note(0, 960, 0, 52),
      ...note(0, 960, 1, 40),
      ...note(0, 120, 9, 36),
    ];
    const song = midiToSong(midi([one], 0));
    expect(song.tracks.map((t) => t.type).sort()).toEqual(['bass', 'drums', 'guitar']);
  });

  it('GM 40 next to 38 stays a rimshot', () => {
    const d = [...note(0, 60, 9, 38), ...note(480, 60, 9, 40)];
    const song = midiToSong(midi([d]));
    expect(song.tracks[0].hits.map((h) => h.articulation)).toEqual(['center', 'rimshot']);
  });

  it('a guitar without string channels gets the tuning that reaches its lowest note', () => {
    const g = [[0, 0xc0, 29] as Ev, ...note(0, 960, 0, 38), ...note(960, 960, 0, 62)];
    const song = midiToSong(midi([g]));
    expect(song.tracks[0].type).toBe('guitar');
    expect(song.tracks[0].tuning.name).toBe('Drop D');
  });
});

describe('MIDI import: other instruments', () => {
  it('a piano program becomes an "other" track with every note kept', () => {
    const piano = [
      [0, 0xc0, 0] as Ev,
      ...note(0, 960, 0, 48),
      ...note(0, 960, 0, 64),
      ...note(960, 480, 0, 72),
    ];
    const song = midiToSong(midi([piano]));
    const t = song.tracks[0];
    expect(t.type).toBe('other');
    expect(t.tones).toEqual([]);
    expect(t.notes.map((n) => n.pitch)).toEqual([48, 64, 72]);
    // and back out: it exports with a piano program, not a guitar one
    const back = midiToSong(songToMidi(song));
    expect(back.tracks[0].type).toBe('other');
  });
});
