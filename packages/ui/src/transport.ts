/**
 * Transport facade used by the UI. The audio engine registers its implementation at startup; until then
 * (or if Web Audio is unavailable) these are no-ops.
 */
export interface TransportImpl {
  play(fromTick: number): void;
  stop(): void;
}

let impl: TransportImpl | null = null;
export function setTransport(t: TransportImpl) {
  impl = t;
}

import { useStore } from './store';

export function togglePlay() {
  const st = useStore.getState();
  if (st.playing) impl?.stop();
  else impl?.play(st.cursor);
}

export function stop() {
  impl?.stop();
}

/** Restart playback from the cursor if playing (after seeking). */
export function seek(tick: number) {
  const st = useStore.getState();
  st.set({ cursor: tick });
  if (st.playing) {
    impl?.stop();
    impl?.play(tick);
  }
}
