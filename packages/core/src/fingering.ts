/**
 * Fingering engine: assigns every guitar/bass note a string and fret.
 *
 * Pure and deterministic. Ported from the prototype's `assign()` and extended:
 *  - notes processed in time order, grouped into chords by start tick
 *  - candidates: every string where 0 <= pitch - open <= maxFret
 *  - cost: distance from the current hand position + small high-fret penalty; open strings are cheap but get
 *    slightly more expensive the higher the hand is
 *  - chords: distinct strings, penalty for a fret span over 4 and for skipped strings between chord notes
 *  - strings still ringing from earlier notes are avoided (big penalty, not forbidden)
 *  - hand position moves toward the frets just used (smoothed)
 *  - pinned notes keep their string; the engine works around them
 *  - exhaustive search per chord group (max 8 notes) with branch-and-bound pruning
 */

export interface FingerNote {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  pinnedString?: number | null;
}

export interface FingerOptions {
  /** Effective open-string pitches (tuning + capo), lowest string first. */
  strings: number[];
  /** Highest playable fret, counted from the capo. */
  maxFret?: number;
  /** Initial hand position (fret). */
  startHand?: number;
}

export interface Position {
  string: number;
  fret: number;
}

export type Fingering = Map<string, Position | null>;

export const DEFAULT_MAX_FRET = 24;
export const MAX_CHORD = 8;

// cost weights (kept together so they can be tuned and documented)
export const W = {
  highFret: 0.04,
  openBase: 0.3,
  openPerHandFret: 0.15,
  ringing: 6,
  spanFree: 4,
  spanPerFret: 4,
  skippedString: 4,
  unplayable: 100,
  handSmoothing: 0.5,
};

export function candidates(pitch: number, strings: number[], maxFret: number): Position[] {
  const out: Position[] = [];
  for (let s = 0; s < strings.length; s++) {
    const f = pitch - strings[s];
    if (f >= 0 && f <= maxFret) out.push({ string: s, fret: f });
  }
  return out;
}

export function assignFingering(notes: readonly FingerNote[], opts: FingerOptions): Fingering {
  const strings = opts.strings;
  const maxFret = opts.maxFret ?? DEFAULT_MAX_FRET;
  const res: Fingering = new Map();
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  let hand = opts.startHand ?? 2;
  // strings currently sounding: end tick per string
  const ringEnd = new Array<number>(strings.length).fill(-Infinity);

  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].start === sorted[i].start) j++;
    const at = sorted[i].start;
    let group = sorted.slice(i, j);
    if (group.length > MAX_CHORD) {
      for (const n of group.slice(MAX_CHORD)) res.set(n.id, null);
      group = group.slice(0, MAX_CHORD);
    }

    const h = hand;
    const cost = (c: Position) =>
      (c.fret === 0 ? W.openBase + W.openPerHandFret * h : Math.abs(c.fret - h) + W.highFret * c.fret) +
      (ringEnd[c.string] > at ? W.ringing : 0);

    const cands = group.map((n) => {
      const all = candidates(n.pitch, strings, maxFret);
      if (n.pinnedString != null) {
        const pinned = all.filter((c) => c.string === n.pinnedString);
        if (pinned.length) return pinned.map((c) => ({ c, cost: 0 })); // user's choice: free
      }
      return all.map((c) => ({ c, cost: cost(c) })).sort((a, b) => a.cost - b.cost);
    });

    // search order: most constrained notes first prunes the tree fastest
    const order = group.map((_, k) => k).sort((a, b) => cands[a].length - cands[b].length);
    // lower bound of the remaining notes' cost, for pruning
    const minRest = new Array<number>(order.length + 1).fill(0);
    for (let k = order.length - 1; k >= 0; k--) {
      const list = cands[order[k]];
      minRest[k] = minRest[k + 1] + (list.length ? list[0].cost : W.unplayable);
    }

    let best: (Position | null)[] | null = null;
    let bestCost = Infinity;
    const pick: (Position | null)[] = new Array(group.length).fill(null);
    let usedMask = 0;

    const chordPenalty = (): number => {
      let lo = Infinity,
        hi = -Infinity,
        count = 0,
        strMask = 0;
      for (const p of pick) {
        if (!p) continue;
        count++;
        strMask |= 1 << p.string;
        if (p.fret > 0) {
          if (p.fret < lo) lo = p.fret;
          if (p.fret > hi) hi = p.fret;
        }
      }
      if (count < 2) return 0;
      let pen = 0;
      if (hi > lo && hi - lo > W.spanFree) pen += (hi - lo - W.spanFree) * W.spanPerFret;
      // skipped strings between the lowest and highest used string
      let first = -1,
        last = -1;
      for (let s = 0; s < strings.length; s++)
        if (strMask & (1 << s)) {
          if (first < 0) first = s;
          last = s;
        }
      pen += W.skippedString * (last - first + 1 - count);
      return pen;
    };

    const rec = (k: number, acc: number) => {
      if (acc + minRest[k] >= bestCost) return;
      if (k === order.length) {
        const tot = acc + chordPenalty();
        if (tot < bestCost) {
          bestCost = tot;
          best = pick.slice();
        }
        return;
      }
      const idx = order[k];
      let any = false;
      for (const { c, cost: cc } of cands[idx]) {
        const bit = 1 << c.string;
        if (usedMask & bit) continue;
        any = true;
        usedMask |= bit;
        pick[idx] = c;
        rec(k + 1, acc + cc);
        usedMask &= ~bit;
      }
      if (!any) {
        pick[idx] = null;
        rec(k + 1, acc + W.unplayable);
      }
      pick[idx] = null;
    };
    rec(0, 0);

    const frets: number[] = [];
    group.forEach((n, k) => {
      const p = best ? best[k] : null;
      res.set(n.id, p ?? null);
      if (p) {
        ringEnd[p.string] = Math.max(ringEnd[p.string], n.start + n.duration);
        if (p.fret > 0) frets.push(p.fret);
      }
    });
    if (frets.length) {
      const avg = frets.reduce((a, b) => a + b, 0) / frets.length;
      hand = hand * W.handSmoothing + avg * (1 - W.handSmoothing);
    }
    i = j;
  }
  return res;
}

/** Notes no position can reach (shown grey with ✕ and listed as a warning). */
export function unplayable(f: Fingering): string[] {
  const out: string[] = [];
  for (const [id, p] of f) if (!p) out.push(id);
  return out;
}

/** Effective open pitches for a track (tuning + capo). */
export function openStrings(tuning: { strings: number[] }, capo = 0): number[] {
  return tuning.strings.map((p) => p + capo);
}
