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
    reverbIR(ctx.sampleRate).then((b) => (this.reverb.buffer = b));
    this.metronome = ctx.createGain();
    this.metronome.connect(dest);
  }
}

export const DI_TRIM: Record<Track['type'], number> = { guitar: 0.35, bass: 0.6, drums: 0.8 };

export class TrackGraph {
  readonly input: GainNode; // DI signal from the sampler
  private chains = new Map<string, { node: ToneChainNode; fade: GainNode; sendFade: GainNode; json: string }>();
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
  ) {
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
    if (track.type === 'drums') {
      this.kitWet?.gain.setTargetAtTime((track.drumComp ?? 0.35) * 1.8, t, 0.02);
      this.sendSum.gain.setTargetAtTime(0.12, t, 0.02); // a little room on the kit
      return;
    }
    const seen = new Set<string>();
    for (const tone of track.tones) {
      seen.add(tone.id);
      const json = JSON.stringify(tone.chain);
      const ex = this.chains.get(tone.id);
      if (ex) {
        if (ex.json !== json) {
          ex.node.update(tone.chain);
          ex.json = json;
        }
        continue;
      }
      const node = new ToneChainNode(this.ctx, tone.chain, { gateWorklet: this.gateWorklet, reverbInput: this.sendSum });
      const fade = this.ctx.createGain();
      fade.gain.value = 0;
      this.input.connect(node.input);
      node.output.connect(fade).connect(this.sum);
      // the reverb send must follow the crossfade too
      node.send.disconnect();
      const sendFade = this.ctx.createGain();
      node.send.connect(sendFade).connect(this.sendSum);
      sendFade.gain.value = 0;
      this.chains.set(tone.id, { node, fade, sendFade, json });
    }
    for (const [id, c] of this.chains)
      if (!seen.has(id)) {
        c.node.dispose();
        c.fade.disconnect();
        c.sendFade.disconnect();
        this.chains.delete(id);
      }
    if (!this.chains.has(this.current)) this.setTone(track.pedal.startTone, t, 0);
  }

  /**
   * Switch the DI signal to another amp chain at `when`, with a short equal-power crossfade (~10 ms) so there's no
   * click. Ringing notes keep sounding through the new chain, exactly like a real footswitch.
   */
  setTone(toneId: string, when: number, fade = 0.01) {
    if (!this.chains.has(toneId)) return;
    const prev = this.current;
    this.current = toneId;
    const steps = 16;
    for (const [id, c] of this.chains) {
      const on = id === toneId;
      const wasOn = id === prev;
      for (const p of [c.fade.gain, c.sendFade.gain]) {
        const pp = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
        if (pp.cancelAndHoldAtTime) pp.cancelAndHoldAtTime(when);
        else pp.cancelScheduledValues(when);
        if (fade <= 0 || on === wasOn) {
          p.setValueAtTime(on ? 1 : 0, when);
          continue;
        }
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
    }
  }

  dispose() {
    for (const c of this.chains.values()) {
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
