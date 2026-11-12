import { useEffect, useState } from 'react';
import type { InstrumentInfo } from '@riffroll/audio';
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
  const [role, setRole] = useState<'guitar' | 'bass' | 'drums'>('guitar');
  const [sfz, setSfz] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  const roles: ['guitar' | 'bass' | 'drums', string][] = [
    ['guitar', 'Guitar'],
    ['bass', 'Bass'],
    ['drums', 'Drums'],
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
      {err && <p className="warn">{err}</p>}
    </Modal>
  );
}
