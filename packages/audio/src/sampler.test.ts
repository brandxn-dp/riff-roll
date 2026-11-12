import { describe, expect, it } from 'vitest';
import { joinUrl } from './sampler';

describe('joinUrl', () => {
  it('escapes spaces but keeps "+" literal so decodeURI-based static servers find the file', () => {
    expect(joinUrl('/instruments/', 'guitar/EGuitar SFZ+FLAC/a #1?.flac')).toBe(
      '/instruments/guitar/EGuitar%20SFZ+FLAC/a%20%231%3F.flac',
    );
    expect(joinUrl('/instruments', 'x/y.sfz')).toBe('/instruments/x/y.sfz');
  });
});
