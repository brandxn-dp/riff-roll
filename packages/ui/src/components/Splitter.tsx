/** Drag handles that resize parts of the workspace; sizes are remembered on this device. */
import { useCallback, useState } from 'react';

const KEY = 'riffroll.layout.sizes';

function readAll(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/** A remembered size (px) for one part of the workspace; null until the user changes it. */
export function usePanelSize(name: string): [number | null, (v: number | null) => void] {
  const [v, setV] = useState<number | null>(() => readAll()[name] ?? null);
  const set = useCallback(
    (n: number | null) => {
      setV(n);
      try {
        const all = readAll();
        if (n == null) delete all[name];
        else all[name] = Math.round(n);
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch {
        /* remembered for this session only */
      }
    },
    [name],
  );
  return [v, set];
}

/**
 * A drag handle. `axis="x"` is a vertical bar resizing a width, `axis="y"` a horizontal bar resizing a height.
 * `invert` when the panel sits after the handle (dragging up / left makes it bigger). Double-click resets.
 */
export function Splitter({
  axis,
  size,
  min,
  max,
  invert = false,
  onSize,
  label,
}: {
  axis: 'x' | 'y';
  /** the panel's current size in px (measured when the drag starts if not set) */
  size: () => number;
  min: number;
  max: number;
  invert?: boolean;
  onSize: (v: number | null) => void;
  label: string;
}) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY;
    const s0 = size();
    const move = (ev: PointerEvent) => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - start;
      onSize(Math.max(min, Math.min(max, s0 + (invert ? -d : d))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className={'splitter ' + axis}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={down}
      onDoubleClick={() => onSize(null)}
    />
  );
}
