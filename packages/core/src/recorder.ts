/** Turns live note-on/note-off events (e.g. from a MIDI keyboard or MIDI guitar) into notes. */
import { newId, type Note } from './model';

export interface RecorderOptions {
  /** snap starts (and lengths) to this many ticks; 0/1 = no quantize */
  quantize?: number;
  /** shortest recorded note in ticks */
  minLength?: number;
  /** MIDI guitar mode: channel N (0-based) = string N counted from the highest string */
  stringCount?: number;
}

interface Open {
  start: number;
  velocity: number;
  channel: number;
}

/** MIDI guitars send one channel per string, channel 1 = high e. Returns our string index (0 = lowest) or null. */
export function channelToString(channel: number, stringCount: number): number | null {
  return channel >= 0 && channel < stringCount ? stringCount - 1 - channel : null;
}

export class NoteRecorder {
  private open = new Map<string, Open>();
  constructor(private o: RecorderOptions = {}) {}

  get held(): number {
    return this.open.size;
  }

  noteOn(pitch: number, velocity: number, tick: number, channel = 0) {
    this.open.set(`${channel}:${pitch}`, { start: tick, velocity, channel });
  }

  /** Returns the finished note, or null if that key wasn't down. */
  noteOff(pitch: number, tick: number, channel = 0): Note | null {
    const key = `${channel}:${pitch}`;
    const o = this.open.get(key);
    if (!o) return null;
    this.open.delete(key);
    return this.make(pitch, o, tick);
  }

  /** Close every held note (playback stopped). */
  flush(tick: number): Note[] {
    const out: Note[] = [];
    for (const [key, o] of this.open) out.push(this.make(Number(key.split(':')[1]), o, tick));
    this.open.clear();
    return out;
  }

  private make(pitch: number, o: Open, end: number): Note {
    const q = this.o.quantize && this.o.quantize > 1 ? this.o.quantize : 0;
    const min = this.o.minLength ?? 60;
    let start = Math.max(0, Math.round(o.start));
    let len = Math.max(min, Math.round(end - o.start));
    if (q) {
      start = Math.round(o.start / q) * q;
      len = Math.max(q, Math.round(len / q) * q);
    }
    const pinned = this.o.stringCount ? channelToString(o.channel, this.o.stringCount) : null;
    return {
      id: newId('n'),
      pitch,
      start,
      duration: len,
      velocity: Math.max(1, Math.min(127, o.velocity)),
      ...(pinned != null ? { pinnedString: pinned } : {}),
    };
  }
}
