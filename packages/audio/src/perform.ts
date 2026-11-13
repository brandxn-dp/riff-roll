import {
  BarMap,
  isFretted,
  laneById,
  toneChanges,
  trackFingering,
  type Note,
  type Position,
  type Song,
  type Track,
} from '@riffroll/core';
import type { Sampler, Voice } from './sampler';
import type { TrackGraph } from './graph';

/** Per-track playing state: what each string is currently sounding (for string-aware cutoff). */
export interface TrackPerfState {
  strings: Map<number, { voices: Voice[]; letRing: boolean; pitch?: number }>;
  voices: Voice[];
}

export const newPerfState = (): TrackPerfState => ({ strings: new Map(), voices: [] });

/** Let ring: a note keeps sounding past its written length, up to this, unless its string is played again. */
const LET_RING_MAX = 6;

export interface Humanize {
  timingMs: number;
  velocity: number;
}

/** Natural harmonic at a fret → semitones above the open string. */
const NATURAL_HARMONICS: Record<number, number> = {
  12: 12,
  24: 24,
  7: 19,
  19: 19,
  5: 24,
  4: 28,
  9: 28,
  16: 28,
  3: 31,
  2: 34,
};

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
  /** the sampler of a sampled tone (a tone with its own instrument), if any */
  toneSampler?: (toneId: string) => Sampler | undefined,
) {
  if (isFretted(track.type)) {
    for (const ch of toneChanges(track.pedal))
      if (ch.tick > 0 && ch.tick >= t0 && ch.tick < t1) graph.setTone(ch.toneId, timeOf(ch.tick));
  }
  if (!sampler) return;
  if (track.type === 'drums') return scheduleDrums(ctx, track, sampler, graph, t0, t1, timeOf, st, human);
  // which tone is on at a tick (for sampled tones)
  const changes = toneSampler && isFretted(track.type) ? toneChanges(track.pedal) : null;
  const toneAtTick = (tick: number) => {
    let id = changes![0].toneId;
    for (const c of changes!) if (c.tick <= tick) id = c.toneId;
    return id;
  };
  // strings matter for guitar and bass only (a new note on a string cuts the last one)
  const fing = isFretted(track.type) ? trackFingering(track) : new Map<string, Position | null>();
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
    const vel = Math.max(
      1,
      Math.min(127, n.velocity + (human.velocity ? Math.round((Math.random() * 2 - 1) * human.velocity) : 0)),
    );

    const tech = n.tech ?? {};
    // a new note on a string cuts whatever that string was sounding, let ring or not (let ring only means the
    // note isn't stopped at its written length)
    const prev = pos ? st.strings.get(pos.string) : undefined;
    if (prev) for (const v of prev.voices) if (v.end > when) v.stop(when);

    // a sampled tone plays its own instrument straight into its chain; otherwise the DI goes to the amp
    const toneId = changes ? toneAtTick(n.start) : undefined;
    const own = toneId ? toneSampler!(toneId) : undefined;
    const smp = own ?? sampler;
    const dest = own
      ? graph.inputFor(toneId, when + dur + (tech.letRing ? LET_RING_MAX : 0) + 0.5)
      : graph.input;

    // pitch actually heard (harmonics sound above the fretted pitch)
    let pitch = n.pitch;
    if (tech.harmonic && pos) {
      const open = n.pitch - pos.fret;
      if (tech.harmonic === 'natural') pitch = open + (NATURAL_HARMONICS[pos.fret] ?? pos.fret + 12);
      else if (tech.harmonic === 'pinch') pitch = n.pitch + 19;
      else pitch = n.pitch + 12; // artificial / tapped: octave harmonic
    }
    const legato = !!(
      tech.hammer ||
      tech.tap ||
      ((tech.slide === 'legato' || tech.slide === 'shift') && prev)
    );
    const detune = detuneFor(n, when, dur) ?? [];
    if (
      (tech.slide === 'legato' || tech.slide === 'shift') &&
      prev?.pitch != null &&
      prev.pitch !== n.pitch
    ) {
      // slide: glide from the previous pitch on this string
      const glide = Math.min(0.09, dur * 0.5);
      detune.unshift(
        { time: when, cents: (prev.pitch - n.pitch) * 100 },
        { time: when + glide, cents: 0, ramp: true },
      );
    }
    // an instrument with real palm-mute / legato / up- and down-stroke samples picks them by velocity; the note's
    // own velocity then only sets the volume (and the faked palm mute and legato softening are not needed)
    const art = smp.articulations;
    const layer = art
      ? tech.palmMute
        ? art.palmMute
        : legato
          ? art.legato
          : tech.pick === 'up'
            ? (art.up ?? art.down)
            : (art.down ?? art.up)
      : undefined;
    const base = {
      pitch,
      palmMute: layer && tech.palmMute ? false : tech.palmMute,
      dead: tech.dead,
      fadeIn: tech.fadeIn ? Math.min(dur, 0.6) : legato && !layer ? 0.006 : undefined,
      gain:
        (tech.ghost ? 0.5 : tech.accent === 'heavy' ? 1.4 : tech.accent ? 1.25 : 1) *
        (legato && !layer ? 0.72 : 1),
      harmonic: !!tech.harmonic,
      detune: detune.length ? detune : undefined,
    };
    const v = Math.max(1, vel - (tech.pick === 'up' ? 8 : 0));
    // the layer's velocity, keeping the note's dynamics inside the layer
    const pickVel = (x: number) => (layer ? Math.round(layer[0] + ((layer[1] - layer[0]) * x) / 127) : x);
    const gainVel = layer ? { gainVelocity: v } : {};
    const sounding = tech.staccato ? dur * 0.45 : dur;
    let voices: Voice[] = [];
    if (tech.tremolo || tech.trill) {
      // re-articulate the note at the tremolo/trill rate for its whole length
      const rate = tech.tremolo ?? tech.trill!.speed;
      const step = timeOf(n.start + 3840 / rate) - timeOf(n.start);
      const count = Math.max(1, Math.floor(dur / Math.max(0.03, step)));
      for (let k = 0; k < count; k++) {
        const trillUp = tech.trill && k % 2 === 1 && pos ? n.pitch - pos.fret + tech.trill.fret - n.pitch : 0;
        voices.push(
          ...smp.play(ctx, dest, {
            ...base,
            ...gainVel,
            pitch: pitch + trillUp,
            velocity: pickVel(k % 2 ? v * 0.85 : v),
            when: when + k * step,
            duration: step * 0.95,
          }),
        );
      }
    } else {
      voices = smp.play(ctx, dest, {
        ...base,
        ...gainVel,
        velocity: pickVel(v),
        when,
        // let ring: past the written length (until the string is played again), but never forever: a sustaining
        // sample would otherwise ring on and pile up until playback stops
        duration: tech.letRing ? Math.max(sounding, LET_RING_MAX) : sounding,
      });
    }
    if (pos) st.strings.set(pos.string, { voices, letRing: !!tech.letRing, pitch: n.pitch });
    st.voices.push(...voices);
  }
  if (st.voices.length > 512) st.voices = st.voices.filter((v) => v.end > ctx.currentTime);
}

/** Mic balance for kits with close/overhead samples (regions tagged riffroll_mic=close|oh). */
export function micGain(track: Track) {
  const m = track.drumMics ?? { close: 1, oh: 1 };
  return (r: { raw: Record<string, string> }) =>
    r.raw.riffroll_mic === 'oh' ? m.oh : r.raw.riffroll_mic === 'close' ? m.close : 1;
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
  if (lane.flam)
    out.push(
      ...sampler.play(ctx, dest, {
        pitch: lane.key,
        velocity: vel * 0.55,
        when: Math.max(ctx.currentTime, when - lane.flam),
        gain: piece,
        regionGain,
      }),
    );
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
    st.voices.push(
      ...playDrum(
        ctx,
        track,
        sampler,
        graph.input,
        `${h.piece}:${h.articulation}`,
        vel,
        Math.max(ctx.currentTime, timeOf(h.start) + jitter),
      ),
    );
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
