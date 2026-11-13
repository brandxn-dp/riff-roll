import { SHORTCUTS } from '../shortcuts';
import { ACTIONS, bindingsOf, niceCombo } from '../keymap';
import { useSettings } from '../settings';
import { useStore } from '../store';
import { Modal } from './Modal';

export function ShortcutSheet() {
  useSettings((s) => s.keys); // re-render when bindings change
  const rows = [
    ...ACTIONS.filter((a) => bindingsOf(a.id).length).map((a) => ({
      group: a.group,
      keys: bindingsOf(a.id).map(niceCombo).join(' / '),
      what: a.label,
    })),
    ...SHORTCUTS,
  ];
  const groups = [...new Set(rows.map((s) => s.group))];
  return (
    <Modal title="Keyboard shortcuts" wide>
      <p className="sheet-head">
        <button
          className="btn"
          onClick={() => useStore.getState().set({ modal: 'settings', settingsTab: 'shortcuts' })}
        >
          Change shortcuts…
        </button>
      </p>
      <div className="sheet">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            <dl>
              {rows
                .filter((s) => s.group === g)
                .map((s) => (
                  <div key={s.keys + s.what}>
                    <dt>
                      <kbd>{s.keys}</kbd>
                    </dt>
                    <dd>{s.what}</dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
