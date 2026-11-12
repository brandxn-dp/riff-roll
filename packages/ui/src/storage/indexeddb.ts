import type { ProjectInfo, StorageAdapter } from './types';

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
}

/** Plain-browser fallback (e.g. the UI opened from `vite preview` with no server). */
export class IndexedDbStorage implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  async list(): Promise<ProjectInfo[]> {
    const keys = (await tx('readonly', (s) => s.getAllKeys())) as string[];
    const rows = (await tx('readonly', (s) => s.getAll())) as Row[];
    return keys
      .map((id, i) => ({ id, updatedAt: rows[i].updatedAt, size: rows[i].data.byteLength }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async load(id: string): Promise<Uint8Array> {
    const row = (await tx('readonly', (s) => s.get(id))) as Row | undefined;
    if (!row) throw new Error('not found');
    return row.data;
  }
  async save(id: string, data: Uint8Array): Promise<void> {
    await tx('readwrite', (s) => s.put({ data, updatedAt: new Date().toISOString() } satisfies Row, id));
  }
  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  }
}
