import { useEffect, useState } from 'react';
import { updateTrack, type DrumPiece, type Track } from '@riffroll/core';
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
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{fmt ? fmt(value) : value.toFixed(2)}</output>
    </label>
  );
}

function Strip({ t, instruments }: { t: Track; instruments: InstrumentOption[] }) {
  const st = useStore.getState();
  const set = (ch: Partial<Track>, label: string) => st.exec(updateTrack(t.id, ch, label));
  const options = instruments.filter((i) => i.role === t.type);
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
      <Slider label="Volume" value={t.volume} min={0} max={1.5} onChange={(v) => set({ volume: v }, 'Volume')} fmt={(v) => db(v) + ' dB'} />
      <Slider label="Pan" value={t.pan} min={-1} max={1} onChange={(v) => set({ pan: v }, 'Pan')} fmt={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)} />
      <label className="slider">
        <span>Instrument</span>
        <select value={t.instrument} onChange={(e) => set({ instrument: e.target.value }, 'Instrument')}>
          {!options.some((o) => o.id === t.instrument) && <option value={t.instrument}>{t.instrument} (not installed)</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {t.type === 'drums' && (
        <>
          <h4>Kit</h4>
          <Slider label="Close mics" value={t.drumMics?.close ?? 1} min={0} max={1.5} onChange={(v) => set({ drumMics: { close: v, oh: t.drumMics?.oh ?? 1 } }, 'Mic balance')} fmt={(v) => db(v) + ' dB'} />
          <Slider label="Overheads" value={t.drumMics?.oh ?? 1} min={0} max={1.5} onChange={(v) => set({ drumMics: { close: t.drumMics?.close ?? 1, oh: v } }, 'Mic balance')} fmt={(v) => db(v) + ' dB'} />
          <Slider label="Kit comp" value={t.drumComp ?? 0.35} min={0} max={1} onChange={(v) => set({ drumComp: v }, 'Kit compressor')} fmt={(v) => Math.round(v * 100) + '%'} />
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
  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  useEffect(() => {
    void ensureEngine().then(async (e) => {
      setInstruments(await e.lib.index());
      setLatency(e.latencyMs);
    });
  }, []);
  return (
    <Modal title="Mixer" wide>
      <div className="mixer">
        {song.tracks.map((t) => (
          <Strip key={t.id} t={t} instruments={instruments} />
        ))}
      </div>
      <p className="mute">
        Master: glue compressor → limiter. Output latency: {latency == null ? '…' : `${latency} ms`} (interactive latency hint).
      </p>
    </Modal>
  );
}
