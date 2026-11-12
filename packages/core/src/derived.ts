import { assignFingering, openStrings, type Fingering } from './fingering';
import type { Note, Track } from './model';

/**
 * Derived data, memoised on the identity of the inputs (songs are immutable, so identity == content).
 * Views call these on every frame without re-running the engine.
 */
const fingeringCache = new WeakMap<Note[], { key: string; value: Fingering }>();

export function trackFingering(track: Track): Fingering {
  const key = `${track.tuning.strings.join(',')}|${track.capo}|${track.maxFret}`;
  const hit = fingeringCache.get(track.notes);
  if (hit && hit.key === key) return hit.value;
  const value = assignFingering(track.notes, {
    strings: openStrings(track.tuning, track.capo),
    maxFret: track.maxFret - track.capo,
  });
  fingeringCache.set(track.notes, { key, value });
  return value;
}
