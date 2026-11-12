/**
 * Web MIDI input. While playing with Rec armed, notes are recorded into the current track at the playhead (one undo
 * step per take). When stopped, playing a key enters a note at the cursor and advances by the note length (step
 * entry; keys held together form a chord). Notes are always heard through the track's current tone.
 */
import { NoteRecorder, addHits, addNotes, laneForGm, newId, type DrumHit } from '@riffroll/core';
import { currentTrack, useStore } from './store';
import { ensureEngine, getEngine } from './audio-setup';

let access: MIDIAccess | null = null;
let recorder: NoteRecorder | null = null;
let recording = false;
const releases = new Map<string, Promise<() => void>>();
let stepHeld = 0;
let stepStart: number | null = null;

function refreshInputs() {
  if (!access) return;
  const inputs = [...access.inputs.values()].map((i) => ({ id: i.id, name: i.name ?? i.id }));
  const st = useStore.getState();
  const inputId =
    st.midi.inputId && inputs.some((i) => i.id === st.midi.inputId)
      ? st.midi.inputId
      : (inputs[0]?.id ?? null);
  st.set({
    midi: { ...st.midi, inputs, inputId },
    ...(inputs.length
      ? {}
      : { status: 'No MIDI input found. Connect a keyboard or MIDI guitar; it appears automatically.' }),
  });
  attach();
}

function attach() {
  if (!access) return;
  const id = useStore.getState().midi.inputId;
  for (const input of access.inputs.values()) input.onmidimessage = input.id === id ? onMessage : null;
}

export async function enableMidi(): Promise<boolean> {
  if (access) return true;
  if (!navigator.requestMIDIAccess) {
    useStore
      .getState()
      .set({ status: 'This browser has no Web MIDI support (try Chrome, Edge or the desktop app).' });
    return false;
  }
  try {
    access = await navigator.requestMIDIAccess();
    access.onstatechange = refreshInputs;
    refreshInputs();
    void ensureEngine();
    return true;
  } catch {
    useStore.getState().set({ status: 'MIDI access was blocked.' });
    return false;
  }
}

export function selectMidiInput(id: string | null) {
  const st = useStore.getState();
  st.set({ midi: { ...st.midi, inputId: id } });
  attach();
}

function onMessage(e: MIDIMessageEvent) {
  const d = e.data;
  if (!d || d.length < 3) return;
  const type = d[0] & 0xf0,
    ch = d[0] & 0x0f;
  if (type === 0x90 && d[2] > 0) noteOn(d[1], d[2], ch);
  else if (type === 0x80 || (type === 0x90 && d[2] === 0)) noteOff(d[1], ch);
}

function noteOn(pitch: number, velocity: number, channel: number) {
  const st = useStore.getState();
  const t = currentTrack(st);
  const e = getEngine();
  if (!t || !e) return;
  const key = `${channel}:${pitch}`;
  releases.set(key, e.liveNote(t, pitch, velocity));
  if (st.playing && st.midi.armed) {
    const tick = e.currentTick();
    if (tick == null) return;
    if (!recording) {
      recording = true;
      recorder = new NoteRecorder({
        quantize: st.midi.quantize ? st.snap : 0,
        stringCount: st.midi.guitarChannels && t.type !== 'drums' ? t.tuning.strings.length : undefined,
      });
      st.begin('Record take');
    }
    if (t.type === 'drums') {
      const lane = laneForGm(pitch);
      if (!lane) return;
      const start = st.midi.quantize ? Math.round(tick / st.snap) * st.snap : Math.round(tick);
      const hit: DrumHit = {
        id: newId('h'),
        start,
        piece: lane.piece,
        articulation: lane.articulation,
        velocity,
      };
      st.exec(addHits(t.id, [hit], 'Record take'));
    } else recorder!.noteOn(pitch, velocity, tick, channel);
    return;
  }
  if (st.playing) return;
  // step entry
  if (stepHeld === 0) stepStart = st.cursor;
  stepHeld++;
  if (t.type === 'drums') {
    const lane = laneForGm(pitch);
    if (lane)
      st.exec(
        addHits(
          t.id,
          [
            {
              id: newId('h'),
              start: stepStart!,
              piece: lane.piece,
              articulation: lane.articulation,
              velocity,
            },
          ],
          'Step input',
        ),
      );
  } else {
    const n = { id: newId('n'), pitch, start: stepStart!, duration: st.noteLen, velocity };
    st.exec(addNotes(t.id, [n], 'Step input'));
  }
}

function noteOff(pitch: number, channel: number) {
  const st = useStore.getState();
  const key = `${channel}:${pitch}`;
  void releases.get(key)?.then((stop) => stop());
  releases.delete(key);
  const t = currentTrack(st);
  if (recording && recorder && t && t.type !== 'drums') {
    const tick = getEngine()?.currentTick();
    const n = tick != null ? recorder.noteOff(pitch, tick, channel) : null;
    if (n) st.exec(addNotes(t.id, [n], 'Record take'));
    return;
  }
  if (!st.playing && stepHeld > 0) {
    stepHeld--;
    if (stepHeld === 0 && stepStart != null) st.set({ cursor: stepStart + st.noteLen });
  }
}

/** Close the take when playback stops. */
export function installMidi() {
  return useStore.subscribe((s, prev) => {
    if (prev.playing && !s.playing && recording) {
      const t = currentTrack(s);
      const left = recorder?.flush(prev.playhead ?? s.cursor) ?? [];
      if (t && left.length) s.exec(addNotes(t.id, left, 'Record take'));
      s.commit();
      recording = false;
      recorder = null;
      s.set({ status: 'Recorded take (Ctrl+Z undoes the whole take)' });
    }
  });
}
