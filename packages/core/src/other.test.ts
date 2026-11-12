import { describe, expect, it } from 'vitest';
import { makeTrack, newSong } from './templates';
import { songToAlphaTex } from './alphatex';
import { songToMusicXml } from './musicxml';
import { packRiff, unpackRiff } from './riff';
import { trackFingering } from './derived';
import type { Note } from './model';

const notes: Note[] = [
  { id: 'a', pitch: 60, start: 0, duration: 960, velocity: 90 },
  { id: 'b', pitch: 64, start: 0, duration: 960, velocity: 90 },
  { id: 'c', pitch: 43, start: 960, duration: 1920, velocity: 70 },
];
function song() {
  const s = newSong('Keys test');
  const keys = { ...makeTrack('other', 'Piano', '#fff'), notes };
  return { ...s, bars: 2, tracks: [keys] };
}

describe('"other" (piano, synth…) tracks', () => {
  it('have no strings, amp or pedal', () => {
    const t = makeTrack('other', 'Piano', '#fff');
    expect(t.tuning.strings).toEqual([]);
    expect(t.tones).toEqual([]);
    expect(trackFingering({ ...t, notes }).size).toBeGreaterThanOrEqual(0); // never throws
  });

  it('write a score-only staff with note names in alphaTex', () => {
    const { tex } = songToAlphaTex(song());
    expect(tex).toContain(String.raw`\staff {score}`);
    expect(tex).toContain(String.raw`\tuning piano`);
    expect(tex).toMatch(/\(C4 E4\)\.4|\(C4 E4\)/);
    expect(tex).toContain('G2');
    expect(tex).not.toContain('{score tabs}');
  });

  it('export to MusicXML on one staff with real pitches', () => {
    const xml = songToMusicXml(song());
    expect(xml).not.toContain('<staves>2</staves>');
    expect(xml).not.toContain('TAB');
    expect(xml).toContain('<step>C</step>');
  });

  it('survive saving and loading', () => {
    const back = unpackRiff(packRiff(song(), {})).song;
    expect(back.tracks[0].type).toBe('other');
    expect(back.tracks[0].notes).toHaveLength(3);
  });
});
