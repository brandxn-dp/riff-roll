import { describe, expect, it } from 'vitest';
import {
  PPQ,
  describeSource,
  importIntoSong,
  makeTrack,
  midiToSong,
  newId,
  newSong,
  songToMidi,
  type Song,
} from './index';

const bar = (n: number) => (n - 1) * 4 * PPQ;

/** a MIDI file with a piano part and a drum part, round-tripped through our own writer */
function sourceFile(): Song {
  const s = newSong('src');
  const keys = makeTrack('other', 'Piano', '#fff');
  keys.notes = [0, 1, 2, 3].map((k) => ({
    id: newId('n'),
    pitch: 60 + k,
    start: k * PPQ,
    duration: PPQ,
    velocity: 90,
  }));
  const drums = s.tracks.find((t) => t.type === 'drums')!;
  drums.hits = [0, 1, 2, 3].map((k) => ({
    id: newId('h'),
    start: k * PPQ,
    piece: 'kick',
    articulation: 'right',
    velocity: 100,
  }));
  return midiToSong(
    songToMidi({ ...s, tempos: [{ tick: 0, bpm: 90 }], tracks: [drums, keys], bars: 1 }),
    'src',
  );
}

describe('importing a MIDI file into the open song', () => {
  it('lists the file’s tracks with what they hold', () => {
    const d = describeSource(sourceFile());
    expect(d.map((x) => [x.type, x.count])).toEqual([
      ['drums', 4],
      ['other', 4],
    ]);
    expect(d[1]).toMatchObject({ low: 60, high: 63 });
  });

  it('adds new tracks with the chosen type and instrument, from the chosen bar, growing the song', () => {
    const song = { ...newSong('Mine'), bars: 4 };
    const src = sourceFile();
    const next = importIntoSong(src, {
      at: bar(4),
      actions: [
        { kind: 'skip' },
        { kind: 'new', type: 'guitar', instrument: 'guitar-bread-overdrive', name: 'Lead' },
      ],
    }).apply(song);
    expect(next.tracks.length).toBe(song.tracks.length + 1);
    const lead = next.tracks.at(-1)!;
    expect(lead).toMatchObject({ name: 'Lead', type: 'guitar', instrument: 'guitar-bread-overdrive' });
    expect(lead.notes.map((n) => n.start)).toEqual([0, 1, 2, 3].map((k) => bar(4) + k * PPQ));
    expect(lead.notes.map((n) => n.pitch)).toEqual([60, 61, 62, 63]);
    // tempo stays the song's
    expect(next.tempos).toEqual(song.tempos);
    expect(next.bars).toBe(4);
  });

  it('merges into an existing track, converting to its type', () => {
    const song = newSong('Mine');
    const drums = song.tracks.find((t) => t.type === 'drums')!;
    const src = sourceFile();
    const next = importIntoSong(src, {
      at: bar(2),
      actions: [{ kind: 'into', trackId: drums.id }, { kind: 'skip' }],
    }).apply(song);
    const d = next.tracks.find((t) => t.id === drums.id)!;
    expect(d.hits.length).toBe(drums.hits.length + 4);
    expect(d.hits.filter((h) => h.start >= bar(2)).every((h) => h.piece === 'kick')).toBe(true);
    expect(next.tracks.length).toBe(song.tracks.length);
  });

  it('can take the file’s tempo from where it lands, and grows the song to fit', () => {
    const song = { ...newSong('Mine'), bars: 2 };
    const next = importIntoSong(sourceFile(), {
      at: bar(3),
      takeTempo: true,
      actions: [{ kind: 'new', type: 'drums' }, { kind: 'skip' }],
    }).apply(song);
    expect(next.tempos.at(-1)).toMatchObject({ tick: bar(3), bpm: 90 });
    expect(next.tempos[0].bpm).toBe(song.tempos[0].bpm);
    expect(next.bars).toBe(3);
  });
});

describe('merging into a track that already has the same events', () => {
  it('does not double hits or notes that are already there', () => {
    const song = newSong('Mine');
    const drums = song.tracks.find((t) => t.type === 'drums')!;
    drums.hits = [{ id: 'k1', start: 0, piece: 'kick', articulation: 'right', velocity: 100 }];
    const next = importIntoSong(sourceFile(), {
      at: 0,
      actions: [{ kind: 'into', trackId: drums.id }, { kind: 'skip' }],
    }).apply(song);
    const kicksAt0 = next.tracks
      .find((t) => t.id === drums.id)!
      .hits.filter((h) => h.start === 0 && h.piece === 'kick');
    expect(kicksAt0.length).toBe(1);
    expect(next.tracks.find((t) => t.id === drums.id)!.hits.length).toBe(4);
  });
});
