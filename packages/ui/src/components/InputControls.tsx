import { useEffect, useState } from 'react';
import { currentTrack, useStore } from '../store';
import { enableMidi, selectMidiInput } from '../midiInput';
import { ensureEngine } from '../audio-setup';

/** Toolbar: MIDI input (record / step entry) and live guitar input through the amp sim. */
export function InputControls() {
  const midi = useStore((s) => s.midi);
  const track = useStore((s) => currentTrack(s));
  const st = useStore.getState();
  const [live, setLive] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState('');
  const [gain, setGain] = useState(2.5);

  // live input follows the selected track
  useEffect(() => {
    if (!live || !track || track.type === 'drums') return;
    let cancelled = false;
    void ensureEngine().then(async (e) => {
      if (cancelled || e.liveInputTrack === track.id) return;
      try {
        await e.startLiveInput(track, device || undefined, gain);
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'));
        st.set({ status: `Live input → ${track.name} (amp, pedal and stomps apply)` });
      } catch (err) {
        setLive(false);
        st.set({ status: `Live input failed: ${(err as Error).message}` });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [live, track?.id, device]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!live) void ensureEngine().then((e) => e.stopLiveInput());
  }, [live]);

  return (
    <div className="group" role="group" aria-label="Inputs">
      {midi.inputs.length ? (
        <>
          <select
            className="mini"
            aria-label="MIDI input"
            value={midi.inputId ?? ''}
            onChange={(e) => selectMidiInput(e.target.value || null)}
          >
            {midi.inputs.map((i) => (
              <option key={i.id} value={i.id}>
                MIDI: {i.name}
              </option>
            ))}
          </select>
          <button
            aria-pressed={midi.armed}
            className={midi.armed ? 'rec' : ''}
            title="Record MIDI while playing (when stopped, keys step-enter notes at the cursor)"
            onClick={() => st.set({ midi: { ...midi, armed: !midi.armed } })}
          >
            ● Rec
          </button>
          <button
            aria-pressed={midi.quantize}
            title="Quantize recorded notes to the snap grid"
            onClick={() => st.set({ midi: { ...midi, quantize: !midi.quantize } })}
          >
            Q
          </button>
          <button
            aria-pressed={midi.guitarChannels}
            title="MIDI guitar: channel 1–6 = string (pins notes to the string you played)"
            onClick={() => st.set({ midi: { ...midi, guitarChannels: !midi.guitarChannels } })}
          >
            Ch=Str
          </button>
        </>
      ) : (
        <button title="Connect a MIDI keyboard or MIDI guitar" onClick={() => void enableMidi()}>
          MIDI
        </button>
      )}
      {track && track.type !== 'drums' && (
        <button
          aria-pressed={live}
          title="Play your guitar/bass (audio interface) through this track's amp and pedal"
          onClick={() => setLive(!live)}
        >
          🎸 Input
        </button>
      )}
      {live && devices.length > 1 && (
        <select
          className="mini"
          aria-label="Audio input device"
          value={device}
          onChange={(e) => setDevice(e.target.value)}
        >
          <option value="">Default input</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Input'}
            </option>
          ))}
        </select>
      )}
      {live && (
        <input
          type="range"
          aria-label="Input gain"
          title="Input gain"
          min={0.5}
          max={8}
          step={0.1}
          value={gain}
          onChange={(e) => {
            const v = Number(e.target.value);
            setGain(v);
            void ensureEngine().then((en) => en.setLiveInputGain(v));
          }}
        />
      )}
    </div>
  );
}
