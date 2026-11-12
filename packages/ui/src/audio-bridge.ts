/**
 * The UI's single entry point to the audio engine. Views call these; the engine is created lazily on the first
 * user gesture (browsers only allow audio after one).
 */
import type { Track } from '@riffroll/core';

export interface AudioHooks {
  preview(track: Track, pitch: number, tick: number, lengthTicks?: number): void;
  previewDrum(track: Track, lane: string, velocity: number): void;
}

let hooks: AudioHooks = {
  preview() {},
  previewDrum() {},
};

export function setAudioHooks(h: AudioHooks) {
  hooks = h;
}

export const preview = (track: Track, pitch: number, tick: number, len?: number) =>
  hooks.preview(track, pitch, tick, len);
export const previewDrum = (track: Track, lane: string, velocity = 100) =>
  hooks.previewDrum(track, lane, velocity);
