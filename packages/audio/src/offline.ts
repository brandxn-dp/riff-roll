/**
 * Offline export: renders the song through exactly the same graph as live playback (samplers → amp chains →
 * mixer → master bus) with an OfflineAudioContext. Used for the WAV mix and per-track stems.
 */
import { TempoMap, laneById, playbackSegments, toneAt, type Song } from '@riffroll/core';
import type { InstrumentLibrary } from './instruments';
import { MasterBus, TrackGraph, audibleTracks } from './graph';
import { newPerfState, scheduleTrack } from './perform';
import type { Sampler } from './sampler';

export interface RenderOptions {
  sampleRate?: number;
  /** render only this track (stems); otherwise the normal mix with mute/solo */
  onlyTrack?: string;
  /** decoded user IRs (cab.ir = "user:<name>") */
  userIRs?: Map<string, AudioBuffer>;
  gateWorkletUrl?: string;
  tail?: number; // seconds of release/reverb after the last bar
  onProgress?: (fraction: number) => void;
}

export async function renderSong(
  song: Song,
  lib: InstrumentLibrary,
  o: RenderOptions = {},
): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? 44100;
  const tempo = new TempoMap(song.tempos, song.ppq);
  const segments = playbackSegments(song);
  let total = 0;
  const timed = segments.map((sg) => {
    const t = total;
    total += tempo.tickToSeconds(sg.end) - tempo.tickToSeconds(sg.start);
    return { ...sg, time: t };
  });
  const seconds = total + (o.tail ?? 2.5);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  let gate = false;
  if (o.gateWorkletUrl) {
    try {
      await ctx.audioWorklet.addModule(o.gateWorkletUrl);
      gate = true;
    } catch {
      /* render without the gate */
    }
  }
  const master = new MasterBus(ctx, ctx.destination);
  const audible = o.onlyTrack ? new Set([o.onlyTrack]) : audibleTracks(song);
  const tracks = song.tracks.filter((t) => audible.has(t.id));
  const graphs = new Map<string, TrackGraph>();
  const samplers = new Map<string, Sampler>();
  for (const t of tracks) {
    const g = new TrackGraph(ctx, t, master, gate, (name) => o.userIRs?.get(name));
    g.update(t, true);
    graphs.set(t.id, g);
    const s = await lib.sampler(t.instrument, t.type);
    const pitches =
      t.type === 'drums'
        ? t.hits.map((h) => laneById.get(`${h.piece}:${h.articulation}`)?.key ?? 0)
        : t.notes.map((n) => n.pitch);
    await s.preload(pitches);
    samplers.set(t.id, s);
  }
  await master.ready;
  await Promise.all([...graphs.values()].map((g) => g.ready()));

  for (const t of tracks) {
    const g = graphs.get(t.id)!;
    const perf = newPerfState();
    for (const sg of timed) {
      const timeOf = (tick: number) => sg.time + tempo.tickToSeconds(tick) - tempo.tickToSeconds(sg.start);
      if (t.type !== 'drums') g.setTone(toneAt(t.pedal, sg.start), sg.time, sg === timed[0] ? 0 : 0.01);
      scheduleTrack(ctx, t, samplers.get(t.id), g, sg.start, sg.end, timeOf, perf, song.humanize);
    }
  }
  if (o.onProgress) {
    const step = Math.max(2, seconds / 50);
    for (let t = step; t < seconds; t += step) {
      const at = t;
      ctx.suspend(at).then(() => {
        o.onProgress!(at / seconds);
        void ctx.resume();
      });
    }
  }
  const buf = await ctx.startRendering();
  o.onProgress?.(1);
  return buf;
}
