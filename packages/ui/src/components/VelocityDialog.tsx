import { useState } from 'react';
import { editVelocities, updateHits, updateNotes, type VelocityOp } from '@riffroll/core';
import { currentTrack, useStore } from '../store';
import { Modal } from './Modal';

type Mode = VelocityOp['mode'];
const MODES: [Mode, string, string][] = [
  ['set', 'Set to', 'Every one gets the same velocity.'],
  ['scale', 'Scale', 'Louder or softer by a percentage, keeping the accents.'],
  ['add', 'Add / subtract', 'Shift all of them up or down.'],
  ['ramp', 'Ramp', 'A smooth crescendo or diminuendo from the first to the last.'],
  ['randomize', 'Humanize', 'Nudge each one randomly so it sounds less mechanical.'],
];

/** Bulk velocity edit for the selected notes or drum hits (or the whole track when nothing is selected). */
export function VelocityDialog() {
  const track = useStore((s) => currentTrack(s));
  const selection = useStore((s) => s.selection);
  const [mode, setMode] = useState<Mode>('scale');
  const [value, setValue] = useState(100);
  const [percent, setPercent] = useState(80);
  const [amount, setAmount] = useState(-10);
  const [from, setFrom] = useState(60);
  const [to, setTo] = useState(120);
  const [spread, setSpread] = useState(8);
  if (!track) return null;

  const drums = track.type === 'drums';
  const all = drums ? track.hits : track.notes;
  const chosen = all.filter((x) => selection.has(x.id));
  const items = chosen.length ? chosen : all;
  const what = drums ? 'hit' : 'note';
  const vels = items.map((i) => i.velocity);
  const lo = vels.length ? Math.min(...vels) : 0,
    hi = vels.length ? Math.max(...vels) : 0;

  const op = (): VelocityOp =>
    mode === 'set'
      ? { mode, value }
      : mode === 'scale'
        ? { mode, percent }
        : mode === 'add'
          ? { mode, amount }
          : mode === 'ramp'
            ? { mode, from, to }
            : { mode, amount: spread, seed: Date.now() % 100000 };

  const apply = () => {
    const out = editVelocities(items, op());
    const st = useStore.getState();
    const label = 'Edit velocity';
    if (drums) {
      const ch: Record<string, { velocity: number }> = {};
      for (const [id, v] of Object.entries(out)) ch[id] = { velocity: v };
      st.exec(updateHits(track.id, ch, label));
    } else {
      const ch: Record<string, { velocity: number }> = {};
      for (const [id, v] of Object.entries(out)) ch[id] = { velocity: v };
      st.exec(updateNotes(track.id, ch, label));
    }
    st.set({
      modal: null,
      status: `Velocity changed on ${items.length} ${what}${items.length === 1 ? '' : 's'}`,
    });
  };

  const num = (v: number, set: (n: number) => void, min: number, max: number, label: string, suffix = '') => (
    <label className="vel-num">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={v}
        onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
      />
      {suffix && <span className="mute">{suffix}</span>}
      <input
        type="range"
        min={min}
        max={max}
        value={v}
        aria-label={label}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );

  return (
    <Modal title="Edit velocity">
      <p className="mute">
        {items.length === 0
          ? `This track has no ${what}s yet.`
          : `${chosen.length ? 'Selected' : 'All'} ${items.length} ${what}${items.length === 1 ? '' : 's'}${
              chosen.length ? '' : ' on this track (nothing is selected)'
            } · now ${lo === hi ? lo : `${lo}–${hi}`}`}
      </p>
      <div className="vel-modes" role="radiogroup" aria-label="How">
        {MODES.map(([m, label]) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      <p className="mute small">{MODES.find((m) => m[0] === mode)![2]}</p>
      <div className="vel-fields">
        {mode === 'set' && num(value, setValue, 1, 127, 'Velocity')}
        {mode === 'scale' && num(percent, setPercent, 10, 200, 'Scale', '%')}
        {mode === 'add' && num(amount, setAmount, -126, 126, 'Change by')}
        {mode === 'ramp' && (
          <>
            {num(from, setFrom, 1, 127, 'From')}
            {num(to, setTo, 1, 127, 'To')}
          </>
        )}
        {mode === 'randomize' && num(spread, setSpread, 1, 40, 'Up to ±')}
      </div>
      <div className="row">
        <span className="mute small">Undo with Ctrl+Z.</span>
        <div className="spacer" />
        <button className="btn" onClick={() => useStore.getState().set({ modal: null })}>
          Cancel
        </button>
        <button className="btn primary" disabled={!items.length} onClick={apply}>
          Apply
        </button>
      </div>
    </Modal>
  );
}
