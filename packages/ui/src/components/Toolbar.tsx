import { useState } from 'react';
import { PPQ, setBars, setTempos, setTuning, tuningByName, tuningsFor, updateSong, updateTrack } from '@riffroll/core';
import { SNAPS, ZOOMS, currentTrack, useStore, type MainView } from '../store';
import { togglePlay } from '../transport';

const LENS = [
  { label: '1/16', ticks: PPQ / 4 },
  { label: '1/8', ticks: PPQ / 2 },
  { label: '1/4', ticks: PPQ },
  { label: '1/2', ticks: PPQ * 2 },
];

export function Toolbar({ right }: { right?: React.ReactNode }) {
  const song = useStore((s) => s.song);
  const track = useStore((s) => currentTrack(s));
  const playing = useStore((s) => s.playing);
  const snap = useStore((s) => s.snap);
  const noteLen = useStore((s) => s.noteLen);
  const view = useStore((s) => s.view);
  useStore((s) => s.historyVersion);
  const st = useStore.getState();
  const [bpmText, setBpmText] = useState<string | null>(null);
  const bpm = song.tempos[0]?.bpm ?? 120;

  const commitBpm = () => {
    if (bpmText == null) return;
    const v = Math.max(20, Math.min(400, Math.round(Number(bpmText)) || bpm));
    st.exec(setTempos([{ ...song.tempos[0], tick: 0, bpm: v }, ...song.tempos.slice(1)]));
    setBpmText(null);
  };

  const tunings = track ? tuningsFor(track.type) : [];
  const isCustom = track && !tunings.some((t) => t.name === track.tuning.name);

  return (
    <header className="topbar">
      <div className="brand">Riff Roll</div>
      <button className={'btn play' + (playing ? ' on' : '')} onClick={togglePlay} title="Play / stop (Space)">
        {playing ? '■ Stop' : '▶ Play'}
      </button>
      <label className="field">
        BPM
        <input
          type="number"
          min={20}
          max={400}
          value={bpmText ?? bpm}
          onChange={(e) => setBpmText(e.target.value)}
          onBlur={commitBpm}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
      </label>
      <label className="field">
        <span className="long">Sig</span>
        <select
          value={`${song.timeSigs[0].num}/${song.timeSigs[0].den}`}
          onChange={(e) => {
            const [num, den] = e.target.value.split('/').map(Number);
            st.exec(updateSong({ timeSigs: [{ bar: 0, num, den }, ...song.timeSigs.slice(1)] }, 'Time signature'));
          }}
        >
          {['4/4', '3/4', '6/8', '7/8', '5/4', '12/8', '2/4'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {track && track.type !== 'drums' && (
        <label className="field">
          <span className="long">Tuning</span>
          <select
            value={track.tuning.name}
            onChange={(e) => {
              const t = tuningByName(e.target.value);
              if (t) st.exec(setTuning(track.id, t));
            }}
          >
            {isCustom && <option>{track.tuning.name}</option>}
            {tunings.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
      )}
      {track && track.type !== 'drums' && (
        <label className="field">
          Capo
          <select value={track.capo} onChange={(e) => st.exec(updateTrack(track.id, { capo: Number(e.target.value) }, 'Capo'))}>
            {Array.from({ length: 13 }, (_, i) => (
              <option key={i} value={i}>
                {i || '–'}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Snap
        <select value={snap} onChange={(e) => st.set({ snap: Number(e.target.value) })}>
          {SNAPS.map((s) => (
            <option key={s.label} value={s.ticks}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="group" role="group" aria-label="New note length">
        <span className="glabel">Note</span>
        {LENS.map((l) => (
          <button key={l.label} aria-pressed={noteLen === l.ticks} onClick={() => st.set({ noteLen: l.ticks })}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="group" role="group" aria-label="Bars">
        <span className="glabel">Bars</span>
        <button aria-label="Fewer bars" onClick={() => st.exec(setBars(song.bars - 1))}>
          −
        </button>
        <output>{song.bars}</output>
        <button aria-label="More bars" onClick={() => st.exec(setBars(song.bars + 1))}>
          +
        </button>
      </div>
      <div className="group" role="group" aria-label="Zoom">
        <span className="glabel">Zoom</span>
        <button aria-label="Zoom out" onClick={() => st.set({ zoom: Math.max(0, st.zoom - 1) })}>
          −
        </button>
        <button aria-label="Zoom in" onClick={() => st.set({ zoom: Math.min(ZOOMS.length - 1, st.zoom + 1) })}>
          +
        </button>
      </div>
      <div className="group" role="group" aria-label="Undo">
        <button disabled={!st.history.canUndo} title={`Undo ${st.history.undoLabel ?? ''} (Ctrl+Z)`} onClick={st.undo} aria-label="Undo">
          ↶
        </button>
        <button disabled={!st.history.canRedo} title={`Redo ${st.history.redoLabel ?? ''} (Ctrl+Shift+Z)`} onClick={st.redo} aria-label="Redo">
          ↷
        </button>
      </div>
      <label className="field">
        View
        <select value={view} onChange={(e) => st.set({ view: e.target.value as MainView })}>
          <option value="split">Roll + Tab</option>
          <option value="roll">Piano roll</option>
          <option value="tab">Tab</option>
          <option value="notation">Notation + Tab</option>
          {track?.type === 'drums' && <option value="drums">Drum grid</option>}
        </select>
      </label>
      <div className="spacer" />
      {right}
      <button className="btn ghost" onClick={() => st.set({ modal: 'shortcuts' })} aria-label="Keyboard shortcuts" title="Shortcuts (?)">
        ?
      </button>
    </header>
  );
}
