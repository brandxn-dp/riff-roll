import type { LoadedProject, ProjectInfo, SaveMeta, StorageAdapter } from './types';
import { localMeta } from './local-meta';

const DB = 'riffroll';
const STORE = 'projects';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

interface Row {
  data: Uint8Array;
  updatedAt: string;
  title?: string;
}

/** Plain-browser fallback (e.g. the UI opened from `vite preview` with no server). Single user. */
export class IndexedDbStorage implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  async list(): Promise<ProjectInfo[]> {
    const keys = (await tx('readonly', (s) => s.getAllKeys())) as string[];
    const rows = (await tx('readonly', (s) => s.getAll())) as Row[];
    return keys
      .map((id, i) => ({
        id,
        name: rows[i].title,
        updatedAt: rows[i].updatedAt,
        size: rows[i].data.byteLength,
        openedAt: localMeta(id).openedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async load(id: string): Promise<LoadedProject> {
    const row = (await tx('readonly', (s) => s.get(id))) as Row | undefined;
    if (!row) throw new Error('not found');
    return { data: row.data, access: 'owner' };
  }
  async save(id: string, data: Uint8Array, meta: SaveMeta) {
    const row: Row = { data, updatedAt: new Date().toISOString(), title: meta.title };
    await tx('readwrite', (s) => s.put(row, id));
    return {};
  }
  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  }
}
