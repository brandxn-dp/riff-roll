/**
 * Edit palette (left sidebar), laid out like Guitar Pro's so switching between the two is painless:
 * bar items, then note values (durations, dot, triplet, tie, rest), dynamics, then articulations and effects.
 * Every button works on the selected notes (or the note under the tab cursor); durations also set the length
 * of new notes.
 */
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url';
import {
  PPQ,
  addSection,
  editVelocities,
  isFretted,
  newId,
  removeNotes,
  setTempos,
  updateHits,
  updateNotes,
  updateSong,
  type CurvePoint,
  type DrumHit,
  type Note,
  type Techniques,
} from '@riffroll/core';
import { barMap, currentTrack, useStore } from '../store';
import { noteOnString, tabKey } from '../tabEntry';

// the score's music font, for note and dynamic symbols
if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
  const f = new FontFace('RRMusic', `url(${bravuraWoff2})`);
  void f
    .load()
    .then((ff) => document.fonts.add(ff))
    .catch(() => {});
}

const DURATIONS: [string, number, string][] = [
  ['', PPQ * 4, 'Whole note'],
  ['', PPQ * 2, 'Half note'],
  ['', PPQ, 'Quarter note'],
  ['', PPQ / 2, 'Eighth note'],
  ['', PPQ / 4, '16th note'],
  ['', PPQ / 8, '32nd note'],
  ['', PPQ / 16, '64th note'],
];
// Guitar Pro's dynamic → velocity mapping
const DYNAMICS: [string, number, string][] = [
  ['', 15, 'ppp'],
  ['', 31, 'pp'],
  ['', 47, 'p'],
  ['', 63, 'mp'],
  ['', 79, 'mf'],
  ['', 95, 'f'],
  ['', 111, 'ff'],
  ['', 127, 'fff'],
];
const FULL_BEND: CurvePoint[] = [
  { pos: 0, value: 0 },
  { pos: 0.4, value: 2 },
  { pos: 1, value: 2 },
];
const DIP: CurvePoint[] = [
  { pos: 0, value: 0 },
  { pos: 0.25, value: -1 },
  { pos: 0.5, value: 0 },
];

const isPow2Len = (d: number) => {
  const r = Math.log2(d / (PPQ / 16));
  return Math.abs(r - Math.round(r)) < 1e-6;
};

/** The notes the palette acts on. */
function targets() {
  const st = useStore.getState();
  const t = currentTrack(st);
  if (!t) return { t: undefined, notes: [] as Note[], hits: [] as DrumHit[] };
  if (t.type === 'drums') return { t, notes: [], hits: t.hits.filter((h) => st.selection.has(h.id)) };
  let notes = t.notes.filter((n) => st.selection.has(n.id));
  if (!notes.length && st.tabCursor) {
    const n = noteOnString(t, st.tabCursor.tick, st.tabCursor.string);
    if (n && n.start === st.tabCursor.tick) notes = [n];
  }
  return { t, notes, hits: [] as DrumHit[] };
}

function editNotes(fn: (n: Note) => Partial<Note>, label: string) {
  const { t, notes } = targets();
  if (!t || !notes.length) return false;
  const ch: Record<string, Partial<Note>> = {};
  for (const n of notes) ch[n.id] = fn(n);
  useStore.getState().exec(updateNotes(t.id, ch, label));
  return true;
}

function setTech(patch: Partial<Techniques>, label: string) {
  editNotes((n) => {
    const tech: Techniques = { ...(n.tech ?? {}), ...patch };
    for (const k of Object.keys(tech) as (keyof Techniques)[]) if (tech[k] === undefined) delete tech[k];
    return { tech: Object.keys(tech).length ? tech : undefined };
  }, label);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function EditPalette() {
  const open = useStore((s) => s.palette);
  const track = useStore((s) => (s.trackId ? currentTrack(s) : undefined));
  const noteLen = useStore((s) => s.noteLen);
  useStore((s) => s.selection);
  useStore((s) => s.song);
  useStore((s) => s.tabCursor);
  const st = useStore.getState();
  const { notes, hits } = targets();
  const n = notes.length;
  const fretted = !!track && isFretted(track.type);
  const drums = track?.type === 'drums';

  if (!open)
    return (
      <aside className="palette closed" aria-label="Edit palette">
        <button
          className="pal-toggle"
          title="Show the edit palette"
          onClick={() => st.set({ palette: true })}
        >
          »
        </button>
      </aside>
    );

  /** a technique button: on when every target note has it; click toggles it on all of them */
  const tech = <K extends keyof Techniques>(
    key: K,
    value: Techniques[K],
    label: React.ReactNode,
    title: string,
    opts: { music?: boolean; fretOnly?: boolean; span?: boolean } = {},
  ) => {
    const on = n > 0 && notes.every((x) => same(x.tech?.[key], value));
    const disabled = !n || (opts.fretOnly && !fretted);
    return (
      <button
        key={title}
        className={'pal-btn' + (opts.music ? ' music' : '') + (opts.span ? ' span2' : '')}
        aria-pressed={on}
        disabled={disabled}
        title={title}
        onClick={() => setTech({ [key]: on ? undefined : value } as Partial<Techniques>, title)}
      >
        {label}
      </button>
    );
  };

  const setLength = (ticks: number, label: string) => {
    st.set({ noteLen: ticks });
    editNotes(() => ({ duration: ticks }), label);
  };
  const dotted = !isPow2Len(noteLen) && isPow2Len((noteLen * 2) / 3);
  const triplet = !isPow2Len(noteLen) && isPow2Len((noteLen * 3) / 2);
  const baseLen = dotted ? (noteLen * 2) / 3 : triplet ? (noteLen * 3) / 2 : noteLen;

  const velTargets: { id: string; start: number; velocity: number }[] = drums ? hits : notes;
  const setVel = (v: number, label: string) => {
    const t = currentTrack(useStore.getState());
    if (!t || !velTargets.length) return;
    const ch: Record<string, { velocity: number }> = {};
    for (const x of velTargets) ch[x.id] = { velocity: v };
    st.exec(drums ? updateHits(t.id, ch, label) : updateNotes(t.id, ch, label));
  };
  const hairpin = (up: boolean) => {
    const t = currentTrack(useStore.getState());
    if (!t || velTargets.length < 2) return;
    const first = [...velTargets].sort((a, b) => a.start - b.start)[0].velocity;
    const out = editVelocities(velTargets, {
      mode: 'ramp',
      from: first,
      to: Math.max(1, Math.min(127, first + (up ? 40 : -40))),
    });
    const ch: Record<string, { velocity: number }> = {};
    for (const [id, v] of Object.entries(out)) ch[id] = { velocity: v };
    st.exec(
      drums
        ? updateHits(t.id, ch, up ? 'Crescendo' : 'Diminuendo')
        : updateNotes(t.id, ch, up ? 'Crescendo' : 'Diminuendo'),
    );
  };

  // bar items act at the playback cursor
  const atCursor = () => {
    const bm = barMap(st.song);
    return bm.barAtTick(st.cursor);
  };
  const addSectionHere = () => {
    const name = prompt('Section name', 'Verse');
    if (name) st.exec(addSection({ id: newId('sec'), tick: atCursor().start, name }));
  };
  const addTempoHere = () => {
    const bar = atCursor();
    const now = [...st.song.tempos].reverse().find((p) => p.tick <= bar.start)?.bpm ?? 120;
    const v = Number(prompt(`Tempo from bar ${bar.index + 1} (BPM)`, String(Math.round(now))));
    if (!v || v < 20 || v > 400) return;
    const tempos = [...st.song.tempos.filter((p) => p.tick !== bar.start), { tick: bar.start, bpm: v }].sort(
      (a, b) => a.tick - b.tick,
    );
    st.exec(setTempos(tempos));
  };
  const timeSigHere = () => {
    const bar = atCursor();
    const v = prompt(`Time signature from bar ${bar.index + 1}`, `${bar.num}/${bar.den}`);
    const m = v && /^(\d{1,2})\s*\/\s*(1|2|4|8|16|32)$/.exec(v.trim());
    if (!m) return;
    const sigs = [
      ...st.song.timeSigs.filter((x) => x.bar !== bar.index),
      { bar: bar.index, num: Number(m[1]), den: Number(m[2]) },
    ].sort((a, b) => a.bar - b.bar);
    st.exec(updateSong({ timeSigs: sigs }, 'Time signature'));
  };
  const repeatHere = () => {
    const bar = atCursor().index;
    const inRepeat = st.song.repeats.find((r) => bar >= r.startBar && bar <= r.endBar);
    st.exec(
      updateSong(
        {
          repeats: inRepeat
            ? st.song.repeats.filter((r) => r !== inRepeat)
            : [...st.song.repeats, { id: newId('rep'), startBar: bar, endBar: bar, times: 2 }],
        },
        inRepeat ? 'Remove repeat' : 'Add repeat',
      ),
    );
  };

  const hint = drums
    ? hits.length
      ? `${hits.length} hit${hits.length === 1 ? '' : 's'} selected`
      : 'Select hits for dynamics'
    : n
      ? `${n} note${n === 1 ? '' : 's'} selected`
      : 'Select notes to edit them';

  return (
    <aside className="palette" aria-label="Edit palette">
      <div className="pal-head">
        <span className="pal-hint">{hint}</span>
        <button
          className="pal-toggle"
          title="Hide the edit palette"
          onClick={() => st.set({ palette: false })}
        >
          «
        </button>
      </div>

      <section className="pal-sec" aria-label="Bar">
        <button className="pal-btn boxed" title="Section marker at the cursor bar" onClick={addSectionHere}>
          A
        </button>
        <button className="pal-btn" title="Tempo change at the cursor bar" onClick={addTempoHere}>
          <span className="music">{''}</span>=
        </button>
        <button className="pal-btn" title="Time signature from the cursor bar" onClick={timeSigHere}>
          <span className="music">{''}</span>
        </button>
        <button className="pal-btn" title="Repeat the cursor bar (or remove the repeat)" onClick={repeatHere}>
          𝄆 𝄇
        </button>
      </section>

      <section className="pal-sec" aria-label="Note values">
        {DURATIONS.map(([g, ticks, title]) => (
          <button
            key={title}
            className="pal-btn music big"
            aria-pressed={baseLen === ticks}
            title={`${title}${drums ? '' : ' (sets the length of new and selected notes)'}`}
            onClick={() => setLength(dotted ? ticks * 1.5 : triplet ? (ticks * 2) / 3 : ticks, title)}
          >
            {g}
          </button>
        ))}
        <button
          className="pal-btn music big"
          aria-pressed={dotted}
          title="Dotted"
          onClick={() => setLength(dotted ? baseLen : baseLen * 1.5, 'Dotted')}
        >
          {''}
        </button>
        <button
          className="pal-btn music big"
          aria-pressed={triplet}
          title="Triplet"
          onClick={() => setLength(triplet ? baseLen : (baseLen * 2) / 3, 'Triplet')}
        >
          {''}
        </button>
        {tech('tieFromPrevious', true, '‿', 'Tie to the previous note (L)')}
        <button
          className="pal-btn music big"
          title="Rest (removes the selected notes)"
          disabled={!n && !st.tabCursor}
          onClick={() => {
            const { t, notes: ns } = targets();
            if (st.tabCursor && !st.selection.size) tabKey('r');
            else if (t && ns.length)
              st.exec(
                removeNotes(
                  t.id,
                  ns.map((x) => x.id),
                  'Rest',
                ),
              );
          }}
        >
          {''}
        </button>
      </section>

      <section className="pal-sec" aria-label="Dynamics">
        {DYNAMICS.map(([g, v, name]) => (
          <button
            key={name}
            className="pal-btn music dyn"
            aria-pressed={velTargets.length > 0 && velTargets.every((x) => Math.abs(x.velocity - v) <= 8)}
            disabled={!velTargets.length}
            title={`${name} (velocity ${v})`}
            onClick={() => setVel(v, `Dynamic ${name}`)}
          >
            {g}
          </button>
        ))}
        <button
          className="pal-btn"
          disabled={velTargets.length < 2}
          title="Crescendo across the selection"
          onClick={() => hairpin(true)}
        >
          &lt;
        </button>
        <button
          className="pal-btn"
          disabled={velTargets.length < 2}
          title="Diminuendo across the selection"
          onClick={() => hairpin(false)}
        >
          &gt;
        </button>
        <button
          className="pal-btn wide"
          disabled={!velTargets.length && !(track && (drums ? track.hits.length : track.notes.length))}
          title="Bulk velocity: set, scale, ramp, humanize"
          onClick={() => st.set({ modal: 'velocity' })}
        >
          Velocity…
        </button>
      </section>

      {!drums && (
        <>
          <section className="pal-sec" aria-label="Articulations">
            {tech('ghost', true, '( )', 'Ghost note (G)')}
            {tech('accent', 'normal', '', 'Accent', { music: true })}
            {tech('accent', 'heavy', '', 'Heavy accent', { music: true })}
            {tech('staccato', true, '', 'Staccato (O)', { music: true })}
            {tech('dead', true, '', 'Dead note (X)', { music: true, fretOnly: true })}
            {tech('letRing', true, 'let ring', 'Let ring (I)', { fretOnly: true, span: true })}
            {tech('palmMute', true, 'P.M.', 'Palm mute (P)', { fretOnly: true })}
            {tech('fadeIn', true, '◁', 'Fade in / volume swell (F)')}
          </section>

          <section className="pal-sec" aria-label="Effects">
            {tech('hammer', true, 'H/P', 'Hammer-on / pull-off (H)', { fretOnly: true })}
            {tech('slide', 'legato', '⟋', 'Legato slide', { fretOnly: true })}
            {tech('slide', 'shift', '⟋S', 'Shift slide', { fretOnly: true })}
            {tech('slide', 'in-below', '↗', 'Slide in from below', { fretOnly: true })}
            {tech('slide', 'in-above', '↘', 'Slide in from above', { fretOnly: true })}
            {tech('slide', 'out-down', '⤵', 'Slide out downwards', { fretOnly: true })}
            {tech('slide', 'out-up', '⤴', 'Slide out upwards', { fretOnly: true })}
            {tech('bend', FULL_BEND, 'full', 'Bend (full step); fine-tune it in the note inspector', {
              fretOnly: true,
            })}
            {tech('whammy', DIP, 'w/bar', 'Whammy bar dip; more shapes in the note inspector', {
              fretOnly: true,
            })}
            {tech('vibrato', 'normal', '∿', 'Vibrato (V)', { fretOnly: true })}
            {tech('vibrato', 'wide', '∿∿', 'Wide vibrato', { fretOnly: true })}
            {tech('tremolo', 16, '≡', 'Tremolo picking (16ths)', { fretOnly: true })}
            {tech('tap', true, 'T', 'Tapping (K)', { fretOnly: true })}
            {tech('harmonic', 'natural', 'N.H.', 'Natural harmonic', { fretOnly: true })}
            {tech('harmonic', 'artificial', 'A.H.', 'Artificial harmonic', { fretOnly: true })}
            {tech('harmonic', 'pinch', 'P.H.', 'Pinch harmonic', { fretOnly: true })}
            {tech('harmonic', 'tapped', 'T.H.', 'Tapped harmonic', { fretOnly: true })}
            {tech('pick', 'down', '', 'Pick stroke down', { music: true, fretOnly: true })}
            {tech('pick', 'up', '', 'Pick stroke up', { music: true, fretOnly: true })}
          </section>
        </>
      )}
    </aside>
  );
}
