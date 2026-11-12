/**
 * Note-value icons for the edit palette, drawn as SVG so they sit centred and crisp at any size (a music font's
 * glyphs sit on a staff baseline, which looks off inside a button).
 * flags: 0 = quarter, 1 = eighth … 4 = 64th; hollow for half/whole; stem false for whole.
 */
export function NoteIcon({
  flags = 0,
  hollow = false,
  stem = true,
  dot = false,
  size = 22,
}: {
  flags?: number;
  hollow?: boolean;
  stem?: boolean;
  dot?: boolean;
  size?: number;
}) {
  // notehead at the bottom, stem up on its right; flags stack down from the top of the stem
  const cx = stem ? 9 : 12;
  const cy = stem ? 18.5 : 13;
  const top = flags > 2 ? 2.5 : 4;
  const gap = flags > 2 ? 3.2 : 3.8;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="note-icon">
      <ellipse
        cx={cx}
        cy={cy}
        rx={stem ? 4.1 : 5.2}
        ry={stem ? 2.9 : 3.4}
        transform={`rotate(-22 ${cx} ${cy})`}
        fill={hollow ? 'none' : 'currentColor'}
        stroke="currentColor"
        strokeWidth={hollow ? 1.6 : 0}
      />
      {stem && <line x1={12.9} y1={top} x2={12.9} y2={cy - 0.8} stroke="currentColor" strokeWidth={1.4} />}
      {Array.from({ length: flags }, (_, i) => (
        <path
          key={i}
          d={`M12.9 ${top + i * gap} c0.6 2.4 4.6 3.4 4.4 7.2`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
      {dot && <circle cx={18.5} cy={cy} r={1.5} fill="currentColor" />}
    </svg>
  );
}

/** Quarter rest. */
export function RestIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="note-icon">
      <path
        d="M10 3 L14.2 8.2 L10.6 12 L14.4 16.6 C11.8 15.4 9.6 16.6 11.6 20.6 C7.8 18 9 13.6 12.4 14.6 L9 10.4 L12.4 7.2 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Triplet: a bracket with a 3. */
export function TripletIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="note-icon">
      <path d="M3 9 V5.5 H9 M15 5.5 H21 V9" fill="none" stroke="currentColor" strokeWidth={1.4} />
      <text x="12" y="10" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor">
        3
      </text>
      <ellipse cx="6" cy="18" rx="2.6" ry="1.9" transform="rotate(-22 6 18)" fill="currentColor" />
      <ellipse cx="12" cy="18" rx="2.6" ry="1.9" transform="rotate(-22 12 18)" fill="currentColor" />
      <ellipse cx="18" cy="18" rx="2.6" ry="1.9" transform="rotate(-22 18 18)" fill="currentColor" />
    </svg>
  );
}

/** Tie: a slur between two noteheads. */
export function TieIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="note-icon">
      <ellipse cx="6" cy="10" rx="3" ry="2.2" transform="rotate(-22 6 10)" fill="currentColor" />
      <ellipse cx="18" cy="10" rx="3" ry="2.2" transform="rotate(-22 18 10)" fill="currentColor" />
      <path
        d="M5 14 C9 19 15 19 19 14"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
