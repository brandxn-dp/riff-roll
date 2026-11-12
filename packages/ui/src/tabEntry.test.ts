import { describe, expect, it, beforeEach } from 'vitest';
import { newSong, trackFingering } from '@riffroll/core';
import { currentTrack, useStore } from './store';
import { tabKey } from './tabEntry';

const notesAt = (tick: number) => currentTrack()!.notes.filter((n) => n.start === tick);

describe('tab entry (keyboard and the mobile fret pad share this path)', () => {
  beforeEach(() => {
    useStore.getState().loadSong(newSong());
    const st = useStore.getState();
    const guitar = st.song.tracks.find((t) => t.type === 'guitar')!;
    st.set({ trackId: guitar.id, view: 'split', tabCursor: { tick: 960 * 9, string: 3 }, noteLen: 480 });
  });

  it('fret pad: "fret:N" enters fret N on the cursor string, pinned', () => {
    expect(tabKey('fret:5')).toBe(true);
    const [n] = notesAt(960 * 9);
    expect(n.pitch).toBe(55 + 5); // G string + 5
    expect(n.pinnedString).toBe(3);
    expect(trackFingering(currentTrack()!).get(n.id)).toEqual({ string: 3, fret: 5 });
  });

  it('arrows, techniques, delete and Escape', () => {
    tabKey('fret:7');
    tabKey('p');
    expect(notesAt(960 * 9)[0].tech?.palmMute).toBe(true);
    tabKey('ArrowRight');
    expect(useStore.getState().tabCursor!.tick).toBe(960 * 9 + 480);
    tabKey('ArrowLeft');
    tabKey('Delete');
    expect(notesAt(960 * 9)).toHaveLength(0);
    tabKey('Escape');
    expect(useStore.getState().tabCursor).toBeNull();
  });
});
