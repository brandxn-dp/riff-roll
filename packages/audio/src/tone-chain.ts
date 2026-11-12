import type { ToneChain } from '@riffroll/core';
import { cabIR } from './impulses';

/**
 * One tone = one amp chain:
 *   gate → comp → drive (pre-EQ + soft clip) → amp (input gain → 4x oversampled waveshaper(s) → tone stack →
 *   power-amp saturation) → cabinet IR → EQ → chorus → delay → out (+ reverb send)
 * Every block has a dry/wet pair so parameters (including on/off) update live without re-wiring.
 */

const CURVE_N = 4096;
const curveCache = new Map<string, Float32Array>();

function curve(kind: 'soft' | 'tube' | 'hard' | 'power'): Float32Array<ArrayBuffer> {
  let c = curveCache.get(kind);
  if (c) return c as Float32Array<ArrayBuffer>;
  c = new Float32Array(CURVE_N);
  for (let i = 0; i < CURVE_N; i++) {
    const x = (i / (CURVE_N - 1)) * 2 - 1;
    switch (kind) {
      case 'soft':
        c[i] = Math.tanh(2.5 * x) / Math.tanh(2.5);
        break;
      case 'tube': {
        // asymmetric: a small bias adds even harmonics like a triode stage
        const b = 0.18;
        c[i] = (Math.tanh(3 * (x + b)) - Math.tanh(3 * b)) / (1 + Math.tanh(3 * b));
        break;
      }
      case 'hard':
        c[i] = Math.max(-1, Math.min(1, 1.5 * x - 0.5 * x * x * x));
        break;
      case 'power':
        c[i] = Math.tanh(1.4 * x) / Math.tanh(1.4);
        break;
    }
  }
  curveCache.set(kind, c);
  return c as Float32Array<ArrayBuffer>;
}

const db = (d: number) => Math.pow(10, d / 20);

export interface ToneChainDeps {
  gateWorklet: boolean;
  reverbInput: AudioNode;
}

export class ToneChainNode {
  readonly input: GainNode;
  readonly output: GainNode;
  /** post-chain reverb send (connect to the global reverb) */
  readonly send: GainNode;
  private n: Record<string, any> = {};
  private irId = '';
  /** resolves when the current cabinet IR is in place */
  ready: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private ctx: BaseAudioContext,
    chain: ToneChain,
    private deps: ToneChainDeps,
  ) {
    const c = ctx;
    const g = (v = 1) => {
      const x = c.createGain();
      x.gain.value = v;
      return x;
    };
    const f = (type: BiquadFilterType, freq: number, q = 0.707, gain = 0) => {
      const x = c.createBiquadFilter();
      x.type = type;
      x.frequency.value = freq;
      x.Q.value = q;
      x.gain.value = gain;
      return x;
    };
    const ws = (kind: Parameters<typeof curve>[0]) => {
      const x = c.createWaveShaper();
      x.curve = curve(kind);
      x.oversample = '4x';
      return x;
    };
    const n = this.n;
    this.input = g();
    this.output = g();
    this.send = g(0);

    // bass low split: lows bypass the amp entirely
    n.splitLow = f('lowpass', 150, 0.6);
    n.splitLowGain = g(0);
    n.splitHigh = f('highpass', 10, 0.6);
    this.input.connect(n.splitLow).connect(n.splitLowGain).connect(this.output);
    this.input.connect(n.splitHigh);
    let node: AudioNode = n.splitHigh;

    // gate
    if (deps.gateWorklet) {
      n.gate = new AudioWorkletNode(c, 'riffroll-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(n.gate);
      node = n.gate;
    }
    // compressor (dry/wet)
    n.comp = c.createDynamicsCompressor();
    n.comp.attack.value = 0.005;
    n.comp.release.value = 0.12;
    n.compWet = g(0);
    n.compDry = g(1);
    n.compMakeup = g(1);
    n.compSum = g();
    node.connect(n.comp).connect(n.compMakeup).connect(n.compWet).connect(n.compSum);
    node.connect(n.compDry).connect(n.compSum);
    node = n.compSum;

    // drive pedal: mid-hump pre-EQ → soft clip → tone → level
    n.driveHp = f('highpass', 320, 0.7);
    n.driveMid = f('peaking', 900, 0.8, 5);
    n.driveGain = g(4);
    n.driveClip = ws('soft');
    n.driveTone = f('lowpass', 4000, 0.6);
    n.driveLevel = g(1);
    n.driveWet = g(0);
    n.driveDry = g(1);
    n.driveSum = g();
    node.connect(n.driveHp).connect(n.driveMid).connect(n.driveGain).connect(n.driveClip).connect(n.driveTone);
    // the pedal passes some lows clean so it tightens rather than thins the amp
    n.driveTone.connect(n.driveLevel).connect(n.driveWet).connect(n.driveSum);
    node.connect(n.driveDry).connect(n.driveSum);
    node = n.driveSum;

    // amp: input gain → tight HP → stage 1 → interstage LP → stage 2 → tone stack → power amp
    n.ampIn = g(1);
    n.ampTight = f('highpass', 60, 0.7);
    n.stage1 = ws('tube');
    n.interLp = f('lowpass', 7500, 0.6);
    n.interHp = f('highpass', 40, 0.6);
    n.stage2Gain = g(1);
    n.stage2 = ws('tube');
    n.stage2Wet = g(0);
    n.stage2Dry = g(1);
    n.stage2Sum = g();
    n.bass = f('lowshelf', 110);
    n.mid = f('peaking', 650, 0.7);
    n.treble = f('highshelf', 3000);
    n.presence = f('peaking', 4800, 0.9);
    n.powerIn = g(1);
    n.power = ws('power');
    n.ampOut = g(1);
    node.connect(n.ampIn).connect(n.ampTight).connect(n.stage1).connect(n.interLp).connect(n.interHp);
    n.interHp.connect(n.stage2Gain).connect(n.stage2).connect(n.stage2Wet).connect(n.stage2Sum);
    n.interHp.connect(n.stage2Dry).connect(n.stage2Sum);
    n.stage2Sum.connect(n.bass).connect(n.mid).connect(n.treble).connect(n.presence);
    n.presence.connect(n.powerIn).connect(n.power).connect(n.ampOut);
    node = n.ampOut;

    // cabinet
    n.cab = c.createConvolver();
    n.cab.normalize = false;
    n.cabWet = g(1);
    n.cabDry = g(0);
    n.cabSum = g();
    node.connect(n.cab).connect(n.cabWet).connect(n.cabSum);
    node.connect(n.cabDry).connect(n.cabSum);
    node = n.cabSum;

    // post EQ
    n.eqLow = f('lowshelf', 120);
    n.eqMid = f('peaking', 800, 0.8);
    n.eqHigh = f('highshelf', 4000);
    node.connect(n.eqLow).connect(n.eqMid).connect(n.eqHigh);
    node = n.eqHigh;

    // chorus: modulated short delay
    n.chorusDelay = c.createDelay(0.05);
    n.chorusDelay.delayTime.value = 0.012;
    n.chorusLfo = c.createOscillator();
    n.chorusLfo.frequency.value = 0.8;
    n.chorusDepth = g(0.002);
    n.chorusLfo.connect(n.chorusDepth).connect(n.chorusDelay.delayTime);
    n.chorusLfo.start();
    n.chorusWet = g(0);
    n.chorusSum = g();
    node.connect(n.chorusSum);
    node.connect(n.chorusDelay).connect(n.chorusWet).connect(n.chorusSum);
    node = n.chorusSum;

    // delay with damped feedback
    n.delay = c.createDelay(2);
    n.delayFb = g(0.3);
    n.delayDamp = f('lowpass', 3500, 0.5);
    n.delayWet = g(0);
    n.delaySum = g();
    node.connect(n.delaySum);
    node.connect(n.delay);
    n.delay.connect(n.delayDamp).connect(n.delayFb).connect(n.delay);
    n.delayDamp.connect(n.delayWet).connect(n.delaySum);
    node = n.delaySum;

    n.level = g(1);
    node.connect(n.level).connect(this.output);
    this.output.connect(this.send);
    this.send.connect(deps.reverbInput);

    this.update(chain);
  }

  update(ch: ToneChain) {
    if (this.disposed) return;
    const n = this.n;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.015);

    // low split (bass)
    const split = ch.lowSplit ?? 0;
    set(n.splitLowGain.gain, split > 0 ? 1 : 0);
    n.splitLow.frequency.value = split || 150;
    n.splitHigh.frequency.value = split > 0 ? split : 10;

    if (n.gate) {
      n.gate.parameters.get('enabled').value = ch.gate.on ? 1 : 0;
      n.gate.parameters.get('threshold').value = ch.gate.threshold;
      n.gate.parameters.get('release').value = ch.gate.release;
    }
    n.comp.threshold.value = ch.comp.threshold;
    n.comp.ratio.value = ch.comp.ratio;
    set(n.compWet.gain, ch.comp.on ? 1 : 0);
    set(n.compDry.gain, ch.comp.on ? 0 : 1);
    set(n.compMakeup.gain, db(Math.max(0, -ch.comp.threshold * (1 - 1 / ch.comp.ratio) * 0.35)));

    set(n.driveGain.gain, 1 + ch.drive.gain * 1.6);
    n.driveTone.frequency.value = 1800 + ch.drive.tone * 700;
    set(n.driveLevel.gain, (ch.drive.level / 5) * 0.55);
    set(n.driveWet.gain, ch.drive.on ? 1 : 0);
    set(n.driveDry.gain, ch.drive.on ? 0 : 1);

    // amp voicing by character. Output compensation (`comp`) was level-matched by measurement: an open Em chord
    // and a palm-muted E5 chug rendered through each preset land at a similar loudness (see docs/DECISIONS.md).
    const a = ch.amp;
    let inGain: number, tight: number, s2: number, comp: number, interLp: number;
    switch (a.character) {
      case 'clean':
        inGain = 0.35 + a.gain * 0.09; // stays mostly in the linear region
        tight = 60;
        s2 = 0;
        interLp = 9000;
        comp = 0.32;
        break;
      case 'crunch':
        inGain = db(4 + a.gain * 2.6);
        tight = 90;
        s2 = 0;
        interLp = 7000;
        comp = 0.15;
        break;
      default:
        // high gain: tight low cut before clipping keeps palm mutes from going flubby
        inGain = db(6 + a.gain * 2.4);
        tight = 140;
        s2 = db(6 + a.gain * 0.8);
        interLp = 6000;
        comp = 0.2;
    }
    set(n.ampIn.gain, inGain);
    n.ampTight.frequency.value = tight;
    n.interLp.frequency.value = interLp;
    set(n.stage2Gain.gain, s2 || 1);
    set(n.stage2Wet.gain, s2 ? 1 : 0);
    set(n.stage2Dry.gain, s2 ? 0 : 1);
    n.bass.gain.value = (a.bass - 5) * 2.4;
    n.mid.gain.value = (a.mid - 5) * 2.6;
    n.treble.gain.value = (a.treble - 5) * 2.4;
    n.presence.gain.value = (a.presence - 5) * 2;
    set(n.powerIn.gain, 0.4 + a.master * 0.12);
    set(n.ampOut.gain, comp);

    // cab
    const ir = ch.cab.on ? ch.cab.ir : '';
    if (ir && ir !== this.irId) {
      this.irId = ir;
      if (ir.startsWith('builtin:'))
        this.ready = cabIR(ir, this.ctx.sampleRate).then((buf) => {
          if (!this.disposed && this.irId === ir) n.cab.buffer = buf;
        });
    }
    set(n.cabWet.gain, ch.cab.on ? ch.cab.mix : 0);
    set(n.cabDry.gain, ch.cab.on ? 1 - ch.cab.mix : 1);

    n.eqLow.gain.value = ch.eq.low;
    n.eqMid.gain.value = ch.eq.mid;
    n.eqHigh.gain.value = ch.eq.high;

    n.chorusLfo.frequency.value = ch.chorus.rate;
    set(n.chorusDepth.gain, 0.0005 + ch.chorus.depth * 0.004);
    set(n.chorusWet.gain, ch.chorus.on ? ch.chorus.mix : 0);

    n.delay.delayTime.setTargetAtTime(ch.delay.time, t, 0.05);
    set(n.delayFb.gain, Math.min(0.9, ch.delay.feedback));
    set(n.delayWet.gain, ch.delay.on ? ch.delay.mix : 0);

    set(this.send.gain, ch.reverb.on ? ch.reverb.mix * 1.6 : 0);
  }

  /** Use a user-supplied IR (decoded WAV). */
  setUserIR(buf: AudioBuffer, id: string) {
    this.irId = id;
    this.n.cab.buffer = buf;
  }

  dispose() {
    this.disposed = true;
    try {
      this.n.chorusLfo.stop();
    } catch {
      /* ok */
    }
    for (const node of Object.values(this.n)) (node as AudioNode).disconnect?.();
    this.input.disconnect();
    this.output.disconnect();
    this.send.disconnect();
  }
}
