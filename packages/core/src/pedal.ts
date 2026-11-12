import type { Id, Pedal, Stomp, Tone, Track } from './model';

export interface PedalSegment {
  start: number;
  end: number;
  toneId: Id;
  /** The stomp that starts this segment (undefined for the first segment). */
  stompId?: Id;
}

const sortStomps = (s: readonly Stomp[]) => [...s].sort((a, b) => a.tick - b.tick);

/** Tone that a stomp switches to, given the tone that was active before it. */
export function nextTone(pedal: Pedal, current: Id, stomp: Stomp): Id {
  if (pedal.mode === 'advanced' && stomp.toneId) return stomp.toneId;
  const [a, b] = pedal.toggle;
  return current === a ? b : a;
}

/** Colored segments of the pedal lane from tick 0 to `end`. */
export function pedalSegments(pedal: Pedal, end: number): PedalSegment[] {
  const out: PedalSegment[] = [];
  let tone = pedal.startTone;
  let start = 0;
  let stompId: Id | undefined;
  for (const s of sortStomps(pedal.stomps)) {
    if (s.tick <= 0 || s.tick >= end) continue;
    if (s.tick > start) out.push({ start, end: s.tick, toneId: tone, stompId });
    tone = nextTone(pedal, tone, s);
    start = s.tick;
    stompId = s.id;
  }
  out.push({ start, end, toneId: tone, stompId });
  return out;
}

export function toneAt(pedal: Pedal, tick: number): Id {
  let tone = pedal.startTone;
  for (const s of sortStomps(pedal.stomps)) {
    if (s.tick > tick) break;
    if (s.tick > 0) tone = nextTone(pedal, tone, s);
  }
  return tone;
}

/** Tone switches in time order (what the audio engine schedules). */
export function toneChanges(pedal: Pedal): { tick: number; toneId: Id }[] {
  const out = [{ tick: 0, toneId: pedal.startTone }];
  let tone = pedal.startTone;
  for (const s of sortStomps(pedal.stomps)) {
    if (s.tick <= 0) continue;
    tone = nextTone(pedal, tone, s);
    out.push({ tick: s.tick, toneId: tone });
  }
  return out;
}

export function toneById(track: Track, id: Id): Tone | undefined {
  return track.tones.find((t) => t.id === id);
}
