import type { Song, Track } from '@riffroll/core';
import { ToneChainNode } from './tone-chain';
import { reverbIR } from './impulses';

/**
 * Audio graph shared by the live engine and offline rendering:
 *   track: DI input → tone chains (crossfaded) → volume → pan → mute → master
 *   master: glue compressor → limiter → destination;   global reverb send/return
 */
export class MasterBus {
  readonly input: GainNode;
  readonly reverbIn: GainNode;
  readonly metronome: GainNode;
  private reverb: ConvolverNode;
  /** resolves once the reverb IR is loaded (offline renders wait for it) */
  readonly ready: Promise<void>;
  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    this.input = ctx.createGain();
    this.input.gain.value = 0.8;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.02;
    glue.release.value = 0.25;
    glue.knee.value = 8;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    this.input.connect(glue).connect(limiter).connect(dest);
    this.reverbIn = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.normalize = false;
    const ret = ctx.createGain();
    ret.gain.value = 0.9;
    this.reverbIn.connect(this.reverb).connect(ret).connect(this.input);
    this.ready = reverbIR(ctx.sampleRate).then((b) => {
      this.reverb.buffer = b;
    });
    this.metronome = ctx.createGain();
    this.metronome.connect(dest);
  }
}

export const DI_TRIM: Record<Track['type'], number> = { guitar: 0.35, bass: 0.6, drums: 0.8, other: 0.7 };

interface Chain {
  node: ToneChainNode;
  /** DI → chain input gain (the footswitch crossfade) */
  fade: GainNode;
  json: string;
  /** connected and being computed */
  live: boolean;
  sleep?: ReturnType<typeof setTimeout>;
  /** the tone plays its own instrument instead of the DI through an amp */
  sampled: boolean;
  /** don't sleep before this (Date.now() ms): a sampled note is still ringing */
  busyUntil?: number;
}

/** How long a switched-off chain keeps running so delay/reverb tails and ringing notes fade out. */
const CHAIN_TAIL_MS = 4000;

export class TrackGraph {
  readonly input: GainNode; // DI signal from the sampler
  /**
   * One amp chain per tone. The DI signal reaches a chain through its `fade` (the footswitch crossfade happens at
   * the inputs, so effect tails ring out naturally). A chain that hasn't had signal for a while is disconnected
   * ("asleep"): the browser then stops computing it. Before, every tone's chain processed the guitar all the time
   * with only its output muted, which is what overloaded the audio thread in songs with many guitars and tones.
   */
  private chains = new Map<string, Chain>();
  /** sleep inactive chains (live playback only: an offline render keeps everything connected) */
  private lazy: boolean;
  private audible = true;
  private vol: GainNode;
  private pan: StereoPannerNode;
  private mute: GainNode;
  private sendVol: GainNode;
  private sendSum: GainNode;
  private sum: GainNode;
  private kitComp?: DynamicsCompressorNode;
  private kitWet?: GainNode;
  current = '';

  constructor(
    private ctx: BaseAudioContext,
    track: Track,
    private master: MasterBus,
    private gateWorklet: boolean,
    private userIR?: (name: string) => AudioBuffer | undefined,
  ) {
    this.lazy = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
    this.input = ctx.createGain();
    // DI trim: the sample packs are recorded hot; this keeps chords out of the amp's clipping-by-accident zone
    this.input.gain.value = DI_TRIM[track.type];
    this.sum = ctx.createGain();
    this.vol = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.mute = ctx.createGain();
    this.sendSum = ctx.createGain();
    this.sendVol = ctx.createGain();
    this.sum.connect(this.vol).connect(this.pan).connect(this.mute).connect(master.input);
    this.sendSum.connect(this.sendVol).connect(master.reverbIn);
    if (track.type === 'drums') {
      // kit bus: parallel ("New York") compression, amount set by the drum mixer
      this.kitComp = ctx.createDynamicsCompressor();
      this.kitComp.threshold.value = -24;
      this.kitComp.ratio.value = 4;
      this.kitComp.attack.value = 0.01;
      this.kitComp.release.value = 0.15;
      this.kitWet = ctx.createGain();
      this.kitWet.gain.value = 0;
      this.input.connect(this.sum);
      this.input.connect(this.kitComp).connect(this.kitWet).connect(this.sum);
      this.input.connect(this.sendSum);
    } else if (track.type === 'other') {
      // piano, synth…: no amp, straight to the mixer with a little reverb
      this.input.connect(this.sum);
      this.input.connect(this.sendSum);
    }
    this.update(track, true);
  }

  /** Sync tones and mixer settings with the track. Cheap when nothing changed. */
  update(track: Track, audible: boolean) {
    const t = this.ctx.currentTime;
    this.vol.gain.setTargetAtTime(track.volume, t, 0.02);
    this.sendVol.gain.setTargetAtTime(track.volume, t, 0.02);
    this.pan.pan.setTargetAtTime(track.pan, t, 0.02);
    this.mute.gain.setTargetAtTime(audible ? 1 : 0, t, 0.01);
    const wasAudible = this.audible;
    this.audible = audible;
    if (track.type === 'drums') {
      this.kitWet?.gain.setTargetAtTime((track.drumComp ?? 0.35) * 1.8, t, 0.02);
      this.sendSum.gain.setTargetAtTime(0.12, t, 0.02); // a little room on the kit
      return;
    }
    if (track.type === 'other') {
      this.sendSum.gain.setTargetAtTime(0.18, t, 0.02);
      return;
    }
    const seen = new Set<string>();
    for (const tone of track.tones) {
      seen.add(tone.id);
      const json = JSON.stringify(tone.chain);
      const ex = this.chains.get(tone.id);
      if (ex) {
        ex.sampled = !!tone.instrument;
        if (ex.json !== json) {
          ex.node.update(tone.chain);
          ex.json = json;
        }
        continue;
      }
      const node = new ToneChainNode(this.ctx, tone.chain, {
        gateWorklet: this.gateWorklet,
        reverbInput: this.sendSum,
        userIR: this.userIR,
      });
      // the chain wires its reverb send itself; we connect it only while the chain is awake
      node.send.disconnect();
      const fade = this.ctx.createGain();
      fade.gain.value = 0;
      fade.connect(node.input);
      const c: Chain = { node, fade, json, live: false, sampled: !!tone.instrument };
      this.chains.set(tone.id, c);
      if (!this.lazy) this.wake(c);
    }
    for (const [id, c] of this.chains)
      if (!seen.has(id)) {
        if (c.sleep) clearTimeout(c.sleep);
        c.node.dispose();
        c.fade.disconnect();
        this.chains.delete(id);
      }
    if (!this.chains.has(this.current)) this.setTone(track.pedal.startTone, t, 0);
    if (this.lazy && audible !== wasAudible) {
      // a muted track costs nothing; unmuting wakes its tone
      if (!audible) for (const c of this.chains.values()) this.sleepAfter(c, t + 0.05);
      else {
        const cur = this.chains.get(this.current);
        if (cur) this.wake(cur);
      }
    }
  }

  private wake(c: Chain) {
    if (c.sleep) {
      clearTimeout(c.sleep);
      c.sleep = undefined;
    }
    if (c.live) return;
    this.input.connect(c.fade);
    c.node.output.connect(this.sum);
    c.node.send.connect(this.sendSum);
    c.live = true;
  }

  /** Disconnect a chain once its input has been silent long enough for its effects to ring out. */
  private sleepAfter(c: Chain, at: number) {
    if (!this.lazy) return;
    if (c.sleep) clearTimeout(c.sleep);
    const ms = Math.max(0, (at - this.ctx.currentTime) * 1000) + CHAIN_TAIL_MS;
    c.sleep = setTimeout(() => {
      c.sleep = undefined;
      const isCurrent = this.chains.get(this.current) === c;
      if (!c.live || (isCurrent && this.audible) || Date.now() < (c.busyUntil ?? 0)) return;
      this.input.disconnect(c.fade);
      c.node.output.disconnect(this.sum);
      c.node.send.disconnect(this.sendSum);
      c.live = false;
    }, ms);
  }

  /**
   * Where a note's samples go. DI notes go to `input` (and on to whichever amp chain is switched on); notes from a
   * sampled tone (a recorded distorted guitar) go straight into that tone's own chain.
   */
  inputFor(toneId: string | undefined, until: number): AudioNode {
    const c = toneId ? this.chains.get(toneId) : undefined;
    if (!c?.sampled) return this.input;
    this.wake(c);
    // keep it awake while the note rings (and its effects after it)
    const ms = Date.now() + Math.max(0, until - this.ctx.currentTime) * 1000;
    if ((c.busyUntil ?? 0) < ms) c.busyUntil = ms;
    if (this.chains.get(this.current) !== c) this.sleepAfter(c, until);
    return c.node.input;
  }

  /**
   * Switch the DI signal to another amp chain at `when`, with a short equal-power crossfade (~10 ms) so there's no
   * click. Ringing notes keep sounding through the new chain, exactly like a real footswitch. A sampled tone gets
   * no DI signal: its notes come from its own instrument (see inputFor).
   */
  setTone(toneId: string, when: number, fade = 0.01) {
    if (!this.chains.has(toneId)) return;
    const prev = this.current;
    this.current = toneId;
    const steps = 16;
    for (const [id, c] of this.chains) {
      const on = id === toneId && !c.sampled;
      const wasOn = id === prev && !c.sampled;
      if (id === toneId && this.audible) this.wake(c);
      if (!on && !wasOn) continue;
      const p = c.fade.gain;
      const pp = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
      if (pp.cancelAndHoldAtTime) pp.cancelAndHoldAtTime(when);
      else p.cancelScheduledValues(when);
      if (fade <= 0 || on === wasOn) p.setValueAtTime(on ? 1 : 0, when);
      else {
        // equal-power crossfade: the incoming chain rises on a sine, the outgoing falls on a cosine
        const curve = new Float32Array(steps + 1);
        for (let i = 0; i <= steps; i++) {
          const x = (i / steps) * (Math.PI / 2);
          curve[i] = on ? Math.sin(x) : Math.cos(x);
        }
        try {
          p.setValueCurveAtTime(curve, when, fade);
        } catch {
          p.setValueAtTime(on ? 1 : 0, when);
        }
      }
      if (!on) this.sleepAfter(c, when + fade);
    }
    // a sampled tone's chain stays awake while it is the current tone
    const cur = this.chains.get(toneId)!;
    if (cur.sampled) cur.busyUntil = Infinity;
    const old = this.chains.get(prev);
    if (old?.sampled && old !== cur) {
      old.busyUntil = Date.now();
      this.sleepAfter(old, when + fade);
    }
  }

  /** Re-apply chains (e.g. after a user IR finished decoding). */
  refresh(track: Track) {
    for (const tone of track.tones) this.chains.get(tone.id)?.node.update(tone.chain);
  }

  /** resolves once every amp chain has its cabinet IR */
  ready(): Promise<void> {
    return Promise.all([...this.chains.values()].map((c) => c.node.ready)).then(() => {});
  }

  dispose() {
    for (const c of this.chains.values()) {
      if (c.sleep) clearTimeout(c.sleep);
      c.node.dispose();
      c.fade.disconnect();
    }
    this.chains.clear();
    this.input.disconnect();
    this.mute.disconnect();
    this.sendVol.disconnect();
  }
}

export function audibleTracks(song: Song): Set<string> {
  const anySolo = song.tracks.some((t) => t.solo);
  return new Set(song.tracks.filter((t) => !t.mute && (!anySolo || t.solo)).map((t) => t.id));
}
