/** Bulk velocity edits for notes and drum hits. */
export type VelocityOp =
  | { mode: 'set'; value: number }
  | { mode: 'scale'; percent: number }
  | { mode: 'add'; amount: number }
  /** from → to across the items in time order (crescendo / diminuendo) */
  | { mode: 'ramp'; from: number; to: number }
  /** each one moved randomly by up to ± amount */
  | { mode: 'randomize'; amount: number; seed?: number };

const clamp = (v: number) => Math.max(1, Math.min(127, Math.round(v)));

/** A small deterministic random generator so "randomize" can be previewed and undone predictably. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * New velocities for `items` (anything with an id, a start and a velocity), as id → velocity.
 * Items starting at the same time (a chord) get the same ramp value.
 */
export function editVelocities(
  items: { id: string; start: number; velocity: number }[],
  op: VelocityOp,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!items.length) return out;
  if (op.mode === 'ramp') {
    const starts = [...new Set(items.map((i) => i.start))].sort((a, b) => a - b);
    const first = starts[0],
      last = starts[starts.length - 1];
    for (const i of items) {
      const f = last === first ? 0 : (i.start - first) / (last - first);
      out[i.id] = clamp(op.from + (op.to - op.from) * f);
    }
    return out;
  }
  const rand = op.mode === 'randomize' ? rng(op.seed ?? 1) : null;
  for (const i of items) {
    out[i.id] = clamp(
      op.mode === 'set'
        ? op.value
        : op.mode === 'scale'
          ? (i.velocity * op.percent) / 100
          : op.mode === 'add'
            ? i.velocity + op.amount
            : i.velocity + (rand!() * 2 - 1) * op.amount,
    );
  }
  return out;
}
