import { describe, expect, it } from 'vitest';
import { makeTrack, newSong, songToAlphaTex, type Note } from '@riffroll/core';
import { exportGp7, importScoreBytes } from './importScore';

const notes: Note[] = [
  { id: 'a', pitch: 60, start: 0, duration: 960, velocity: 90 },
  { id: 'b', pitch: 64, start: 960, duration: 960, velocity: 90 },
];

describe('Guitar Pro import: keyboard tracks', () => {
  it('a piano track round-trips as an "other" track, a guitar stays a guitar', () => {
    const s = newSong('GP keys');
    const keys = { ...makeTrack('other', 'Piano', '#fff'), notes };
    const gtr = { ...makeTrack('guitar', 'Rhythm', '#f00'), notes };
    const back = importScoreBytes(exportGp7(songToAlphaTex({ ...s, bars: 1, tracks: [gtr, keys] }).tex)).song;
    expect(back.tracks.map((t) => [t.name, t.type])).toEqual([
      ['Rhythm', 'guitar'],
      ['Piano', 'other'],
    ]);
    expect(back.tracks[1].notes.map((n) => n.pitch)).toEqual([60, 64]);
  });

  it('a track named Keys is "other" even when Guitar Pro gave it a guitar tuning', () => {
    const s = newSong('GP keys 2');
    const keys = { ...makeTrack('guitar', 'Keys 1', '#fff'), notes };
    const back = importScoreBytes(exportGp7(songToAlphaTex({ ...s, bars: 1, tracks: [keys] }).tex)).song;
    expect(back.tracks[0].type).toBe('other');
  });
});
