import { stringLabel } from '@riffroll/core';
import { currentTrack, useStore } from '../../store';
import { noteOnString, tabKey } from '../../tabEntry';
import { lengthLabel } from '../../format';

/**
 * On-screen fret pad for tab entry on phones (no keyboard): tap a tab line to place the cursor, then tap frets.
 * Every button goes through the same code as the Guitar Pro style keyboard shortcuts.
 */
export function FretPad() {
  const track = useStore((s) => currentTrack(s));
  const cursor = useStore((s) => s.tabCursor);
  const noteLen = useStore((s) => s.noteLen);
  useStore((s) => s.song);
  if (!track || !cursor) return null;
  const here = noteOnString(track, cursor.tick, cursor.string);
  const curFret =
    here && here.start === cursor.tick ? here.pitch - track.tuning.strings[cursor.string] - track.capo : null;
  const frets = Array.from({ length: Math.min(track.maxFret, 24) + 1 }, (_, i) => i);
  const k =
    (key: string, ctrl = false) =>
    () =>
      tabKey(key, ctrl);
  const tech = (key: string, label: string, on?: boolean) => (
    <button className="tech" aria-pressed={!!on} onClick={k(key)} disabled={!here}>
      {label}
    </button>
  );
  const t = here?.tech ?? {};
  return (
    <div className="fretpad" aria-label="Fret pad">
      <div className="fp-head">
        <strong>{stringLabel(track.tuning, cursor.string, track.type)} string</strong>
        <span className="mute">{lengthLabel(noteLen)}</span>
        <button className="ib small" onClick={k('Escape')}>
          Done
        </button>
      </div>
      <div className="fp-frets" role="group" aria-label="Frets">
        {frets.map((f) => (
          <button key={f} className={'fp-fret' + (f === curFret ? ' on' : '')} onClick={k(`fret:${f}`)}>
            {f}
          </button>
        ))}
      </div>
      <div className="fp-row">
        <button className="ib" aria-label="Previous beat" onClick={k('ArrowLeft')}>
          ◀
        </button>
        <button className="ib" aria-label="Next beat" onClick={k('ArrowRight')}>
          ▶
        </button>
        <button className="ib" aria-label="Higher string" onClick={k('ArrowUp')}>
          ▲
        </button>
        <button className="ib" aria-label="Lower string" onClick={k('ArrowDown')}>
          ▼
        </button>
        <span className="sep" />
        <button className="ib" aria-label="Shorter" onClick={k('-')}>
          −
        </button>
        <button className="ib" aria-label="Longer" onClick={k('+')}>
          +
        </button>
        <button className="ib" aria-label="Dotted" onClick={k('.')}>
          ·
        </button>
        <button className="ib" aria-label="Triplet" onClick={k('t')}>
          ³
        </button>
        <span className="sep" />
        <button className="ib" onClick={k('r')}>
          Rest
        </button>
        <button className="ib danger" aria-label="Delete note" onClick={k('Delete')} disabled={!here}>
          ⌫
        </button>
      </div>
      <div className="fp-row">
        {tech('h', 'H/P', t.hammer)}
        {tech('s', 'Slide', !!t.slide)}
        {tech('b', 'Bend', !!t.bend)}
        {tech('v', 'Vib', !!t.vibrato)}
        {tech('p', 'PM', t.palmMute)}
        {tech('x', 'X', t.dead)}
        {tech('i', 'Ring', t.letRing)}
        {tech('n', 'Harm', !!t.harmonic)}
        {tech('l', 'Tie', t.tieFromPrevious)}
      </div>
    </div>
  );
}
