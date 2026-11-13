import { describe, expect, it } from 'vitest';
import { makeTrack } from './templates';
import { convertTrack } from './convert';

const gtr = () => ({
  ...makeTrack('guitar', 'Keys 1', '#fff'),
  notes: [
    { id: 'a', pitch: 60, start: 0, duration: 960, velocity: 90, pinnedString: 3, tech: { palmMute: true } },
    { id: 'b', pitch: 36, start: 960, duration: 480, velocity: 70 },
  ],
});

describe('change a track’s instrument type', () => {
  it('guitar → other keeps the notes, drops strings, amp and guitar techniques', () => {
    const t = convertTrack(gtr(), 'other', 960);
    expect(t.type).toBe('other');
    expect(t.name).toBe('Keys 1');
    expect(t.notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [60, 0, 960],
      [36, 960, 480],
    ]);
    expect(t.notes[0].pinnedString).toBeNull();
    expect(t.notes[0].tech).toBeUndefined();
    expect(t.tuning.strings).toEqual([]);
    expect(t.tones).toEqual([]);
    expect(t.instrument).toBe('');
  });

  it('other → guitar gets a tuning, amp tones and a pedal', () => {
    const t = convertTrack(convertTrack(gtr(), 'other', 960), 'guitar', 960);
    expect(t.tuning.strings).toHaveLength(6);
    expect(t.tones.length).toBe(2);
    expect(t.pedal.toggle[0]).toBe(t.tones[0].id);
  });

  it('guitar ↔ bass keeps the tones', () => {
    const g = gtr();
    const b = convertTrack(g, 'bass', 960);
    expect(b.tones).toBe(g.tones);
    expect(b.tuning.name).toBe('Bass Standard E');
  });

  it('to and from drums maps through General MIDI drum numbers', () => {
    const d = convertTrack(gtr(), 'drums', 960);
    expect(d.notes).toEqual([]);
    expect(d.hits.map((h) => `${h.piece}:${h.articulation}`)).toEqual(['snare:center', 'kick:right']); // 60 has no lane → snare
    const back = convertTrack(d, 'other', 960);
    expect(back.notes.map((n) => n.pitch)).toEqual([38, 36]);
    expect(back.hits).toEqual([]);
  });
});
