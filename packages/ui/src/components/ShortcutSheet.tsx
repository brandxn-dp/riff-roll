import { SHORTCUTS } from '../shortcuts';
import { Modal } from './Modal';

export function ShortcutSheet() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <Modal title="Keyboard shortcuts" wide>
      <div className="sheet">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            <dl>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
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
