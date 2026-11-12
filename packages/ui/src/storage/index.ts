import { ElectronStorage } from './electron';
import { IndexedDbStorage } from './indexeddb';
import { RestStorage } from './rest';
import type { StorageAdapter } from './types';

export type { StorageAdapter, ProjectInfo, Access, LoadedProject } from './types';
export { SaveError } from './types';

/** Pick the adapter for the environment we are running in. */
export async function detectStorage(): Promise<StorageAdapter> {
  if (typeof window !== 'undefined' && window.riffroll) return new ElectronStorage(window.riffroll);
  try {
    const r = await fetch('./api/health', { cache: 'no-store' });
    if (r.ok && (await r.json()).ok) return new RestStorage();
  } catch {
    /* no server */
  }
  return new IndexedDbStorage();
}
