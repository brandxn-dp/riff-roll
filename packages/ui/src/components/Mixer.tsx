import { useEffect, useState } from 'react';
import {
  parsePitch,
  pitchName,
  setTuning,
  updateSong,
  updateTrack,
  type DrumPiece,
  type Track,
  isFretted,
  changeTrackType,
  type TrackType,
} from '@riffroll/core';
import { useStore } from '../store';
import { Modal } from './Modal';
import { ensureEngine } from '../audio-setup';

interface InstrumentOption {
  id: string;
  name: string;
  role: string;
}

const PIECES: { piece: DrumPiece; label: string }[] = [
  { piece: 'kick', label: 'Kick' },
  { piece: 'snare', label: 'Snare' },
  { piece: 'hihat', label: 'Hi-hat' },
  { piece: 'tom1', label: 'Tom 1' },
  { piece: 'tom2', label: 'Tom 2' },
  { piece: 'tom3', label: 'Floor 1' },
  { piece: 'tom4', label: 'Floor 2' },
  { piece: 'ride', label: 'Ride' },
  { piece: 'crash1', label: 'Crash 1' },
  { piece: 'crash2', label: 'Crash 2' },
  { piece: 'china', label: 'China' },
  { piece: 'splash', label: 'Splash' },
];

const db = (v: number) => (v <= 0.0001 ? '−∞' : (20 * Math.log10(v)).toFixed(1));

function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{fmt ? fmt(value) : value.toFixed(2)}</output>
    </label>
  );
}

const TYPES: [TrackType, string][] = [
  ['guitar', 'Guitar'],
  ['bass', 'Bass'],
  ['drums', 'Drums'],
  ['other', 'Other (piano, synth…)'],
];

function Strip({ t, instruments }: { t: Track; instruments: InstrumentOption[] | null }) {
  const st = useStore.getState();
  const set = (ch: Partial<Track>, label: string) => st.exec(updateTrack(t.id, ch, label));
  const options = (instruments ?? []).filter((i) => i.role === t.type);
  return (
    <section className="strip" style={{ ['--tc' as string]: t.color }}>
      <header>
        <strong>{t.name}</strong>
        <div className="tbtns">
          <button aria-pressed={t.mute} onClick={() => set({ mute: !t.mute }, 'Mute')} title="Mute">
            M
          </button>
          <button aria-pressed={t.solo} onClick={() => set({ solo: !t.solo }, 'Solo')} title="Solo">
            S
          </button>
        </div>
      </header>
      <Slider
        label="Volume"
        value={t.volume}
        min={0}
        max={1.5}
        onChange={(v) => set({ volume: v }, 'Volume')}
        fmt={(v) => db(v) + ' dB'}
      />
      <Slider
        label="Pan"
        value={t.pan}
        min={-1}
        max={1}
        onChange={(v) => set({ pan: v }, 'Pan')}
        fmt={(v) =>
          Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`
        }
      />
      <label className="slider">
        <span>Type</span>
        <select
          value={t.type}
          onChange={(e) => {
            const type = e.target.value as TrackType;
            if (
              (type === 'drums') !== (t.type === 'drums') &&
              !confirm(
                type === 'drums'
                  ? 'Turn this track into drums? Its notes become drum hits by General MIDI drum number.'
                  : 'Turn these drums into a pitched track? Each hit becomes a short note at its General MIDI pitch.',
              )
            )
              return;
            st.exec(changeTrackType(t.id, type));
            if (st.trackId === t.id)
              st.set({
                selection: new Set(),
                tabCursor: null,
                view: type === 'drums' ? 'drums' : st.view === 'drums' ? 'split' : st.view,
              });
          }}
        >
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="slider">
        <span>Instrument</span>
        <select value={t.instrument} onChange={(e) => set({ instrument: e.target.value }, 'Instrument')}>
          {!options.some((o) => o.id === t.instrument) && (
            <option value={t.instrument}>
              {instruments === null
                ? 'Loading…'
                : t.instrument
                  ? `${t.instrument} (not installed)`
                  : 'Default (none installed: basic sound)'}
            </option>
          )}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {isFretted(t.type) && <TuningField t={t} />}
      {isFretted(t.type) && (
        <label className="slider">
          <span>Frets</span>
          <select value={t.maxFret} onChange={(e) => set({ maxFret: Number(e.target.value) }, 'Fret count')}>
            {[12, 15, 17, 19, 20, 21, 22, 24, 27, 30].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      )}
      {t.type === 'drums' && (
        <>
          <h4>Kit</h4>
          <Slider
            label="Close mics"
            value={t.drumMics?.close ?? 1}
            min={0}
            max={1.5}
            onChange={(v) => set({ drumMics: { close: v, oh: t.drumMics?.oh ?? 1 } }, 'Mic balance')}
            fmt={(v) => db(v) + ' dB'}
          />
          <Slider
            label="Overheads"
            value={t.drumMics?.oh ?? 1}
            min={0}
            max={1.5}
            onChange={(v) => set({ drumMics: { close: t.drumMics?.close ?? 1, oh: v } }, 'Mic balance')}
            fmt={(v) => db(v) + ' dB'}
          />
          <Slider
            label="Kit comp"
            value={t.drumComp ?? 0.35}
            min={0}
            max={1}
            onChange={(v) => set({ drumComp: v }, 'Kit compressor')}
            fmt={(v) => Math.round(v * 100) + '%'}
          />
          <h4>Pieces</h4>
          {PIECES.map((p) => (
            <Slider
              key={p.piece}
              label={p.label}
              value={t.drumMix?.[p.piece] ?? 1}
              min={0}
              max={1.5}
              onChange={(v) => set({ drumMix: { ...t.drumMix, [p.piece]: v } }, 'Drum mix')}
              fmt={(v) => db(v) + ' dB'}
            />
          ))}
        </>
      )}
    </section>
  );
}

export function Mixer() {
  const song = useStore((s) => s.song);
  const [instruments, setInstruments] = useState<InstrumentOption[] | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  useEffect(() => {
    void ensureEngine().then(async (e) => {
      e.lib.refresh(); // always the current list (instruments may have been added since)
      setInstruments(await e.lib.index());
      setLatency(e.latencyMs);
    });
  }, []);
  return (
    <Modal title="Mixer" wide>
      {instruments !== null && instruments.length === 0 && (
        <p className="warn">
          Couldn’t load the instrument list, so every track is playing a basic fallback sound.{' '}
          <button
            className="ib small"
            onClick={() => {
              setInstruments(null);
              void ensureEngine().then(async (e) => {
                e.lib.refresh();
                setInstruments(await e.lib.index());
                e.setSong(useStore.getState().song);
              });
            }}
          >
            Retry
          </button>
        </p>
      )}
      <div className="mixer">
        {song.tracks.map((t) => (
          <Strip key={t.id} t={t} instruments={instruments} />
        ))}
      </div>
      <Humanize />
      <p className="mute">
        Master: glue compressor → limiter. Output latency: {latency == null ? '…' : `${latency} ms`}{' '}
        (interactive latency hint).
      </p>
    </Modal>
  );
}

/** Fully custom tuning: type the open strings low to high, e.g. "C2 G2 C3 F3 A3 D4". */
function TuningField({ t }: { t: Track }) {
  const text = t.tuning.strings.map(pitchName).join(' ');
  const [err, setErr] = useState(false);
  return (
    <label className="slider" title="Open strings, lowest first (4–8 strings)">
      <span>Tuning</span>
      <input
        key={text}
        className={'tuningtext' + (err ? ' bad' : '')}
        defaultValue={text}
        aria-label={`Tuning of ${t.name}`}
        onBlur={(e) => {
          try {
            const strings = e.target.value.trim().split(/s+/).map(parsePitch);
            if (strings.length < 4 || strings.length > 8) throw new Error('4–8 strings');
            setErr(false);
            if (strings.join() !== t.tuning.strings.join())
              useStore
                .getState()
                .exec(setTuning(t.id, { name: 'Custom: ' + strings.map(pitchName).join(' '), strings }));
          } catch {
            setErr(true);
          }
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** Humanize: random timing (ms) and velocity spread applied at playback and export. */
function Humanize() {
  const h = useStore((s) => s.song.humanize);
  const set = (patch: Partial<typeof h>) =>
    useStore.getState().exec(updateSong({ humanize: { ...h, ...patch } }, 'Humanize'));
  return (
    <section className="humanize">
      <h4>Humanize</h4>
      <Slider
        label="Timing"
        value={h.timingMs}
        min={0}
        max={20}
        step={1}
        onChange={(v) => set({ timingMs: v })}
        fmt={(v) => `±${v} ms`}
      />
      <Slider
        label="Velocity"
        value={h.velocity}
        min={0}
        max={30}
        step={1}
        onChange={(v) => set({ velocity: v })}
        fmt={(v) => `±${v}`}
      />
    </section>
  );
}
