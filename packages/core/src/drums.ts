import type { DrumPiece } from './model';

/** One row of the drum grid: a kit piece + articulation, with its General MIDI note for import/export. */
export interface DrumLane {
  key: string; // `${piece}:${articulation}`
  piece: DrumPiece;
  articulation: string;
  label: string;
  gm: number;
  /** Choke group: a hit in a lane silences ringing hits from lanes with the same group (hi-hat, cymbal chokes). */
  choke?: string;
}

const L = (piece: DrumPiece, articulation: string, label: string, gm: number, choke?: string): DrumLane => ({
  key: `${piece}:${articulation}`,
  piece,
  articulation,
  label,
  gm,
  choke,
});

/** Lanes top to bottom, cymbals first like most drum editors. */
export const DRUM_LANES: DrumLane[] = [
  L('crash1', 'hit', 'Crash 1', 49, 'crash1'),
  L('crash1', 'choke', 'Crash 1 choke', 49, 'crash1'),
  L('crash2', 'hit', 'Crash 2', 57, 'crash2'),
  L('crash2', 'choke', 'Crash 2 choke', 57, 'crash2'),
  L('china', 'hit', 'China', 52, 'china'),
  L('splash', 'hit', 'Splash', 55, 'splash'),
  L('ride', 'bow', 'Ride', 51, 'ride'),
  L('ride', 'bell', 'Ride bell', 53, 'ride'),
  L('hihat', 'open', 'Hi-hat open', 46, 'hihat'),
  L('hihat', 'half', 'Hi-hat half-open', 46, 'hihat'),
  L('hihat', 'closed', 'Hi-hat closed', 42, 'hihat'),
  L('hihat', 'pedal', 'Hi-hat pedal', 44, 'hihat'),
  L('tom1', 'hit', 'Tom 1', 50),
  L('tom2', 'hit', 'Tom 2', 48),
  L('tom3', 'hit', 'Floor tom 1', 43),
  L('tom4', 'hit', 'Floor tom 2', 41),
  L('snare', 'center', 'Snare', 38),
  L('snare', 'rimshot', 'Snare rimshot', 40),
  L('snare', 'ghost', 'Snare ghost', 38),
  L('snare', 'crossstick', 'Cross-stick', 37),
  L('snare', 'flam', 'Snare flam', 38),
  L('kick', 'right', 'Kick', 36),
  L('kick', 'left', 'Kick 2 (double)', 35),
];

export const laneKey = (piece: DrumPiece, articulation: string) => `${piece}:${articulation}`;
export const laneByKey = new Map(DRUM_LANES.map((l) => [l.key, l]));

export function laneForGm(note: number): DrumLane | undefined {
  // prefer the "main" articulation when several lanes share a GM note
  return DRUM_LANES.find((l) => l.gm === note && !['choke', 'ghost', 'flam', 'half'].includes(l.articulation));
}
