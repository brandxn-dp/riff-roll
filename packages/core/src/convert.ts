/** Change what kind of instrument a track is (a Guitar Pro piano imported as a guitar → Other, etc.). */
import { cmd } from './commands';
import { DRUM_LANES, laneById, laneForGm } from './drums';
import { isFretted, newId, type DrumHit, type Note, type Track, type TrackType } from './model';
import { makeTrack } from './templates';

/**
 * The same track as another type. Notes are kept (pitched ↔ pitched); to or from drums, notes and hits are mapped
 * through General MIDI drum numbers. Guitar/bass get that type's default tuning, tones and pedal unless they already
 * had them; the instrument goes back to the type's default.
 */
export function convertTrack(t: Track, type: TrackType, ppq: number): Track {
  if (t.type === type) return t;
  const fresh = makeTrack(type, t.name, t.color);
  let notes: Note[] = t.notes.map((n) => ({ ...n, pinnedString: null }));
  let hits: DrumHit[] = t.hits;
  if (t.type === 'drums') {
    // hits → notes at their General MIDI pitch, a 16th long
    notes = t.hits.map((h) => ({
      id: newId('n'),
      pitch: laneById.get(`${h.piece}:${h.articulation}`)?.gm ?? 38,
      start: h.start,
      duration: ppq / 4,
      velocity: h.velocity,
    }));
    hits = [];
  }
  if (type === 'drums') {
    hits = t.notes.map((n) => {
      const lane = laneForGm(n.pitch) ?? DRUM_LANES.find((l) => l.id === 'snare:center')!;
      return {
        id: newId('h'),
        start: n.start,
        piece: lane.piece,
        articulation: lane.articulation,
        velocity: n.velocity,
      };
    });
    notes = [];
  }
  // guitar ↔ bass keeps the amp tones and pedal; anything else takes the new type's defaults
  const keepTones = isFretted(t.type) && isFretted(type);
  return {
    ...t,
    type,
    tuning: fresh.tuning,
    capo: 0,
    maxFret: fresh.maxFret,
    instrument: fresh.instrument,
    tones: keepTones ? t.tones : fresh.tones,
    pedal: keepTones ? t.pedal : fresh.pedal,
    notes: notes.map((n) => ({ ...n, tech: type === 'other' || type === 'drums' ? undefined : n.tech })),
    hits,
    drumMix: type === 'drums' ? t.drumMix : undefined,
    drumMics: type === 'drums' ? t.drumMics : undefined,
    drumComp: type === 'drums' ? t.drumComp : undefined,
  };
}

export const changeTrackType = (trackId: string, type: TrackType) =>
  cmd('Change instrument type', (s) => ({
    ...s,
    tracks: s.tracks.map((t) => (t.id === trackId ? convertTrack(t, type, s.ppq) : t)),
  }));
