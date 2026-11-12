/**
 * Guitar Pro 3/4/5/GPX/GP7/GP8 and MusicXML import via alphaTab's loaders, mapped onto our song model:
 * tracks, tunings, capo, notes (pinned to the file's strings), techniques, tempo, time signatures, sections,
 * repeats and alternate endings. GP instrument automations (clean ↔ overdrive/distortion programs) become tones
 * and pedal stomps.
 */
import * as alphaTab from '@coderline/alphatab';
import {
  BASS_PRESETS,
  DRUM_LANES,
  GUITAR_PRESETS,
  PPQ,
  TRACK_COLORS,
  laneForGm,
  makeTone,
  makeTrack,
  newId,
  newSong,
  pitchName,
  tuningByName,
  type CurvePoint,
  type DrumHit,
  type Note,
  type Song,
  type Stomp,
  type Techniques,
  type Track,
} from '@riffroll/core';

type ATScore = alphaTab.model.Score;
type ATTrack = alphaTab.model.Track;
type ATNote = alphaTab.model.Note;
type ATBeat = alphaTab.model.Beat;

const DIST_PROGRAMS = new Set([29, 30, 31, 34]);

const curve = (pts: { offset: number; value: number }[] | null | undefined): CurvePoint[] | undefined =>
  pts?.length ? pts.map((p) => ({ pos: p.offset / 60, value: p.value / 2 })) : undefined;

function techniques(n: ATNote, b: ATBeat): Techniques | undefined {
  const t: Techniques = {};
  const at = alphaTab.model;
  if (n.isHammerPullDestination) t.hammer = true;
  if (n.slideInType === at.SlideInType.IntoFromBelow) t.slide = 'in-below';
  else if (n.slideInType === at.SlideInType.IntoFromAbove) t.slide = 'in-above';
  if (n.slideOutType === at.SlideOutType.OutDown) t.slide = 'out-down';
  else if (n.slideOutType === at.SlideOutType.OutUp) t.slide = 'out-up';
  const bend = curve(n.bendPoints);
  if (bend && bend.some((p) => p.value !== 0)) t.bend = bend;
  const vib = n.vibrato || b.vibrato;
  if (vib) t.vibrato = vib === at.VibratoType.Wide ? 'wide' : 'normal';
  if (n.isPalmMute) t.palmMute = true;
  if (n.isLetRing) t.letRing = true;
  if (n.isDead) t.dead = true;
  const h = n.harmonicType;
  if (h === at.HarmonicType.Natural) t.harmonic = 'natural';
  else if (h === at.HarmonicType.Artificial || h === at.HarmonicType.Semi) t.harmonic = 'artificial';
  else if (h === at.HarmonicType.Pinch) t.harmonic = 'pinch';
  else if (h === at.HarmonicType.Tap) t.harmonic = 'tapped';
  if (b.tap) t.tap = true;
  if (b.isTremolo && b.tremoloSpeed)
    t.tremolo = (b.tremoloSpeed as number) >= 32 ? 32 : (b.tremoloSpeed as number) >= 16 ? 16 : 8;
  if (n.isGhost) t.ghost = true;
  if (n.accentuated === at.AccentuationType.Heavy) t.accent = 'heavy';
  else if (n.accentuated === at.AccentuationType.Normal) t.accent = 'normal';
  if (n.isStaccato) t.staccato = true;
  if (b.pickStroke === at.PickStroke.Down) t.pick = 'down';
  else if (b.pickStroke === at.PickStroke.Up) t.pick = 'up';
  const wh = curve(b.whammyBarPoints);
  if (wh && wh.some((p) => p.value !== 0)) t.whammy = wh;
  if (b.fadeIn) t.fadeIn = true;
  if (n.trillValue >= 0 && n.isTrill)
    t.trill = { fret: n.trillFret ?? n.trillValue, speed: (n.trillSpeed as number) >= 32 ? 32 : 16 };
  return Object.keys(t).length ? t : undefined;
}

function convertTrack(score: ATScore, at: ATTrack, index: number, warnings: string[]): Track {
  const staff = at.staves[0];
  const color = TRACK_COLORS[index % TRACK_COLORS.length];
  if (staff.isPercussion) {
    const t = makeTrack('drums', at.name || 'Drums', color);
    const hits: DrumHit[] = [];
    for (const bar of staff.bars)
      for (const v of bar.voices)
        for (const b of v.beats)
          for (const n of b.notes) {
            const art = at.percussionArticulations[n.percussionArticulation];
            const gm = art?.outputMidiNumber ?? n.percussionArticulation;
            const lane =
              laneForGm(gm) ??
              DRUM_LANES.find((l) => l.gm === gm) ??
              DRUM_LANES.find((l) => l.id === 'snare:center')!;
            hits.push({
              id: newId('h'),
              start: b.absolutePlaybackStart,
              piece: lane.piece,
              articulation: lane.articulation,
              velocity: velocityOf(n),
            });
          }
    return { ...t, hits: hits.sort((a, b) => a.start - b.start) };
  }
  let strings = [...staff.tuning].reverse();
  let lowest = 127;
  for (const bar of staff.bars)
    for (const v of bar.voices)
      for (const b of v.beats) for (const n of b.notes) lowest = Math.min(lowest, n.realValue);
  const isBass =
    (strings.length ? strings[0] < 36 : lowest < 40) ||
    (at.playbackInfo.program >= 32 && at.playbackInfo.program <= 39) ||
    /bass/i.test(at.name);
  const t = makeTrack(isBass ? 'bass' : 'guitar', at.name || (isBass ? 'Bass' : 'Guitar'), color);
  if (strings.length) t.tuning = { name: staff.tuningName || strings.map(pitchName).join(' '), strings };
  else {
    // notation-only files (e.g. some MusicXML) carry no tab tuning: pick a standard one that reaches every note
    const pick = isBass
      ? lowest < 28
        ? '5-string Bass Standard B'
        : 'Bass Standard E'
      : lowest < 35
        ? '8-string Standard F#'
        : lowest < 40
          ? '7-string Standard B'
          : 'Standard E';
    t.tuning = tuningByName(pick)!;
    strings = t.tuning.strings;
  }
  t.capo = staff.capo || 0;
  if (strings.length > 8) warnings.push(`${at.name}: ${strings.length} strings — only 8 are supported`);
  const notes: Note[] = [];
  const tieTargets = new Map<string, Note>();
  // pedal: instrument automations switching between clean and driven programs
  const program = at.playbackInfo.program;
  const tones = isBass
    ? [makeTone(BASS_PRESETS.clean), makeTone(BASS_PRESETS.driven)]
    : [makeTone(GUITAR_PRESETS.clean), makeTone(GUITAR_PRESETS.dist)];
  const stomps: Stomp[] = [];
  let driven = DIST_PROGRAMS.has(program);
  const startDriven = driven;
  for (const bar of staff.bars)
    for (const v of bar.voices)
      for (const b of v.beats) {
        for (const a of b.automations) {
          if (a.type !== alphaTab.model.AutomationType.Instrument) continue;
          const d = DIST_PROGRAMS.has(a.value);
          if (d !== driven) {
            driven = d;
            stomps.push({ id: newId('stomp'), tick: b.absolutePlaybackStart });
          }
        }
        for (const n of b.notes) {
          const s = n.string - 1; // alphaTab: 1 = lowest string
          const key = `${s}`;
          if (n.isTieDestination) {
            const prev = tieTargets.get(key);
            if (prev) {
              prev.duration = b.absolutePlaybackStart + b.playbackDuration - prev.start;
              continue;
            }
          }
          const note: Note = {
            id: newId('n'),
            pitch: n.realValueWithoutHarmonic,
            start: b.absolutePlaybackStart,
            duration: Math.max(1, b.playbackDuration),
            velocity: velocityOf(n),
            pinnedString: s >= 0 && s < strings.length ? s : null,
            tech: techniques(n, b),
          };
          notes.push(note);
          tieTargets.set(key, note);
        }
      }
  return {
    ...t,
    tones,
    pedal: {
      mode: 'simple',
      startTone: tones[startDriven ? 1 : 0].id,
      toggle: [tones[0].id, tones[1].id],
      stomps,
    },
    notes: notes.sort((a, b) => a.start - b.start),
  };
}

function velocityOf(n: ATNote): number {
  // alphaTab dynamics: ppp..fff (0..7)
  const dyn = (n.dynamics as number) ?? 5;
  return Math.max(20, Math.min(127, 40 + dyn * 12));
}

export function scoreToSong(score: ATScore): { song: Song; warnings: string[] } {
  const warnings: string[] = [];
  const song = newSong(score.title || 'Imported');
  song.artist = score.artist || '';
  song.tracks = score.tracks.map((t, i) => convertTrack(score, t, i, warnings));
  if (!song.tracks.length) throw new Error('The file contains no tracks.');
  song.bars = score.masterBars.length;
  song.tempos = [{ tick: 0, bpm: score.tempo || 120 }];
  song.timeSigs = [];
  song.sections = [];
  song.repeats = [];
  let prevSig = '';
  let openRepeat: number | null = null;
  for (const mb of score.masterBars) {
    const sig = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`;
    if (sig !== prevSig)
      song.timeSigs.push({ bar: mb.index, num: mb.timeSignatureNumerator, den: mb.timeSignatureDenominator });
    prevSig = sig;
    for (const a of mb.tempoAutomations) {
      const tick = mb.start + Math.round(a.ratioPosition * mb.calculateDuration());
      if (tick === 0) song.tempos[0] = { tick: 0, bpm: a.value };
      else song.tempos.push({ tick, bpm: a.value, ...(a.isLinear ? { ramp: true } : {}) });
    }
    if (mb.section)
      song.sections.push({
        id: newId('sec'),
        tick: mb.start,
        name: mb.section.text || mb.section.marker || 'Section',
      });
    if (mb.isRepeatStart) openRepeat = mb.index;
    if (mb.repeatCount > 0) {
      const start = openRepeat ?? 0;
      song.repeats.push({
        id: newId('rep'),
        startBar: start,
        endBar: mb.index,
        times: Math.max(2, mb.repeatCount),
      });
      openRepeat = null;
    }
  }
  // alternate endings: bit flags per master bar → attach to the repeat that contains (or precedes) the bar
  for (const mb of score.masterBars) {
    if (!mb.alternateEndings) continue;
    const passes: number[] = [];
    for (let i = 0; i < 8; i++) if (mb.alternateEndings & (1 << i)) passes.push(i + 1);
    const rep = [...song.repeats].reverse().find((r) => r.startBar <= mb.index);
    if (rep) (rep.endings ??= []).push({ bar: mb.index, passes });
  }
  if (!song.timeSigs.length) song.timeSigs = [{ bar: 0, num: 4, den: 4 }];
  song.ppq = PPQ;
  return { song, warnings };
}

/** Load GP/GPX/GP7/GP8/MusicXML bytes. */
export function importScoreBytes(bytes: Uint8Array): { song: Song; warnings: string[] } {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
  return scoreToSong(score);
}

/** Our song → alphaTab score (via AlphaTex) → Guitar Pro 7 bytes. */
export function exportGp7(tex: string): Uint8Array {
  const settings = new alphaTab.Settings();
  const imp = new alphaTab.importer.AlphaTexImporter();
  imp.initFromString(tex, settings);
  const score = imp.readScore();
  return new alphaTab.exporter.Gp7Exporter().export(score, settings);
}
