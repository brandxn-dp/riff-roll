import type { ProjectInfo, StorageAdapter } from './types';

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

/** Desktop mode: Electron IPC to the main process, which uses the native file system. */
export class ElectronStorage implements StorageAdapter {
  readonly kind = 'electron' as const;
  constructor(private bridge: RiffRollBridge) {}
  list() {
    return this.bridge.projects.list();
  }
  load(id: string) {
    return this.bridge.projects.load(id);
  }
  save(id: string, data: Uint8Array) {
    return this.bridge.projects.save(id, data);
  }
  remove(id: string) {
    return this.bridge.projects.remove(id);
  }
}
