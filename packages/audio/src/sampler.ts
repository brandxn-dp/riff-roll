import { parseSfz, selectRegions, type SfzInstrument, type SfzRegion } from './sfz';

/** Fetches and decodes sample files once, shared by every sampler and every (offline) context. */
export class SampleLoader {
  private cache = new Map<string, Promise<AudioBuffer>>();
  private decoded = new Map<string, AudioBuffer>();
  constructor(
    private decodeCtx: BaseAudioContext,
    private fetcher: (url: string) => Promise<ArrayBuffer> = defaultFetch,
  ) {}

  load(url: string): Promise<AudioBuffer> {
    let p = this.cache.get(url);
    if (!p) {
      p = this.fetcher(url)
        .then((data) => this.decodeCtx.decodeAudioData(data))
        .then((buf) => {
          this.decoded.set(url, buf);
          return buf;
        });
      p.catch(() => this.cache.delete(url));
      this.cache.set(url, p);
    }
    return p;
  }

  get(url: string): AudioBuffer | undefined {
    return this.decoded.get(url);
  }
}

const CACHE_NAME = 'riffroll-instruments-v1';

/** fetch with Cache Storage (web) so instruments load once per browser. */
export async function defaultFetch(url: string): Promise<ArrayBuffer> {
  let cache: Cache | undefined;
  try {
    if (typeof caches !== 'undefined' && /^https?:$/.test(location.protocol)) cache = await caches.open(CACHE_NAME);
  } catch {
    cache = undefined;
  }
  const hit = cache && (await cache.match(url));
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  if (cache) await cache.put(url, res.clone()).catch(() => {});
  return res.arrayBuffer();
}

/** Encode each path segment (sample packs use spaces and '+' in folder names). */
export function joinUrl(base: string, rel: string): string {
  const b = base.endsWith('/') ? base : base + '/';
  return b + rel.split('/').map(encodeURIComponent).join('/');
}

export interface PlayOptions {
  pitch: number;
  velocity: number;
  when: number;
  /** seconds; undefined = let it ring until stop() */
  duration?: number;
  palmMute?: boolean;
  dead?: boolean;
  fadeIn?: number; // seconds of volume swell
  gain?: number; // extra linear gain
  pan?: number;
  /** Cent offsets over time: [{time (abs seconds), cents}] — bends, slides, vibrato, whammy */
  detune?: { time: number; cents: number; ramp?: boolean }[];
  harmonic?: boolean;
  /** Extra per-region gain (drum mic balance). */
  regionGain?: (r: SfzRegion) => number;
}

export interface Voice {
  readonly region: SfzRegion;
  readonly start: number;
  end: number;
  stop(when: number, fast?: boolean): void;
  detune: AudioParam;
  readonly output: AudioNode;
}

/** Plays an SFZ instrument (subset) with sample-accurate scheduling. */
export class Sampler {
  readonly inst: SfzInstrument;
  private seq = new Map<string, number>();
  private active: Voice[] = [];
  /** cents applied to a region with pitch tracking (0 for drums) */
  constructor(
    sfzText: string,
    private baseUrl: string,
    private loader: SampleLoader,
  ) {
    this.inst = parseSfz(sfzText);
  }

  urlOf(r: SfzRegion) {
    return joinUrl(this.baseUrl, r.sample);
  }

  /** Every region that could sound for these pitches (all velocity layers / round robins). */
  regionsForPitches(pitches: Iterable<number>): SfzRegion[] {
    const set = new Set<number>(pitches);
    return this.inst.regions.filter((r) => {
      for (const p of set) if (p >= r.lokey && p <= r.hikey) return true;
      return false;
    });
  }

  /** Load the samples needed for these pitches. Reports progress as (loaded, total). */
  async preload(pitches: Iterable<number>, onProgress?: (done: number, total: number) => void) {
    const urls = [...new Set(this.regionsForPitches(pitches).map((r) => this.urlOf(r)))];
    let done = 0;
    onProgress?.(0, urls.length);
    await Promise.all(
      urls.map((u) =>
        this.loader.load(u).then(
          () => onProgress?.(++done, urls.length),
          () => onProgress?.(++done, urls.length),
        ),
      ),
    );
  }

  async preloadAll(onProgress?: (done: number, total: number) => void) {
    const all: number[] = [];
    for (let p = 0; p < 128; p++) all.push(p);
    return this.preload(all, onProgress);
  }

  private seqCount(r: SfzRegion) {
    const k = `${r.lokey}:${r.hikey}:${r.lovel}:${r.hivel}:${r.seqLength}`;
    const n = this.seq.get(k) ?? 0;
    return n;
  }
  private bumpSeq(rs: SfzRegion[]) {
    const seen = new Set<string>();
    for (const r of rs) {
      const k = `${r.lokey}:${r.hikey}:${r.lovel}:${r.hivel}:${r.seqLength}`;
      if (seen.has(k)) continue;
      seen.add(k);
      this.seq.set(k, (this.seq.get(k) ?? 0) + 1);
    }
  }

  /** Release voices choked by a newly triggered region group (e.g. closed hi-hat chokes open hi-hat). */
  private choke(group: number, when: number) {
    if (!group) return;
    for (const v of this.active) if (v.region.offBy === group && v.end > when) v.stop(when, v.region.offMode === 'fast');
  }

  /** Start a note. Returns the voices started (several if regions layer), or [] if samples aren't loaded yet. */
  play(ctx: BaseAudioContext, dest: AudioNode, o: PlayOptions): Voice[] {
    const vel = Math.max(1, Math.min(127, Math.round(o.velocity)));
    const regions = selectRegions(this.inst, o.pitch, vel, Math.random(), (r) => this.seqCount(r));
    this.bumpSeq(regions);
    const out: Voice[] = [];
    this.active = this.active.filter((v) => v.end > ctx.currentTime);
    for (const r of regions) {
      const buf = this.loader.get(this.urlOf(r));
      if (!buf) {
        void this.loader.load(this.urlOf(r)); // lazy: available next time
        continue;
      }
      this.choke(r.group, o.when);
      out.push(this.startVoice(ctx, dest, r, buf, o, vel));
    }
    return out;
  }

  private startVoice(
    ctx: BaseAudioContext,
    dest: AudioNode,
    r: SfzRegion,
    buf: AudioBuffer,
    o: PlayOptions,
    vel: number,
  ): Voice {
    const when = Math.max(o.when, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const semis = ((o.pitch - r.pitchKeycenter) * r.pitchKeytrack) / 100 + r.transpose + r.tune / 100;
    src.playbackRate.value = Math.pow(2, semis / 12);
    if (r.loopMode === 'loop_continuous' || r.loopMode === 'loop_sustain') {
      if (r.loopStart !== undefined && r.loopEnd !== undefined && r.loopEnd > r.loopStart) {
        src.loop = true;
        src.loopStart = r.loopStart / buf.sampleRate;
        src.loopEnd = r.loopEnd / buf.sampleRate;
      }
    }
    const env = ctx.createGain();
    // velocity curve: amp_veltrack 100% = (vel/127)^2 scaling of the sample layer
    const vt = r.ampVeltrack / 100;
    const velGain = 1 - vt + vt * Math.pow(vel / 127, 1.6);
    const peak = Math.pow(10, r.volume / 20) * velGain * (o.gain ?? 1) * (o.regionGain ? o.regionGain(r) : 1);
    const a = r.ampeg;
    const t0 = when + a.delay;
    const attack = Math.max(a.attack, o.fadeIn ?? 0, 0.0015);
    env.gain.setValueAtTime(0, when);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (a.decay > 0 && a.sustain < 100) {
      env.gain.setValueAtTime(peak, t0 + attack + a.hold);
      env.gain.setTargetAtTime((peak * a.sustain) / 100, t0 + attack + a.hold, a.decay / 4);
    }
    let node: AudioNode = src;
    if (o.palmMute || o.dead) {
      // no dedicated samples in the default pack: short envelope + low-pass, which is how a palm mute sounds
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.dead ? 1400 : 950;
      lp.Q.value = 0.6;
      node.connect(lp);
      node = lp;
      env.gain.setTargetAtTime(o.dead ? 0 : peak * 0.18, t0 + attack, o.dead ? 0.012 : 0.07);
    }
    if (o.harmonic) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      node.connect(hp);
      node = hp;
    }
    node.connect(env);
    let out: AudioNode = env;
    const pan = (r.pan / 100) + (o.pan ?? 0);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      env.connect(p);
      out = p;
    }
    out.connect(dest);
    if (o.detune) {
      for (const d of o.detune) {
        if (d.ramp) src.detune.linearRampToValueAtTime(d.cents, Math.max(when, d.time));
        else src.detune.setValueAtTime(d.cents, Math.max(when, d.time));
      }
    }
    const offset = r.offset / buf.sampleRate;
    src.start(when, offset);
    const natural = when + (buf.duration - offset) / src.playbackRate.value;
    const releaseTau = Math.max(0.005, a.release / 4);
    let stopped = false;
    const voice: Voice = {
      region: r,
      start: when,
      end: natural,
      detune: src.detune,
      output: out,
      stop(at: number, fast = false) {
        if (stopped && at >= voice.end) return;
        stopped = true;
        const t = Math.max(at, when + 0.002);
        const tau = fast ? 0.006 : releaseTau;
        const g = env.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
        else g.cancelScheduledValues(t);
        g.setTargetAtTime(0, t, tau);
        const end = Math.min(natural, t + tau * 8);
        try {
          src.stop(end);
        } catch {
          /* already stopped */
        }
        voice.end = end;
      },
    };
    if (o.duration !== undefined) voice.stop(when + Math.max(0.01, o.duration));
    src.onended = () => {
      try {
        out.disconnect();
      } catch {
        /* ok */
      }
    };
    this.active.push(voice);
    return voice;
  }
}
