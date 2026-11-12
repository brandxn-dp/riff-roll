import {
  candidates,
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

export function Inspector() {
  const song = useStore((s) => s.song);
  const track = useStore((s) => currentTrack(s));
  const selection = useStore((s) => s.selection);
  const snap = useStore((s) => s.snap);
  if (!track || track.type === 'drums') return null;
  const st = useStore.getState();
  const fing = trackFingering(track);
  const sel = track.notes.filter((n) => selection.has(n.id));
  const exec = st.exec;
  const end = songEnd(song);

  if (!sel.length) {
    const bad = track.notes.filter((n) => !fing.get(n.id)).length;
    return (
      <div className="insp">
        <div className="hint">
          {bad > 0 && (
            <span className="warn">
              {bad} note{bad > 1 ? 's' : ''} can't be played in {track.tuning.name}
              {track.capo ? ` (capo ${track.capo})` : ''}
            </span>
          )}
          Click the grid to add a note, drag to move, drag the right edge to resize, right-click to delete,
          Ctrl-drag to box-select. Click the pedal lane to add or remove a stomp. Press <kbd>?</kbd> for shortcuts.
        </div>
        <Legend t={track} />
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
          <button className="ib" onClick={() => edit((n) => ({ start: Math.max(0, n.start - snap) }), 'Move notes')} aria-label="Move earlier">◀</button>
          <button className="ib" onClick={() => edit((n) => ({ start: Math.min(end - n.duration, n.start + snap) }), 'Move notes')} aria-label="Move later">▶</button>
          <span className="sep" />
          <button className="ib" onClick={() => edit((n) => ({ pitch: n.pitch - 1, pinnedString: null }), 'Transpose')} aria-label="Semitone down">▼</button>
          <button className="ib" onClick={() => edit((n) => ({ pitch: n.pitch + 1, pinnedString: null }), 'Transpose')} aria-label="Semitone up">▲</button>
          <span className="sep" />
          {pinned && (
            <button className="ib" onClick={() => edit(() => ({ pinnedString: null }), 'Auto fingering')}>
              Auto
            </button>
          )}
          <button className="ib danger" onClick={() => exec(removeNotes(track.id, sel.map((n) => n.id)))}>
            Delete
          </button>
          <button className="ib" onClick={() => st.select([])}>
            Done
          </button>
        </div>
        <TechniquePanel track={track} notes={sel} />
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
            style={clean ? { color: tone.color, borderColor: tone.color } : { background: tone.color, borderColor: tone.color }}
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
        <button className="ib" onClick={() => one({ start: Math.max(0, n.start - snap) }, 'Move note')} aria-label="Move earlier">◀</button>
        <button className="ib" onClick={() => one({ start: Math.min(end - n.duration, n.start + snap) }, 'Move note')} aria-label="Move later">▶</button>
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
        <button className="ib" aria-label="Shorter" onClick={() => one({ duration: Math.max(snap, n.duration - snap) }, 'Resize note')}>
          −
        </button>
        <span className="lenv">{lengthLabel(n.duration)}</span>
        <button className="ib" aria-label="Longer" onClick={() => one({ duration: Math.min(end - n.start, n.duration + snap) }, 'Resize note')}>
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
      <TechniquePanel track={track} notes={sel} />
    </div>
  );
}
