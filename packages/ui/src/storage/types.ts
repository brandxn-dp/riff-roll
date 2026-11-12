/** Where projects live. The UI only ever talks to this interface. */
export interface ProjectInfo {
  id: string;
  name?: string;
  updatedAt: string;
  size?: number;
}

export interface StorageAdapter {
  readonly kind: 'rest' | 'electron' | 'indexeddb';
  list(): Promise<ProjectInfo[]>;
  load(id: string): Promise<Uint8Array>;
  save(id: string, data: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
}
