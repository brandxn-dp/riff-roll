import { useRef } from 'react';
import {
  trackFingering,
  updateNotes,
  type CurvePoint,
  type Note,
  type Techniques,
  type Track,
} from '@riffroll/core';
import { useStore } from '../store';

const BEND_PRESETS: Record<string, CurvePoint[]> = {
  full: [
    { pos: 0, value: 0 },
    { pos: 0.4, value: 2 },
    { pos: 1, value: 2 },
  ],
  half: [
    { pos: 0, value: 0 },
    { pos: 0.4, value: 1 },
    { pos: 1, value: 1 },
  ],
  'bend-release': [
    { pos: 0, value: 0 },
    { pos: 0.3, value: 2 },
    { pos: 0.6, value: 2 },
    { pos: 0.9, value: 0 },
  ],
  'pre-bend': [
    { pos: 0, value: 2 },
    { pos: 1, value: 2 },
  ],
  'pre-bend release': [
    { pos: 0, value: 2 },
    { pos: 0.5, value: 2 },
    { pos: 1, value: 0 },
  ],
};

const WHAMMY_PRESETS: Record<string, CurvePoint[]> = {
  dip: [
    { pos: 0, value: 0 },
    { pos: 0.25, value: -1 },
    { pos: 0.5, value: 0 },
  ],
  dive: [
    { pos: 0, value: 0 },
    { pos: 1, value: -12 },
  ],
  'dive & return': [
    { pos: 0, value: 0 },
    { pos: 0.5, value: -5 },
    { pos: 1, value: 0 },
  ],
};

/** A tiny curve editor: drag points vertically in quarter-tone steps (bend) or semitones (whammy). */
function CurveEditor({
  curve,
  min,
  max,
  step,
  onChange,
}: {
  curve: CurvePoint[];
  min: number;
  max: number;
  step: number;
  onChange: (c: CurvePoint[]) => void;
}) {
  const W = 140,
    H = 54,
    P = 6;
  const ref = useRef<SVGSVGElement>(null);
  const x = (pos: number) => P + pos * (W - 2 * P);
  const y = (v: number) => P + ((max - v) / (max - min)) * (H - 2 * P);
  const drag = (i: number) => (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = ref.current!.getBoundingClientRect();
      const v = max - ((ev.clientY - r.top - P) / (H - 2 * P)) * (max - min);
      const q = Math.max(min, Math.min(max, Math.round(v / step) * step));
      if (q !== curve[i].value) onChange(curve.map((p, k) => (k === i ? { ...p, value: q } : p)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useStore.getState().commit();
    };
    useStore.getState().begin('Edit curve');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <svg ref={ref} width={W} height={H} className="curve" role="img" aria-label="Curve editor">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="#4a5160" />
      <polyline
        fill="none"
        stroke="#e6e8ee"
        strokeWidth={1.5}
        points={curve.map((p) => `${x(p.pos)},${y(p.value)}`).join(' ')}
      />
      {curve.map((p, i) => (
        <circle
          key={i}
          cx={x(p.pos)}
          cy={y(p.value)}
          r={5}
          fill="#8cb4ff"
          onPointerDown={drag(i)}
          style={{ cursor: 'ns-resize' }}
        />
      ))}
    </svg>
  );
}

export function TechniquePanel({ track, notes }: { track: Track; notes: Note[] }) {
  const st = useStore.getState();
  const t: Techniques = notes[0]?.tech ?? {};
  const fret = notes[0] ? (trackFingering(track).get(notes[0].id)?.fret ?? 0) : 0;
  const set = (patch: Partial<Techniques>, label: string) => {
    const ch: Record<string, Partial<Note>> = {};
    for (const n of notes) {
      const tech: Techniques = { ...(n.tech ?? {}), ...patch };
      for (const k of Object.keys(tech) as (keyof Techniques)[]) if (tech[k] === undefined) delete tech[k];
      ch[n.id] = { tech: Object.keys(tech).length ? tech : undefined };
    }
    st.exec(updateNotes(track.id, ch, label));
  };
  const tog = (key: keyof Techniques, label: string, title: string) => (
    <button
      className="tech"
      aria-pressed={!!t[key]}
      title={title}
      onClick={() => set({ [key]: t[key] ? undefined : true } as Partial<Techniques>, title)}
    >
      {label}
    </button>
  );
  const sel = <K extends keyof Techniques>(
    key: K,
    label: string,
    options: [string, Techniques[K] | undefined][],
  ) => (
    <label className="techsel" title={label}>
      <span>{label}</span>
      <select
        value={String(
          options.find(([, v]) => JSON.stringify(v) === JSON.stringify(t[key]))?.[0] ??
            (t[key] ? 'custom' : ''),
        )}
        onChange={(e) =>
          set({ [key]: options.find(([k]) => k === e.target.value)?.[1] } as Partial<Techniques>, label)
        }
      >
        {options.map(([k]) => (
          <option key={k} value={k}>
            {k || '—'}
          </option>
        ))}
        {t[key] && !options.some(([, v]) => JSON.stringify(v) === JSON.stringify(t[key])) && (
          <option value="custom">custom</option>
        )}
      </select>
    </label>
  );

  return (
    <div className="techs">
      <span className="lbl">Technique</span>
      {tog('hammer', 'H/P', 'Hammer-on / pull-off from the previous note (H)')}
      {sel('slide', 'Slide', [
        ['', undefined],
        ['legato', 'legato'],
        ['shift', 'shift'],
        ['in from below', 'in-below'],
        ['in from above', 'in-above'],
        ['out down', 'out-down'],
        ['out up', 'out-up'],
      ])}
      {sel('bend', 'Bend', [['', undefined], ...Object.entries(BEND_PRESETS)])}
      {t.bend && (
        <CurveEditor
          curve={t.bend}
          min={0}
          max={3}
          step={0.5}
          onChange={(c) => set({ bend: c }, 'Bend curve')}
        />
      )}
      {sel('vibrato', 'Vib', [
        ['', undefined],
        ['normal', 'normal'],
        ['wide', 'wide'],
      ])}
      {tog('palmMute', 'PM', 'Palm mute (P)')}
      {tog('letRing', 'Let ring', 'Let ring (I)')}
      {tog('dead', 'X', 'Dead / muted note (X)')}
      {sel('harmonic', 'Harm', [
        ['', undefined],
        ['natural', 'natural'],
        ['artificial', 'artificial'],
        ['pinch', 'pinch'],
        ['tapped', 'tapped'],
      ])}
      {tog('tap', 'Tap', 'Tapping (K)')}
      {sel('tremolo', 'Trem', [
        ['', undefined],
        ['8th', 8],
        ['16th', 16],
        ['32nd', 32],
      ])}
      {tog('ghost', '( )', 'Ghost note (G)')}
      {sel('accent', 'Acc', [
        ['', undefined],
        ['accent', 'normal'],
        ['heavy', 'heavy'],
      ])}
      {tog('staccato', 'Stacc', 'Staccato (O)')}
      {sel('pick', 'Pick', [
        ['', undefined],
        ['down ⊓', 'down'],
        ['up V', 'up'],
      ])}
      {sel('whammy', 'Whammy', [['', undefined], ...Object.entries(WHAMMY_PRESETS)])}
      {t.whammy && (
        <CurveEditor
          curve={t.whammy}
          min={-12}
          max={2}
          step={1}
          onChange={(c) => set({ whammy: c }, 'Whammy curve')}
        />
      )}
      {tog('fadeIn', 'Swell', 'Fade in / volume swell (F)')}
      {sel('trill', 'Trill', [
        ['', undefined],
        [`with fret ${fret + 1}`, { fret: fret + 1, speed: 16 }],
        [`with fret ${fret + 2}`, { fret: fret + 2, speed: 16 }],
      ])}
      {tog('tieFromPrevious', 'Tie', 'Tie to the previous note (L)')}
    </div>
  );
}
