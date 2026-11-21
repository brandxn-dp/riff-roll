/**
 * Ghost notes from another track, moved by whole octaves into the range of the track being edited, so a bass line
 * shows up on the guitar's lowest matching notes (and a lead above the bass's range comes down to its highest).
 */
export function foldIntoRange(pitch: number, lo: number, hi: number): number {
  if (hi - lo < 11) return pitch; // a range under an octave can't hold every note name
  if (pitch < lo) return pitch + 12 * Math.ceil((lo - pitch) / 12);
  if (pitch > hi) return pitch - 12 * Math.ceil((pitch - hi) / 12);
  return pitch;
}
