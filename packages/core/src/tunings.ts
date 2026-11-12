import { parsePitch, pitchClassName, type TrackType, type Tuning } from './model';

const t = (name: string, notes: string): Tuning => ({ name, strings: notes.split(' ').map(parsePitch) });

export const GUITAR_TUNINGS: Tuning[] = [
  t('Standard E', 'E2 A2 D3 G3 B3 E4'),
  t('Drop D', 'D2 A2 D3 G3 B3 E4'),
  t('D Standard', 'D2 G2 C3 F3 A3 D4'),
  t('Drop C', 'C2 G2 C3 F3 A3 D4'),
  t('C Standard', 'C2 F2 A#2 D#3 G3 C4'),
  t('Drop B', 'B1 F#2 B2 E3 G#3 C#4'),
  t('B Standard', 'B1 E2 A2 D3 F#3 B3'),
  t('7-string Standard B', 'B1 E2 A2 D3 G3 B3 E4'),
  t('7-string Drop A', 'A1 E2 A2 D3 G3 B3 E4'),
  t('8-string Standard F#', 'F#1 B1 E2 A2 D3 G3 B3 E4'),
];

export const BASS_TUNINGS: Tuning[] = [
  t('Bass Standard E', 'E1 A1 D2 G2'),
  t('Bass Drop D', 'D1 A1 D2 G2'),
  t('5-string Bass Standard B', 'B0 E1 A1 D2 G2'),
];

export const ALL_TUNINGS = [...GUITAR_TUNINGS, ...BASS_TUNINGS];

export function tuningByName(name: string): Tuning | undefined {
  const f = ALL_TUNINGS.find((x) => x.name === name);
  return f && { name: f.name, strings: [...f.strings] };
}

export function tuningsFor(type: TrackType): Tuning[] {
  return type === 'bass' ? BASS_TUNINGS : type === 'guitar' ? GUITAR_TUNINGS : [];
}

/**
 * String colours. The six roles of a standard guitar (low E .. high e) are red, orange, yellow, green, blue, violet
 * (the prototype's colours). Extra low strings on 7/8-string guitars get pink and bronze. Basses use the same roles
 * as the guitar strings they double (E A D G = red orange yellow green, low B = pink, high C = blue), so a bass
 * line and a guitar riff read the same way.
 */
export const ROLE_COLORS: Record<number, string> = {
  [-2]: '#c8935a',
  [-1]: '#ff6fb5',
  0: '#ff5a5a',
  1: '#ff9a3c',
  2: '#f3cf48',
  3: '#5fd17c',
  4: '#47bfee',
  5: '#b38bff',
};

export function stringRole(type: TrackType, stringCount: number, index: number): number {
  if (type === 'bass') return stringCount >= 5 ? index - 1 : index;
  return index - (stringCount - 6);
}

export function stringColor(type: TrackType, stringCount: number, index: number): string {
  const role = Math.max(-2, Math.min(5, stringRole(type, stringCount, index)));
  return ROLE_COLORS[role];
}

/** Label for a string, lowest string first. The highest guitar string is lower-case like in tab ("e"). */
export function stringLabel(tuning: Tuning, index: number, type: TrackType = 'guitar'): string {
  const n = pitchClassName(tuning.strings[index]);
  return type === 'guitar' && index === tuning.strings.length - 1 ? n.toLowerCase() : n;
}
