/**
 * SoundFont 2 (.sf2) and SoundFont 3 (.sf3, Ogg-compressed samples) support, by conversion: a preset becomes an
 * SFZ file plus one audio file per sample, so the existing sampler, offline render, desktop and server storage all
 * work unchanged. Conversion follows the SF2.04 spec: instrument zones over an optional global zone, preset
 * generators added on top, key/velocity ranges intersected.
 */

export interface SfPreset {
  /** index into the file's preset table */
  index: number;
  name: string;
  bank: number;
  program: number;
  /** bank 128 is the percussion bank */
  drums: boolean;
}

interface Sample {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  rate: number;
  pitch: number;
  correction: number;
  type: number;
}
type Gens = Map<number, number>;
interface Zone {
  gens: Gens;
}
interface Inst {
  name: string;
  zones: Zone[];
  global?: Zone;
}
interface PresetData extends SfPreset {
  zones: Zone[];
  global?: Zone;
}

export interface SoundFont {
  name: string;
  presets: SfPreset[];
  /** SF3: samples are Ogg Vorbis files */
  compressed: boolean;
  /** internals used by the converter */
  _p: { presets: PresetData[]; insts: Inst[]; samples: Sample[]; smpl: Uint8Array };
}

// generator numbers (SF2.04 §8.1.2)
const G = {
  startOffset: 0,
  endOffset: 1,
  loopStartOffset: 2,
  loopEndOffset: 3,
  startCoarse: 4,
  endCoarse: 12,
  pan: 17,
  delayVol: 33,
  attackVol: 34,
  holdVol: 35,
  decayVol: 36,
  sustainVol: 37,
  releaseVol: 38,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  loopStartCoarse: 45,
  keynum: 46,
  attenuation: 48,
  loopEndCoarse: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  exclusiveClass: 57,
  rootKey: 58,
};
const RANGE = new Set([G.keyRange, G.velRange]);
const UNSIGNED = new Set([G.instrument, G.sampleID, G.sampleModes, G.exclusiveClass]);

function str(b: Uint8Array, o: number, n: number) {
  let s = '';
  for (let i = 0; i < n && b[o + i]; i++) s += String.fromCharCode(b[o + i]);
  return s.trim();
}

export function parseSoundFont(bytes: Uint8Array): SoundFont {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (o: number) => str(bytes, o, 4);
  if (id(0) !== 'RIFF' || id(8) !== 'sfbk') throw new Error('Not a SoundFont (.sf2 / .sf3) file.');
  const chunks = new Map<string, Uint8Array>();
  let name = '';
  let ver = 2;
  // walk RIFF: top-level LISTs (INFO, sdta, pdta) and their sub-chunks
  const walk = (start: number, end: number) => {
    let p = start;
    while (p + 8 <= end) {
      const cid = id(p);
      const len = dv.getUint32(p + 4, true);
      const body = p + 8;
      if (cid === 'LIST') walk(body + 4, Math.min(end, body + len));
      else {
        const data = bytes.subarray(body, Math.min(end, body + len));
        chunks.set(cid, data);
        if (cid === 'INAM') name = str(data, 0, data.length);
        if (cid === 'ifil' && data.length >= 2) ver = data[0] | (data[1] << 8);
      }
      p = body + len + (len & 1);
    }
  };
  walk(12, Math.min(bytes.length, 8 + dv.getUint32(4, true)));
  const need = (k: string) => {
    const c = chunks.get(k);
    if (!c) throw new Error(`This SoundFont is missing its "${k}" chunk.`);
    return new DataView(c.buffer, c.byteOffset, c.byteLength);
  };
  const smpl = chunks.get('smpl') ?? new Uint8Array();

  const readGens = (d: DataView, from: number, to: number): Gens => {
    const g: Gens = new Map();
    for (let i = from; i < to; i++) {
      const op = d.getUint16(i * 4, true);
      if (RANGE.has(op)) g.set(op, d.getUint8(i * 4 + 2) | (d.getUint8(i * 4 + 3) << 8));
      else if (UNSIGNED.has(op)) g.set(op, d.getUint16(i * 4 + 2, true));
      else g.set(op, d.getInt16(i * 4 + 2, true));
    }
    return g;
  };
  /** zones of headers [i] built from bags; a first zone without the terminal generator is the global zone */
  const zonesOf = (hdrBag: number[], bag: DataView, gen: DataView, terminal: number) =>
    hdrBag.slice(0, -1).map((b0, i) => {
      const b1 = hdrBag[i + 1];
      const zones: Zone[] = [];
      for (let b = b0; b < b1; b++) {
        const g0 = bag.getUint16(b * 4, true),
          g1 = bag.getUint16((b + 1) * 4, true);
        zones.push({ gens: readGens(gen, g0, g1) });
      }
      const global = zones.length && !zones[0].gens.has(terminal) ? zones.shift() : undefined;
      return { zones: zones.filter((z) => z.gens.has(terminal)), global };
    });

  const shdr = need('shdr');
  const samples: Sample[] = [];
  for (let o = 0; o + 46 <= shdr.byteLength - 46; o += 46)
    samples.push({
      name: str(new Uint8Array(shdr.buffer, shdr.byteOffset + o, 20), 0, 20),
      start: shdr.getUint32(o + 20, true),
      end: shdr.getUint32(o + 24, true),
      loopStart: shdr.getUint32(o + 28, true),
      loopEnd: shdr.getUint32(o + 32, true),
      rate: shdr.getUint32(o + 36, true),
      pitch: shdr.getUint8(o + 40),
      correction: shdr.getInt8(o + 41),
      type: shdr.getUint16(o + 44, true),
    });

  const inst = need('inst');
  const instBags: number[] = [];
  const instNames: string[] = [];
  for (let o = 0; o + 22 <= inst.byteLength; o += 22) {
    instNames.push(str(new Uint8Array(inst.buffer, inst.byteOffset + o, 20), 0, 20));
    instBags.push(inst.getUint16(o + 20, true));
  }
  const insts: Inst[] = zonesOf(instBags, need('ibag'), need('igen'), G.sampleID).map((z, i) => ({
    name: instNames[i],
    ...z,
  }));

  const phdr = need('phdr');
  const pBags: number[] = [];
  const pInfo: Omit<PresetData, 'zones' | 'global'>[] = [];
  for (let o = 0; o + 38 <= phdr.byteLength; o += 38) {
    const bank = phdr.getUint16(o + 22, true);
    pInfo.push({
      index: pInfo.length,
      name: str(new Uint8Array(phdr.buffer, phdr.byteOffset + o, 20), 0, 20),
      program: phdr.getUint16(o + 20, true),
      bank,
      drums: bank === 128,
    });
    pBags.push(phdr.getUint16(o + 24, true));
  }
  const presets: PresetData[] = zonesOf(pBags, need('pbag'), need('pgen'), G.instrument).map((z, i) => ({
    ...pInfo[i],
    ...z,
  }));
  const compressed = ver >= 3 || samples.some((s) => s.type & 0x10);
  return {
    name: name || 'SoundFont',
    presets: presets
      .filter((p) => p.zones.length)
      .map(({ index, name, bank, program, drums }) => ({ index, name, bank, program, drums }))
      .sort((a, b) => a.bank - b.bank || a.program - b.program),
    compressed,
    _p: { presets, insts, samples, smpl },
  };
}

// ---------------- conversion ----------------
const tc = (v: number | undefined, def = -12000) => Math.pow(2, (v ?? def) / 1200); // timecents → seconds
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const lo = (range: number | undefined) => (range === undefined ? 0 : range & 0xff);
const hi = (range: number | undefined) => (range === undefined ? 127 : (range >> 8) & 0xff);
const safe = (s: string) => s.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'sample';

function wav16(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export interface ConvertedInstrument {
  /** SFZ text; sample paths are relative to it (inside `samples/`) */
  sfz: string;
  /** files relative to the SFZ: samples/NNN-name.wav (or .ogg for SF3) */
  files: { path: string; data: Uint8Array }[];
  regions: number;
}

/** Convert one preset to SFZ + sample files. */
export function soundFontPresetToSfz(sf: SoundFont, presetIndex: number): ConvertedInstrument {
  const { presets, insts, samples, smpl } = sf._p;
  const p = presets[presetIndex];
  if (!p) throw new Error('No such preset.');
  const files = new Map<number, string>();
  const out: { path: string; data: Uint8Array }[] = [];
  const lines: string[] = [
    `// ${p.name} (bank ${p.bank}, program ${p.program}) converted from the SoundFont "${sf.name}" by Riff Roll`,
  ];
  let regions = 0;

  for (const pz of p.zones) {
    const pg = new Map([...(p.global?.gens ?? []), ...pz.gens]);
    const ins = insts[pz.gens.get(G.instrument)!];
    if (!ins) continue;
    for (const iz of ins.zones) {
      const g = new Map([...(ins.global?.gens ?? []), ...iz.gens]);
      const s = samples[g.get(G.sampleID)!];
      if (!s || s.type & 0x8000) continue; // ROM samples aren't in the file
      // ranges: instrument range intersected with the preset zone's range
      const kLo = Math.max(lo(g.get(G.keyRange)), lo(pg.get(G.keyRange)));
      const kHi = Math.min(hi(g.get(G.keyRange)), hi(pg.get(G.keyRange)));
      const vLo = Math.max(lo(g.get(G.velRange)), lo(pg.get(G.velRange)));
      const vHi = Math.min(hi(g.get(G.velRange)), hi(pg.get(G.velRange)));
      if (kLo > kHi || vLo > vHi) continue;
      // preset generators add to the instrument's (SF2.04 §9.4)
      const sum = (op: number, def = 0) => (g.get(op) ?? def) + (pg.get(op) ?? 0);

      const root = (g.get(G.rootKey) ?? -1) >= 0 ? g.get(G.rootKey)! : s.pitch <= 127 ? s.pitch : 60;
      const tune = sum(G.coarseTune) * 100 + sum(G.fineTune) + s.correction;
      const startOff = (g.get(G.startOffset) ?? 0) + (g.get(G.startCoarse) ?? 0) * 32768;
      const endOff = (g.get(G.endOffset) ?? 0) + (g.get(G.endCoarse) ?? 0) * 32768;
      const loopS = s.loopStart + (g.get(G.loopStartOffset) ?? 0) + (g.get(G.loopStartCoarse) ?? 0) * 32768;
      const loopE = s.loopEnd + (g.get(G.loopEndOffset) ?? 0) + (g.get(G.loopEndCoarse) ?? 0) * 32768;
      const compressed = !!(s.type & 0x10);

      // one file per (sample, start/end offsets)
      const key = s.start * 7 + startOff * 13 + endOff;
      let file = files.get(key);
      if (!file) {
        const n = String(files.size + 1).padStart(3, '0');
        file = `samples/${n}-${safe(s.name)}.${compressed ? 'ogg' : 'wav'}`;
        const data = compressed
          ? smpl.slice(s.start, s.end) // SF3: byte offsets of an Ogg Vorbis file
          : wav16(smpl.slice((s.start + startOff) * 2, (s.end + endOff) * 2), s.rate);
        files.set(key, file);
        out.push({ path: file, data });
      }

      const ops: string[] = [`sample=${file}`, `lokey=${kLo}`, `hikey=${kHi}`, `pitch_keycenter=${root}`];
      const keynum = g.get(G.keynum);
      if (keynum !== undefined && keynum >= 0) ops.push(`pitch_keytrack=0`);
      if (vLo > 0 || vHi < 127) ops.push(`lovel=${vLo}`, `hivel=${vHi}`);
      if (tune) ops.push(`tune=${tune}`);
      // attenuation is in centibels; most players apply it at 0.4 strength (EMU behaviour), so do we
      const att = sum(G.attenuation);
      if (att) ops.push(`volume=${r3((-att / 10) * 0.4)}`);
      const pan = sum(G.pan);
      if (pan) ops.push(`pan=${r3(Math.max(-100, Math.min(100, pan / 5)))}`);
      const delay = tc(sum(G.delayVol, -12000));
      const attack = tc(sum(G.attackVol, -12000));
      const hold = tc(sum(G.holdVol, -12000));
      const decay = tc(sum(G.decayVol, -12000));
      const release = tc(sum(G.releaseVol, -12000));
      const sustainCb = Math.max(0, Math.min(1440, sum(G.sustainVol)));
      if (delay > 0.002) ops.push(`ampeg_delay=${r3(delay)}`);
      if (attack > 0.002) ops.push(`ampeg_attack=${r3(attack)}`);
      if (hold > 0.002) ops.push(`ampeg_hold=${r3(hold)}`);
      if (sustainCb > 0) {
        ops.push(`ampeg_decay=${r3(decay)}`);
        ops.push(`ampeg_sustain=${r3(100 * Math.pow(10, -sustainCb / 200))}`);
      }
      ops.push(`ampeg_release=${r3(Math.max(0.01, release))}`);
      const mode = g.get(G.sampleModes) ?? 0;
      if ((mode === 1 || mode === 3) && loopE > loopS) {
        ops.push(`loop_mode=${mode === 3 ? 'loop_sustain' : 'loop_continuous'}`);
        // loop points relative to the extracted file (SF3 stores them relative to the sample already)
        const base = compressed ? 0 : s.start + startOff;
        ops.push(`loop_start=${Math.max(0, loopS - base)}`, `loop_end=${Math.max(0, loopE - base)}`);
      }
      const ex = g.get(G.exclusiveClass);
      if (ex) ops.push(`group=${ex}`, `off_by=${ex}`); // e.g. open hi-hat cut by the closed one
      lines.push(`<region> ${ops.join(' ')}`);
      regions++;
    }
  }
  if (!regions) throw new Error(`The preset "${p.name}" has no playable samples.`);
  return { sfz: lines.join('\n') + '\n', files: out, regions };
}
