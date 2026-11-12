import { describe, expect, it } from 'vitest';
import { parseSfz, selectRegions, sfzNote } from './sfz';

const GUITAR = `
//+ Name: test
<control> default_path=samples/
<global>
 ampeg_release=0.2

<group>
 //+ RandomRegion: Yes
 lokey=35 hikey=38
 hivel=92
 pitch_keycenter=36
<region>
 lorand=0 hirand=0.5
 sample=bridge/C2 soft 01.flac
<region> lorand=0.5 hirand=1 sample=bridge/C2 soft 02.flac
<group> lokey=35 hikey=38 lovel=93 pitch_keycenter=36
<region> sample=bridge/C2_01.flac
`;

describe('sfz parser', () => {
  it('note names', () => {
    expect(sfzNote('c4')).toBe(60);
    expect(sfzNote('e2')).toBe(40);
    expect(sfzNote('f#2')).toBe(42);
    expect(sfzNote('Bb1')).toBe(34);
    expect(sfzNote('64')).toBe(64);
  });

  it('inherits global/group opcodes, applies default_path, keeps spaces in sample paths', () => {
    const inst = parseSfz(GUITAR);
    expect(inst.regions).toHaveLength(3);
    const r = inst.regions[0];
    expect(r.sample).toBe('samples/bridge/C2 soft 01.flac');
    expect(r.lokey).toBe(35);
    expect(r.hikey).toBe(38);
    expect(r.pitchKeycenter).toBe(36);
    expect(r.hivel).toBe(92);
    expect(r.ampeg.release).toBe(0.2);
    expect(inst.regions[1].lorand).toBe(0.5);
    expect(inst.regions[2].lovel).toBe(93);
  });

  it('selects by key, velocity and random range', () => {
    const inst = parseSfz(GUITAR);
    const rr = () => 0;
    expect(selectRegions(inst, 36, 80, 0.2, rr).map((r) => r.sample)).toEqual([
      'samples/bridge/C2 soft 01.flac',
    ]);
    expect(selectRegions(inst, 36, 80, 0.7, rr).map((r) => r.sample)).toEqual([
      'samples/bridge/C2 soft 02.flac',
    ]);
    expect(selectRegions(inst, 36, 120, 0.7, rr).map((r) => r.sample)).toEqual(['samples/bridge/C2_01.flac']);
    expect(selectRegions(inst, 50, 80, 0.2, rr)).toEqual([]);
  });

  it('round robins via seq_length / seq_position, key=, #define, choke groups', () => {
    const inst = parseSfz(`
#define $HH 42
<group> key=$HH seq_length=2 group=1 off_by=2
<region> seq_position=1 sample=hh1.wav
<region> seq_position=2 sample=hh2.wav
<region> key=46 group=2 sample=open.wav loop_mode=one_shot
`);
    expect(inst.regions[0].lokey).toBe(42);
    expect(inst.regions[0].pitchKeycenter).toBe(42);
    expect(inst.regions[0].offBy).toBe(2);
    expect(inst.regions[2].loopMode).toBe('one_shot');
    expect(selectRegions(inst, 42, 100, 0.1, () => 0)[0].sample).toBe('hh1.wav');
    expect(selectRegions(inst, 42, 100, 0.1, () => 1)[0].sample).toBe('hh2.wav');
  });
});
