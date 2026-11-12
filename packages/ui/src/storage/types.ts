/** Where projects live. The UI only ever talks to this interface. */
export type Access = 'owner' | 'edit' | 'view';

export interface ProjectInfo {
  id: string;
  /** song title (missing for songs saved by older versions until they are saved again) */
  name?: string;
  updatedAt: string;
  size?: number;
  /** last time the signed-in user (or this device) opened it */
  openedAt?: string;
  /** server accounts only */
  access?: Access;
  owner?: { id: string; displayName: string };
  /** number of people the owner shared it with */
  sharedWith?: number;
  version?: number;
}

export interface LoadedProject {
  data: Uint8Array;
  access: Access;
  version?: number;
  /** display name of the owner */
  owner?: string;
}

export interface SaveMeta {
  title: string;
  /** the version this save is based on (the server refuses it if someone saved in between) */
  baseVersion?: number;
}

/** Why a save was refused. */
export class SaveError extends Error {
  constructor(
    public code: 'taken' | 'conflict' | 'readonly' | 'signed-out',
    message: string,
    public updatedBy?: string,
  ) {
    super(message);
  }
}

export interface StorageAdapter {
  readonly kind: 'rest' | 'electron' | 'indexeddb';
  list(): Promise<ProjectInfo[]>;
  load(id: string): Promise<LoadedProject>;
  save(id: string, data: Uint8Array, meta: SaveMeta): Promise<{ version?: number }>;
  remove(id: string): Promise<void>;
}
