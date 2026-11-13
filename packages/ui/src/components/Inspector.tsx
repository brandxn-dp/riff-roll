import { useState } from 'react';
import {
  candidates,
  notesNearFret,
  notesToString,
  shiftStrings,
  type StringEdit,
  openStrings,
  pitchName,
  removeNotes,
  stringColor,
  stringLabel,
  toneAt,
  trackFingering,
  updateNotes,
  type Note,
  type Track,
} from '@riffroll/core';
import { currentTrack, songEnd, useStore } from '../store';
import { preview } from '../audio-bridge';
import { lengthLabel } from '../format';
import { TechniquePanel } from './TechniquePanel';

/** Several notes selected (guitar, bass): strings, neck position, octave, clear techniques, all at once. */
function BulkStrings({ track, notes }: { track: Track; notes: Note[] }) {
  const [fret, setFret] = useState('');
  const st = useStore.getState();
  const n = track.tuning.strings.length;
  const apply = (r: StringEdit, label: string, done: string) => {
    const moved = Object.keys(r.changes).length;
    if (moved) st.exec(updateNotes(track.id, r.changes, label));
    st.set({
      status: r.skipped
        ? `${done} (${moved} moved; ${r.skipped} don’t fit there and stayed put)`
        : `${done} (${moved} notes)`,
    });
  };
  const all = (fn: (x: Note) => Partial<Note>, label: string) => {
    const ch: Record<string, Partial<Note>> = {};
    for (const x of notes) ch[x.id] = fn(x);
    st.exec(updateNotes(track.id, ch, label));
  };
  return (
    <div className="row bulk">
      <span className="lbl">String</span>
      {Array.from({ length: n }, (_, i) => n - 1 - i).map((idx) => {
        const name = stringLabel(track.tuning, idx, track.type);
        return (
          <button
            key={idx}
            className="ib str"
            style={{ ['--c' as string]: stringColor(track.type, n, idx) }}
            title={`Put the selected notes on the ${name} string (where they fit)`}
            onClick={() => apply(notesToString(track, notes, idx), 'Move to string', `On the ${name} string`)}
          >
            {name}
          </button>
        );
      })}
      <button
        className="ib"
        title="Each note one string higher, same pitch"
        onClick={() => apply(shiftStrings(track, notes, 1), 'String up', 'One string higher')}
      >
        Str ↑
      </button>
      <button
        className="ib"
        title="Each note one string lower, same pitch"
        onClick={() => apply(shiftStrings(track, notes, -1), 'String down', 'One string lower')}
      >
        Str ↓
      </button>
      <select
        className="mini"
        aria-label="Play the selection near a fret"
        title="Move the selection up or down the neck: each note goes to the string nearest this fret"
        value={fret}
        onChange={(e) => {
          const f = Number(e.target.value);
          setFret('');
          if (e.target.value !== '')
            apply(notesNearFret(track, notes, f), 'Neck position', `Around fret ${f}`);
        }}
      >
        <option value="">Near fret…</option>
        {Array.from({ length: Math.min(22, track.maxFret - track.capo) + 1 }, (_, f) => (
          <option key={f} value={f}>
            Fret {f}
          </option>
        ))}
      </select>
      <span className="sep" />
      <button
        className="ib"
        title="Octave down"
        onClick={() => all((x) => ({ pitch: Math.max(0, x.pitch - 12), pinnedString: null }), 'Octave down')}
      >
        8vb
      </button>
      <button
        className="ib"
        title="Octave up"
        onClick={() => all((x) => ({ pitch: Math.min(127, x.pitch + 12), pinnedString: null }), 'Octave up')}
      >
        8va
      </button>
      <button
        className="ib"
        title="Remove every technique from the selected notes"
        disabled={!notes.some((x) => x.tech && Object.keys(x.tech).length)}
        onClick={() => all(() => ({ tech: undefined }), 'Clear techniques')}
      >
        Clear techniques
      </button>
    </div>
  );
}

function Legend({ t }: { t: Track }) {
  const n = t.tuning.strings.length;
  return (
    <div className="legend">
      {Array.from({ length: n }, (_, i) => n - 1 - i).map((s) => (
        <span key={s} className="lg" style={{ ['--c' as string]: stringColor(t.type, n, s) }}>
          <i />
          {stringLabel(t.tuning, s, t.type)}
        </span>
      ))}
    </div>
  );
}

/** Techniques: always open on desktop, a collapsible section on phones (screen space). */
function Techs({ track, notes, mobile }: { track: Track; notes: Note[]; mobile: boolean }) {
  if (!mobile) return <TechniquePanel track={track} notes={notes} />;
  return (
    <details className="techdetails">
      <summary>Techniques</summary>
      <TechniquePanel track={track} notes={notes} />
    </details>
  );
}

export function Inspector() {
  useStore((s) => s.themeRev); // string colours follow the palette
  const mobile = useStore((s) => s.layout === 'mobile');
  const song = useStore((s) => s.song);
  const track = useStore((s) => currentTrack(s));
  const selection = useStore((s) => s.selection);
  const snap = useStore((s) => s.snap);
  if (!track || track.type === 'drums') return null;
  const st = useStore.getState();
  const other = track.type === 'other';
  const fing = other ? new Map<string, null>() : trackFingering(track);
  const sel = track.notes.filter((n) => selection.has(n.id));
  const exec = st.exec;
  const end = songEnd(song);

  if (!sel.length) {
    const bad = other ? 0 : track.notes.filter((n) => !fing.get(n.id)).length;
    return (
      <div className="insp">
        <div className="hint">
          {bad > 0 && (
            <span className="warn">
              {bad} note{bad > 1 ? 's' : ''} can't be played in {track.tuning.name}
              {track.capo ? ` (capo ${track.capo})` : ''}
            </span>
          )}
          {other ? (
            <>
              {mobile ? 'Tap' : 'Click'} the grid to add a note. Pick this track's sound in the Mixer; add
              your own (piano, synth…) under Instruments as an “Other” instrument.{' '}
              {!mobile && (
                <>
                  Shift+click a key to select every note of that pitch. Press <kbd>?</kbd> for shortcuts.
                </>
              )}
            </>
          ) : mobile ? (
            <>
              Tap the grid to add a note, tap a note to edit it. Tap the pedal lane for a stomp, tap a tab
              line to type frets.
            </>
          ) : (
            <>
              Click the grid to add a note, drag to move, drag the right edge to resize, right-click to
              delete, Ctrl-drag to box-select. Click the pedal lane to add or remove a stomp. Press{' '}
              <kbd>?</kbd> for shortcuts.
            </>
          )}
        </div>
        {!other && <Legend t={track} />}
      </div>
    );
  }

  const edit = (fn: (n: Note) => Partial<Note>, label: string) => {
    const ch: Record<string, Partial<Note>> = {};
    for (const n of sel) ch[n.id] = fn(n);
    exec(updateNotes(track.id, ch, label));
  };

  if (sel.length > 1) {
    const pinned = sel.some((n) => n.pinnedString != null);
    return (
      <div className="insp">
        <div className="selinfo">
          <strong>{sel.length} notes selected</strong>
          <span className="mute">Arrows move, Ctrl+D duplicates, Q quantizes, Delete removes.</span>
        </div>
        <div className="row">
          <button
            className="ib"
            onClick={() => edit((n) => ({ start: Math.max(0, n.start - snap) }), 'Move notes')}
            aria-label="Move earlier"
          >
            ◀
          </button>
          <button
            className="ib"
            onClick={() => edit((n) => ({ start: Math.min(end - n.duration, n.start + snap) }), 'Move notes')}
            aria-label="Move later"
          >
            ▶
          </button>
          <span className="sep" />
          <button
            className="ib"
            onClick={() => edit((n) => ({ pitch: n.pitch - 1, pinnedString: null }), 'Transpose')}
            aria-label="Semitone down"
          >
            ▼
          </button>
          <button
            className="ib"
            onClick={() => edit((n) => ({ pitch: n.pitch + 1, pinnedString: null }), 'Transpose')}
            aria-label="Semitone up"
          >
            ▲
          </button>
          <span className="sep" />
          {pinned && (
            <button className="ib" onClick={() => edit(() => ({ pinnedString: null }), 'Auto fingering')}>
              Auto
            </button>
          )}
          <button
            className="ib danger"
            onClick={() =>
              exec(
                removeNotes(
                  track.id,
                  sel.map((n) => n.id),
                ),
              )
            }
          >
            Delete
          </button>
          <button className="ib" onClick={() => st.set({ modal: 'velocity' })}>
            Velocity…
          </button>
          <button className="ib" onClick={() => st.select([])}>
            Done
          </button>
        </div>
        {track.type !== 'other' && <BulkStrings track={track} notes={sel} />}
        {track.type !== 'other' && <Techs track={track} notes={sel} mobile={mobile} />}
      </div>
    );
  }

  if (other) {
    const n = sel[0];
    const one = (ch: Partial<Note>, label: string) => exec(updateNotes(track.id, { [n.id]: ch }, label));
    return (
      <div className="insp">
        <div className="selinfo">
          <span className="sw" style={{ ['--c' as string]: track.color }} />
          <strong>{pitchName(n.pitch)}</strong>
          <span className="mute">vel {n.velocity}</span>
        </div>
        <div className="row">
          <button
            className="ib"
            onClick={() => one({ start: Math.max(0, n.start - snap) }, 'Move note')}
            aria-label="Move earlier"
          >
            ◀
          </button>
          <button
            className="ib"
            onClick={() => one({ start: Math.min(end - n.duration, n.start + snap) }, 'Move note')}
            aria-label="Move later"
          >
            ▶
          </button>
          <span className="sep" />
          <button
            className="ib"
            aria-label="Semitone down"
            onClick={() => {
              one({ pitch: n.pitch - 1 }, 'Transpose');
              preview(track, n.pitch - 1, n.start, n.duration);
            }}
          >
            ▼
          </button>
          <button
            className="ib"
            aria-label="Semitone up"
            onClick={() => {
              one({ pitch: n.pitch + 1 }, 'Transpose');
              preview(track, n.pitch + 1, n.start, n.duration);
            }}
          >
            ▲
          </button>
          <span className="sep" />
          <label className="field">
            Velocity
            <input
              type="range"
              min={1}
              max={127}
              value={n.velocity}
              onChange={(e) => one({ velocity: Number(e.target.value) }, 'Change velocity')}
            />
          </label>
          <span className="sep" />
          <button className="ib danger" onClick={() => exec(removeNotes(track.id, [n.id]))}>
            Delete
          </button>
          <button className="ib" onClick={() => st.select([])}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const n = sel[0];
  const pos = fing.get(n.id);
  const nStr = track.tuning.strings.length;
  const col = pos ? stringColor(track.type, nStr, pos.string) : '#4a505d';
  const toneId = toneAt(track.pedal, n.start);
  const tone = track.tones.find((x) => x.id === toneId);
  const opts = candidates(n.pitch, openStrings(track.tuning, track.capo), track.maxFret - track.capo).sort(
    (a, b) => b.string - a.string,
  );
  const one = (ch: Partial<Note>, label: string) => exec(updateNotes(track.id, { [n.id]: ch }, label));
  const clean = !tone || tone.chain.amp.character === 'clean';

  return (
    <div className="insp">
      <div className="selinfo">
        <span className="sw" style={{ ['--c' as string]: col }} />
        <strong>{pitchName(n.pitch)}</strong>
        <span className="mute">
          {pos
            ? `${stringLabel(track.tuning, pos.string, track.type)} string, fret ${pos.fret}${n.pinnedString != null ? ' (pinned)' : ''}`
            : 'No string reaches this note'}
        </span>
        {tone && (
          <span
            className={'pill' + (clean ? ' clean' : ' dist')}
            style={
              clean
                ? { color: tone.color, borderColor: tone.color }
                : { background: tone.color, borderColor: tone.color }
            }
          >
            {tone.name}
          </span>
        )}
        <span className="mute">vel {n.velocity}</span>
      </div>
      <div className="row">
        <span className="lbl">Play on</span>
        {opts.length ? (
          opts.map((c) => (
            <button
              key={c.string}
              className={'pos' + (pos && pos.string === c.string ? ' on' : '')}
              style={{ ['--c' as string]: stringColor(track.type, nStr, c.string) }}
              aria-label={`Play on ${stringLabel(track.tuning, c.string, track.type)} string, fret ${c.fret}`}
              aria-pressed={!!pos && pos.string === c.string}
              onClick={() => {
                one({ pinnedString: c.string }, 'Pin string');
                preview(track, n.pitch, n.start, n.duration);
              }}
            >
              {stringLabel(track.tuning, c.string, track.type)}
              <b>{c.fret}</b>
            </button>
          ))
        ) : (
          <span className="mute">none</span>
        )}
        {n.pinnedString != null && (
          <button className="ib" onClick={() => one({ pinnedString: null }, 'Auto fingering')}>
            Auto
          </button>
        )}
      </div>
      <div className="row">
        <button
          className="ib"
          onClick={() => one({ start: Math.max(0, n.start - snap) }, 'Move note')}
          aria-label="Move earlier"
        >
          ◀
        </button>
        <button
          className="ib"
          onClick={() => one({ start: Math.min(end - n.duration, n.start + snap) }, 'Move note')}
          aria-label="Move later"
        >
          ▶
        </button>
        <span className="sep" />
        <button
          className="ib"
          aria-label="Semitone down"
          onClick={() => {
            one({ pitch: n.pitch - 1, pinnedString: null }, 'Transpose');
            preview(track, n.pitch - 1, n.start, n.duration);
          }}
        >
          ▼
        </button>
        <button
          className="ib"
          aria-label="Semitone up"
          onClick={() => {
            one({ pitch: n.pitch + 1, pinnedString: null }, 'Transpose');
            preview(track, n.pitch + 1, n.start, n.duration);
          }}
        >
          ▲
        </button>
        <span className="sep" />
        <button
          className="ib"
          aria-label="Shorter"
          onClick={() => one({ duration: Math.max(snap, n.duration - snap) }, 'Resize note')}
        >
          −
        </button>
        <span className="lenv">{lengthLabel(n.duration)}</span>
        <button
          className="ib"
          aria-label="Longer"
          onClick={() => one({ duration: Math.min(end - n.start, n.duration + snap) }, 'Resize note')}
        >
          +
        </button>
        <span className="sep" />
        <button className="ib danger" onClick={() => exec(removeNotes(track.id, [n.id]))}>
          Delete
        </button>
        <button className="ib" onClick={() => st.select([])}>
          Done
        </button>
      </div>
      <Techs track={track} notes={sel} mobile={mobile} />
    </div>
  );
}
