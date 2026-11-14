import {
  BarMap,
  isFretted,
  TempoMap,
  laneById,
  laneForGm,
  playbackSegments,
  toneAt,
  type Song,
  type Track,
} from '@riffroll/core';
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
  /** 'interactive' (lowest latency), 'balanced', 'playback' (fewest dropouts), or seconds */
  latencyHint?: AudioContextLatencyCategory | number;
  /** force a sample rate (otherwise the output device's) */
  sampleRate?: number;
  /** output device id from enumerateDevices ('' = system default) */
  sinkId?: string;
}

// Seconds scheduled ahead of the audio clock. Notes are handed to the audio thread this far ahead, so a busy
// main thread (a big song redrawing, garbage collection, saving) can stall for up to this long without the
// music stuttering. Edits made while playing take about this long to be heard.
const LOOKAHEAD = 0.3;
const INTERVAL = 25; // ms between scheduler runs

/**
 * The scheduler's clock. A worker's timer keeps time when the browser throttles the page's own timers (a hidden
 * tab, a minimised or covered window), which would otherwise starve playback; falls back to setInterval.
 */
function ticker(fn: () => void, ms: number): () => void {
  try {
    const src = `const t = setInterval(() => postMessage(0), ${ms}); onmessage = () => { clearInterval(t); close(); };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = fn;
    return () => {
      w.postMessage(0);
      w.terminate();
    };
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

interface PlayState {
  segStart: number; // tick where the current segment (pass through the loop) starts
  segTime: number; // context time at segStart
  segEnd: number; // tick where this segment ends (loop end or song end)
  next: number; // ticks scheduled so far
  anchors: { time: number; tick: number }[]; // for playhead mapping across loop wraps
  /** stops the scheduler clock */
  stopTimer: () => void;
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
  /** samplers of sampled tones, by "trackId:toneId" */
  private toneSamplers = new Map<string, Sampler>();
  private toneSamplerKeys = new Map<string, string>();
  private gate = false;
  /** decoded user impulse responses by asset name */
  readonly userIRs = new Map<string, AudioBuffer>();
  private auditionVoices: { stop(t: number, fast?: boolean): void }[] = [];
  private fallbackRetry = 0;
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
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({
        latencyHint: opts.latencyHint ?? 'interactive',
        ...(opts.sampleRate ? { sampleRate: opts.sampleRate } : {}),
      });
    } catch (err) {
      // an unsupported sample rate: fall back to the device's own
      console.warn('audio settings not supported, using defaults:', err);
      ctx = new AudioContext({ latencyHint: opts.latencyHint ?? 'interactive' });
    }
    const e = new AudioEngine(ctx, opts);
    if (opts.sinkId) await e.setOutput(opts.sinkId).catch((err) => console.warn('output device:', err));
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
  /** Send the sound to another output device ('' = system default). Chromium / Electron only. */
  async setOutput(sinkId: string) {
    const c = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!c.setSinkId) throw new Error('This browser can’t choose an output device.');
    await c.setSinkId(sinkId);
  }

  /** What the device is actually running at, for the audio settings. */
  get info() {
    return { sampleRate: this.ctx.sampleRate, latencyMs: this.latencyMs, state: this.ctx.state };
  }

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
    this.master.setVolume(song.master?.volume ?? 1, this.ctx);
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
        const ng = new TrackGraph(this.ctx, t, this.master, this.gate, (name) => this.userIRs.get(name));
        ng.update(t, audible.has(t.id));
        this.graphs.set(t.id, ng);
      }
      const key = `${t.type}:${t.instrument}`;
      // a track on the fallback sound tries its real instrument again now and then (the list may load later)
      const cur = this.samplers.get(t.id);
      const retry = !!cur && isFallback(cur) && Date.now() - this.fallbackRetry > 10_000;
      if (retry) this.fallbackRetry = Date.now();
      if (this.samplerKeys.get(t.id) !== key || retry) {
        this.samplerKeys.set(t.id, key);
        this.samplers.delete(t.id);
        this.lib.sampler(t.instrument, t.type).then((s) => {
          if (this.samplerKeys.get(t.id) === key) {
            this.samplers.set(t.id, s);
            if (isFallback(s))
              this.opts.onStatus?.(
                `Couldn't load the instrument for “${t.name}”, so it plays a basic fallback sound. File → Instruments shows what is installed.`,
              );
          }
        });
      }
    }
    // sampled tones: each loads its own instrument
    const toneKeys = new Set<string>();
    for (const t of song.tracks)
      for (const tone of t.tones) {
        if (!tone.instrument) continue;
        const k = `${t.id}:${tone.id}`;
        toneKeys.add(k);
        const want = `${t.type}:${tone.instrument}`;
        if (this.toneSamplerKeys.get(k) === want) continue;
        this.toneSamplerKeys.set(k, want);
        this.toneSamplers.delete(k);
        this.lib.sampler(tone.instrument, t.type).then((smp) => {
          if (this.toneSamplerKeys.get(k) === want) this.toneSamplers.set(k, smp);
        });
      }
    for (const k of [...this.toneSamplerKeys.keys()])
      if (!toneKeys.has(k)) {
        this.toneSamplerKeys.delete(k);
        this.toneSamplers.delete(k);
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
      for (const tone of t.tones)
        if (tone.instrument)
          jobs.push(
            this.lib.sampler(tone.instrument, t.type).then((s) =>
              s.preload(pitches, (d, n) => {
                prog.set(`${t.id}:${tone.id}`, [d, n]);
                report();
              }),
            ),
          );
    }
    await Promise.all(jobs);
  }

  /**
   * The sampler and destination for a one-off note on a track under a tone: a sampled tone plays its own
   * instrument into its chain, otherwise the track's DI goes to the amp. `pm` maps a palm mute onto real
   * palm-mute samples when the instrument has them.
   */
  private async voiceFor(track: Track, toneId: string | undefined, until: number) {
    const g = this.graphs.get(track.id)!;
    const tone = toneId ? track.tones.find((t) => t.id === toneId) : undefined;
    if (tone?.instrument) {
      const s =
        this.toneSamplers.get(`${track.id}:${tone.id}`) ??
        (await this.lib.sampler(tone.instrument, track.type));
      return { s, dest: g.inputFor(tone.id, until) };
    }
    const s = this.samplers.get(track.id) ?? (await this.lib.sampler(track.instrument, track.type));
    return { s, dest: g.input as AudioNode };
  }

  private tempoMap(song: Song) {
    return new TempoMap(song.tempos, song.ppq);
  }

  /** Audition a note (piano roll click, key column, position picker). */
  async preview(track: Track, pitch: number, tick: number, lengthTicks = 480) {
    await this.resume();
    const g = this.graphs.get(track.id);
    if (!g || track.type === 'drums') return;
    const toneId = isFretted(track.type) ? toneAt(track.pedal, tick) : undefined;
    const { s, dest } = await this.voiceFor(track, toneId, this.ctx.currentTime + 2);
    await s.preload([pitch]);
    if (!this.st && toneId) g.setTone(toneId, this.ctx.currentTime, 0);
    const song = this.song;
    const secs = song ? (lengthTicks * 60) / (this.tempoMap(song).bpmAt(tick) * song.ppq) : 0.4;
    s.play(this.ctx, dest, {
      pitch,
      velocity: 100,
      when: this.ctx.currentTime + 0.005,
      duration: Math.min(1.2, Math.max(0.15, secs)),
    });
  }

  /** Decode user-loaded IR files (song assets) and apply them to the amp chains that use them. */
  async setUserAssets(assets: Record<string, Uint8Array>) {
    let changed = false;
    for (const [name, data] of Object.entries(assets)) {
      if (this.userIRs.has(name) || !/.wav$/i.test(name)) continue;
      try {
        this.userIRs.set(name, await this.ctx.decodeAudioData(data.slice().buffer));
        changed = true;
      } catch {
        this.opts.onStatus?.(`Could not decode impulse response "${name}"`);
      }
    }
    if (changed && this.song) for (const t of this.song.tracks) this.graphs.get(t.id)?.refresh(t);
  }

  /**
   * Tone audition (the A/B page): play a short phrase through one tone, or alternate two tones phrase by phrase.
   * Phrases: a palm-muted E5 chug, an open Em chord, and a pentatonic lick.
   */
  async audition(track: Track, phrase: 'chug' | 'chord' | 'lick', toneA: string, toneB?: string) {
    await this.resume();
    this.stopAudition();
    const g = this.graphs.get(track.id);
    if (!g || !isFretted(track.type)) return;
    const s = this.samplers.get(track.id) ?? (await this.lib.sampler(track.instrument, track.type));
    const bass = track.type === 'bass';
    const o = bass ? -12 : 0;
    const P: Record<string, { p: number[]; t: number; d: number; pm?: boolean; v?: number }[]> = {
      chug: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({
        p: [40 + o, 47 + o],
        t: k * 0.25,
        d: 0.22,
        pm: k !== 7,
        v: k % 2 ? 96 : 112,
      })),
      chord: [{ p: bass ? [28, 40] : [40, 47, 52, 55, 59, 64], t: 0, d: 1.9, v: 100 }],
      lick: [57, 60, 62, 64, 67, 69, 67, 64].map((p, k) => ({ p: [p + o], t: k * 0.18, d: 0.2, v: 104 })),
    };
    const notes = P[phrase];
    const len = phrase === 'chord' ? 2.2 : 2.1;
    await s.preload(notes.flatMap((n) => n.p));
    const passes = toneB ? [toneA, toneB, toneA, toneB] : [toneA];
    const t0 = this.ctx.currentTime + 0.05;
    const voices = await Promise.all(
      passes.map((tone, i) => this.voiceFor(track, tone, t0 + (i + 1) * len + 1)),
    );
    for (const v of voices) await v.s.preload(notes.flatMap((n) => n.p));
    passes.forEach((tone, i) => {
      const start = t0 + i * len;
      g.setTone(tone, start, i ? 0.01 : 0);
      const { s: smp, dest } = voices[i];
      const art = smp.articulations;
      for (const n of notes)
        n.p.forEach((pitch, k) => {
          const layer = art ? (n.pm ? art.palmMute : (art.down ?? art.up)) : undefined;
          const v = n.v ?? 100;
          const vs = smp.play(this.ctx, dest, {
            pitch,
            velocity: layer ? Math.round(layer[0] + ((layer[1] - layer[0]) * v) / 127) : v,
            ...(layer ? { gainVelocity: v } : {}),
            when: start + n.t + k * 0.012,
            duration: n.d,
            palmMute: layer ? false : n.pm,
          });
          this.auditionVoices.push(...vs);
        });
    });
    return passes.length * len;
  }

  /**
   * Live note for MIDI input monitoring: starts sounding now through the track's current tone and returns a
   * function that releases it (note-off).
   */
  async liveNote(track: Track, pitch: number, velocity: number): Promise<() => void> {
    await this.resume();
    const g = this.graphs.get(track.id);
    if (!g) return () => {};
    if (track.type === 'drums') {
      const lane = laneForGm(pitch);
      if (lane) void this.previewDrum(track, lane.id, velocity);
      return () => {};
    }
    const toneId = isFretted(track.type) ? g.current || undefined : undefined;
    const { s, dest } = await this.voiceFor(track, toneId, this.ctx.currentTime + 30);
    await s.preload([pitch]);
    const art = s.articulations?.down ?? s.articulations?.up;
    const voices = s.play(this.ctx, dest, {
      pitch,
      velocity: art ? Math.round(art[0] + ((art[1] - art[0]) * velocity) / 127) : velocity,
      ...(art ? { gainVelocity: velocity } : {}),
      when: this.ctx.currentTime,
    });
    return () => voices.forEach((v) => v.stop(this.ctx.currentTime));
  }

  // ---------------- live instrument input (guitar/bass into the amp sim) ----------------
  private live: {
    stream: MediaStream;
    src: MediaStreamAudioSourceNode;
    gain: GainNode;
    trackId: string;
  } | null = null;

  /** Route an audio input (e.g. a guitar into an audio interface) through a track's amp chain and pedal. */
  async startLiveInput(track: Track, deviceId?: string, inputGain = 2.5) {
    this.stopLiveInput();
    await this.resume();
    const g = this.graphs.get(track.id);
    if (!g || !isFretted(track.type)) throw new Error('Pick a guitar or bass track for live input.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = inputGain;
    src.connect(gain).connect(g.input);
    if (!this.st) g.setTone(toneAt(track.pedal, 0), this.ctx.currentTime, 0);
    this.live = { stream, src, gain, trackId: track.id };
  }

  setLiveInputGain(v: number) {
    this.live?.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get liveInputTrack(): string | null {
    return this.live?.trackId ?? null;
  }

  stopLiveInput() {
    if (!this.live) return;
    this.live.src.disconnect();
    this.live.gain.disconnect();
    this.live.stream.getTracks().forEach((t) => t.stop());
    this.live = null;
  }

  stopAudition() {
    const now = this.ctx.currentTime;
    for (const v of this.auditionVoices) v.stop(now, true);
    this.auditionVoices = [];
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
      stopTimer: ticker(() => this.tick(), INTERVAL),
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
            (toneId) => this.toneSamplers.get(`${t.id}:${toneId}`),
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
    st.stopTimer();
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
