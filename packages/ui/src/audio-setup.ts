/**
 * Connects the audio engine to the UI store. The AudioContext is created on the first user gesture
 * (browsers block audio before that), then kept in sync with the song on every edit.
 */
import { AudioEngine, gateWorkletUrl } from '@riffroll/audio';
import { setAudioHooks } from './audio-bridge';
import { setTransport } from './transport';
import { useStore } from './store';
import { KEYS_W, pxPerTick } from './canvas';
import { settings } from './settings';

let engine: AudioEngine | null = null;
let creating: Promise<AudioEngine> | null = null;
let unsync: (() => void) | null = null;

export function getEngine(): AudioEngine | null {
  return engine;
}

export function ensureEngine(): Promise<AudioEngine> {
  if (engine) return Promise.resolve(engine);
  if (!creating) {
    creating = AudioEngine.create({
      instrumentsUrl: new URL('./instruments/', location.href).href,
      gateWorkletUrl,
      onEnded: () => useStore.getState().set({ playing: false, playhead: null }),
      onStatus: (msg) => useStore.getState().set({ status: msg }),
      latencyHint: settings().audio.latency,
      sampleRate: settings().audio.sampleRate || undefined,
      sinkId: settings().audio.sinkId || undefined,
    }).then((e) => {
      engine = e;
      if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__engine = e;
      e.setSong(useStore.getState().song);
      e.speed = useStore.getState().speed;
      void e.setUserAssets(useStore.getState().assets);
      unsync = useStore.subscribe((s, prev) => {
        if (s.song !== prev.song) e.setSong(s.song);
        if (s.assets !== prev.assets) void e.setUserAssets(s.assets);
        if (s.speed !== prev.speed) {
          e.speed = s.speed;
          if (e.playing) {
            const at = e.currentTick();
            e.stop();
            e.play(at ?? s.cursor);
          }
        }
      });
      // warm the sample cache for what's in the song
      void e.prepare(useStore.getState().song, (d, t) => {
        if (t) useStore.getState().set({ status: d < t ? `Loading instruments ${d}/${t}…` : '' });
      });
      return e;
    });
  }
  return creating;
}

/**
 * Close the audio device and open it again with the current settings (latency and sample rate can only be
 * chosen when the AudioContext is made). Playback stops.
 */
export async function restartAudio(): Promise<AudioEngine> {
  const old = engine ?? (creating ? await creating.catch(() => null) : null);
  unsync?.();
  unsync = null;
  if (old) old.dispose();
  engine = null;
  creating = null;
  useStore.getState().set({ playing: false, playhead: null });
  const e = await ensureEngine();
  await e.resume();
  return e;
}

/** Switch the output device without restarting. */
export async function setOutputDevice(sinkId: string) {
  settings().updateAudio({ sinkId });
  if (engine) await engine.setOutput(sinkId);
}

function playheadLoop() {
  const st = useStore.getState();
  if (!st.playing || !engine) return;
  const tick = engine.currentTick();
  if (tick !== st.playhead) {
    st.set({ playhead: tick });
    // keep the playhead in view (unless the user is dragging something)
    const sc = document.querySelector<HTMLElement>('.cvwrap .scroller');
    if (tick != null && sc && settings().followPlayhead && !(document.body.dataset.dragging === '1')) {
      const x = tick * pxPerTick(st.zoom);
      const view = sc.clientWidth - KEYS_W;
      if (x < st.scrollX || x > st.scrollX + view - 24) st.set({ scrollX: Math.max(0, x - 24) });
    }
  }
  requestAnimationFrame(playheadLoop);
}

export function installAudio() {
  const gesture = () => {
    void ensureEngine().then((e) => e.resume());
  };
  window.addEventListener('pointerdown', gesture, { once: true, capture: true });
  window.addEventListener('keydown', gesture, { once: true, capture: true });

  setAudioHooks({
    preview: (track, pitch, tick, len) => {
      void ensureEngine().then((e) => e.preview(track, pitch, tick, len));
    },
    previewDrum: (track, lane, velocity) => {
      void ensureEngine().then((e) => e.previewDrum(track, lane, velocity));
    },
  });

  setTransport({
    play: (from) => {
      void ensureEngine().then(async (e) => {
        await e.resume();
        const st = useStore.getState();
        // make sure every sample the song needs is decoded before the first beat
        let shown = false;
        await e.prepare(st.song, (d, t) => {
          if (d < t) {
            shown = true;
            st.set({ status: `Loading instruments ${d}/${t}…` });
          }
        });
        if (shown) st.set({ status: '' });
        e.play(from);
        useStore.getState().set({ playing: true });
        requestAnimationFrame(playheadLoop);
      });
    },
    stop: () => {
      engine?.stop();
      useStore.getState().set({ playing: false, playhead: null });
    },
  });
}
