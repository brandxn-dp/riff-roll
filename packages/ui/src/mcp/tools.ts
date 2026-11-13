/**
 * The MCP tools, run inside the editor so Claude's edits show up live and land on the undo stack like the user's
 * own (one undo step per call, labelled "Claude: …"). The tool list and descriptions live in
 * apps/server/src/mcp/protocol.ts; this is what each one does.
 */
import {
  DRUM_LANES,
  NOTE_NAMES,
  keyTonic,
  PPQ,
  SCALES,
  TRACK_COLORS,
  addHits,
  addNotes,
  addTrack,
  asciiTab,
  cmd,
  isFretted,
  makeTrack,
  newId,
  notesNearFret,
  notesToString,
  shiftStrings,
  parsePitch,
  pitchName,
  removeHits,
  removeNotes,
  removeTrack,
  setBars,
  setTempos,
  setTimeSigs,
  setTuning,
  trackFingering,
  tuningByName,
  updateHits,
  updateNotes,
  updateSong,
  updateTrack,
  type Command,
  type DrumHit,
  type Note,
  type Song,
  type Techniques,
  type TempoPoint,
  type TimeSig,
  type Track,
  type TrackType,
} from '@riffroll/core';
import { barMap, currentTrack, songEnd, useStore } from '../store';
import { pxPerTick, KEYS_W } from '../canvas';
import { seek, stop, togglePlay } from '../transport';
import { flushSaves, getStorage, newProject, openProject } from '../files/actions';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
type Args = Record<string, unknown>;

class ToolError extends Error {}
const bad = (msg: string): never => {
  throw new ToolError(msg);
};

const st = () => useStore.getState();
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);

function needSong() {
  if (st().screen !== 'editor')
    bad('No song is open in Riff Roll. Use list_songs and open_song, or new_song.');
  if (st().doc.blocked === 'readonly')
    bad('This song is view-only for the user, so changes can’t be saved. Open one of their own songs.');
}

/** A track by id, name or 1-based number; the editor's track by default. */
function trackOf(ref: unknown): Track {
  const s = st();
  if (ref == null || ref === '') return currentTrack(s) ?? bad('The song has no tracks.');
  const tracks = s.song.tracks;
  const n = typeof ref === 'number' ? ref : /^\d+$/.test(String(ref)) ? Number(ref) : NaN;
  const t =
    tracks.find((x) => x.id === ref) ??
    tracks.find((x) => x.name.toLowerCase() === String(ref).toLowerCase()) ??
    (Number.isInteger(n) ? tracks[n - 1] : undefined);
  return t ?? bad(`No track "${ref}". Tracks: ${tracks.map((x, i) => `${i + 1} ${x.name}`).join(', ')}`);
}

/** bar/beat (1-based, beats in quarter notes) or tick → tick */
function tickOf(a: Args): number {
  const tick = num(a.tick);
  if (tick != null) return Math.max(0, Math.round(tick));
  const bar = num(a.bar) ?? 1;
  const beat = num(a.beat) ?? 1;
  if (bar < 1) bad('Bars start at 1.');
  if (beat < 1) bad('Beats start at 1.');
  return Math.round(barMap(st().song).barStart(Math.floor(bar) - 1) + (beat - 1) * PPQ);
}
function where(tick: number) {
  const b = barMap(st().song).barAtTick(tick);
  return { bar: b.index + 1, beat: r3((tick - b.start) / PPQ + 1) };
}
/** [from, to) ticks of a 1-based inclusive bar range (whole song by default) */
function range(a: Args): [number, number] {
  const bm = barMap(st().song);
  const from = num(a.from_bar);
  const to = num(a.to_bar);
  return [
    from != null ? bm.barStart(Math.max(0, from - 1)) : 0,
    to != null ? bm.barStart(Math.max(0, to)) : Infinity,
  ];
}

/** One undo step for a whole tool call; grows the song if notes land past its end. */
function run(label: string, cmds: Command[], lastTick = 0) {
  const s = st();
  const all = [...cmds];
  const bm = barMap(s.song);
  if (lastTick > songEnd(s.song)) all.push(setBars(bm.barAtTick(lastTick - 1).index + 1));
  s.exec(cmd(`Claude: ${label}`, (song: Song) => all.reduce((acc, c) => c.apply(acc), song)));
}

const SLIDES = ['shift', 'legato', 'in-below', 'in-above', 'out-down', 'out-up'];
function techniques(v: unknown): Techniques | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const t = v as Record<string, unknown>;
  const out: Techniques = {};
  for (const k of ['palmMute', 'letRing', 'dead', 'ghost', 'hammer', 'tap'] as const)
    if (t[k] === true) out[k] = true;
  if (typeof t.slide === 'string' && SLIDES.includes(t.slide)) out.slide = t.slide as Techniques['slide'];
  if (t.vibrato === 'normal' || t.vibrato === 'wide') out.vibrato = t.vibrato;
  if (t.accent === 'normal' || t.accent === 'heavy') out.accent = t.accent;
  const h = t.harmonic === 'tap' ? 'tapped' : t.harmonic;
  if (h === 'natural' || h === 'artificial' || h === 'pinch' || h === 'tapped') out.harmonic = h;
  const bend = num(t.bend);
  if (bend)
    out.bend = [
      { pos: 0, value: 0 },
      { pos: 0.4, value: bend },
      { pos: 1, value: bend },
    ];
  return Object.keys(out).length ? out : undefined;
}

/** Add, change or (with false/null) remove techniques; clear starts from none. */
function mergeTech(old: Techniques | undefined, raw: unknown, clear: boolean): Techniques | undefined {
  const out: Record<string, unknown> = clear ? {} : { ...(old ?? {}) };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    for (const [k, v] of Object.entries(r)) if (v === false || v === null) delete out[k];
    Object.assign(
      out,
      techniques(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== false && v !== null))) ?? {},
    );
  }
  return Object.keys(out).length ? (out as Techniques) : undefined;
}

function noteInfo(t: Track, n: Note, fing: ReturnType<typeof trackFingering> | null) {
  const pos = fing?.get(n.id);
  const nStr = t.tuning.strings.length;
  return {
    id: n.id,
    pitch: pitchName(n.pitch),
    midi: n.pitch,
    ...where(n.start),
    length: r3(n.duration / PPQ),
    velocity: n.velocity,
    ...(pos ? { string: nStr - pos.string, fret: pos.fret } : fing ? { string: null } : {}),
    ...(n.tech && Object.keys(n.tech).length ? { techniques: n.tech } : {}),
  };
}

function laneOf(name: string) {
  const q = name.trim().toLowerCase();
  return (
    DRUM_LANES.find((l) => l.id === q) ??
    DRUM_LANES.find((l) => l.label.toLowerCase() === q) ??
    DRUM_LANES.find((l) => l.piece === q) ??
    bad(`Unknown drum lane "${name}". Lanes: ${DRUM_LANES.map((l) => l.id).join(', ')}`)
  );
}

function parseKey(s: string): Song['keySig'] {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(major|minor|maj|min|m)?\s*$/i.exec(s);
  if (!m) return bad(`Couldn’t read the key "${s}". Try "E minor" or "A major".`);
  const pc =
    ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C'] +
      (/[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0) +
      12) %
    12;
  const minor = !!m[3] && /^m(in(or)?)?$/i.test(m[3]);
  const majorPc = minor ? (pc + 3) % 12 : pc;
  const flat = /[b♭]/.test(m[2]);
  let best = 0,
    bestScore = Infinity;
  for (let f = -7; f <= 7; f++) {
    if ((((f * 7) % 12) + 12) % 12 !== majorPc) continue;
    const score = Math.abs(f) + (flat ? (f > 0 ? 0.5 : 0) : f < 0 ? 0.5 : 0);
    if (score < bestScore) [best, bestScore] = [f, score];
  }
  return { fifths: best, minor };
}

/** The bpm playing at a tick (inside a gradual change, part way between its two tempos). */
function bpmAt(tempos: TempoPoint[], tick: number): number {
  let i = 0;
  while (i + 1 < tempos.length && tempos[i + 1].tick <= tick) i++;
  const p = tempos[i],
    next = tempos[i + 1];
  if (!p) return 120;
  if (!p.ramp || !next) return p.bpm;
  return Math.round(p.bpm + ((next.bpm - p.bpm) * (tick - p.tick)) / (next.tick - p.tick));
}

// ---------------------------------------------------------------- the tools
const tools: Record<string, (a: Args) => unknown | Promise<unknown>> = {
  get_song() {
    needSong();
    const s = st();
    const song = s.song;
    const bm = barMap(song);
    return {
      title: song.title,
      artist: song.artist,
      bars: song.bars,
      tempo: song.tempos.map((t) => ({ ...where(t.tick), bpm: t.bpm, ...(t.ramp ? { ramp: true } : {}) })),
      time_signatures: song.timeSigs.map((t) => ({ bar: t.bar + 1, sig: `${t.num}/${t.den}` })),
      key: `${NOTE_NAMES[keyTonic(song.keySig)]} ${song.keySig.minor ? 'minor' : 'major'}`,
      scale: song.scale ?? (song.keySig.minor ? 'minor' : 'major'),
      sections: song.sections.map((x) => ({ name: x.name, bar: bm.barAtTick(x.tick).index + 1 })),
      loop: song.loop?.on ? { from: where(song.loop.start), to: where(song.loop.end) } : null,
      shown_track: currentTrack(s)?.id,
      playing: s.playing,
      selected_ids: [...s.selection],
      tracks: song.tracks.map((t, i) => ({
        number: i + 1,
        id: t.id,
        name: t.name,
        type: t.type,
        ...(isFretted(t.type)
          ? {
              tuning: t.tuning.name,
              strings_high_to_low: [...t.tuning.strings].reverse().map(pitchName),
              capo: t.capo,
            }
          : {}),
        instrument: t.instrument,
        notes: t.type === 'drums' ? t.hits.length : t.notes.length,
        mute: t.mute,
        solo: t.solo,
        volume: r3(t.volume),
        pan: r3(t.pan),
      })),
      ...(song.tracks.some((t) => t.type === 'drums') ? { drum_lanes: DRUM_LANES.map((l) => l.id) } : {}),
      positions: 'bar and beat are 1-based; beats and lengths are quarter notes',
    };
  },

  get_notes(a) {
    needSong();
    const t = trackOf(a.track);
    const [from, to] = range(a);
    const LIMIT = 1500;
    if (t.type === 'drums') {
      const hits = t.hits.filter((h) => h.start >= from && h.start < to).sort((x, y) => x.start - y.start);
      return {
        track: t.name,
        hits: hits.slice(0, LIMIT).map((h) => ({
          id: h.id,
          lane: `${h.piece}:${h.articulation}`,
          ...where(h.start),
          velocity: h.velocity,
        })),
        ...(hits.length > LIMIT
          ? { truncated: `showing ${LIMIT} of ${hits.length}; ask for fewer bars` }
          : {}),
      };
    }
    const fing = isFretted(t.type) ? trackFingering(t) : null;
    const notes = t.notes
      .filter((n) => n.start >= from && n.start < to)
      .sort((x, y) => x.start - y.start || x.pitch - y.pitch);
    return {
      track: t.name,
      notes: notes.slice(0, LIMIT).map((n) => noteInfo(t, n, fing)),
      ...(notes.length > LIMIT
        ? { truncated: `showing ${LIMIT} of ${notes.length}; ask for fewer bars` }
        : {}),
    };
  },

  get_tab(a) {
    needSong();
    const t = trackOf(a.track);
    if (!isFretted(t.type)) bad(`${t.name} is not a guitar or bass track.`);
    const bm = barMap(st().song);
    const fromBar = Math.max(1, num(a.from_bar) ?? 1);
    const toBar = Math.min(st().song.bars, num(a.to_bar) ?? fromBar + 7);
    return asciiTab(st().song, t, { from: bm.barStart(fromBar - 1), to: bm.barStart(toBar) });
  },

  add_notes(a) {
    needSong();
    const t = trackOf(a.track);
    if (t.type === 'drums') bad(`${t.name} is a drum track: use add_drum_hits.`);
    const list = Array.isArray(a.notes) ? (a.notes as Args[]) : bad('notes must be a list.');
    if (!list.length) bad('No notes given.');
    const nStr = t.tuning.strings.length;
    let last = 0;
    const notes: Note[] = list.map((x, i) => {
      const at = `note ${i + 1}`;
      const sNum = num(x.string);
      let idx: number | undefined;
      if (sNum != null) {
        if (!isFretted(t.type)) bad(`${at}: ${t.name} has no strings.`);
        if (sNum < 1 || sNum > nStr) bad(`${at}: string ${sNum} doesn’t exist (1–${nStr}).`);
        idx = nStr - sNum;
      }
      let pitch: number;
      if (x.pitch != null) {
        try {
          pitch =
            typeof x.pitch === 'number'
              ? Math.round(x.pitch)
              : parsePitch(String(x.pitch).replace('♯', '#').replace('♭', 'b'));
        } catch {
          return bad(`${at}: can’t read pitch "${x.pitch}" (use names like E2, F#3, Bb1, or MIDI numbers).`);
        }
      } else if (idx != null && num(x.fret) != null) {
        pitch = t.tuning.strings[idx] + t.capo + num(x.fret)!;
      } else return bad(`${at}: give a pitch, or a string and fret.`);
      if (pitch < 0 || pitch > 127) bad(`${at}: pitch out of range.`);
      const start = tickOf(x);
      const duration = Math.max(1, Math.round((num(x.length) ?? 1) * PPQ));
      last = Math.max(last, start + duration);
      return {
        id: newId('n'),
        pitch,
        start,
        duration,
        velocity: Math.max(1, Math.min(127, Math.round(num(x.velocity) ?? 100))),
        ...(idx != null ? { pinnedString: idx } : {}),
        ...(techniques(x.techniques) ? { tech: techniques(x.techniques) } : {}),
      };
    });
    run(notes.length > 1 ? 'Add notes' : 'Add note', [addNotes(t.id, notes)], last);
    const now = trackOf(t.id);
    const fing = isFretted(now.type) ? trackFingering(now) : null;
    const added = new Set(notes.map((n) => n.id));
    return {
      added: now.notes.filter((n) => added.has(n.id)).map((n) => noteInfo(now, n, fing)),
      ...(fing && notes.some((n) => !fing.get(n.id))
        ? { warning: 'Some notes can’t be played on this tuning.' }
        : {}),
    };
  },

  add_drum_hits(a) {
    needSong();
    const t = trackOf(a.track ?? st().song.tracks.find((x) => x.type === 'drums')?.id);
    if (t.type !== 'drums') bad(`${t.name} is not a drum track.`);
    const list = Array.isArray(a.hits) ? (a.hits as Args[]) : bad('hits must be a list.');
    if (!list.length) bad('No hits given.');
    let last = 0;
    const hits: DrumHit[] = list.map((x) => {
      const lane = laneOf(String(x.lane ?? x.piece ?? ''));
      const start = tickOf(x);
      last = Math.max(last, start + 1);
      return {
        id: newId('h'),
        start,
        piece: lane.piece,
        articulation: lane.articulation,
        velocity: Math.max(1, Math.min(127, Math.round(num(x.velocity) ?? 100))),
      };
    });
    run('Add drum hits', [addHits(t.id, hits)], last);
    return { added: hits.length, ids: hits.map((h) => h.id) };
  },

  edit_notes(a) {
    needSong();
    const t = trackOf(a.track);
    const [from, to] = range(a);
    const ids = Array.isArray(a.ids) ? new Set(a.ids.map(String)) : null;
    const pickOk = (x: { id: string; start: number }) =>
      ids ? ids.has(x.id) : x.start >= from && x.start < to;
    const transpose = Math.round(num(a.transpose) ?? 0);
    const shift = Math.round((num(a.shift) ?? 0) * PPQ);
    const vel = num(a.velocity);
    const scale = num(a.velocity_scale);
    const len = num(a.length);
    const v = (old: number) =>
      Math.max(1, Math.min(127, Math.round(vel ?? (scale != null ? old * scale : old))));
    let last = 0,
      n = 0;
    if (t.type === 'drums') {
      if (transpose) bad('Drum hits can’t be transposed.');
      const changes: Record<string, Partial<DrumHit>> = {};
      for (const h of t.hits.filter(pickOk)) {
        const start = Math.max(0, h.start + shift);
        changes[h.id] = { start, velocity: v(h.velocity) };
        last = Math.max(last, start + 1);
        n++;
      }
      if (!n) bad('No drum hits matched.');
      run('Edit drum hits', [updateHits(t.id, changes)], last);
      return { changed: n };
    }
    const changes: Record<string, Partial<Note>> = {};
    for (const x of t.notes.filter(pickOk)) {
      const start = Math.max(0, x.start + shift);
      const duration = len != null ? Math.max(1, Math.round(len * PPQ)) : x.duration;
      const pitch = Math.max(0, Math.min(127, x.pitch + transpose));
      changes[x.id] = {
        start,
        duration,
        pitch,
        velocity: v(x.velocity),
        // a transposed note may not fit its pinned string any more: let the fingering engine choose
        ...(transpose || a.auto_strings === true ? { pinnedString: null } : {}),
        ...(a.techniques || a.clear_techniques
          ? { tech: mergeTech(x.tech, a.techniques, a.clear_techniques === true) }
          : {}),
      };
      last = Math.max(last, start + duration);
      n++;
    }
    if (!n) bad('No notes matched.');
    // strings / neck position, worked out on the notes as they will be (after transposing)
    let skipped = 0;
    const strNum = num(a.string),
      strShift = num(a.string_shift),
      nearFret = num(a.near_fret);
    if (strNum != null || strShift != null || nearFret != null) {
      if (!isFretted(t.type)) bad(`${t.name} has no strings.`);
      const nStr = t.tuning.strings.length;
      const after = {
        ...t,
        notes: t.notes.map((x) => (changes[x.id] ? ({ ...x, ...changes[x.id] } as Note) : x)),
      };
      const moved = after.notes.filter((x) => changes[x.id]);
      const r =
        strNum != null
          ? strNum >= 1 && strNum <= nStr
            ? notesToString(after, moved, nStr - Math.round(strNum))
            : bad(`string must be 1–${nStr}.`)
          : strShift != null
            ? shiftStrings(after, moved, strShift > 0 ? 1 : -1)
            : notesNearFret(after, moved, nearFret!);
      for (const [id, c] of Object.entries(r.changes)) changes[id] = { ...changes[id], ...c };
      skipped = r.skipped;
    }
    run('Edit notes', [updateNotes(t.id, changes)], last);
    return {
      changed: n,
      ...(skipped ? { not_moved: `${skipped} notes don’t fit there and kept their string` } : {}),
    };
  },

  delete_notes(a) {
    needSong();
    const t = trackOf(a.track);
    const ids = Array.isArray(a.ids) ? new Set(a.ids.map(String)) : null;
    if (!ids && a.from_bar == null && a.to_bar == null)
      bad('Give ids, or from_bar/to_bar (to clear a whole track, use from_bar: 1).');
    const [from, to] = range(a);
    const pickOk = (x: { id: string; start: number }) =>
      ids ? ids.has(x.id) : x.start >= from && x.start < to;
    if (t.type === 'drums') {
      const gone = t.hits.filter(pickOk).map((h) => h.id);
      if (!gone.length) bad('No drum hits matched.');
      run('Delete drum hits', [removeHits(t.id, gone)]);
      return { deleted: gone.length };
    }
    const gone = t.notes.filter(pickOk).map((x) => x.id);
    if (!gone.length) bad('No notes matched.');
    run('Delete notes', [removeNotes(t.id, gone)]);
    return { deleted: gone.length };
  },

  set_song(a) {
    needSong();
    const cmds: Command[] = [];
    const patch: Partial<Song> = {};
    if (typeof a.title === 'string') patch.title = a.title.slice(0, 200);
    if (typeof a.artist === 'string') patch.artist = a.artist.slice(0, 200);
    const bpm = num(a.tempo);
    if (bpm != null) {
      if (bpm < 20 || bpm > 400) bad('Tempo must be 20–400 bpm.');
      // the whole song (set_tempo changes part of it)
      patch.tempos = [{ tick: 0, bpm }];
    }
    if (typeof a.key === 'string') patch.keySig = parseKey(a.key);
    if (typeof a.scale === 'string') {
      const sc = a.scale.toLowerCase().trim();
      if (!SCALES[sc]) bad(`Unknown scale. Scales: ${Object.keys(SCALES).join(', ')}`);
      patch.scale = sc;
    }
    if (Object.keys(patch).length) cmds.push(updateSong(patch));
    if (typeof a.time_signature === 'string') {
      const m = /^(\d{1,2})\s*\/\s*(1|2|4|8|16|32)$/.exec(a.time_signature.trim());
      if (!m || Number(m[1]) < 1) bad('Time signature like "4/4", "6/8" or "7/8".');
      cmds.push(setTimeSigs([{ bar: 0, num: Number(m![1]), den: Number(m![2]) }]));
    }
    const bars = num(a.bars);
    if (bars != null) {
      if (bars < 1 || bars > 2000) bad('bars must be 1–2000.');
      cmds.push(setBars(Math.round(bars)));
    }
    if (!cmds.length) bad('Nothing to change.');
    run('Song settings', cmds);
    return tools.get_song({});
  },

  set_tempo(a) {
    needSong();
    const song = st().song;
    const bm = barMap(song);
    const from = Math.round(num(a.from_bar) ?? 1);
    if (from < 1 || from > song.bars) bad(`from_bar must be 1–${song.bars}.`);
    const at = bm.barStart(from - 1);
    let tempos: TempoPoint[] = [...song.tempos].sort((x, y) => x.tick - y.tick);
    if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0]?.bpm ?? 120 });
    const summary = () => ({
      tempo: st().song.tempos.map((t) => ({
        ...where(t.tick),
        bpm: t.bpm,
        ...(t.ramp ? { ramp: true } : {}),
      })),
    });
    if (a.remove === true) {
      if (at === 0) bad('The tempo at bar 1 can’t be removed; set it instead.');
      if (!tempos.some((t) => t.tick === at)) bad(`There’s no tempo change at bar ${from}.`);
      run('Remove tempo change', [setTempos(tempos.filter((t) => t.tick !== at))]);
      return summary();
    }
    const bpm = num(a.bpm) ?? bad('Give bpm.');
    if (bpm < 20 || bpm > 400) bad('Tempo must be 20–400 bpm.');
    const toBar = num(a.to_bar);
    if (toBar != null && toBar < from) bad('to_bar comes before from_bar.');
    // the change covers from_bar … to_bar, then the tempo goes back to what was playing there
    const end = toBar != null && toBar < song.bars ? bm.barStart(Math.round(toBar)) : null;
    const back =
      end != null ? (tempos.find((t) => t.tick === end) ?? { tick: end, bpm: bpmAt(tempos, end) }) : null;
    tempos = tempos.filter((t) => t.tick < at || (end != null && t.tick > end));
    tempos.push({ tick: at, bpm });
    if (back && back.bpm !== bpm) tempos.push({ ...back, ramp: back.ramp });
    tempos.sort((x, y) => x.tick - y.tick);
    if (a.ramp === true) {
      const prev = [...tempos].reverse().find((t) => t.tick < at);
      if (!prev) bad('A ramp needs a tempo before from_bar to glide from.');
      tempos = tempos.map((t) => (t === prev ? { ...t, ramp: true } : t));
    }
    run('Tempo', [setTempos(tempos)]);
    return summary();
  },

  set_time_signature(a) {
    needSong();
    const song = st().song;
    const from = Math.round(num(a.from_bar) ?? 1);
    if (from < 1 || from > song.bars) bad(`from_bar must be 1–${song.bars}.`);
    const f = from - 1;
    let sigs: TimeSig[] = [...song.timeSigs].sort((x, y) => x.bar - y.bar);
    if (!sigs.length || sigs[0].bar > 0) sigs.unshift({ bar: 0, num: 4, den: 4 });
    const sigAt = (bar: number) => [...sigs].reverse().find((x) => x.bar <= bar)!;
    const summary = () => ({
      time_signatures: st().song.timeSigs.map((t) => ({ bar: t.bar + 1, sig: `${t.num}/${t.den}` })),
      bars: st().song.bars,
    });
    if (a.remove === true) {
      if (f === 0) bad('The time signature at bar 1 can’t be removed; set it instead.');
      if (!sigs.some((x) => x.bar === f)) bad(`There’s no time signature change at bar ${from}.`);
      run('Remove time signature', [setTimeSigs(sigs.filter((x) => x.bar !== f))]);
      return summary();
    }
    const m = /^(\d{1,2})\s*\/\s*(1|2|4|8|16|32)$/.exec(String(a.signature ?? '').trim());
    if (!m || Number(m[1]) < 1) return bad('signature like "4/4", "6/8" or "7/8".');
    const sig = { num: Number(m[1]), den: Number(m[2]) };
    const toBar = num(a.to_bar);
    if (toBar != null && toBar < from) bad('to_bar comes before from_bar.');
    const to = toBar != null && toBar < song.bars ? Math.round(toBar) : null; // 0-based bar after the range
    const back = to != null ? (sigs.find((x) => x.bar === to) ?? { ...sigAt(to), bar: to }) : null;
    sigs = sigs.filter((x) => x.bar < f || (to != null && x.bar > to));
    sigs.push({ bar: f, ...sig });
    if (back) sigs.push(back);
    // drop changes that don't change anything
    sigs = sigs
      .sort((x, y) => x.bar - y.bar)
      .filter((x, i, all) => i === 0 || x.num !== all[i - 1].num || x.den !== all[i - 1].den);
    run('Time signature', [setTimeSigs(sigs)]);
    return summary();
  },

  set_sections(a) {
    needSong();
    const list = Array.isArray(a.sections) ? (a.sections as Args[]) : bad('sections must be a list.');
    const bm = barMap(st().song);
    const sections = list.map((x) => ({
      id: newId('sec'),
      name: String(x.name ?? 'Section').slice(0, 60),
      tick: bm.barStart(Math.max(0, (num(x.bar) ?? 1) - 1)),
    }));
    run('Sections', [updateSong({ sections: sections.sort((x, y) => x.tick - y.tick) })]);
    return { sections: sections.length };
  },

  add_track(a) {
    needSong();
    const type = String(a.type) as TrackType;
    if (!['guitar', 'bass', 'drums', 'other'].includes(type))
      bad('type must be guitar, bass, drums or other.');
    const song = st().song;
    const name =
      typeof a.name === 'string' && a.name.trim()
        ? a.name.trim().slice(0, 60)
        : { guitar: 'Guitar', bass: 'Bass', drums: 'Drums', other: 'Keys' }[type];
    let t = makeTrack(type, name, TRACK_COLORS[song.tracks.length % TRACK_COLORS.length]);
    if (typeof a.tuning === 'string' && isFretted(type)) {
      const tu = tuningByName(a.tuning) ?? bad(`Unknown tuning "${a.tuning}".`);
      t = { ...t, tuning: tu };
    }
    run('Add track', [addTrack(t)]);
    st().set({ trackId: t.id });
    return { id: t.id, number: st().song.tracks.length, name: t.name, type };
  },

  update_track(a) {
    needSong();
    const t = trackOf(a.track);
    if (a.delete === true) {
      if (st().song.tracks.length === 1) bad('A song needs at least one track.');
      run('Delete track', [removeTrack(t.id)]);
      if (st().trackId === t.id) st().set({ trackId: st().song.tracks[0].id });
      return { deleted: t.name };
    }
    const cmds: Command[] = [];
    const patch: Partial<Track> = {};
    if (typeof a.name === 'string' && a.name.trim()) patch.name = a.name.trim().slice(0, 60);
    if (typeof a.mute === 'boolean') patch.mute = a.mute;
    if (typeof a.solo === 'boolean') patch.solo = a.solo;
    if (num(a.volume) != null) patch.volume = Math.max(0, Math.min(1.5, num(a.volume)!));
    if (num(a.pan) != null) patch.pan = Math.max(-1, Math.min(1, num(a.pan)!));
    if (num(a.capo) != null) patch.capo = Math.max(0, Math.min(12, Math.round(num(a.capo)!)));
    if (Object.keys(patch).length) cmds.push(updateTrack(t.id, patch));
    if (typeof a.tuning === 'string') {
      if (!isFretted(t.type)) bad(`${t.name} has no tuning.`);
      cmds.push(setTuning(t.id, tuningByName(a.tuning) ?? bad(`Unknown tuning "${a.tuning}".`)));
    }
    if (!cmds.length) bad('Nothing to change.');
    run('Track settings', cmds);
    return { track: trackOf(t.id).name, ...patch, ...(a.tuning ? { tuning: a.tuning } : {}) };
  },

  show(a) {
    needSong();
    const s = st();
    if (a.track != null) s.set({ trackId: trackOf(a.track).id });
    const bar = num(a.bar);
    if (bar != null) {
      const tick = barMap(s.song).barStart(Math.max(0, bar - 1));
      s.set({ cursor: tick, scrollX: Math.max(0, tick * pxPerTick(s.zoom) - KEYS_W) });
    }
    if (Array.isArray(a.select)) s.select(a.select.map(String), (a.select[0] as string) ?? null);
    return { shown_track: currentTrack(st())?.name, selected: st().selection.size };
  },

  playback(a) {
    needSong();
    if (a.action === 'stop') {
      stop();
      return { playing: false };
    }
    const bar = num(a.from_bar);
    if (bar != null) seek(barMap(st().song).barStart(Math.max(0, bar - 1)));
    if (!st().playing) togglePlay();
    return {
      playing: true,
      note: 'Playback needs the user to have clicked in Riff Roll once since it opened.',
    };
  },

  undo(a) {
    needSong();
    const steps = Math.max(1, Math.min(50, Math.round(num(a.steps) ?? 1)));
    const h = st().history;
    for (let i = 0; i < steps; i++) (a.redo ? st().redo : st().undo)();
    return { [a.redo ? 'redone' : 'undone']: steps, can_undo: h.canUndo, can_redo: h.canRedo };
  },

  async list_songs() {
    const list = await (await getStorage()).list();
    return list
      .sort((x, y) => (y.updatedAt ?? '').localeCompare(x.updatedAt ?? ''))
      .map((p) => ({
        id: p.id,
        title: p.name || 'Untitled',
        edited: p.updatedAt,
        ...(p.access && p.access !== 'owner' ? { access: p.access, owner: p.owner?.displayName } : {}),
      }));
  },

  async open_song(a) {
    if (typeof a.id !== 'string') bad('Give the song id from list_songs.');
    await flushSaves();
    await openProject(a.id as string);
    return tools.get_song({});
  },

  async new_song(a) {
    await flushSaves();
    newProject();
    if (typeof a.title === 'string' && a.title.trim())
      st().exec(updateSong({ title: a.title.trim().slice(0, 200) }, 'Title'));
    return tools.get_song({});
  },
};

export const TOOL_NAMES = Object.keys(tools);

/** Run one tool call; errors come back as an error result the model can read, never as a throw. */
export async function runTool(name: string, args: Args = {}): Promise<ToolResult> {
  const fn = tools[name];
  if (!fn) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
  try {
    const out = await fn(args ?? {});
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    st().set({ status: `Claude: ${name.replace(/_/g, ' ')}` });
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return { content: [{ type: 'text', text: (e as Error).message || String(e) }], isError: true };
  }
}
