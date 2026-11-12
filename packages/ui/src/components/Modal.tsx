import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '../store';

export function Modal({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus();
  }, []);
  const close = () => useStore.getState().set({ modal: null });
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className={'modal' + (wide ? ' wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          // Escape closes the dialog even while typing in one of its fields
          if (e.key === 'Escape') {
            e.stopPropagation();
            return close();
          }
          if (e.key !== 'Tab') return;
          // keep keyboard focus inside the dialog
          const f = [
            ...ref.current!.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ].filter((x) => !x.hasAttribute('disabled'));
          if (!f.length) return;
          const first = f[0],
            last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ib" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
