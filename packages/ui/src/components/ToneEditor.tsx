import { useState } from 'react';
import {
  BASS_PRESETS,
  GUITAR_PRESETS,
  addTone,
  makeTone,
  removeTone,
  setPedal,
  updateTone,
  type Tone,
  type ToneChain,
  type Track,
} from '@riffroll/core';
import { CABS } from '@riffroll/audio';
import { currentTrack, useStore } from '../store';
import { Modal } from './Modal';
import { ensureEngine } from '../audio-setup';

type Block = keyof Omit<ToneChain, 'lowSplit'>;
interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const knob = (key: string, label = key[0].toUpperCase() + key.slice(1)): Param => ({
  key,
  label,
  min: 0,
  max: 10,
  step: 0.1,
});

/** Pedalboard blocks in signal order. */
const BLOCKS: { block: Block; title: string; toggle: boolean; params: Param[] }[] = [
  {
    block: 'gate',
    title: 'Noise gate',
    toggle: true,
    params: [
      { key: 'threshold', label: 'Threshold', min: -90, max: -20, step: 1, fmt: (v) => `${v} dB` },
      {
        key: 'release',
        label: 'Release',
        min: 0.01,
        max: 0.5,
        step: 0.01,
        fmt: (v) => `${Math.round(v * 1000)} ms`,
      },
    ],
  },
  {
    block: 'comp',
    title: 'Compressor',
    toggle: true,
    params: [
      { key: 'threshold', label: 'Threshold', min: -50, max: 0, step: 1, fmt: (v) => `${v} dB` },
      { key: 'ratio', label: 'Ratio', min: 1, max: 12, step: 0.5, fmt: (v) => `${v}:1` },
    ],
  },
  {
    block: 'drive',
    title: 'Overdrive',
    toggle: true,
    params: [knob('gain', 'Drive'), knob('tone'), knob('level')],
  },
  {
    block: 'amp',
    title: 'Amp',
    toggle: false,
    params: [knob('gain'), knob('bass'), knob('mid'), knob('treble'), knob('presence'), knob('master')],
  },
  {
    block: 'cab',
    title: 'Cabinet',
    toggle: true,
    params: [{ key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, fmt: pct }],
  },
  {
    block: 'eq',
    title: 'EQ',
    toggle: false,
    params: ['low', 'mid', 'high'].map((k) => ({
      key: k,
      label: k[0].toUpperCase() + k.slice(1),
      min: -12,
      max: 12,
      step: 0.5,
      fmt: (v: number) => `${v > 0 ? '+' : ''}${v} dB`,
    })),
  },
  {
    block: 'chorus',
    title: 'Chorus',
    toggle: true,
    params: [
      { key: 'rate', label: 'Rate', min: 0.1, max: 5, step: 0.1, fmt: (v) => `${v} Hz` },
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, fmt: pct },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, fmt: pct },
    ],
  },
  {
    block: 'delay',
    title: 'Delay',
    toggle: true,
    params: [
      {
        key: 'time',
        label: 'Time',
        min: 0.05,
        max: 1.2,
        step: 0.01,
        fmt: (v) => `${Math.round(v * 1000)} ms`,
      },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, fmt: pct },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, fmt: pct },
    ],
  },
  {
    block: 'reverb',
    title: 'Reverb',
    toggle: true,
    params: [{ key: 'mix', label: 'Send', min: 0, max: 0.6, step: 0.01, fmt: pct }],
  },
];

function ToneBlocks({ track, tone }: { track: Track; tone: Tone }) {
  const st = useStore.getState();
  const assets = useStore((s) => s.assets);
  const ch = tone.chain;
  const set = <B extends Block>(block: B, patch: Partial<ToneChain[B]>, label: string) =>
    st.exec(
      updateTone(
        track.id,
        tone.id,
        { chain: { [block]: { ...ch[block], ...patch } } as Partial<ToneChain> },
        label,
      ),
    );
  const loadIR = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav,audio/wav';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const name = f.name.replace(/[^\w.\- ]+/g, '_');
      st.set({ assets: { ...useStore.getState().assets, [name]: new Uint8Array(await f.arrayBuffer()) } });
      set('cab', { ir: `user:${name}`, on: true }, 'Load impulse response');
    };
    input.click();
  };
  return (
    <div className="board">
      {BLOCKS.map(({ block, title, toggle, params }) => {
        const values = ch[block] as unknown as Record<string, number | boolean | string>;
        const on = toggle ? !!values.on : true;
        return (
          <section key={block} className={'pedal' + (on ? ' on' : '')}>
            <header>
              <span>{title}</span>
              {toggle && (
                <button
                  className="tech"
                  aria-pressed={on}
                  aria-label={`${title} on/off`}
                  onClick={() => set(block, { on: !on } as never, `${title} ${on ? 'off' : 'on'}`)}
                >
                  {on ? 'On' : 'Off'}
                </button>
              )}
            </header>
            {block === 'amp' && (
              <label className="slider">
                <span>Channel</span>
                <select
                  value={ch.amp.character}
                  onChange={(e) =>
                    set('amp', { character: e.target.value as ToneChain['amp']['character'] }, 'Amp channel')
                  }
                >
                  <option value="clean">Clean</option>
                  <option value="crunch">Crunch</option>
                  <option value="high-gain">High gain</option>
                </select>
              </label>
            )}
            {block === 'cab' && (
              <label className="slider">
                <span>Cab</span>
                <select
                  value={ch.cab.ir}
                  onChange={(e) =>
                    e.target.value === '__load' ? loadIR() : set('cab', { ir: e.target.value }, 'Cabinet')
                  }
                >
                  {Object.entries(CABS).map(([id, c]) => (
                    <option key={id} value={id}>
                      {c.name}
                    </option>
                  ))}
                  {Object.keys(assets)
                    .filter((n) => /\.wav$/i.test(n))
                    .map((n) => (
                      <option key={n} value={`user:${n}`}>
                        IR: {n}
                      </option>
                    ))}
                  <option value="__load">Load IR (.wav)…</option>
                </select>
              </label>
            )}
            {params.map((p) => (
              <label key={p.key} className="slider">
                <span>{p.label}</span>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={values[p.key] as number}
                  onPointerDown={() => st.begin(`${title} ${p.label}`)}
                  onPointerUp={() => st.commit()}
                  onChange={(e) =>
                    set(block, { [p.key]: Number(e.target.value) } as never, `${title} ${p.label}`)
                  }
                />
                <output>
                  {p.fmt ? p.fmt(values[p.key] as number) : (values[p.key] as number).toFixed(1)}
                </output>
              </label>
            ))}
          </section>
        );
      })}
      {track.type === 'bass' && (
        <section className="pedal on">
          <header>
            <span>Low split</span>
          </header>
          <label className="slider">
            <span>Below</span>
            <input
              type="range"
              min={0}
              max={400}
              step={10}
              value={ch.lowSplit ?? 0}
              onChange={(e) =>
                st.exec(
                  updateTone(track.id, tone.id, { chain: { lowSplit: Number(e.target.value) } }, 'Low split'),
                )
              }
            />
            <output>{ch.lowSplit ? `${ch.lowSplit} Hz clean` : 'off'}</output>
          </label>
        </section>
      )}
    </div>
  );
}

export function ToneEditor() {
  const track = useStore((s) => currentTrack(s));
  const [sel, setSel] = useState<string | null>(null);
  const [abWith, setAbWith] = useState<string>('');
  const st = useStore.getState();
  if (!track || track.type === 'drums')
    return (
      <Modal title="Tones">
        <p className="mute">Select a guitar or bass track to edit its tones.</p>
      </Modal>
    );
  const tone = track.tones.find((t) => t.id === sel) ?? track.tones[0];
  const presets = track.type === 'bass' ? BASS_PRESETS : GUITAR_PRESETS;
  const p = track.pedal;
  const audition = (phrase: 'chug' | 'chord' | 'lick') =>
    void ensureEngine().then((e) => e.audition(track, phrase, tone.id, abWith || undefined));

  return (
    <Modal title={`Tones — ${track.name}`} wide>
      <div className="tones-head">
        <div className="tonelist" role="tablist" aria-label="Tones">
          {track.tones.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tone.id}
              className="tonechip"
              style={{ ['--tc' as string]: t.color }}
              onClick={() => setSel(t.id)}
            >
              {t.name}
            </button>
          ))}
          <select
            className="mini"
            aria-label="Add a tone from a preset"
            value=""
            onChange={(e) => {
              const pr = presets[e.target.value];
              if (!pr) return;
              const t = makeTone(pr);
              st.exec(addTone(track.id, t));
              setSel(t.id);
            }}
          >
            <option value="">+ Add tone…</option>
            {Object.entries(presets).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <input
            className="secedit"
            aria-label="Tone name"
            value={tone.name}
            onChange={(e) => st.exec(updateTone(track.id, tone.id, { name: e.target.value }, 'Rename tone'))}
          />
          <input
            type="color"
            aria-label="Tone colour"
            value={tone.color}
            onChange={(e) => st.exec(updateTone(track.id, tone.id, { color: e.target.value }, 'Tone colour'))}
          />
          <button
            className="ib small danger"
            disabled={track.tones.length <= 1}
            onClick={() => {
              st.exec(removeTone(track.id, tone.id));
              setSel(null);
            }}
          >
            Delete tone
          </button>
        </div>
      </div>

      <div className="pedalcfg row">
        <span className="lbl">Pedal</span>
        <select
          className="mini"
          value={p.mode}
          onChange={(e) =>
            st.exec(setPedal(track.id, { mode: e.target.value as 'simple' | 'advanced' }, 'Pedal mode'))
          }
        >
          <option value="simple">Simple: each stomp toggles</option>
          <option value="advanced">Advanced: each stomp picks a tone</option>
        </select>
        {p.mode === 'simple' && (
          <>
            <span className="lbl">between</span>
            {[0, 1].map((i) => (
              <select
                key={i}
                className="mini"
                value={p.toggle[i]}
                onChange={(e) => {
                  const toggle: [string, string] = [...p.toggle] as [string, string];
                  toggle[i] = e.target.value;
                  st.exec(
                    setPedal(
                      track.id,
                      { toggle, startTone: i === 0 ? toggle[0] : p.startTone },
                      'Pedal tones',
                    ),
                  );
                }}
              >
                {track.tones.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ))}
          </>
        )}
        <span className="lbl">start on</span>
        <select
          className="mini"
          value={p.startTone}
          onChange={(e) => st.exec(setPedal(track.id, { startTone: e.target.value }, 'Starting tone'))}
        >
          {track.tones.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="audition row" aria-label="Listen">
        <span className="lbl">Listen</span>
        <button className="ib small" onClick={() => audition('chug')}>
          Palm-muted chug
        </button>
        <button className="ib small" onClick={() => audition('chord')}>
          Open chord
        </button>
        <button className="ib small" onClick={() => audition('lick')}>
          Lick
        </button>
        <label className="field">
          A/B against
          <select className="mini" value={abWith} onChange={(e) => setAbWith(e.target.value)}>
            <option value="">— (this tone only)</option>
            {track.tones
              .filter((t) => t.id !== tone.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <button className="ib small" onClick={() => void ensureEngine().then((e) => e.stopAudition())}>
          Stop
        </button>
        <span className="mute">A/B plays the phrase A → B → A → B.</span>
      </div>

      <ToneBlocks track={track} tone={tone} />
    </Modal>
  );
}
