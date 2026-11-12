import type { DrumPiece } from './model';

/** One row of the drum grid: a kit piece + articulation, with its General MIDI note for import/export. */
export interface DrumLane {
  id: string; // `${piece}:${articulation}`
  piece: DrumPiece;
  articulation: string;
  label: string;
  gm: number;
  /**
   * Key in Riff Roll's normalised drum SFZ (the fetch script writes kits to this keymap). Lanes without their own
   * samples reuse another key: ghost = snare center played softly, flam = two snare hits.
   */
  key: number;
  /** Velocity multiplier applied before triggering (ghost notes). */
  velScale?: number;
  /** Play a grace hit this many seconds before the main hit (flam). */
  flam?: number;
  /** Choke group: a hit in a lane silences ringing hits from lanes with the same group (hi-hat, cymbal chokes). */
  choke?: string;
}

const L = (
  piece: DrumPiece,
  articulation: string,
  label: string,
  gm: number,
  key: number,
  extra: Partial<DrumLane> = {},
): DrumLane => ({ id: `${piece}:${articulation}`, piece, articulation, label, gm, key, ...extra });

/** Lanes top to bottom, cymbals first like most drum editors. */
export const DRUM_LANES: DrumLane[] = [
  L('crash1', 'hit', 'Crash 1', 49, 49, { choke: 'crash1' }),
  L('crash1', 'choke', 'Crash 1 choke', 49, 24, { choke: 'crash1' }),
  L('crash2', 'hit', 'Crash 2', 57, 57, { choke: 'crash2' }),
  L('crash2', 'choke', 'Crash 2 choke', 57, 25, { choke: 'crash2' }),
  L('china', 'hit', 'China', 52, 52, { choke: 'china' }),
  L('splash', 'hit', 'Splash', 55, 55),
  L('ride', 'bow', 'Ride', 51, 51),
  L('ride', 'bell', 'Ride bell', 53, 53),
  L('hihat', 'open', 'Hi-hat open', 46, 46, { choke: 'hihat' }),
  L('hihat', 'half', 'Hi-hat half-open', 46, 26, { choke: 'hihat' }),
  L('hihat', 'closed', 'Hi-hat closed', 42, 42, { choke: 'hihat' }),
  L('hihat', 'pedal', 'Hi-hat pedal', 44, 44, { choke: 'hihat' }),
  L('tom1', 'hit', 'Tom 1', 50, 50),
  L('tom2', 'hit', 'Tom 2', 48, 48),
  L('tom3', 'hit', 'Floor tom 1', 43, 43),
  L('tom4', 'hit', 'Floor tom 2', 41, 41),
  L('snare', 'center', 'Snare', 38, 38),
  L('snare', 'rimshot', 'Snare rimshot', 40, 40),
  L('snare', 'ghost', 'Snare ghost', 38, 38, { velScale: 0.32 }),
  L('snare', 'crossstick', 'Cross-stick', 37, 37),
  L('snare', 'flam', 'Snare flam', 38, 38, { flam: 0.028 }),
  L('kick', 'right', 'Kick', 36, 36),
  L('kick', 'left', 'Kick 2 (double)', 35, 35),
];

export const laneId = (piece: DrumPiece, articulation: string) => `${piece}:${articulation}`;
export const laneById = new Map(DRUM_LANES.map((l) => [l.id, l]));

export function laneForGm(note: number): DrumLane | undefined {
  // prefer the "main" articulation when several lanes share a GM note
  return DRUM_LANES.find(
    (l) => l.gm === note && !['choke', 'ghost', 'flam', 'half'].includes(l.articulation),
  );
}
