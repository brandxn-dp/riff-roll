/** Scales for the piano roll's row shading and "snap to scale". The root comes from the song's key signature. */
import type { Song } from './model';

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** Pitch class of the key's tonic: C major / A minor = 0 sharps; each sharp moves the major tonic up a fifth. */
export function keyTonic(keySig: Song['keySig']): number {
  const major = (((keySig.fifths * 7) % 12) + 12) % 12;
  return keySig.minor ? (major + 9) % 12 : major;
}

export interface SongScale {
  tonic: number;
  name: string;
  /** pitch classes in the scale */
  pcs: Set<number>;
}

/** The song's scale: its own scale type if set, otherwise major/minor from the key signature. */
export function songScale(song: Pick<Song, 'keySig' | 'scale'>): SongScale {
  const name = song.scale && SCALES[song.scale] ? song.scale : song.keySig.minor ? 'minor' : 'major';
  const tonic = keyTonic(song.keySig);
  return { tonic, name, pcs: new Set(SCALES[name].map((i) => (tonic + i) % 12)) };
}

export const inScale = (pitch: number, s: SongScale) => s.pcs.has(((pitch % 12) + 12) % 12);

/** The next scale note above (dir 1) or below (dir -1). */
export function stepInScale(pitch: number, dir: 1 | -1 | number, s: SongScale): number {
  let p = pitch;
  for (let i = 0; i < 12; i++) {
    p += dir > 0 ? 1 : -1;
    if (inScale(p, s)) return p;
  }
  return pitch + (dir > 0 ? 1 : -1);
}

/** The nearest scale note (ties go down). */
export function snapToScale(pitch: number, s: SongScale): number {
  if (inScale(pitch, s)) return pitch;
  for (let d = 1; d < 12; d++) {
    if (inScale(pitch - d, s)) return pitch - d;
    if (inScale(pitch + d, s)) return pitch + d;
  }
  return pitch;
}
