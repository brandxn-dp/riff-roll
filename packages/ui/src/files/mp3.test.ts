import { describe, expect, it } from 'vitest';
import { encodeMp3, id3Tag } from './mp3';

describe('MP3 export', () => {
  it('encodes stereo PCM to MP3 frames after an ID3 tag with the title and artist', () => {
    const sr = 44100;
    const n = sr; // one second of a 440 Hz tone
    const l = new Float32Array(n).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr));
    const bytes = encodeMp3({
      channels: [l, l],
      sampleRate: sr,
      kbps: 192,
      title: 'Dropped Signal',
      artist: 'Riff Roll',
    });
    expect(String.fromCharCode(...bytes.slice(0, 3))).toBe('ID3');
    const tagLen = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    // an MPEG audio frame sync right after the tag
    expect(bytes[tagLen]).toBe(0xff);
    expect(bytes[tagLen + 1] & 0xe0).toBe(0xe0);
    // about 192 kbit/s for one second
    expect(bytes.length - tagLen).toBeGreaterThan(20000);
    expect(bytes.length - tagLen).toBeLessThan(30000);
  });

  it('writes UTF-16 text frames, and no frames for empty fields', () => {
    const t = id3Tag('Ünïcode', '');
    expect(String.fromCharCode(...t.slice(10, 14))).toBe('TIT2');
    expect(t.length).toBe(10 + 10 + 3 + 'Ünïcode'.length * 2);
    expect(id3Tag('', '').length).toBe(10);
  });
});
