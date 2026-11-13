import { useState } from 'react';
import {
  setBars,
  setLoop,
  setTempos,
  setTuning,
  tuningByName,
  tuningsFor,
  updateSong,
  updateTrack,
  isFretted,
} from '@riffroll/core';
import { NOTE_LENS, SNAPS, ZOOMS, ZOOMS_Y, barMap, currentTrack, useStore, type MainView } from '../store';
import { togglePlay } from '../transport';

export function Toolbar({ right, left }: { right?: React.ReactNode; left?: React.ReactNode }) {
  const song = useStore((s) => s.song);
  const track = useStore((s) => currentTrack(s));
  const fretted = !!track && isFretted(track.type);
  const zoom = useStore((s) => s.zoom);
  const zoomY = useStore((s) => s.zoomY);
  const playing = useStore((s) => s.playing);
  const snap = useStore((s) => s.snap);
  const noteLen = useStore((s) => s.noteLen);
  const view = useStore((s) => s.view);
  const speed = useStore((s) => s.speed);
  const mobile = useStore((s) => s.layout === 'mobile');
  const snapScale = useStore((s) => s.snapScale);
  const ghostTrackId = useStore((s) => s.ghostTrackId);
  useStore((s) => s.historyVersion);
  const st = useStore.getState();
  const [bpmText, setBpmText] = useState<string | null>(null);
  const [barsText, setBarsText] = useState<string | null>(null);
  const bpm = song.tempos[0]?.bpm ?? 120;

  const commitBpm = () => {
    if (bpmText == null) return;
    const v = Math.max(20, Math.min(400, Math.round(Number(bpmText)) || bpm));
    st.exec(setTempos([{ ...song.tempos[0], tick: 0, bpm: v }, ...song.tempos.slice(1)]));
    setBpmText(null);
  };

  const tunings = track ? tuningsFor(track.type) : [];
  const isCustom = track && !tunings.some((t) => t.name === track.tuning.name);

  const loopToggle = () => {
    const bm = barMap(song);
    const loop = song.loop ?? {
      start: bm.barAtTick(st.cursor).start,
      end: bm.barStart(Math.min(song.bars, bm.barAtTick(st.cursor).index + 2)),
      on: false,
    };
    st.exec(setLoop({ ...loop, on: !loop.on }));
  };

  return (
    <header className="topbar">
      {/* row 1: song on the left, transport + tempo in the middle, inputs and mixer on the right */}
      <div className="tb-row">
        <div className="tb-side">
          <div className="brand">Riff Roll</div>
          {left}
        </div>
        <div className="tb-center">
          <button
            className={'btn play' + (playing ? ' on' : '')}
            onClick={togglePlay}
            title="Play / stop (Space)"
          >
            {playing ? '■ Stop' : '▶ Play'}
          </button>
          <div className="group" role="group" aria-label="Transport options">
            <button
              aria-pressed={!!song.loop?.on}
              title="Loop (Shift+drag in the ruler to set the region)"
              onClick={loopToggle}
            >
              ⟲ Loop
            </button>
            <button
              aria-pressed={song.metronome.on}
              title="Metronome"
              onClick={() =>
                st.exec(updateSong({ metronome: { ...song.metronome, on: !song.metronome.on } }, 'Metronome'))
              }
            >
              Click
            </button>
            <select
              className="mini"
              aria-label="Count-in bars"
              title="Count-in"
              value={song.metronome.countIn}
              onChange={(e) =>
                st.exec(
                  updateSong(
                    { metronome: { ...song.metronome, countIn: Number(e.target.value) } },
                    'Count-in',
                  ),
                )
              }
            >
              <option value={0}>No count-in</option>
              <option value={1}>Count-in 1 bar</option>
              <option value={2}>Count-in 2 bars</option>
            </select>
            <select
              className="mini"
              aria-label="Playback speed"
              title="Playback speed (pitch unchanged)"
              value={speed}
              onChange={(e) => st.set({ speed: Number(e.target.value) })}
            >
              {[0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
          </div>
          <span className="tb-sep" />
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
                st.exec(
                  updateSong(
                    { timeSigs: [{ bar: 0, num, den }, ...song.timeSigs.slice(1)] },
                    'Time signature',
                  ),
                );
              }}
            >
              {['4/4', '3/4', '6/8', '7/8', '5/4', '12/8', '2/4'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="tb-side right">
          {right}
          {track && isFretted(track.type) && (
            <button
              className="btn"
              onClick={() => st.set({ modal: 'tone' })}
              title="Edit this track's tones (amp, pedals, cab)"
            >
              Tones
            </button>
          )}
          <button className="btn" onClick={() => st.set({ modal: 'mixer' })} title="Mixer">
            Mixer
          </button>
          <button
            className="btn ghost"
            onClick={() => st.set({ modal: 'shortcuts' })}
            aria-label="Keyboard shortcuts"
            title="Shortcuts (?)"
          >
            ?
          </button>
        </div>
      </div>

      {/* row 2: how you look at and edit the current track */}
      <div className="tb-row sub">
        <label className="field">
          View
          <select value={view} onChange={(e) => st.set({ view: e.target.value as MainView })}>
            <option value="split">{fretted ? 'Roll + Tab' : 'Roll + Velocity'}</option>
            <option value="roll">Piano roll</option>
            {fretted && <option value="tab">Tab</option>}
            <option value="notation">{fretted ? 'Notation + Tab' : 'Notation'}</option>
            {track?.type === 'drums' && <option value="drums">Drum grid</option>}
          </select>
        </label>
        {fretted && track && (
          <>
            <span className="tb-sep" />
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
            <label className="field">
              Capo
              <select
                value={track.capo}
                onChange={(e) => st.exec(updateTrack(track.id, { capo: Number(e.target.value) }, 'Capo'))}
              >
                {Array.from({ length: 13 }, (_, i) => (
                  <option key={i} value={i}>
                    {i || '–'}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <span className="tb-sep" />
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
        <label className="field" title="Ghost notes: show another track's notes faintly in the piano roll">
          Ghost
          <select
            value={ghostTrackId ?? ''}
            onChange={(e) => st.set({ ghostTrackId: e.target.value || null })}
          >
            <option value="">None</option>
            {song.tracks
              .filter((x) => x.id !== track?.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
        <div className="group" role="group" aria-label="Snap to scale">
          <button
            aria-pressed={snapScale}
            title="Snap to scale: new, dragged and arrow-moved notes stay on the song's scale (Song bar → scale)"
            onClick={() => st.set({ snapScale: !snapScale })}
          >
            Scale snap
          </button>
        </div>
        {mobile && (
          // on the desktop the note values live in the edit palette
          <div className="group" role="group" aria-label="New note length">
            <span className="glabel">Note</span>
            {NOTE_LENS.map((l) => (
              <button
                key={l.label}
                aria-pressed={noteLen === l.ticks}
                onClick={() => st.set({ noteLen: l.ticks })}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
        <div className="group" role="group" aria-label="Bars">
          <span className="glabel">Bars</span>
          <button aria-label="Fewer bars" onClick={() => st.exec(setBars(song.bars - 1))}>
            −
          </button>
          <input
            className="bars-input"
            type="number"
            min={1}
            max={2000}
            aria-label="Number of bars"
            value={barsText ?? song.bars}
            onChange={(e) => setBarsText(e.target.value)}
            onBlur={() => {
              const v = Math.round(Number(barsText));
              if (barsText != null && v >= 1 && v !== song.bars) st.exec(setBars(v));
              setBarsText(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setBarsText(null);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
          <button aria-label="More bars" onClick={() => st.exec(setBars(song.bars + 1))}>
            +
          </button>
        </div>
        <span className="tb-sep" />
        <div className="group" role="group" aria-label="Horizontal zoom" title="Horizontal zoom (Ctrl+wheel)">
          <span className="glabel">Zoom ↔</span>
          <button
            aria-label="Zoom out horizontally"
            disabled={zoom === 0}
            onClick={() => st.set({ zoom: Math.max(0, st.zoom - 1) })}
          >
            −
          </button>
          <button
            aria-label="Zoom in horizontally"
            disabled={zoom === ZOOMS.length - 1}
            onClick={() => st.set({ zoom: Math.min(ZOOMS.length - 1, st.zoom + 1) })}
          >
            +
          </button>
        </div>
        <div className="group" role="group" aria-label="Vertical zoom" title="Vertical zoom (Alt+wheel)">
          <span className="glabel">↕</span>
          <button
            aria-label="Zoom out vertically"
            disabled={zoomY === 0}
            onClick={() => st.set({ zoomY: Math.max(0, st.zoomY - 1) })}
          >
            −
          </button>
          <button
            aria-label="Zoom in vertically"
            disabled={zoomY === ZOOMS_Y.length - 1}
            onClick={() => st.set({ zoomY: Math.min(ZOOMS_Y.length - 1, st.zoomY + 1) })}
          >
            +
          </button>
        </div>
        <span className="tb-sep" />
        <div className="group" role="group" aria-label="Undo">
          <button
            disabled={!st.history.canUndo}
            title={`Undo ${st.history.undoLabel ?? ''} (Ctrl+Z)`}
            onClick={st.undo}
            aria-label="Undo"
          >
            ↶
          </button>
          <button
            disabled={!st.history.canRedo}
            title={`Redo ${st.history.redoLabel ?? ''} (Ctrl+Shift+Z)`}
            onClick={st.redo}
            aria-label="Redo"
          >
            ↷
          </button>
        </div>
      </div>
    </header>
  );
}
