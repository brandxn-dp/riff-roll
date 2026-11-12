// Noise gate AudioWorklet: envelope follower with hysteresis, smooth attack/release.
// Plain JS so it can be loaded with audioWorklet.addModule() without a build step.
class RiffRollGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -55, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.08, minValue: 0.005, maxValue: 2, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.env = 0;
    this.gain = 1;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    const enabled = params.enabled[0] >= 0.5;
    const thr = Math.pow(10, params.threshold[0] / 20);
    const open = thr * 1.4; // hysteresis
    const atk = Math.exp(-1 / (0.0008 * sampleRate));
    const rel = Math.exp(-1 / (params.release[0] * sampleRate));
    const envRel = Math.exp(-1 / (0.03 * sampleRate));
    const n = input[0].length;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) {
        const v = Math.abs(input[c][i]);
        if (v > peak) peak = v;
      }
      this.env = peak > this.env ? peak : this.env * envRel + peak * (1 - envRel);
      let target = this.gain;
      if (this.env > open) target = 1;
      else if (this.env < thr) target = 0;
      this.gain =
        target > this.gain ? target + (this.gain - target) * atk : target + (this.gain - target) * rel;
      const g = enabled ? this.gain : 1;
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ? input[c][i] : input[0][i]) * g;
    }
    return true;
  }
}
registerProcessor('riffroll-gate', RiffRollGate);
