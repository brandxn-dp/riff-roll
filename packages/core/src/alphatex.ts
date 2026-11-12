/**
 * Song → AlphaTex (alphaTab's text format) for the notation view and printing. alphaTab renders; our model stays
 * the source of truth. Tab positions come from the fingering engine, rhythms from rhythm.ts.
 */
import { type Position } from './fingering';
import { trackFingering } from './derived';
import { DRUM_LANES, laneById } from './drums';
import { pedalSegments } from './pedal';
import { rhythmize, type RBar, type RBeat } from './rhythm';
import { pitchName, type Note, type Song, type Track } from './model';
import { BarMap } from './timesig';

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const texPitch = (p: number) => pitchName(p);

export interface TexBeatRef {
  trackIndex: number;
  bar: number;
  beat: number;
  start: number;
  noteIds: string[];
}

export interface TexResult {
  tex: string;
  /** beat lookup so clicks in the rendered score map back to our notes */
  beats: TexBeatRef[];
}

function durTex(b: RBeat): string {
  const s = `.${b.value}`;
  const fx: string[] = [];
  if (b.dots === 1) fx.push('d');
  if (b.dots === 2) fx.push('dd');
  if (b.tuplet) fx.push(`tu ${b.tuplet}`);
  return fx.length ? `${s} {${fx.join(' ')}}` : s;
}

function bendTex(curve: { pos: number; value: number }[]): string {
  // alphaTex bends: equidistant points in quarter tones
  return curve.map((p) => Math.round(p.value * 2)).join(' ');
}

const GM_PROGRAM: Record<Track['type'], number> = { guitar: 27, bass: 33, drums: 0 };

/** Notes that start a hammer-on/pull-off (alphaTex marks the origin note; our model marks the destination). */
function hammerOrigins(track: Track, fing: Map<string, Position | null>): Set<string> {
  const origins = new Set<string>();
  const lastOnString = new Map<number, Note>();
  for (const n of track.notes) {
    const p = fing.get(n.id);
    if (!p) continue;
    const prev = lastOnString.get(p.string);
    if (n.tech?.hammer && prev) origins.add(prev.id);
    if ((n.tech?.slide === 'legato' || n.tech?.slide === 'shift') && prev) origins.add('slide:' + prev.id + ':' + n.tech.slide);
    lastOnString.set(p.string, n);
  }
  return origins;
}

function noteEffects(n: Note, origins: Set<string>, tied: boolean): string[] {
  if (tied) return [];
  const t = n.tech ?? {};
  const fx: string[] = [];
  if (origins.has(n.id)) fx.push('h');
  if (origins.has(`slide:${n.id}:legato`)) fx.push('sl');
  if (origins.has(`slide:${n.id}:shift`)) fx.push('ss');
  if (t.slide === 'in-below') fx.push('sib');
  if (t.slide === 'in-above') fx.push('sia');
  if (t.slide === 'out-down') fx.push('sod');
  if (t.slide === 'out-up') fx.push('sou');
  if (t.bend?.length) fx.push(`b (${bendTex(t.bend)})`);
  if (t.vibrato) fx.push(t.vibrato === 'wide' ? 'vw' : 'v');
  if (t.palmMute) fx.push('pm');
  if (t.letRing) fx.push('lr');
  if (t.dead) fx.push('x');
  if (t.harmonic === 'natural') fx.push('nh');
  if (t.harmonic === 'artificial') fx.push('ah');
  if (t.harmonic === 'pinch') fx.push('ph');
  if (t.harmonic === 'tapped') fx.push('th');
  if (t.ghost) fx.push('g');
  if (t.accent) fx.push(t.accent === 'heavy' ? 'hac' : 'ac');
  if (t.staccato) fx.push('st');
  if (t.trill) fx.push(`tr ${t.trill.fret} ${t.trill.speed}`);
  return fx;
}

function beatEffects(b: RBeat<Note>, stompText?: string): string[] {
  const fx: string[] = [];
  const first = b.notes.find((n) => !n.tied)?.event;
  const t = first?.tech;
  if (t?.tap) fx.push('tt');
  if (t?.tremolo) fx.push(`tp ${t.tremolo}`);
  if (t?.fadeIn) fx.push('f');
  if (t?.pick === 'up') fx.push('spu');
  if (t?.pick === 'down') fx.push('spd');
  if (t?.whammy?.length) fx.push(`tb (${bendTex(t.whammy)})`);
  if (stompText) fx.push(`txt ${q(stompText)}`);
  return fx;
}

function withEffects(dur: string, extra: string[]): string {
  if (!extra.length) return dur;
  const m = /^(\.\d+)(?: \{(.*)\})?$/.exec(dur)!;
  const all = [...(m[2] ? [m[2]] : []), ...extra];
  return `${m[1]} {${all.join(' ')}}`;
}

export function songToAlphaTex(song: Song, trackIds?: string[]): TexResult {
  const lines: string[] = [];
  const beats: TexBeatRef[] = [];
  const bm = new BarMap(song.timeSigs, song.ppq);
  lines.push(`\\title ${q(song.title || 'Untitled')}`);
  if (song.artist) lines.push(`\\artist ${q(song.artist)}`);
  lines.push(`\\tempo ${Math.round(song.tempos[0]?.bpm ?? 120)}`);
  lines.push('.');
  const tracks = song.tracks.filter((t) => !trackIds || trackIds.includes(t.id));

  tracks.forEach((track, ti) => {
    lines.push(`\\track ${q(track.name)}`);
    if (track.type === 'drums') {
      lines.push('\\staff {score}');
      lines.push('\\instrument percussion');
      lines.push('\\articulation defaults');
    } else {
      lines.push('\\staff {score tabs}');
      lines.push(`\\tuning ${[...track.tuning.strings].reverse().map(texPitch).join(' ')}`);
      if (track.capo) lines.push(`\\capo ${track.capo}`);
      lines.push(`\\instrument ${GM_PROGRAM[track.type]}`);
    }
    const fing = track.type === 'drums' ? new Map() : trackFingering(track);
    const nStr = track.tuning.strings.length;
    // stomp markers: text on the first beat at or after each stomp
    const stomps = track.type === 'drums' ? [] : pedalSegments(track.pedal, bm.barStart(song.bars)).filter((s) => s.stompId);
    const toneName = (id: string) => track.tones.find((t) => t.id === id)?.name ?? '';
    let si = 0;

    let bars: RBar<Note>[];
    if (track.type === 'drums') {
      // drum hits have no length: each lasts until the next hit (max a quarter) so rhythms read naturally
      const starts = [...new Set(track.hits.map((h) => h.start))].sort((a, b) => a - b);
      const events = track.hits.map((h) => {
        const next = starts.find((s) => s > h.start) ?? h.start + song.ppq;
        return { id: h.id, start: h.start, duration: Math.min(song.ppq, next - h.start), velocity: h.velocity, pitch: laneById.get(`${h.piece}:${h.articulation}`)?.gm ?? 38, hit: h } as unknown as Note;
      });
      bars = rhythmize(events, song);
    } else {
      bars = rhythmize(track.notes.filter((n) => fing.get(n.id)), song);
    }
    const origins = track.type === 'drums' ? new Set<string>() : hammerOrigins(track, fing);
    let prevSig = '';
    const barTex: string[] = [];
    for (const bar of bars) {
      const meta: string[] = [];
      const sig = `${bar.num} ${bar.den}`;
      if (sig !== prevSig) meta.push(`\\ts ${sig}`);
      prevSig = sig;
      if (ti === 0) {
        for (const sec of song.sections) if (sec.tick >= bar.start && sec.tick < bar.start + bar.length) meta.push(`\\section ${q(sec.name)}`);
        for (const tp of song.tempos) if (tp.tick > 0 && tp.tick >= bar.start && tp.tick < bar.start + bar.length) meta.push(`\\tempo ${Math.round(tp.bpm)}`);
      }
      for (const r of song.repeats) {
        if (r.startBar === bar.index) meta.push('\\ro');
        if (r.endBar === bar.index) meta.push(`\\rc ${r.times}`);
        const end = r.endings?.find((e) => e.bar === bar.index);
        if (end) meta.push(`\\ae (${end.passes.join(' ')})`);
      }
      const parts: string[] = [];
      bar.beats.forEach((b, bi) => {
        let stomp: string | undefined;
        while (si < stomps.length && stomps[si].start <= b.start + b.duration - 1 && !b.rest) {
          stomp = toneName(stomps[si].toneId);
          si++;
        }
        const dur = durTex(b);
        if (b.rest) {
          parts.push(`r${dur}`);
          return;
        }
        let notesTex: string[];
        if (track.type === 'drums') {
          // tied drum continuations aren't meaningful: show them as rests
          if (b.notes.every((n) => n.tied)) {
            parts.push(`r${dur}`);
            return;
          }
          notesTex = [
            ...new Set(
              b.notes
                .filter((n) => !n.tied)
                .map(({ event }) => {
                  const hit = (event as unknown as { hit: { piece: string; articulation: string } }).hit;
                  return String((laneById.get(`${hit.piece}:${hit.articulation}`) ?? DRUM_LANES[0]).gm);
                }),
            ),
          ];
        } else {
          notesTex = b.notes.map(({ event, tied }) => {
            const p = fing.get(event.id)!;
            const s = nStr - p.string;
            const fx = noteEffects(event, origins, tied);
            const fret = tied ? '-' : event.tech?.dead ? 'x' : String(p.fret);
            return `${fret}.${s}${fx.length ? `{${fx.join(' ')}}` : ''}`;
          });
        }
        const head = notesTex.length === 1 ? notesTex[0] : `(${notesTex.join(' ')})`;
        if (track.type === 'drums') {
          // percussion: a bare number is an articulation, so the duration goes in front (":8 (36 42)")
          const m = /^\.(\d+)(?: \{(.*)\})?$/.exec(dur)!;
          parts.push(`:${m[1]} ${head}${m[2] ? ` {${m[2]}}` : ''}`);
        } else parts.push(head + withEffects(dur, beatEffects(b, stomp)));
        beats.push({ trackIndex: ti, bar: bar.index, beat: bi, start: b.start, noteIds: b.notes.map((n) => n.event.id) });
      });
      barTex.push([...meta, parts.join(' ')].join(' '));
    }
    lines.push(barTex.join(' |\n'));
  });
  return { tex: lines.join('\n'), beats };
}
