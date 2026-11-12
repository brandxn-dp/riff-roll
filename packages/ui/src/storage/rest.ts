import {
  SaveError,
  type Access,
  type LoadedProject,
  type ProjectInfo,
  type SaveMeta,
  type StorageAdapter,
} from './types';
import { signedOut } from '../account';

/** Docker / server mode: songs stored by the Fastify server, per signed-in user. */
export class RestStorage implements StorageAdapter {
  readonly kind = 'rest' as const;
  constructor(private base = './api/projects') {}

  private check(r: Response, what: string) {
    if (r.status === 401) {
      signedOut();
      throw new SaveError('signed-out', 'You were signed out.');
    }
    if (!r.ok) throw new Error(`${what} failed: ${r.status}`);
  }
  async list(): Promise<ProjectInfo[]> {
    const r = await fetch(this.base, { cache: 'no-store' });
    this.check(r, 'list');
    return r.json();
  }
  async load(id: string): Promise<LoadedProject> {
    const r = await fetch(`${this.base}/${encodeURIComponent(id)}`, { cache: 'no-store' });
    this.check(r, 'load');
    return {
      data: new Uint8Array(await r.arrayBuffer()),
      access: (r.headers.get('x-access') as Access | null) ?? 'owner',
      version: Number(r.headers.get('x-version')) || undefined,
      owner: decodeURIComponent(r.headers.get('x-owner') ?? '') || undefined,
    };
  }
  async save(id: string, data: Uint8Array, meta: SaveMeta) {
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'x-song-title': encodeURIComponent(meta.title),
    };
    if (meta.baseVersion) headers['x-base-version'] = String(meta.baseVersion);
    const r = await fetch(`${this.base}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers,
      body: data as BodyInit,
    });
    if (r.status === 409) {
      const b = (await r.json().catch(() => ({}))) as { error?: string; updatedBy?: string };
      if (b.error === 'taken') throw new SaveError('taken', 'That song id belongs to someone else.');
      throw new SaveError(
        'conflict',
        `${b.updatedBy || 'Someone'} saved this song after you opened it.`,
        b.updatedBy,
      );
    }
    if (r.status === 403) throw new SaveError('readonly', 'This song is shared with you read-only.');
    this.check(r, 'save');
    return (await r.json()) as { version?: number };
  }
  async remove(id: string): Promise<void> {
    const r = await fetch(`${this.base}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.check(r, 'delete');
  }
}
