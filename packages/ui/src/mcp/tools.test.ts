import { describe, expect, it, beforeEach } from 'vitest';
import { PPQ } from '@riffroll/core';
import { TOOLS } from '../../../../apps/server/src/mcp/protocol';
import { TOOL_NAMES, runTool } from './tools';
import { initialSong, useStore } from '../store';

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await runTool(name, args);
  const text = r.content[0].text;
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text (tab, errors) */
  }
  return { error: !!r.isError, data: data as Record<string, any>, text };
};

beforeEach(() => {
  useStore.getState().loadSong({ ...initialSong(), title: 'Test' });
  useStore.getState().set({ screen: 'editor', doc: { access: 'owner', blocked: null } });
});

describe('MCP tools', () => {
  it('implements every tool the server lists', () => {
    expect(TOOL_NAMES.sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it('describes the song', async () => {
    const { data } = await call('get_song');
    expect(data.title).toBe('Test');
    expect(data.tracks.map((t: { type: string }) => t.type)).toEqual(['drums', 'guitar', 'guitar', 'bass']);
    expect(data.drum_lanes).toContain('kick:right');
    expect(data.tracks[1].strings_high_to_low).toEqual(['E4', 'B3', 'G3', 'D3', 'A2', 'E2']);
  });

  it('adds notes by pitch or string/fret as one undo step, growing the song', async () => {
    const before = useStore.getState().song.tracks[2].notes.length;
    const { data, error } = await call('add_notes', {
      track: 'Guitar 2',
      notes: [
        { pitch: 'E2', bar: 1, beat: 1, length: 0.5 },
        { string: 6, fret: 3, bar: 1, beat: 1.5, length: 0.5, techniques: { palmMute: true } },
        { pitch: 'A3', bar: 6, beat: 4, length: 1 },
      ],
    });
    expect(error).toBe(false);
    const t = useStore.getState().song.tracks[2];
    expect(t.notes.length).toBe(before + 3);
    expect(data.added[1]).toMatchObject({ pitch: 'G2', bar: 1, beat: 1.5, string: 6, fret: 3, length: 0.5 });
    expect(data.added[1].techniques).toEqual({ palmMute: true });
    expect(useStore.getState().song.bars).toBe(6);
    expect(useStore.getState().history.undoLabel).toBe('Claude: Add notes');
    useStore.getState().undo();
    expect(useStore.getState().song.tracks[2].notes.length).toBe(before);
    expect(useStore.getState().song.bars).toBe(4);
  });

  it('reads notes and tab, edits and deletes them', async () => {
    const g = useStore.getState().song.tracks[1];
    const { data } = await call('get_notes', { track: 2, from_bar: 1, to_bar: 1 });
    expect(data.notes.length).toBeGreaterThan(0);
    expect(data.notes.every((n: { bar: number }) => n.bar === 1)).toBe(true);
    const tab = await call('get_tab', { track: g.id, to_bar: 2 });
    expect(tab.text).toMatch(/^e +\|/m);
    const first = g.notes[0];
    await call('edit_notes', { track: g.id, ids: [first.id], transpose: 12, shift: 1, velocity: 50 });
    const moved = useStore.getState().song.tracks[1].notes.find((n) => n.id === first.id)!;
    expect(moved).toMatchObject({ pitch: first.pitch + 12, start: first.start + PPQ, velocity: 50 });
    const del = await call('delete_notes', { track: g.id, from_bar: 1, to_bar: 1 });
    expect(del.data.deleted).toBeGreaterThan(0);
    expect((await call('delete_notes', { track: g.id })).error).toBe(true); // no ids or range
  });

  it('adds drum hits by lane or piece', async () => {
    const { data } = await call('add_drum_hits', {
      hits: [
        { lane: 'kick', bar: 2, beat: 1 },
        { lane: 'snare:center', bar: 2, beat: 2, velocity: 90 },
      ],
    });
    expect(data.added).toBe(2);
    const d = useStore.getState().song.tracks[0];
    expect(d.hits.find((h) => h.id === data.ids[1])).toMatchObject({ piece: 'snare', velocity: 90 });
    expect((await call('add_drum_hits', { hits: [{ lane: 'cowbell' }] })).error).toBe(true);
  });

  it('changes song settings, sections and tracks', async () => {
    const { data } = await call('set_song', { tempo: 140, key: 'F# minor', time_signature: '7/8', bars: 12 });
    expect(data).toMatchObject({ bars: 12, key: 'F# minor', time_signatures: [{ bar: 1, sig: '7/8' }] });
    expect(data.tempo[0].bpm).toBe(140);
    await call('set_sections', {
      sections: [
        { name: 'Verse', bar: 5 },
        { name: 'Intro', bar: 1 },
      ],
    });
    expect(useStore.getState().song.sections.map((s) => s.name)).toEqual(['Intro', 'Verse']);
    const t = await call('add_track', { type: 'guitar', name: 'Baritone', tuning: 'Drop D' });
    expect(useStore.getState().song.tracks.at(-1)).toMatchObject({ name: 'Baritone' });
    expect(useStore.getState().song.tracks.at(-1)!.tuning.name).toBe('Drop D');
    await call('update_track', { track: t.data.id, mute: true, volume: 0.5 });
    expect(useStore.getState().song.tracks.at(-1)).toMatchObject({ mute: true, volume: 0.5 });
    await call('update_track', { track: 'Baritone', delete: true });
    expect(useStore.getState().song.tracks.length).toBe(4);
  });

  it('explains what went wrong instead of throwing', async () => {
    expect((await call('add_notes', { track: 'Nope', notes: [{ pitch: 'E2' }] })).text).toMatch(/No track/);
    expect((await call('add_notes', { notes: [{ pitch: 'H9' }] })).error).toBe(true);
    expect((await call('set_song', { key: 'Q major' })).error).toBe(true);
    useStore.getState().set({ screen: 'home' });
    expect((await call('get_song')).text).toMatch(/No song is open/);
  });
});
