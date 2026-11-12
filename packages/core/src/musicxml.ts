/**
 * MusicXML 4.0 (partwise) export. Guitar/bass parts are written as a notation staff + TAB staff with string/fret
 * technical marks; drums as an unpitched percussion part. Stomps become words directions ("Dist").
 */
import { trackFingering } from './derived';
import { laneById } from './drums';
import { pedalSegments } from './pedal';
import { rhythmize, type RBeat } from './rhythm';
import { BarMap } from './timesig';
import { isFretted, type Note, type Song, type Track } from './model';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STEPS: [string, number][] = [
  ['C', 0],
  ['C', 1],
  ['D', 0],
  ['D', 1],
  ['E', 0],
  ['F', 0],
  ['F', 1],
  ['G', 0],
  ['G', 1],
  ['A', 0],
  ['A', 1],
  ['B', 0],
];
const TYPE: Record<number, string> = {
  1: 'whole',
  2: 'half',
  4: 'quarter',
  8: 'eighth',
  16: '16th',
  32: '32nd',
  64: '64th',
};

function pitchXml(p: number) {
  const [step, alter] = STEPS[((p % 12) + 12) % 12];
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${Math.floor(p / 12) - 1}</octave></pitch>`;
}

function beatTiming(b: RBeat) {
  let x = `<type>${TYPE[b.value]}</type>`;
  for (let i = 0; i < b.dots; i++) x += '<dot/>';
  if (b.tuplet)
    x +=
      '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
  return x;
}

function partXml(song: Song, track: Track, pid: string): string {
  const bm = new BarMap(song.timeSigs, song.ppq);
  const fing = isFretted(track.type) ? trackFingering(track) : null;
  // drums and other (piano, synth…) tracks get one staff; guitar and bass get notation + tab
  const single = !isFretted(track.type);
  const n = track.tuning.strings.length;
  const events: (Note & { gm?: number })[] =
    track.type === 'drums'
      ? (() => {
          const starts = [...new Set(track.hits.map((h) => h.start))].sort((a, b) => a - b);
          return track.hits.map((h) => {
            const next = starts.find((s) => s > h.start) ?? h.start + song.ppq;
            return {
              id: h.id,
              pitch: 60,
              start: h.start,
              duration: Math.min(song.ppq, next - h.start),
              velocity: h.velocity,
              gm: laneById.get(`${h.piece}:${h.articulation}`)?.gm ?? 38,
            };
          });
        })()
      : track.type === 'other'
        ? track.notes
        : track.notes.filter((x) => fing!.get(x.id));
  const bars = rhythmize(events, song);
  const stomps = single ? [] : pedalSegments(track.pedal, bm.barStart(song.bars)).filter((s) => s.stompId);
  const toneName = (id: string) => track.tones.find((t) => t.id === id)?.name ?? '';
  const out: string[] = [`<part id="${pid}">`];
  let prevSig = '';
  for (const bar of bars) {
    out.push(`<measure number="${bar.index + 1}">`);
    const sig = `${bar.num}/${bar.den}`;
    if (bar.index === 0 || sig !== prevSig) {
      out.push('<attributes>');
      if (bar.index === 0) {
        out.push(`<divisions>${song.ppq}</divisions>`);
        out.push(
          `<key><fifths>${song.keySig.fifths}</fifths><mode>${song.keySig.minor ? 'minor' : 'major'}</mode></key>`,
        );
      }
      out.push(`<time><beats>${bar.num}</beats><beat-type>${bar.den}</beat-type></time>`);
      if (bar.index === 0) {
        if (track.type === 'drums') out.push('<clef><sign>percussion</sign></clef>');
        else if (track.type === 'other') {
          const ps = track.notes.map((x) => x.pitch).sort((a, b) => a - b);
          out.push(
            ps.length && ps[ps.length >> 1] < 57
              ? '<clef><sign>F</sign><line>4</line></clef>'
              : '<clef><sign>G</sign><line>2</line></clef>',
          );
        } else {
          out.push('<staves>2</staves>');
          out.push(
            `<clef number="1"><sign>G</sign><line>2</line>${track.type === 'bass' ? '<clef-octave-change>-2</clef-octave-change>' : '<clef-octave-change>-1</clef-octave-change>'}</clef>`,
          );
          out.push('<clef number="2"><sign>TAB</sign><line>5</line></clef>');
          out.push(`<staff-details number="2"><staff-lines>${n}</staff-lines>`);
          for (let i = 0; i < n; i++) {
            const p = track.tuning.strings[i];
            const [step, alter] = STEPS[p % 12];
            out.push(
              `<staff-tuning line="${i + 1}"><tuning-step>${step}</tuning-step>${alter ? `<tuning-alter>${alter}</tuning-alter>` : ''}<tuning-octave>${Math.floor(p / 12) - 1}</tuning-octave></staff-tuning>`,
            );
          }
          if (track.capo) out.push(`<capo>${track.capo}</capo>`);
          out.push('</staff-details>');
        }
      }
      out.push('</attributes>');
    }
    prevSig = sig;
    // tempo + sections from the first part only
    if (pid === 'P1') {
      for (const s of song.sections)
        if (s.tick >= bar.start && s.tick < bar.start + bar.length)
          out.push(
            `<direction placement="above"><direction-type><rehearsal>${esc(s.name)}</rehearsal></direction-type></direction>`,
          );
      for (const t of song.tempos)
        if (t.tick >= bar.start && t.tick < bar.start + bar.length)
          out.push(
            `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(t.bpm)}</per-minute></metronome></direction-type><sound tempo="${t.bpm}"/></direction>`,
          );
    }
    for (const r of song.repeats) {
      if (r.startBar === bar.index)
        out.push(
          '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>',
        );
    }
    for (const s of stomps)
      if (s.start >= bar.start && s.start < bar.start + bar.length)
        out.push(
          `<direction placement="above"><direction-type><words>${esc(toneName(s.toneId))}</words></direction-type><offset>${s.start - bar.start}</offset></direction>`,
        );

    const staves = single ? [1] : [1, 2];
    staves.forEach((staff, si) => {
      if (si > 0) out.push(`<backup><duration>${bar.length}</duration></backup>`);
      for (const b of bar.beats) {
        if (b.rest || !b.notes.length) {
          out.push(
            `<note><rest/><duration>${Math.round(b.duration)}</duration><voice>${staff}</voice>${beatTiming(b)}${single ? '' : `<staff>${staff}</staff>`}</note>`,
          );
          continue;
        }
        b.notes.forEach(({ event, tied }, k) => {
          const parts: string[] = ['<note>'];
          if (k > 0) parts.push('<chord/>');
          if (track.type === 'drums') {
            parts.push(
              `<unpitched><display-step>${['F', 'C', 'G', 'E', 'A'][((event as { gm?: number }).gm ?? 38) % 5]}</display-step><display-octave>${(event as { gm?: number }).gm! >= 42 ? 5 : 4}</display-octave></unpitched>`,
            );
          } else parts.push(pitchXml(event.pitch));
          parts.push(`<duration>${Math.round(b.duration)}</duration>`);
          const tieStop = tied;
          const tieStart = b.start + b.duration < event.start + event.duration - 1;
          if (tieStop) parts.push('<tie type="stop"/>');
          if (tieStart) parts.push('<tie type="start"/>');
          parts.push(`<voice>${staff}</voice>`);
          parts.push(beatTiming(b));
          if (track.type === 'drums')
            parts.push(
              '<notehead>' + (((event as { gm?: number }).gm ?? 0) >= 42 ? 'x' : 'normal') + '</notehead>',
            );
          else if (!single) parts.push(`<staff>${staff}</staff>`);
          const nots: string[] = [];
          if (tieStop) nots.push('<tied type="stop"/>');
          if (tieStart) nots.push('<tied type="start"/>');
          if (track.type !== 'drums' && staff === 2) {
            const p = fing!.get(event.id)!;
            const tech: string[] = [`<string>${n - p.string}</string>`, `<fret>${p.fret}</fret>`];
            const t = event.tech ?? {};
            if (!tied) {
              if (t.hammer) tech.push('<hammer-on type="stop">H</hammer-on>');
              if (t.bend?.length)
                tech.push(`<bend><bend-alter>${Math.max(...t.bend.map((x) => x.value))}</bend-alter></bend>`);
              if (t.harmonic) tech.push('<harmonic/>');
              if (t.tap) tech.push('<tap/>');
              if (t.dead) tech.push('<stopped/>');
              if (t.pick) tech.push(t.pick === 'down' ? '<down-bow/>' : '<up-bow/>');
            }
            nots.push(`<technical>${tech.join('')}</technical>`);
            const art: string[] = [];
            if (!tied && t.accent) art.push(t.accent === 'heavy' ? '<strong-accent/>' : '<accent/>');
            if (!tied && t.staccato) art.push('<staccato/>');
            if (art.length) nots.push(`<articulations>${art.join('')}</articulations>`);
            if (!tied && t.vibrato) nots.push('<ornaments><wavy-line type="start"/></ornaments>');
          }
          if (nots.length) parts.push(`<notations>${nots.join('')}</notations>`);
          parts.push('</note>');
          out.push(parts.join(''));
        });
      }
    });
    for (const r of song.repeats)
      if (r.endBar === bar.index)
        out.push(
          `<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward" times="${r.times}"/></barline>`,
        );
    out.push('</measure>');
  }
  out.push('</part>');
  return out.join('\n');
}

export function songToMusicXml(song: Song): string {
  const parts = song.tracks.map((t, i) => ({ t, id: `P${i + 1}` }));
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${esc(song.title)}</work-title></work>`,
    `<identification>${song.artist ? `<creator type="composer">${esc(song.artist)}</creator>` : ''}<encoding><software>Riff Roll</software></encoding></identification>`,
    '<part-list>',
    ...parts.map(({ t, id }) => `<score-part id="${id}"><part-name>${esc(t.name)}</part-name></score-part>`),
    '</part-list>',
    ...parts.map(({ t, id }) => partXml(song, t, id)),
    '</score-partwise>',
  ].join('\n');
}
