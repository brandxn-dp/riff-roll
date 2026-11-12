import { describe, expect, it } from 'vitest';
import { newSong } from './templates';
import {
  barSpan,
  clearBars,
  copyBars,
  deleteBars,
  duplicateBars,
  filledBars,
  insertBars,
  pasteBars,
} from './bars';
import type { Song } from './model';

const BAR = 3840; // 4/4 at 960 PPQ

/** 8 bars; guitar: one note at the start of every bar (pitch 50 + bar); drums: a kick per bar; a stomp in bar 2. */
function song(): Song {
  const s = newSong('Bars');
  const [drums, gtr, gtr2, bass] = s.tracks;
  return {
    ...s,
    bars: 8,
    tempos: [
      { tick: 0, bpm: 120 },
      { tick: 5 * BAR, bpm: 140 },
    ],
    sections: [
      { id: 's1', tick: 0, name: 'Intro' },
      { id: 's2', tick: 4 * BAR, name: 'Verse' },
    ],
    repeats: [{ id: 'r1', startBar: 4, endBar: 5, times: 2 }],
    tracks: [
      {
        ...drums,
        hits: Array.from({ length: 8 }, (_, i) => ({
          id: `h${i}`,
          start: i * BAR,
          piece: 'kick' as const,
          articulation: 'right',
          velocity: 100,
        })),
      },
      {
        ...gtr,
        notes: Array.from({ length: 8 }, (_, i) => ({
          id: `n${i}`,
          pitch: 50 + i,
          start: i * BAR,
          duration: 960,
          velocity: 90,
        })),
        pedal: { ...gtr.pedal, stomps: [{ id: 'st', tick: 2 * BAR + 960 }] },
      },
      gtr2,
      bass,
    ],
  };
}
const pitchesIn = (s: Song, trackIndex: number, bar: number) => {
  const { start, end } = barSpan(s, bar, bar);
  return s.tracks[trackIndex].notes.filter((n) => n.start >= start && n.start < end).map((n) => n.pitch);
};

describe('bar editing (global view)', () => {
  it('marks which bars have content', () => {
    const s = song();
    const f = filledBars(s);
    expect([...f.get(s.tracks[1].id)!].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(f.get(s.tracks[2].id)!.size).toBe(0);
  });

  it('copy + paste (overwrite) replaces the target bars, across several tracks', () => {
    const s = song();
    const ids = [s.tracks[0].id, s.tracks[1].id];
    const clip = copyBars(s, ids, 1, 2);
    expect(clip.bars).toBe(2);
    expect(clip.tracks[1].notes.map((n) => [n.pitch, n.start])).toEqual([
      [51, 0],
      [52, BAR],
    ]);
    const out = pasteBars(clip, ids, 5, false).apply(s);
    expect(pitchesIn(out, 1, 5)).toEqual([51]);
    expect(pitchesIn(out, 1, 6)).toEqual([52]);
    expect(pitchesIn(out, 1, 7)).toEqual([57]); // untouched
    expect(out.bars).toBe(8);
    expect(out.tracks[0].hits.filter((h) => h.start === 5 * BAR)).toHaveLength(1);
    // the stomp came along to the same place inside the bar
    expect(out.tracks[1].pedal.stomps.map((x) => x.tick).sort((a, b) => a - b)).toEqual([
      2 * BAR + 960,
      6 * BAR + 960,
    ]);
  });

  it('drum parts only paste onto drum tracks', () => {
    const s = song();
    const clip = copyBars(s, [s.tracks[0].id], 0, 0);
    const out = pasteBars(clip, [s.tracks[2].id], 0, false).apply(s);
    expect(out.tracks[2].hits).toHaveLength(0);
    expect(out.tracks[2].notes).toHaveLength(0);
  });

  it('pasting past the end makes the song longer', () => {
    const s = song();
    const clip = copyBars(s, [s.tracks[1].id], 0, 2);
    const out = pasteBars(clip, [s.tracks[1].id], 7, false).apply(s);
    expect(out.bars).toBe(10);
    expect(pitchesIn(out, 1, 9)).toEqual([52]);
  });

  it('insert bars moves everything after them: notes, stomps, sections, tempos, repeats', () => {
    const s = song();
    const out = insertBars(2, 2).apply(s);
    expect(out.bars).toBe(10);
    expect(pitchesIn(out, 1, 2)).toEqual([]);
    expect(pitchesIn(out, 1, 4)).toEqual([52]);
    expect(out.tracks[1].pedal.stomps[0].tick).toBe(4 * BAR + 960);
    expect(out.sections.map((x) => x.tick)).toEqual([0, 6 * BAR]);
    expect(out.tempos).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 7 * BAR, bpm: 140 },
    ]);
    expect(out.repeats[0]).toMatchObject({ startBar: 6, endBar: 7 });
  });

  it('paste (insert) recreates the copied bars’ time signatures', () => {
    const s = {
      ...song(),
      timeSigs: [
        { bar: 0, num: 4, den: 4 },
        { bar: 3, num: 3, den: 4 },
        { bar: 4, num: 4, den: 4 },
      ],
    };
    const clip = copyBars(s, [s.tracks[1].id], 3, 3); // the 3/4 bar
    const out = pasteBars(clip, [s.tracks[1].id], 0, true).apply(s);
    expect(out.timeSigs.slice(0, 2)).toEqual([
      { bar: 0, num: 3, den: 4 },
      { bar: 1, num: 4, den: 4 },
    ]);
    expect(out.bars).toBe(9);
  });

  it('delete bars removes their content and pulls the rest left', () => {
    const s = song();
    const out = deleteBars(1, 2).apply(s);
    expect(out.bars).toBe(6);
    expect(pitchesIn(out, 1, 0)).toEqual([50]);
    expect(pitchesIn(out, 1, 1)).toEqual([53]);
    expect(out.tracks[1].pedal.stomps).toEqual([]);
    expect(out.tracks[0].hits).toHaveLength(6);
    expect(out.sections.map((x) => x.tick)).toEqual([0, 2 * BAR]);
    expect(out.repeats[0]).toMatchObject({ startBar: 2, endBar: 3 });
  });

  it('deleting bars that hold a tempo change keeps the tempo that follows them', () => {
    const s = song();
    const out = deleteBars(5, 5).apply(s);
    expect(out.tempos).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 5 * BAR, bpm: 140 },
    ]);
  });

  it('never deletes the last bar', () => {
    const s = song();
    expect(deleteBars(0, 99).apply(s).bars).toBe(1);
  });

  it('clear empties bars on the chosen tracks only; a note ringing in is shortened', () => {
    const s = song();
    s.tracks[1].notes[0].duration = BAR * 2; // rings through bar 1
    const out = clearBars([s.tracks[1].id], 1, 1).apply(s);
    expect(pitchesIn(out, 1, 1)).toEqual([]);
    expect(out.tracks[1].notes[0].duration).toBe(BAR);
    expect(out.tracks[0].hits).toHaveLength(8);
  });

  it('duplicate inserts a copy right after the range', () => {
    const s = song();
    const out = duplicateBars(0, 1).apply(s);
    expect(out.bars).toBe(10);
    expect(pitchesIn(out, 1, 2)).toEqual([50]);
    expect(pitchesIn(out, 1, 3)).toEqual([51]);
    expect(pitchesIn(out, 1, 4)).toEqual([52]);
  });
});
