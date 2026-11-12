/** Generates THIRD_PARTY_NOTICES.md and the UI's credits data from instruments/manifest.json. */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOFTWARE = [
  { name: 'React', license: 'MIT', url: 'https://react.dev' },
  { name: 'Zustand', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'zod', license: 'MIT', url: 'https://zod.dev' },
  { name: 'fflate', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
  { name: 'alphaTab', license: 'MPL-2.0', url: 'https://alphatab.net' },
  { name: 'spessasynth_lib', license: 'Apache-2.0', url: 'https://github.com/spessasus/spessasynth_lib' },
  { name: 'Fastify', license: 'MIT', url: 'https://fastify.dev' },
  { name: 'Electron', license: 'MIT', url: 'https://www.electronjs.org' },
  { name: '7-Zip (via 7zip-bin)', license: 'LGPL-2.1 / MIT', url: 'https://www.7-zip.org' },
  { name: 'IBM Plex Sans / Mono', license: 'OFL-1.1', url: 'https://github.com/IBM/plex' },
  { name: 'Barlow Condensed', license: 'OFL-1.1', url: 'https://github.com/jpt/barlow' },
];

export async function generateNotices() {
  const manifest = JSON.parse(await readFile(path.join(root, 'instruments/manifest.json'), 'utf8'));
  const instruments = manifest.instruments.map((i: Record<string, string>) => ({
    name: i.name,
    author: i.author,
    license: i.license,
    url: i.homepage,
    attribution: i.attribution,
  }));
  const md = [
    '# Third-party notices',
    '',
    'Generated from `instruments/manifest.json` by `pnpm notices`. Do not edit by hand.',
    '',
    '## Instruments and samples',
    '',
    ...instruments.map(
      (i: Record<string, string>) =>
        `- **${i.name}** by ${i.author} — ${i.license} — ${i.url}\n  ${i.attribution}`,
    ),
    '',
    '## Software',
    '',
    ...SOFTWARE.map((s) => `- **${s.name}** — ${s.license} — ${s.url}`),
    '',
  ].join('\n');
  await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), md);
  await writeFile(
    path.join(root, 'packages/ui/src/credits.json'),
    JSON.stringify({ instruments, software: SOFTWARE }, null, 2) + '\n',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await generateNotices();
  console.log('wrote THIRD_PARTY_NOTICES.md and packages/ui/src/credits.json');
}
