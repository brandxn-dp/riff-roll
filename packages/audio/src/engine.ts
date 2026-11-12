import { BarMap, TempoMap, laneById, playbackSegments, toneAt, type Song, type Track } from '@riffroll/core';
import { InstrumentLibrary, isFallback } from './instruments';
import { MasterBus, TrackGraph, audibleTracks } from './graph';
import { newPerfState, playDrum, scheduleClicks, scheduleTrack, click, type TrackPerfState } from './perform';
import type { Sampler } from './sampler';

export interface EngineOptions {
  instrumentsUrl: string;
  /** URL of worklets/gate-processor.js (resolved by the bundler). */
  gateWorkletUrl?: string;
  onEnded?: () => void;
  onStatus?: (msg: string) => void;
}

const LOOKAHEAD = 0.12; // seconds scheduled ahead of the audio clock
const INTERVAL = 25; // ms between scheduler runs

interface PlayState {
  segStart: number; // tick where the current segment (pass through the loop) starts
  segTime: number; // context time at segStart
  segEnd: number; // tick where this segment ends (loop end or song end)
  next: number; // ticks scheduled so far
  anchors: { time: number; tick: number }[]; // for playhead mapping across loop wraps
  timer: ReturnType<typeof setInterval>;
  perf: Map<string, TrackPerfState>;
  tempo: TempoMap;
  tempos: Song['tempos'];
  endTime: number | null;
  /** segments still to play after the current one (repeats / alternate endings) */
  queue: { start: number; end: number }[];
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly lib: InstrumentLibrary;
  private master: MasterBus;
  private graphs = new Map<string, TrackGraph>();
  private samplers = new Map<string, Sampler>();
  private samplerKeys = new Map<string, string>();
  private gate = false;
  private song: Song | null = null;
  private st: PlayState | null = null;
  /** playback speed 0.5..1.5; pitch is unaffected because we schedule MIDI events, not audio */
  speed = 1;

  private constructor(
    ctx: AudioContext,
    private opts: EngineOptions,
  ) {
    this.ctx = ctx;
    this.lib = new InstrumentLibrary(ctx, opts.instrumentsUrl);
    this.master = new MasterBus(ctx, ctx.destination);
  }

  static async create(opts: EngineOptions): Promise<AudioEngine> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const e = new AudioEngine(ctx, opts);
    if (opts.gateWorkletUrl && ctx.audioWorklet) {
      try {
        await ctx.audioWorklet.addModule(opts.gateWorkletUrl);
        e.gate = true;
      } catch (err) {
        console.warn('noise gate worklet unavailable (needs a secure origin):', err);
      }
    }
    return e;
  }

  /** Output latency the user actually hears, in ms. */
  get latencyMs(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return Math.round(((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000);
  }

  get playing() {
    return !!this.st;
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Keep graphs in sync with the song (tracks, tones, mixer). Called on every song change. */
  setSong(song: Song) {
    const prev = this.song;
    this.song = song;
    const audible = audibleTracks(song);
    const ids = new Set(song.tracks.map((t) => t.id));
    for (const [id, g] of this.graphs)
      if (!ids.has(id)) {
        g.dispose();
        this.graphs.delete(id);
      }
    for (const t of song.tracks) {
      const g = this.graphs.get(t.id);
      if (g) g.update(t, audible.has(t.id));
      else {
        const ng = new TrackGraph(this.ctx, t, this.master, this.gate);
        ng.update(t, audible.has(t.id));
        this.graphs.set(t.id, ng);
      }
      const key = `${t.type}:${t.instrument}`;
      if (this.samplerKeys.get(t.id) !== key) {
        this.samplerKeys.set(t.id, key);
        this.samplers.delete(t.id);
        this.lib.sampler(t.instrument, t.type).then((s) => {
          if (this.samplerKeys.get(t.id) === key) {
            this.samplers.set(t.id, s);
            if (isFallback(s))
              this.opts.onStatus?.(
                'Instruments not installed — using a basic fallback sound. Run "pnpm fetch-instruments".',
              );
          }
        });
      }
    }
    // tempo edits while playing: re-anchor at the current position
    if (this.st && prev && prev.tempos !== song.tempos) {
      const at = this.currentTick();
      this.stop();
      if (at != null) this.play(at);
    }
  }

  /** Load the samples every note in the song needs. */
  async prepare(song: Song, onProgress?: (done: number, total: number) => void) {
    const jobs: Promise<void>[] = [];
    const prog = new Map<string, [number, number]>();
    const report = () => {
      let d = 0,
        t = 0;
      for (const [a, b] of prog.values()) {
        d += a;
        t += b;
      }
      onProgress?.(d, t);
    };
    for (const t of song.tracks) {
      const pitches =
        t.type === 'drums'
          ? t.hits.map((h) => laneById.get(`${h.piece}:${h.articulation}`)?.key ?? 0)
          : t.notes.map((n) => n.pitch);
      jobs.push(
        this.lib.sampler(t.instrument, t.type).then((s) =>
          s.preload(pitches, (d, n) => {
            prog.set(t.id, [d, n]);
            report();
          }),
        ),
      );
    }
    await Promise.all(jobs);
  }

  private tempoMap(song: Song) {
    return new TempoMap(song.tempos, song.ppq);
  }

  /** Audition a note (piano roll click, key column, position picker). */
  async preview(track: Track, pitch: number, tick: number, lengthTicks = 480) {
    await this.resume();
    const g = this.graphs.get(track.id);
    if (!g || track.type === 'drums') return;
    const s = this.samplers.get(track.id) ?? (await this.lib.sampler(track.instrument, track.type));
    await s.preload([pitch]);
    if (!this.st) g.setTone(toneAt(track.pedal, tick), this.ctx.currentTime, 0);
    const song = this.song;
    const secs = song ? (lengthTicks * 60) / (this.tempoMap(song).bpmAt(tick) * song.ppq) : 0.4;
    s.play(this.ctx, g.input, {
      pitch,
      velocity: 100,
      when: this.ctx.currentTime + 0.005,
      duration: Math.min(1.2, Math.max(0.15, secs)),
    });
  }

  /** Audition a drum lane (drum grid clicks). */
  async previewDrum(track: Track, laneId: string, velocity = 100) {
    await this.resume();
    const g = this.graphs.get(track.id);
    if (!g) return;
    const s = this.samplers.get(track.id) ?? (await this.lib.sampler(track.instrument, 'drums'));
    const key = laneById.get(laneId)?.key;
    if (key == null) return;
    await s.preload([key]);
    playDrum(this.ctx, track, s, g.input, laneId, velocity, this.ctx.currentTime + 0.005);
  }

  /** Start playback at `fromTick`. Count-in bars come from song.metronome.countIn. */
  play(fromTick: number) {
    const song = this.song;
    if (!song) return;
    this.stop();
    void this.resume();
    const tempo = this.tempoMap(song);
    const bm = new BarMap(song.timeSigs, song.ppq);
    const songEnd = bm.barStart(song.bars);
    const loop = song.loop?.on && song.loop.end > song.loop.start ? song.loop : null;
    if (loop && (fromTick < loop.start || fromTick >= loop.end)) fromTick = loop.start;
    const now = this.ctx.currentTime + 0.06;

    // count-in clicks before the music starts
    let start = now;
    if (song.metronome.countIn > 0) {
      const bar = bm.barAtTick(fromTick);
      const beatSec = 60 / tempo.bpmAt(fromTick) / (bar.den / 4) / this.speed;
      const beats = bar.num * song.metronome.countIn;
      for (let k = 0; k < beats; k++)
        click(this.ctx, this.master.metronome, now + k * beatSec, k % bar.num === 0, song.metronome.volume);
      start = now + beats * beatSec;
    }
    for (const t of song.tracks) this.graphs.get(t.id)?.setTone(toneAt(t.pedal, fromTick), now, 0);

    // playback order: the loop region, or the song with its repeats expanded
    let segEnd = loop ? loop.end : songEnd;
    let queue: { start: number; end: number }[] = [];
    if (!loop) {
      const order = playbackSegments(song);
      const i = order.findIndex((sg) => fromTick >= sg.start && fromTick < sg.end);
      if (i >= 0) {
        segEnd = order[i].end;
        queue = order.slice(i + 1);
      }
    }
    const perf = new Map<string, TrackPerfState>();
    for (const t of song.tracks) perf.set(t.id, newPerfState());
    this.st = {
      segStart: fromTick,
      segTime: start,
      segEnd,
      queue,
      next: fromTick,
      anchors: [{ time: start, tick: fromTick }],
      timer: setInterval(() => this.tick(), INTERVAL),
      perf,
      tempo,
      tempos: song.tempos,
      endTime: null,
    };
    this.tick();
  }

  private timeOf(tick: number) {
    const st = this.st!;
    return st.segTime + (st.tempo.tickToSeconds(tick) - st.tempo.tickToSeconds(st.segStart)) / this.speed;
  }
  private tickAtTime(time: number) {
    const st = this.st!;
    return st.tempo.secondsToTick(st.tempo.tickToSeconds(st.segStart) + (time - st.segTime) * this.speed);
  }

  private tick() {
    const st = this.st;
    const song = this.song;
    if (!st || !song) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    if (st.endTime != null) {
      if (this.ctx.currentTime > st.endTime) {
        this.stop();
        this.opts.onEnded?.();
      }
      return;
    }
    // schedule possibly several segments (loop wraps) within the horizon
    for (let guard = 0; guard < 4; guard++) {
      const until = Math.min(st.segEnd, this.tickAtTime(horizon));
      if (until > st.next) {
        const audible = audibleTracks(song);
        for (const t of song.tracks) {
          if (!audible.has(t.id)) continue;
          const g = this.graphs.get(t.id);
          if (!g) continue;
          scheduleTrack(
            this.ctx,
            t,
            this.samplers.get(t.id),
            g,
            st.next,
            until,
            (x) => this.timeOf(x),
            st.perf.get(t.id) ?? newPerfState(),
            song.humanize,
          );
        }
        if (song.metronome.on)
          scheduleClicks(
            this.ctx,
            song,
            this.master.metronome,
            st.next,
            until,
            (x) => this.timeOf(x),
            song.metronome.volume,
          );
        st.next = until;
      }
      if (st.next < st.segEnd) break;
      const loop = song.loop?.on && song.loop.end > song.loop.start ? song.loop : null;
      if (loop) {
        // wrap: the loop start plays right after the loop end
        const wrapTime = this.timeOf(st.segEnd);
        st.segStart = loop.start;
        st.segTime = wrapTime;
        st.segEnd = loop.end;
        st.next = loop.start;
        st.anchors.push({ time: wrapTime, tick: loop.start });
        if (st.anchors.length > 8) st.anchors.shift();
        for (const t of song.tracks)
          this.graphs.get(t.id)?.setTone(toneAt(t.pedal, loop.start), wrapTime, 0.01);
        for (const p of st.perf.values()) for (const v of p.voices) if (v.end > wrapTime) v.stop(wrapTime);
      } else if (st.queue.length) {
        // jump for a repeat / alternate ending; ringing notes carry over like a real performance
        const nextSeg = st.queue.shift()!;
        const jumpTime = this.timeOf(st.segEnd);
        st.segStart = nextSeg.start;
        st.segTime = jumpTime;
        st.segEnd = nextSeg.end;
        st.next = nextSeg.start;
        st.anchors.push({ time: jumpTime, tick: nextSeg.start });
        if (st.anchors.length > 8) st.anchors.shift();
        for (const t of song.tracks)
          this.graphs.get(t.id)?.setTone(toneAt(t.pedal, nextSeg.start), jumpTime, 0.01);
      } else {
        st.endTime = this.timeOf(st.segEnd) + 0.3;
        break;
      }
    }
  }

  /** Current playback position in ticks (for the playhead), or null when stopped / counting in. */
  currentTick(): number | null {
    const st = this.st;
    if (!st) return null;
    const now = this.ctx.currentTime - (this.latencyMs / 1000) * 0.5;
    let a = st.anchors[0];
    for (const x of st.anchors) if (x.time <= now) a = x;
    if (now < a.time) return null;
    const tempo = st.tempo;
    const tick = tempo.secondsToTick(tempo.tickToSeconds(a.tick) + (now - a.time) * this.speed);
    return Math.min(tick, st.endTime != null ? Infinity : tick);
  }

  stop() {
    const st = this.st;
    if (!st) return;
    clearInterval(st.timer);
    const now = this.ctx.currentTime;
    for (const p of st.perf.values()) for (const v of p.voices) if (v.end > now) v.stop(now, true);
    this.st = null;
  }

  dispose() {
    this.stop();
    for (const g of this.graphs.values()) g.dispose();
    void this.ctx.close();
  }
}
