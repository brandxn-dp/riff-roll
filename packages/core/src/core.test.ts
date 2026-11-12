import { describe, expect, it } from 'vitest';
import { TempoMap } from './tempo';
import { BarMap } from './timesig';
import { pedalSegments, toneAt, toneChanges } from './pedal';
import { History } from './history';
import {
  addNotes,
  addStomp,
  removeNotes,
  removeStomp,
  removeTone,
  setBars,
  setTempos,
  setTuning,
  updateNotes,
  updateTrack,
} from './commands';
import { exampleRiff, newSong } from './templates';
import { parseSong } from './schema';
import { trackFingering } from './derived';
import { PPQ, type Pedal } from './model';
import { stringColor, tuningByName } from './tunings';

describe('tempo map', () => {
  it('constant tempo', () => {
    const m = new TempoMap([{ tick: 0, bpm: 120 }]);
    expect(m.tickToSeconds(PPQ)).toBeCloseTo(0.5);
    expect(m.secondsToTick(2)).toBeCloseTo(PPQ * 4);
  });
  it('tempo change', () => {
    const m = new TempoMap([
      { tick: 0, bpm: 120 },
      { tick: PPQ * 4, bpm: 60 },
    ]);
    expect(m.tickToSeconds(PPQ * 4)).toBeCloseTo(2);
    expect(m.tickToSeconds(PPQ * 5)).toBeCloseTo(3);
    expect(m.secondsToTick(3)).toBeCloseTo(PPQ * 5);
  });
  it('linear ramp is exact and invertible', () => {
    const m = new TempoMap([
      { tick: 0, bpm: 60, ramp: true },
      { tick: PPQ * 4, bpm: 120 },
    ]);
    // ∫ 60/(960*bpm) over a 60→120 ramp of 4 beats = 4 * ln(2) seconds
    expect(m.tickToSeconds(PPQ * 4)).toBeCloseTo(4 * Math.log(2), 6);
    expect(m.bpmAt(PPQ * 2)).toBeCloseTo(90);
    for (const t of [0, 100, 1234, 3000, PPQ * 4, PPQ * 9])
      expect(m.secondsToTick(m.tickToSeconds(t))).toBeCloseTo(t, 4);
  });
});

describe('bar map', () => {
  it('handles time signature changes', () => {
    const b = new BarMap([
      { bar: 0, num: 4, den: 4 },
      { bar: 2, num: 7, den: 8 },
    ]);
    expect(b.barStart(2)).toBe(PPQ * 8);
    expect(b.bar(2).length).toBe(PPQ * 3.5);
    expect(b.barStart(3)).toBe(PPQ * 11.5);
    expect(b.barAtTick(PPQ * 11.6).index).toBe(3);
    expect(b.format(PPQ * 9)).toBe('3.3');
  });
});

describe('pedal', () => {
  const pedal: Pedal = {
    mode: 'simple',
    startTone: 'clean',
    toggle: ['clean', 'dist'],
    stomps: [
      { id: 's2', tick: 2000 },
      { id: 's1', tick: 1000 },
    ],
  };
  it('simple mode toggles', () => {
    expect(toneAt(pedal, 0)).toBe('clean');
    expect(toneAt(pedal, 1000)).toBe('dist');
    expect(toneAt(pedal, 2500)).toBe('clean');
    expect(pedalSegments(pedal, 3000).map((s) => [s.start, s.end, s.toneId])).toEqual([
      [0, 1000, 'clean'],
      [1000, 2000, 'dist'],
      [2000, 3000, 'clean'],
    ]);
  });
  it('advanced mode names the tone', () => {
    const p: Pedal = { ...pedal, mode: 'advanced', stomps: [{ id: 'a', tick: 500, toneId: 'lead' }] };
    expect(toneChanges(p)).toEqual([
      { tick: 0, toneId: 'clean' },
      { tick: 500, toneId: 'lead' },
    ]);
  });
});

describe('history / commands', () => {
  it('undo and redo every kind of edit', () => {
    const song = newSong();
    const g = song.tracks[1];
    const h = new History(song);
    h.execute(addNotes(g.id, [{ id: 'a', pitch: 40, start: 0, duration: 480, velocity: 100 }]));
    h.execute(addStomp(g.id, { id: 'st', tick: 960 }));
    h.execute(setTempos([{ tick: 0, bpm: 140 }]));
    h.execute(updateTrack(g.id, { volume: 0.5, name: 'Rhythm' }));
    expect(h.song.tracks[1].notes).toHaveLength(1);
    expect(h.song.tracks[1].pedal.stomps).toHaveLength(1);
    expect(h.song.tempos[0].bpm).toBe(140);
    h.undo();
    expect(h.song.tracks[1].name).toBe('Guitar 1');
    h.undo();
    expect(h.song.tempos[0].bpm).toBe(120);
    h.undo();
    expect(h.song.tracks[1].pedal.stomps).toHaveLength(0);
    h.undo();
    expect(h.song).toBe(song);
    expect(h.undo()).toBe(false);
    h.redo();
    h.redo();
    expect(h.song.tracks[1].pedal.stomps).toHaveLength(1);
    h.execute(removeStomp(g.id, 'st'));
    expect(h.canRedo).toBe(false);
  });

  it('transactions group a drag into one undo step', () => {
    const song = newSong();
    const g = song.tracks[1].id;
    const h = new History(song);
    h.execute(addNotes(g, [{ id: 'a', pitch: 40, start: 0, duration: 480, velocity: 100 }]));
    h.begin('Move note');
    for (let i = 1; i <= 10; i++) h.execute(updateNotes(g, { a: { start: i * 120 } }));
    h.commit();
    expect(h.song.tracks[1].notes[0].start).toBe(1200);
    h.undo();
    expect(h.song.tracks[1].notes[0].start).toBe(0);
    h.undo();
    expect(h.song.tracks[1].notes).toHaveLength(0);
  });

  it('no-op commands do not create history entries', () => {
    const h = new History(newSong());
    h.execute(removeNotes('nope', ['x']));
    expect(h.canUndo).toBe(false);
  });

  it('setBars trims events past the end; undo restores them', () => {
    let s = newSong();
    const g = s.tracks[1];
    s = { ...s, tracks: s.tracks.map((t) => (t.id === g.id ? exampleRiff(t) : t)) };
    const h = new History(s);
    h.execute(setBars(2));
    expect(h.song.tracks[1].notes.every((n) => n.start < PPQ * 8)).toBe(true);
    expect(h.song.tracks[1].pedal.stomps).toHaveLength(0);
    h.undo();
    expect(h.song.tracks[1].notes.length).toBe(s.tracks[1].notes.length);
  });

  it('changing the tuning re-runs fingering (derived, never stored)', () => {
    const s = newSong();
    const g = s.tracks[1];
    const h = new History(s);
    h.execute(addNotes(g.id, [{ id: 'd', pitch: 38, start: 0, duration: 480, velocity: 100 }]));
    expect(trackFingering(h.song.tracks[1]).get('d')).toBeNull(); // D2 unplayable in Standard E
    h.execute(setTuning(g.id, tuningByName('Drop D')!));
    expect(trackFingering(h.song.tracks[1]).get('d')).toEqual({ string: 0, fret: 0 });
  });

  it('removing a tone re-points the pedal at a remaining tone', () => {
    const s = newSong();
    const g = s.tracks[1];
    const dist = g.tones[1].id;
    const h = new History(s);
    h.execute(removeTone(g.id, dist));
    const p = h.song.tracks[1].pedal;
    expect(p.toggle).toEqual([g.tones[0].id, g.tones[0].id]);
  });
});

describe('schema', () => {
  it('round-trips a new song through JSON', () => {
    const s = newSong('Test');
    const t = { ...s, tracks: s.tracks.map((x) => (x.type === 'guitar' ? exampleRiff(x) : x)) };
    expect(parseSong(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });
  it('rejects garbage with a readable message', () => {
    expect(() => parseSong({ schemaVersion: 1, title: 3 })).toThrow(/Invalid song file/);
    expect(() => parseSong({ schemaVersion: 99 })).toThrow(/newer version/);
  });
});

describe('string colours', () => {
  it('7-string adds a colour below red, bass matches guitar roles', () => {
    expect(stringColor('guitar', 6, 0)).toBe('#ff5a5a');
    expect(stringColor('guitar', 7, 1)).toBe('#ff5a5a');
    expect(stringColor('guitar', 7, 0)).not.toBe('#ff5a5a');
    expect(stringColor('bass', 4, 0)).toBe('#ff5a5a');
    expect(stringColor('bass', 5, 1)).toBe('#ff5a5a');
  });
});
