import { BarMap, laneById, toneChanges, trackFingering, type Note, type Song, type Track } from '@riffroll/core';
import type { Sampler, Voice } from './sampler';
import type { TrackGraph } from './graph';

/** Per-track playing state: what each string is currently sounding (for string-aware cutoff). */
export interface TrackPerfState {
  strings: Map<number, { voices: Voice[]; letRing: boolean }>;
  voices: Voice[];
}

export const newPerfState = (): TrackPerfState => ({ strings: new Map(), voices: [] });

export interface Humanize {
  timingMs: number;
  velocity: number;
}

/** first index with start >= tick */
function lb(notes: readonly Note[], tick: number) {
  let lo = 0,
    hi = notes.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (notes[m].start < tick) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * Schedule every note of `track` that starts in [t0, t1) and every stomp in that range.
 * `timeOf(tick)` maps song ticks to context time; `secPerTick` is used for durations at that position.
 */
export function scheduleTrack(
  ctx: BaseAudioContext,
  track: Track,
  sampler: Sampler | undefined,
  graph: TrackGraph,
  t0: number,
  t1: number,
  timeOf: (tick: number) => number,
  st: TrackPerfState,
  human: Humanize,
) {
  if (track.type !== 'drums') {
    for (const ch of toneChanges(track.pedal)) if (ch.tick > 0 && ch.tick >= t0 && ch.tick < t1) graph.setTone(ch.toneId, timeOf(ch.tick));
  }
  if (!sampler) return;
  if (track.type === 'drums') return scheduleDrums(ctx, track, sampler, graph, t0, t1, timeOf, st, human);
  const fing = trackFingering(track);
  const notes = track.notes;
  for (let i = lb(notes, t0); i < notes.length && notes[i].start < t1; i++) {
    const n = notes[i];
    if (n.tech?.tieFromPrevious) continue; // tied: the previous note keeps sounding
    const pos = fing.get(n.id);
    const jitter = human.timingMs ? ((Math.random() * 2 - 1) * human.timingMs) / 1000 : 0;
    const when = Math.max(ctx.currentTime, timeOf(n.start) + jitter);
    // tied continuation extends the sounding length
    let endTick = n.start + n.duration;
    for (let j = i + 1; j < notes.length && notes[j].start <= endTick; j++)
      if (notes[j].tech?.tieFromPrevious && notes[j].pitch === n.pitch && notes[j].start === endTick)
        endTick = notes[j].start + notes[j].duration;
    const dur = Math.max(0.02, timeOf(endTick) - timeOf(n.start));
    const vel = Math.max(1, Math.min(127, n.velocity + (human.velocity ? Math.round((Math.random() * 2 - 1) * human.velocity) : 0)));

    // a new note on a string cuts the previous note on that string, unless it was let ring
    if (pos) {
      const prev = st.strings.get(pos.string);
      if (prev && !prev.letRing) for (const v of prev.voices) if (v.end > when) v.stop(when);
    }
    const voices = sampler.play(ctx, graph.input, {
      pitch: n.pitch,
      velocity: vel,
      when,
      duration: n.tech?.letRing ? undefined : dur,
      palmMute: n.tech?.palmMute,
      dead: n.tech?.dead,
      fadeIn: n.tech?.fadeIn ? Math.min(dur, 0.6) : undefined,
      gain: n.tech?.ghost ? 0.5 : n.tech?.accent ? 1.25 : 1,
      harmonic: n.tech?.harmonic === 'natural' || n.tech?.harmonic === 'artificial',
      detune: detuneFor(n, when, dur),
    });
    if (pos) st.strings.set(pos.string, { voices, letRing: !!n.tech?.letRing });
    st.voices.push(...voices);
  }
  if (st.voices.length > 512) st.voices = st.voices.filter((v) => v.end > ctx.currentTime);
}

/** Mic balance for kits with close/overhead samples (regions tagged riffroll_mic=close|oh). */
export function micGain(track: Track) {
  const m = track.drumMics ?? { close: 1, oh: 1 };
  return (r: { raw: Record<string, string> }) => (r.raw.riffroll_mic === 'oh' ? m.oh : r.raw.riffroll_mic === 'close' ? m.close : 1);
}

/** Play one drum lane hit (also used for previews in the drum grid). */
export function playDrum(
  ctx: BaseAudioContext,
  track: Track,
  sampler: Sampler,
  dest: AudioNode,
  laneId: string,
  velocity: number,
  when: number,
): Voice[] {
  const lane = laneById.get(laneId);
  if (!lane) return [];
  const piece = track.drumMix?.[lane.piece] ?? 1;
  const regionGain = micGain(track);
  const vel = Math.max(1, Math.min(127, Math.round(velocity * (lane.velScale ?? 1))));
  const out: Voice[] = [];
  if (lane.flam) out.push(...sampler.play(ctx, dest, { pitch: lane.key, velocity: vel * 0.55, when: Math.max(ctx.currentTime, when - lane.flam), gain: piece, regionGain }));
  out.push(...sampler.play(ctx, dest, { pitch: lane.key, velocity: vel, when, gain: piece, regionGain }));
  return out;
}

function scheduleDrums(
  ctx: BaseAudioContext,
  track: Track,
  sampler: Sampler,
  graph: TrackGraph,
  t0: number,
  t1: number,
  timeOf: (tick: number) => number,
  st: TrackPerfState,
  human: Humanize,
) {
  const hits = track.hits;
  let lo = 0,
    hi = hits.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (hits[m].start < t0) lo = m + 1;
    else hi = m;
  }
  for (let i = lo; i < hits.length && hits[i].start < t1; i++) {
    const h = hits[i];
    const jitter = human.timingMs ? ((Math.random() * 2 - 1) * human.timingMs) / 1000 : 0;
    const vel = h.velocity + (human.velocity ? Math.round((Math.random() * 2 - 1) * human.velocity) : 0);
    st.voices.push(...playDrum(ctx, track, sampler, graph.input, `${h.piece}:${h.articulation}`, vel, Math.max(ctx.currentTime, timeOf(h.start) + jitter)));
  }
}

/** Bends, vibrato and whammy as pitch automation on the playing voice. */
function detuneFor(n: Note, when: number, dur: number) {
  const pts: { time: number; cents: number; ramp?: boolean }[] = [];
  const curve = n.tech?.bend ?? n.tech?.whammy;
  if (curve?.length) {
    pts.push({ time: when, cents: curve[0].value * 100 });
    for (const p of curve.slice(1)) pts.push({ time: when + p.pos * dur, cents: p.value * 100, ramp: true });
  }
  if (n.tech?.vibrato) {
    const depth = n.tech.vibrato === 'wide' ? 45 : 22;
    const rate = 5.5;
    const start = when + Math.min(0.12, dur * 0.25);
    for (let t = start, k = 0; t < when + dur; t += 1 / rate / 2, k++)
      pts.push({ time: t, cents: k % 2 ? -depth : depth, ramp: true });
  }
  if (n.tech?.slide === 'in-below' || n.tech?.slide === 'in-above') {
    const from = n.tech.slide === 'in-below' ? -300 : 300;
    pts.unshift({ time: when, cents: from }, { time: when + Math.min(0.08, dur / 3), cents: 0, ramp: true });
  }
  if (n.tech?.slide === 'out-down' || n.tech?.slide === 'out-up') {
    const to = n.tech.slide === 'out-down' ? -700 : 700;
    pts.push({ time: when + dur * 0.6, cents: 0 }, { time: when + dur, cents: to, ramp: true });
  }
  return pts.length ? pts : undefined;
}

/** Metronome clicks for beats in [t0, t1). Downbeats are accented. */
export function scheduleClicks(
  ctx: BaseAudioContext,
  song: Song,
  dest: AudioNode,
  t0: number,
  t1: number,
  timeOf: (tick: number) => number,
  volume: number,
) {
  const bm = new BarMap(song.timeSigs, song.ppq);
  for (let b = bm.barAtTick(Math.max(0, t0)).index; ; b++) {
    const bar = bm.bar(b);
    if (bar.start >= t1) break;
    const beat = (song.ppq * 4) / bar.den;
    for (let k = 0; k < bar.num; k++) {
      const tick = bar.start + k * beat;
      if (tick < t0 || tick >= t1) continue;
      click(ctx, dest, timeOf(tick), k === 0, volume);
    }
  }
}

export function click(ctx: BaseAudioContext, dest: AudioNode, when: number, accent: boolean, volume: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(volume * (accent ? 0.5 : 0.32), when + 0.001);
  g.gain.setTargetAtTime(0, when + 0.002, 0.012);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.08);
}
