import type { Song } from './model';

/**
 * Command pattern for every edit. A command is a pure Song -> Song transform with a label.
 * The history stores the song before and after each command; because songs are immutable with structural sharing,
 * that is cheap, and undo/redo are exact (no hand-written inverse operations to get wrong).
 */
export interface Command {
  label: string;
  apply(song: Song): Song;
}

interface Entry {
  label: string;
  before: Song;
  after: Song;
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private txn: { label: string; base: Song } | null = null;
  private listeners = new Set<(song: Song) => void>();
  private _song: Song;

  constructor(
    song: Song,
    private limit = 500,
  ) {
    this._song = song;
  }

  get song(): Song {
    return this._song;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.txn;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this.txn;
  }
  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  subscribe(fn: (song: Song) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(song: Song) {
    this._song = song;
    for (const l of this.listeners) l(song);
  }

  execute(cmd: Command): Song {
    const before = this._song;
    const after = cmd.apply(before);
    if (after === before) return before;
    if (!this.txn) {
      this.undoStack.push({ label: cmd.label, before, after });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    this.set(after);
    return after;
  }

  /** Group the following commands (e.g. a whole mouse drag) into one undo step. */
  begin(label: string) {
    if (this.txn) this.commit();
    this.txn = { label, base: this._song };
  }

  commit() {
    const t = this.txn;
    this.txn = null;
    if (!t || t.base === this._song) return;
    this.undoStack.push({ label: t.label, before: t.base, after: this._song });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Abort a transaction and restore the song from before it. */
  cancel() {
    const t = this.txn;
    this.txn = null;
    if (t) this.set(t.base);
  }

  get inTransaction(): boolean {
    return !!this.txn;
  }

  undo(): boolean {
    if (this.txn) this.commit();
    const e = this.undoStack.pop();
    if (!e) return false;
    this.redoStack.push(e);
    this.set(e.before);
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.undoStack.push(e);
    this.set(e.after);
    return true;
  }

  /** Replace the song without an undo step (loading a file). Clears history. */
  reset(song: Song) {
    this.undoStack = [];
    this.redoStack = [];
    this.txn = null;
    this.set(song);
  }
}
