import { useEffect, useState } from 'react';
import { parseSoundFont, soundFontPresetToSfz, type InstrumentInfo, type SoundFont } from '@riffroll/audio';
import { useStore } from '../store';
import { Modal } from './Modal';
import { ensureEngine } from '../audio-setup';
import { getStorage } from '../files/actions';

interface Uploader {
  putFile(id: string, rel: string, data: Uint8Array): Promise<unknown>;
  finalize(id: string, info: { name: string; role: string; sfz: string }): Promise<unknown>;
  remove(id: string): Promise<unknown>;
}

const ALLOWED = /\.(sfz|wav|flac|ogg|txt|md)$/i;

/** Desktop: IPC into the app data folder. Docker/server: REST into the instruments volume. Plain browser: none. */
async function uploader(): Promise<Uploader | null> {
  const bridge = window.riffroll as undefined | { instruments?: Uploader };
  if (bridge?.instruments) return bridge.instruments;
  const s = await getStorage();
  if (s.kind !== 'rest') return null;
  const check = async (r: Response) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    return r.json();
  };
  const enc = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');
  return {
    putFile: (id, rel, data) =>
      fetch(`./api/instruments/${id}/files/${enc(rel)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: data as BodyInit,
      }).then(check),
    finalize: (id, info) =>
      fetch(`./api/instruments/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(info),
      }).then(check),
    remove: (id) => fetch(`./api/instruments/${id}`, { method: 'DELETE' }).then(check),
  };
}

type Role = 'guitar' | 'bass' | 'drums' | 'other';

/** General MIDI program → our instrument kind (guitars 24–31, basses 32–39, bank 128 = drums). */
function roleForPreset(p: { bank: number; program: number; drums: boolean }): Role {
  if (p.drums) return 'drums';
  if (p.program >= 24 && p.program <= 31) return 'guitar';
  if (p.program >= 32 && p.program <= 39) return 'bass';
  return 'other';
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'inst';

interface SfPick {
  file: string;
  sf: SoundFont;
  chosen: Map<number, Role>;
  query: string;
}

interface Picked {
  folder: string;
  files: File[];
  sfz: string[];
}

export function Instruments() {
  const [list, setList] = useState<(InstrumentInfo & { user?: boolean })[]>([]);
  const [canAdd, setCanAdd] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('guitar');
  const [sfz, setSfz] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sfPick, setSfPick] = useState<SfPick | null>(null);

  const pickSoundFont = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sf2,.sf3';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setErr(null);
      setBusy('Reading the SoundFont…');
      try {
        const sf = parseSoundFont(new Uint8Array(await file.arrayBuffer()));
        if (!sf.presets.length) throw new Error('This SoundFont has no presets.');
        // a single-preset font is chosen right away
        const chosen = new Map<number, Role>();
        if (sf.presets.length === 1) chosen.set(sf.presets[0].index, roleForPreset(sf.presets[0]));
        setSfPick({ file: file.name, sf, chosen, query: '' });
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(null);
      }
    };
    input.click();
  };

  const addSoundFont = async () => {
    if (!sfPick) return;
    const up = await uploader();
    if (!up) return;
    const picks = sfPick.sf.presets.filter((p) => sfPick.chosen.has(p.index));
    try {
      let done = 0;
      for (const p of picks) {
        setBusy(`Converting “${p.name}” (${++done}/${picks.length})…`);
        const conv = soundFontPresetToSfz(sfPick.sf, p.index);
        const id = `user-${slug(p.name)}-${Date.now().toString(36)}${done}`;
        const sfzName = `${slug(p.name)}.sfz`;
        let i = 0;
        for (const file of conv.files) {
          if (++i % 10 === 0) setBusy(`Copying “${p.name}”: ${i}/${conv.files.length} samples…`);
          await up.putFile(id, file.path, file.data);
        }
        await up.putFile(id, sfzName, new TextEncoder().encode(conv.sfz));
        await up.finalize(id, { name: p.name, role: sfPick.chosen.get(p.index)!, sfz: sfzName });
      }
      setSfPick(null);
      useStore.getState().set({
        status: `Added ${picks.length} instrument${picks.length === 1 ? '' : 's'} from ${sfPick.file}. Pick them in the Mixer.`,
      });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    const e = await ensureEngine();
    e.lib.refresh();
    setList(await e.lib.index());
  };
  useEffect(() => {
    void refresh();
    void uploader().then((u) => setCanAdd(!!u));
  }, []);

  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.onchange = () => {
      const files = [...(input.files ?? [])].filter((f) => ALLOWED.test(f.name));
      if (!files.length) return setErr('No SFZ or audio files in that folder.');
      const rel = (f: File) => f.webkitRelativePath.split('/').slice(1).join('/') || f.name;
      const sfzs = files.map(rel).filter((p) => p.toLowerCase().endsWith('.sfz'));
      if (!sfzs.length) return setErr('That folder has no .sfz file.');
      const folder = files[0].webkitRelativePath.split('/')[0] || 'Instrument';
      setErr(null);
      setPicked({
        folder,
        files,
        sfz: sfzs.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length),
      });
      setSfz(sfzs[0]);
      setName(folder);
    };
    input.click();
  };

  const upload = async () => {
    if (!picked) return;
    const up = await uploader();
    if (!up) return;
    const id = `user-${
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'inst'
    }-${Date.now().toString(36)}`;
    try {
      let i = 0;
      for (const f of picked.files) {
        setBusy(`Copying ${++i}/${picked.files.length}…`);
        const rel = f.webkitRelativePath.split('/').slice(1).join('/') || f.name;
        await up.putFile(id, rel, new Uint8Array(await f.arrayBuffer()));
      }
      await up.finalize(id, { name, role, sfz });
      setPicked(null);
      useStore.getState().set({ status: `Added instrument “${name}”. Pick it in the Mixer.` });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    const up = await uploader();
    if (!up || !confirm('Remove this instrument? Songs using it fall back to the default instrument.'))
      return;
    await up.remove(id);
    await refresh();
  };

  const roles: [Role, string][] = [
    ['guitar', 'Guitar'],
    ['bass', 'Bass'],
    ['drums', 'Drums'],
    ['other', 'Other (piano, synth, strings…)'],
  ];
  return (
    <Modal title="Instruments" wide>
      {roles.map(([r, label]) => (
        <section key={r}>
          <h3 className="h3">{label}</h3>
          <ul className="projects">
            {list
              .filter((i) => i.role === r)
              .map((i) => (
                <li key={i.id}>
                  <span className="pname" style={{ cursor: 'default' }}>
                    {i.name}
                    <small>{i.user ? 'added by you' : `${i.license} · ${i.author}`}</small>
                  </span>
                  {i.user && (
                    <button className="ib small danger" onClick={() => void remove(i.id)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            {!list.some((i) => i.role === r) && (
              <li className="mute">None installed (a basic fallback sound is used).</li>
            )}
          </ul>
        </section>
      ))}
      <h3 className="h3">Add an SFZ instrument</h3>
      {canAdd === false && (
        <p className="mute">
          Adding instruments needs the desktop app or the Docker server. You can also copy an instrument
          folder into the instruments volume (see README).
        </p>
      )}
      {canAdd && !picked && (
        <div className="row">
          <button className="ib" onClick={pick}>
            Choose a folder…
          </button>
          <span className="mute">
            The folder must contain the .sfz file and its samples (WAV/FLAC/OGG). Drum kits should use General
            MIDI keys.
          </span>
        </div>
      )}
      {picked && (
        <div className="addinst">
          <label className="field">
            Name <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {roles.map(([r, l]) => (
                <option key={r} value={r}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {picked.sfz.length > 1 && (
            <label className="field">
              SFZ
              <select value={sfz} onChange={(e) => setSfz(e.target.value)}>
                {picked.sfz.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          )}
          <span className="mute">{picked.files.length} files</span>
          <button className="ib" disabled={!!busy || !name.trim()} onClick={() => void upload()}>
            {busy ?? 'Add instrument'}
          </button>
          <button className="ib" disabled={!!busy} onClick={() => setPicked(null)}>
            Cancel
          </button>
        </div>
      )}
      <h3 className="h3">Add a SoundFont (SF2 / SF3)</h3>
      {canAdd === false && (
        <p className="mute">Adding instruments needs the desktop app or the Docker server.</p>
      )}
      {canAdd && !sfPick && (
        <div className="row">
          <button className="ib" disabled={!!busy} onClick={pickSoundFont}>
            Choose a SoundFont…
          </button>
          <span className="mute">
            Pick the presets you want; each becomes an instrument (converted to SFZ, so it plays and exports
            like the others). GM drum kits (bank 128) become drum instruments.
          </span>
        </div>
      )}
      {sfPick && (
        <div className="sfpick">
          <div className="row">
            <strong>{sfPick.sf.name}</strong>
            <span className="mute">
              {sfPick.file} · {sfPick.sf.presets.length} preset{sfPick.sf.presets.length === 1 ? '' : 's'}
              {sfPick.sf.compressed ? ' · compressed (SF3)' : ''}
            </span>
            <div className="spacer" />
            <input
              className="search"
              type="search"
              placeholder="Search presets"
              aria-label="Search presets"
              value={sfPick.query}
              onChange={(e) => setSfPick({ ...sfPick, query: e.target.value })}
            />
          </div>
          <ul className="sf-presets">
            {sfPick.sf.presets
              .filter((p) => !sfPick.query || p.name.toLowerCase().includes(sfPick.query.toLowerCase()))
              .map((p) => {
                const on = sfPick.chosen.has(p.index);
                const toggle = () => {
                  const chosen = new Map(sfPick.chosen);
                  if (on) chosen.delete(p.index);
                  else chosen.set(p.index, roleForPreset(p));
                  setSfPick({ ...sfPick, chosen });
                };
                return (
                  <li key={p.index} className={on ? 'on' : ''}>
                    <label className="check">
                      <input type="checkbox" checked={on} onChange={toggle} />
                      <span className="mute sf-num">
                        {p.bank}:{String(p.program).padStart(3, '0')}
                      </span>
                      {p.name}
                    </label>
                    {on && (
                      <select
                        aria-label={`Kind of instrument for ${p.name}`}
                        value={sfPick.chosen.get(p.index)}
                        onChange={(e) => {
                          const chosen = new Map(sfPick.chosen);
                          chosen.set(p.index, e.target.value as Role);
                          setSfPick({ ...sfPick, chosen });
                        }}
                      >
                        {roles.map(([r, l]) => (
                          <option key={r} value={r}>
                            {l}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
          </ul>
          <div className="row">
            <button
              className="ib"
              disabled={!!busy || !sfPick.chosen.size}
              onClick={() => void addSoundFont()}
            >
              {busy ?? `Add ${sfPick.chosen.size || ''} instrument${sfPick.chosen.size === 1 ? '' : 's'}`}
            </button>
            <button className="ib" disabled={!!busy} onClick={() => setSfPick(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {busy && !picked && !sfPick && <p className="mute">{busy}</p>}
      {err && <p className="warn">{err}</p>}
    </Modal>
  );
}
