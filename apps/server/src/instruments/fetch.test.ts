import { describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeReadable } from './fetch.js';

describe('unpacked instrument packs', () => {
  // Windows has no Unix permissions to fix
  it.skipIf(process.platform === 'win32')(
    'are made readable by everyone (the server runs as PUID)',
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'riffroll-perm-'));
      try {
        // what 7-Zip leaves for a zip made on Windows: folders for the extracting user only
        await mkdir(path.join(dir, 'samples'));
        await writeFile(path.join(dir, 'kit.sfz'), 'x');
        await writeFile(path.join(dir, 'samples', 'a.wav'), 'x');
        await chmod(path.join(dir, 'samples', 'a.wav'), 0o600);
        await chmod(path.join(dir, 'samples'), 0o700);
        await makeReadable(dir);
        expect((await stat(path.join(dir, 'samples'))).mode & 0o777).toBe(0o755);
        expect((await stat(path.join(dir, 'samples', 'a.wav'))).mode & 0o777).toBe(0o644);
        expect((await stat(path.join(dir, 'kit.sfz'))).mode & 0o777).toBe(0o644);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
