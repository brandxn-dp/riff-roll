import type { ProjectInfo, SaveMeta, StorageAdapter } from './types';
import { forgetLocal, localMeta, noteLocal } from './local-meta';

/** API exposed by apps/desktop/src/preload.ts via contextBridge. */
export interface RiffRollBridge {
  platform: string;
  projects: {
    list(): Promise<ProjectInfo[]>;
    load(id: string): Promise<Uint8Array>;
    save(id: string, data: Uint8Array): Promise<void>;
    remove(id: string): Promise<void>;
  };
  [key: string]: unknown;
}

declare global {
  interface Window {
    riffroll?: RiffRollBridge;
  }
}

/** Desktop mode: Electron IPC to the main process, which uses the native file system. Single user. */
export class ElectronStorage implements StorageAdapter {
  readonly kind = 'electron' as const;
  constructor(private bridge: RiffRollBridge) {}
  async list() {
    const items = await this.bridge.projects.list();
    return items.map((p) => ({ ...p, name: localMeta(p.id).title, openedAt: localMeta(p.id).openedAt }));
  }
  async load(id: string) {
    const data = await this.bridge.projects.load(id);
    return { data, access: 'owner' as const };
  }
  async save(id: string, data: Uint8Array, meta: SaveMeta) {
    await this.bridge.projects.save(id, data);
    noteLocal(id, { title: meta.title });
    return {};
  }
  async remove(id: string) {
    await this.bridge.projects.remove(id);
    forgetLocal(id);
  }
}
