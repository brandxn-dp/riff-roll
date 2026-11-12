import { describe, expect, it } from 'vitest';
import { NoteRecorder, channelToString } from './recorder';

describe('note recorder', () => {
  it('pairs note on/off into notes and quantizes', () => {
    const r = new NoteRecorder({ quantize: 240 });
    r.noteOn(40, 100, 250);
    r.noteOn(47, 90, 245);
    expect(r.held).toBe(2);
    const a = r.noteOff(40, 700)!;
    expect([a.pitch, a.start, a.duration, a.velocity]).toEqual([40, 240, 480, 100]);
    expect(r.noteOff(41, 700)).toBeNull();
    const rest = r.flush(1000);
    expect(rest.map((n) => [n.pitch, n.start])).toEqual([[47, 240]]);
    expect(r.held).toBe(0);
  });
  it('unquantized notes keep their timing with a minimum length', () => {
    const n = new NoteRecorder({ minLength: 60 });
    n.noteOn(60, 80, 1003);
    expect(n.noteOff(60, 1010)).toMatchObject({ start: 1003, duration: 60 });
  });
  it('MIDI guitar: channel 1 is the high string and pins the note', () => {
    expect(channelToString(0, 6)).toBe(5);
    expect(channelToString(5, 6)).toBe(0);
    expect(channelToString(9, 6)).toBeNull();
    const r = new NoteRecorder({ stringCount: 6 });
    r.noteOn(45, 100, 0, 4); // channel 5 = A string
    expect(r.noteOff(45, 480, 4)!.pinnedString).toBe(1);
  });
});
