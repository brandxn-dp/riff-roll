import { describe, expect, it } from 'vitest';
import { parseSoundFont, soundFontPresetToSfz } from './soundfont';
import { parseSfz } from './sfz';

// ---------- a tiny SoundFont writer, enough to build test files ----------
const enc = (s: string, n?: number) => {
  const b = new Uint8Array(n ?? s.length);
  for (let i = 0; i < Math.min(s.length, b.length); i++) b[i] = s.charCodeAt(i);
  return b;
};
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u16 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255]);
const u32 = (v: number) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
const s16 = (v: number) => u16(v & 0xffff);
const chunk = (id: string, data: Uint8Array) =>
  cat(enc(id), u32(data.length), data, data.length & 1 ? new Uint8Array(1) : new Uint8Array());
const list = (type: string, ...chunks: Uint8Array[]) => chunk('LIST', cat(enc(type), ...chunks));
const gen = (op: number, amount: number | [number, number]) =>
  cat(u16(op), Array.isArray(amount) ? new Uint8Array(amount) : s16(amount));

/**
 * One 400-frame sample. Instrument "Keys": zone A keys 0–59 root 48, zone B keys 60–127 root 72 with a loop,
 * attenuation and a fine tune; a global zone sets the release. Preset "Piano" (bank 0, program 0) uses it, with
 * a preset-level coarse tune of +1 on top. Drum preset "Kit" (bank 128) uses the same instrument with exclusive
 * class 1 on zone B.
 */
function buildSf2(): Uint8Array {
  const frames = 400;
  const pcm = new Uint8Array((frames + 46) * 2); // +46 zero frames after each sample (spec)
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((i / frames) * Math.PI * 8) * 12000);
    pcm[i * 2] = v & 255;
    pcm[i * 2 + 1] = (v >> 8) & 255;
  }
  const shdr = cat(
    enc('Sine', 20),
    u32(0),
    u32(frames),
    u32(100),
    u32(300),
    u32(44100),
    new Uint8Array([60]),
    new Uint8Array([-5 & 255]),
    u16(0),
    u16(1),
    enc('EOS', 20),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    new Uint8Array([0, 0]),
    u16(0),
    u16(0),
  );
  // instrument generators: global [release], A [keyRange 0-59, root 48, sampleID], B [keyRange 60-127, root 72,
  // fine tune 10, attenuation 50 cB, sampleModes 1, exclusiveClass 1, sampleID]
  const igen = cat(
    gen(38, 0), // global: release 1 s (timecents 0)
    gen(43, [0, 59]),
    gen(58, 48),
    gen(53, 0),
    gen(43, [60, 127]),
    gen(58, 72),
    gen(52, 10),
    gen(48, 50),
    gen(54, 1),
    gen(57, 1),
    gen(53, 0),
    gen(0, 0), // terminal
  );
  const ibag = cat(u16(0), u16(0), u16(1), u16(0), u16(4), u16(0), u16(11), u16(0));
  const inst = cat(enc('Keys', 20), u16(0), enc('EOI', 20), u16(3));
  const pgen = cat(gen(51, 1), gen(41, 0), gen(41, 0), gen(0, 0)); // Piano: [coarse +1, instrument 0]; Kit: [instrument 0]
  const pbag = cat(u16(0), u16(0), u16(2), u16(0), u16(3), u16(0));
  const phdr = cat(
    enc('Piano', 20),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(0),
    enc('Kit', 20),
    u16(0),
    u16(128),
    u16(1),
    u32(0),
    u32(0),
    u32(0),
    enc('EOP', 20),
    u16(0),
    u16(0),
    u16(2),
    u32(0),
    u32(0),
    u32(0),
  );
  const empty = new Uint8Array(4); // pmod/imod terminal records
  const body = cat(
    enc('sfbk'),
    list('INFO', chunk('ifil', cat(u16(2), u16(1))), chunk('INAM', enc('Test Font\0'))),
    list('sdta', chunk('smpl', pcm)),
    list(
      'pdta',
      chunk('phdr', phdr),
      chunk('pbag', pbag),
      chunk('pmod', new Uint8Array(10)),
      chunk('pgen', pgen),
      chunk('inst', inst),
      chunk('ibag', ibag),
      chunk('imod', new Uint8Array(10)),
      chunk('igen', igen),
      chunk('shdr', shdr),
    ),
  );
  void empty;
  return cat(enc('RIFF'), u32(body.length), body);
}

describe('SoundFont import', () => {
  const sf = parseSoundFont(buildSf2());

  it('lists the presets, drum kits marked', () => {
    expect(sf.name).toBe('Test Font');
    expect(sf.presets.map((p) => [p.name, p.bank, p.program, p.drums])).toEqual([
      ['Piano', 0, 0, false],
      ['Kit', 128, 0, true],
    ]);
  });

  it('converts a preset to SFZ regions the sampler understands', () => {
    const piano = sf.presets.find((p) => p.name === 'Piano')!;
    const out = soundFontPresetToSfz(sf, piano.index);
    expect(out.regions).toBe(2);
    const sfz = parseSfz(out.sfz);
    const [a, b] = sfz.regions;
    expect([a.lokey, a.hikey, a.pitchKeycenter]).toEqual([0, 59, 48]);
    expect([b.lokey, b.hikey, b.pitchKeycenter]).toEqual([60, 127, 72]);
    // preset coarse +1 semitone added to the instrument, plus the sample's −5 cent correction (and +10 fine on B)
    expect(a.tune).toBe(100 - 5);
    expect(b.tune).toBe(100 + 10 - 5);
    expect(b.volume).toBeCloseTo(-2, 5); // 50 cB at 0.4 strength
    expect(a.ampeg.release).toBeCloseTo(1, 3); // from the instrument's global zone
    expect(b.loopMode).toBe('loop_continuous');
    expect([b.loopStart, b.loopEnd]).toEqual([100, 300]);
    expect([b.group, b.offBy]).toEqual([1, 1]);
  });

  it('writes each sample once, as a 16-bit mono WAV', () => {
    const out = soundFontPresetToSfz(sf, sf.presets[0].index);
    expect(out.files).toHaveLength(1);
    const f = out.files[0];
    expect(f.path).toBe('samples/001-Sine.wav');
    const dv = new DataView(f.data.buffer, f.data.byteOffset);
    expect(String.fromCharCode(...f.data.slice(0, 4))).toBe('RIFF');
    expect(dv.getUint16(22, true)).toBe(1); // mono
    expect(dv.getUint32(24, true)).toBe(44100);
    expect(dv.getUint32(40, true)).toBe(400 * 2);
  });

  it('rejects files that are not SoundFonts', () => {
    expect(() => parseSoundFont(new Uint8Array(64))).toThrow(/Not a SoundFont/);
  });
});
