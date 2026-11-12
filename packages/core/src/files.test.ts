import { describe, expect, it } from 'vitest';
import { exampleBass, exampleBeat, exampleRiff, newSong } from './templates';
import { packRiff, unpackRiff } from './riff';
import { midiToSong, songToMidi } from './midi';
import { songToMusicXml } from './musicxml';
import { asciiTab } from './ascii';
import { songToAlphaTex } from './alphatex';
import { PPQ } from './model';

const demo = () => {
  const s = newSong('Demo');
  return { ...s, bars: 4, tracks: s.tracks.map((t, i) => (i === 0 ? exampleBeat(t) : i === 1 ? exampleRiff(t) : i === 3 ? exampleBass(t) : t)) };
};

describe('.riff files', () => {
  it('round-trips song and assets', () => {
    const song = demo();
    const ir = new Uint8Array([1, 2, 3]);
    const back = unpackRiff(packRiff(song, { 'my-cab.wav': ir }));
    expect(back.song).toEqual(song);
    expect([...back.assets['my-cab.wav']]).toEqual([1, 2, 3]);
  });
  it('rejects non-riff data clearly', () => {
    expect(() => unpackRiff(new Uint8Array([1, 2, 3]))).toThrow(/Not a Riff Roll file/);
  });
});

describe('MIDI', () => {
  it('exports and re-imports notes, drums, tempo and stomps as program changes', () => {
    const song = { ...demo(), tempos: [{ tick: 0, bpm: 140 }] };
    const bytes = songToMidi(song);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MThd');
    // program change 30 (distortion) appears for the stomp
    const hasDistProgram = bytes.some((b, i) => (b & 0xf0) === 0xc0 && bytes[i + 1] === 30);
    expect(hasDistProgram).toBe(true);
    const back = midiToSong(bytes);
    expect(back.tempos[0].bpm).toBeCloseTo(140, 0);
    const drums = back.tracks.find((t) => t.type === 'drums')!;
    expect(drums.hits.length).toBe(song.tracks[0].hits.length);
    const gtr = back.tracks.find((t) => t.name === 'Guitar 1')!;
    expect(gtr.notes.map((n) => [n.pitch, n.start, n.duration])).toEqual(song.tracks[1].notes.map((n) => [n.pitch, n.start, n.duration]));
    expect(back.tracks.find((t) => t.name === 'Bass')!.type).toBe('bass');
  });
});

describe('MusicXML', () => {
  it('writes a well-formed partwise score with tab staves', () => {
    const xml = songToMusicXml(demo());
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml).toContain('<sign>TAB</sign>');
    expect(xml).toContain('<fret>');
    expect(xml).toContain('<words>Dist</words>');
    // every opened measure is closed
    expect(xml.match(/<measure /g)!.length).toBe(xml.match(/<\/measure>/g)!.length);
    expect(xml.match(/<part id=/g)!.length).toBe(4);
  });
});

describe('ASCII tab', () => {
  it('renders the first bar of the riff', () => {
    const s = demo();
    const txt = asciiTab(s, s.tracks[1], { from: 0, to: PPQ * 4 });
    const lines = txt.split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[5].startsWith('E |0')).toBe(true);
    expect(lines[0].startsWith('e |')).toBe(true);
  });
});

describe('AlphaTex', () => {
  it('emits a track per song track with tuning, stomp text and percussion', () => {
    const { tex } = songToAlphaTex(demo());
    expect(tex.match(/\\track /g)!.length).toBe(4);
    expect(tex).toContain('\\tuning E4 B3 G3 D3 A2 E2');
    expect(tex).toContain('txt "Dist"');
    expect(tex).toContain('\\instrument percussion');
  });
});
