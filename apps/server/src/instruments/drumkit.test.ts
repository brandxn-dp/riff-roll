import { describe, expect, it } from 'vitest';
import { kitSfz, selectKitFiles, type KitPieceMap } from './drumkit.js';
import { parseSfz, selectRegions } from '../../../../packages/audio/src/sfz.js';

const MAP: KitPieceMap[] = [
  { key: 36, dir: 'Samples/kick/', mics: { kick: 0, oh: -6 } },
  { key: 42, dir: 'Samples/hh_closed/', mics: { cl: 0 }, group: 1 },
  { key: 46, dir: 'Samples/hh_open/', mics: { cl: 0 }, group: 2, offBy: 1 },
];

const files = [
  ...[1, 2].flatMap((vl) =>
    [1, 2, 3, 4].flatMap((rr) => ['kick', 'oh', 'sn'].map((m) => `Samples/kick/${m}/k_vl${vl}_rr${rr}.flac`)),
  ),
  'Samples/hh_closed/cl/hh_vl1_rr1.flac',
  'Samples/hh_open/cl/ho_vl1_rr1.flac',
  'Samples/other/cl/x_vl1_rr1.flac',
];

describe('normalised drum kit', () => {
  it('keeps only the chosen mics and round robins', () => {
    const sel = selectKitFiles(files, MAP, 2);
    expect(sel.filter((f) => f.includes('/kick/'))).toHaveLength(2 * 2 * 2); // 2 layers × 2 rr × 2 mics
    expect(sel.some((f) => f.includes('/sn/'))).toBe(false);
    expect(sel.some((f) => f.includes('other'))).toBe(false);
  });

  it('writes an SFZ the sampler can play: velocity layers, round robins, mic layering, chokes', () => {
    const inst = parseSfz(kitSfz(selectKitFiles(files, MAP, 2), MAP, 2));
    const soft = selectRegions(inst, 36, 30, 0.5, () => 0);
    expect(soft.map((r) => r.sample).sort()).toEqual([
      'Samples/kick/kick/k_vl1_rr1.flac',
      'Samples/kick/oh/k_vl1_rr1.flac',
    ]);
    const loudRr2 = selectRegions(inst, 36, 120, 0.5, () => 1);
    expect(loudRr2.every((r) => r.sample.includes('vl2_rr2'))).toBe(true);
    expect(loudRr2.find((r) => r.raw.riffroll_mic === 'oh')?.volume).toBe(-6);
    const open = inst.regions.find((r) => r.lokey === 46)!;
    expect(open.offBy).toBe(1);
    expect(inst.regions.find((r) => r.lokey === 42)!.group).toBe(1);
    expect(open.loopMode).toBe('one_shot');
  });
});
