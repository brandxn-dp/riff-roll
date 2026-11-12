import type { ProjectInfo, StorageAdapter } from './types';

/** Docker / server mode: projects stored on disk by the Fastify server. */
export class RestStorage implements StorageAdapter {
  readonly kind = 'rest' as const;
  constructor(private base = './api/projects') {}

  async list(): Promise<ProjectInfo[]> {
    const r = await fetch(this.base);
    if (!r.ok) throw new Error(`list failed: ${r.status}`);
    return r.json();
  }
  async load(id: string): Promise<Uint8Array> {
    const r = await fetch(`${this.base}/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`load failed: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async save(id: string, data: Uint8Array): Promise<void> {
    const r = await fetch(`${this.base}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: data as BodyInit,
    });
    if (!r.ok) throw new Error(`save failed: ${r.status}`);
  }
  async remove(id: string): Promise<void> {
    await fetch(`${this.base}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
