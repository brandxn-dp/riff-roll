import { useEffect, useMemo, useState } from 'react';
import {
  describeSource,
  importIntoSong,
  makeTrack,
  pitchName,
  type ImportAction,
  type TrackType,
} from '@riffroll/core';
import { barMap, useStore } from '../store';
import { Modal } from './Modal';
import { ensureEngine } from '../audio-setup';

const TYPES: [TrackType, string][] = [
  ['guitar', 'New guitar track'],
  ['bass', 'New bass track'],
  ['drums', 'New drum track'],
  ['other', 'New other track (piano, synth, strings…)'],
];

interface Row {
  /** 'skip', 'new:<type>' or 'into:<trackId>' */
  target: string;
  instrument: string;
  name: string;
}

/**
 * File → Import MIDI into this song: every track of the file becomes a new track (pick its type and instrument),
 * goes into one of the song's tracks, or is skipped; it all lands from a chosen bar on, as one undo step.
 */
export function ImportIntoDialog() {
  const pending = useStore((s) => s.pendingImport);
  const song = useStore((s) => s.song);
  const [instruments, setInstruments] = useState<{ id: string; name: string; role: string }[] | null>(null);
  const info = useMemo(() => (pending ? describeSource(pending.song) : []), [pending]);
  const [rows, setRows] = useState<Row[]>(() =>
    info.map((t) => ({ target: t.count ? `new:${t.type}` : 'skip', instrument: '', name: t.name })),
  );
  const [startBar, setStartBar] = useState(
    () => barMap(song).barAtTick(useStore.getState().cursor).index + 1,
  );
  const [takeTempo, setTakeTempo] = useState(false);

  useEffect(() => {
    void ensureEngine()
      .then((e) => e.lib.index())
      .then(setInstruments)
      .catch(() => setInstruments([]));
  }, []);

  if (!pending) return null;
  const close = () => useStore.getState().set({ modal: null, pendingImport: null });
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const role = (target: string) => (target.startsWith('new:') ? (target.slice(4) as TrackType) : null);
  const optionsFor = (type: TrackType) => (instruments ?? []).filter((i) => i.role === type);
  const defaultInstrument = (type: TrackType) => makeTrack(type, '', '#000').instrument;
  const using = rows.filter((r) => r.target !== 'skip').length;

  const doImport = () => {
    const actions: ImportAction[] = rows.map((r) => {
      if (r.target === 'skip') return { kind: 'skip' };
      if (r.target.startsWith('into:')) return { kind: 'into', trackId: r.target.slice(5) };
      const type = r.target.slice(4) as TrackType;
      const fallbackOther = type === 'other' ? optionsFor('other')[0]?.id : undefined;
      return { kind: 'new', type, instrument: r.instrument || fallbackOther || undefined, name: r.name };
    });
    const st = useStore.getState();
    const before = st.song.tracks.length;
    st.exec(
      importIntoSong(pending.song, {
        at: barMap(st.song).barStart(Math.max(0, startBar - 1)),
        actions,
        takeTempo,
      }),
    );
    const s2 = useStore.getState();
    const added = s2.song.tracks.length - before;
    if (added) s2.set({ trackId: s2.song.tracks[s2.song.tracks.length - 1].id });
    s2.set({
      modal: null,
      pendingImport: null,
      status: `Imported ${pending.name}: ${using} part${using === 1 ? '' : 's'} from bar ${startBar}${added ? `, ${added} new track${added === 1 ? '' : 's'}` : ''} (Ctrl+Z undoes it)`,
    });
  };

  return (
    <Modal title={`Import ${pending.name} into this song`} wide>
      <div className="imp-opts">
        <label className="field">
          Start at bar
          <input
            type="number"
            min={1}
            max={song.bars + 1}
            value={startBar}
            onChange={(e) => setStartBar(Math.max(1, Math.round(Number(e.target.value) || 1)))}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={takeTempo} onChange={(e) => setTakeTempo(e.target.checked)} />
          Also use the file’s tempo and time signature from there
        </label>
      </div>
      <div className="imp-table" role="table" aria-label="Tracks in the file">
        <div className="imp-tr head" role="row">
          <span role="columnheader">In the file</span>
          <span role="columnheader">Add as</span>
          <span role="columnheader">Instrument</span>
          <span role="columnheader">Name</span>
        </div>
        {info.map((t, i) => {
          const r = rows[i];
          const type = role(r.target);
          const opts = type ? optionsFor(type) : [];
          return (
            <div className={'imp-tr' + (r.target === 'skip' ? ' skipped' : '')} role="row" key={i}>
              <span role="cell">
                <b>{t.name}</b>
                <small className="mute">
                  {t.count} {t.type === 'drums' ? 'drum hits' : 'notes'}
                  {t.low != null && t.type !== 'drums' ? ` · ${pitchName(t.low)}–${pitchName(t.high!)}` : ''}
                </small>
              </span>
              <span role="cell">
                <select
                  aria-label={`What ${t.name} becomes`}
                  value={r.target}
                  onChange={(e) => set(i, { target: e.target.value, instrument: '' })}
                >
                  <optgroup label="A new track">
                    {TYPES.map(([ty, label]) => (
                      <option key={ty} value={`new:${ty}`}>
                        {label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Into a track of this song">
                    {song.tracks.map((s) => (
                      <option key={s.id} value={`into:${s.id}`}>
                        Into “{s.name}”
                      </option>
                    ))}
                  </optgroup>
                  <option value="skip">Skip</option>
                </select>
              </span>
              <span role="cell">
                {type ? (
                  <select
                    aria-label={`Instrument for ${t.name}`}
                    value={r.instrument || defaultInstrument(type) || opts[0]?.id || ''}
                    onChange={(e) => set(i, { instrument: e.target.value })}
                  >
                    {instruments === null && <option value="">Loading…</option>}
                    {opts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                    {instruments !== null && !opts.length && (
                      <option value="">Basic sound (none installed)</option>
                    )}
                  </select>
                ) : (
                  <span className="mute small">{r.target === 'skip' ? '—' : 'the track’s own'}</span>
                )}
              </span>
              <span role="cell">
                {type ? (
                  <input
                    aria-label={`Name for ${t.name}`}
                    value={r.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                ) : (
                  <span className="mute small">—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mute small">
        Notes keep their place in bars and beats. Parts brought into a drum track are mapped by General MIDI
        drum numbers; drum parts brought into a pitched track become notes. Guitar and bass parts get strings
        and frets worked out for the track’s tuning.
      </p>
      <div className="row imp-actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" disabled={!using} onClick={doImport}>
          Import {using} part{using === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}
