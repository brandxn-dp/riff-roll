/**
 * Accounts, sessions and the song library (who owns which song, who it is shared with, what each user opened
 * recently). Everything lives in JSON files next to the songs so a single Docker volume holds it all:
 *
 *   <projectsDir>/accounts.json   users (scrypt password hashes) + sessions (sha-256 of the token)
 *   <projectsDir>/library.json    song owner, title, version, shares; per-user recently opened
 *   <projectsDir>/<songId>.riff   the songs themselves (unchanged layout from before accounts)
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type Access = 'owner' | 'edit' | 'view';

export interface User {
  id: string;
  username: string;
  displayName: string;
  admin: boolean;
  salt: string;
  hash: string;
  createdAt: string;
}
export type PublicUser = Pick<User, 'id' | 'username' | 'displayName' | 'admin'>;

interface Session {
  userId: string;
  expires: number;
}

export interface SongEntry {
  owner: string;
  title: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  size: number;
  /** userId → access */
  shares: Record<string, 'view' | 'edit'>;
}

interface AccountsFile {
  users: User[];
  sessions: Record<string, Session>;
  /** Claude (MCP) access tokens: sha-256 of the token → owner. One per user. */
  mcp: Record<string, { userId: string; createdAt: string }>;
}
interface LibraryFile {
  songs: Record<string, SongEntry>;
  /** userId → songId → ISO time last opened */
  recent: Record<string, Record<string, string>>;
}

export const SESSION_DAYS = 30;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export const publicUser = (u: User): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  admin: u.admin,
});

async function hashPassword(password: string, salt = randomBytes(16)) {
  const hash = await scrypt(password, salt, 64);
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

export function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 6)
    throw new HttpError(400, 'Passwords need at least 6 characters.');
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.');
  return pw;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Serialises writes and keeps the JSON files on disk in step with memory. */
class JsonFile<T> {
  private queue = Promise.resolve();
  constructor(
    private file: string,
    public data: T,
  ) {}
  static async load<T>(file: string, empty: T): Promise<JsonFile<T>> {
    const data = existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as T) : empty;
    return new JsonFile(file, { ...empty, ...data });
  }
  save(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 1);
    this.queue = this.queue.then(async () => {
      const tmp = this.file + '.tmp';
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.queue;
  }
}

export class Accounts {
  private constructor(
    private acc: JsonFile<AccountsFile>,
    private lib: JsonFile<LibraryFile>,
  ) {}

  static async open(dir: string): Promise<Accounts> {
    const acc = await JsonFile.load<AccountsFile>(path.join(dir, 'accounts.json'), {
      users: [],
      sessions: {},
      mcp: {},
    });
    const lib = await JsonFile.load<LibraryFile>(path.join(dir, 'library.json'), { songs: {}, recent: {} });
    return new Accounts(acc, lib);
  }

  // ---------------- users ----------------
  get hasUsers() {
    return this.acc.data.users.length > 0;
  }
  users(): User[] {
    return this.acc.data.users;
  }
  user(id: string): User | undefined {
    return this.acc.data.users.find((u) => u.id === id);
  }

  async createUser(input: {
    username?: unknown;
    password?: unknown;
    displayName?: unknown;
    admin?: boolean;
  }) {
    const username = String(input.username ?? '')
      .trim()
      .toLowerCase();
    if (!USERNAME_RE.test(username))
      throw new HttpError(400, 'Usernames are 2–32 characters: letters, numbers, dot, dash or underscore.');
    if (this.acc.data.users.some((u) => u.username === username))
      throw new HttpError(409, 'That username is taken.');
    const password = validatePassword(input.password);
    const displayName =
      String(input.displayName ?? '')
        .trim()
        .slice(0, 60) || username;
    const user: User = {
      id: 'u_' + randomBytes(9).toString('base64url'),
      username,
      displayName,
      admin: !!input.admin,
      ...(await hashPassword(password)),
      createdAt: new Date().toISOString(),
    };
    this.acc.data.users.push(user);
    await this.acc.save();
    return user;
  }

  async verify(username: unknown, password: unknown): Promise<User | null> {
    const u = this.acc.data.users.find(
      (x) =>
        x.username ===
        String(username ?? '')
          .trim()
          .toLowerCase(),
    );
    // hash anyway so a wrong username takes as long as a wrong password
    const salt = u ? Buffer.from(u.salt, 'base64') : randomBytes(16);
    const got = await scrypt(String(password ?? ''), salt, 64);
    return u && timingSafeEqual(got, Buffer.from(u.hash, 'base64')) ? u : null;
  }

  async setPassword(userId: string, password: unknown) {
    const u = this.user(userId);
    if (!u) throw new HttpError(404, 'No such user.');
    Object.assign(u, await hashPassword(validatePassword(password)));
    // signing in again everywhere else is the safe default after a password change
    for (const [k, s] of Object.entries(this.acc.data.sessions))
      if (s.userId === userId) delete this.acc.data.sessions[k];
    await this.acc.save();
  }

  async updateUser(userId: string, patch: { displayName?: unknown; admin?: unknown }) {
    const u = this.user(userId);
    if (!u) throw new HttpError(404, 'No such user.');
    if (typeof patch.displayName === 'string' && patch.displayName.trim())
      u.displayName = patch.displayName.trim().slice(0, 60);
    if (typeof patch.admin === 'boolean') {
      if (!patch.admin && u.admin && this.acc.data.users.filter((x) => x.admin).length === 1)
        throw new HttpError(400, 'There has to be at least one admin.');
      u.admin = patch.admin;
    }
    await this.acc.save();
    return u;
  }

  /** Remove a user. Their songs move to `heir` (nothing is lost); shares to them are dropped. */
  async deleteUser(userId: string, heir: string) {
    const u = this.user(userId);
    if (!u) throw new HttpError(404, 'No such user.');
    if (userId === heir) throw new HttpError(400, 'You can’t delete your own account here.');
    if (u.admin && this.acc.data.users.filter((x) => x.admin).length === 1)
      throw new HttpError(400, 'There has to be at least one admin.');
    this.acc.data.users = this.acc.data.users.filter((x) => x.id !== userId);
    for (const [k, s] of Object.entries(this.acc.data.sessions))
      if (s.userId === userId) delete this.acc.data.sessions[k];
    for (const song of Object.values(this.lib.data.songs)) {
      delete song.shares[userId];
      if (song.owner === userId) {
        song.owner = heir;
        delete song.shares[heir];
      }
    }
    delete this.lib.data.recent[userId];
    for (const [k, t] of Object.entries(this.acc.data.mcp))
      if (t.userId === userId) delete this.acc.data.mcp[k];
    await Promise.all([this.acc.save(), this.lib.save()]);
  }

  // ---------------- sessions ----------------
  private static tokenKey(token: string) {
    return createHash('sha256').update(token).digest('base64url');
  }
  async startSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    for (const [k, s] of Object.entries(this.acc.data.sessions))
      if (s.expires < now) delete this.acc.data.sessions[k];
    this.acc.data.sessions[Accounts.tokenKey(token)] = { userId, expires: now + SESSION_DAYS * 86_400_000 };
    await this.acc.save();
    return token;
  }
  sessionUser(token: string | undefined): User | null {
    if (!token) return null;
    const s = this.acc.data.sessions[Accounts.tokenKey(token)];
    if (!s || s.expires < Date.now()) return null;
    return this.user(s.userId) ?? null;
  }
  // ---------------- Claude (MCP) tokens ----------------
  /** A new token for a user (replaces their old one). Only its hash is kept; the token is shown once. */
  async createMcpToken(userId: string): Promise<string> {
    if (!this.user(userId)) throw new HttpError(404, 'No such user.');
    await this.revokeMcpToken(userId, false);
    const token = 'rr_' + randomBytes(24).toString('base64url');
    this.acc.data.mcp[Accounts.tokenKey(token)] = { userId, createdAt: new Date().toISOString() };
    await this.acc.save();
    return token;
  }
  mcpTokenInfo(userId: string): { createdAt: string } | null {
    const t = Object.values(this.acc.data.mcp).find((x) => x.userId === userId);
    return t ? { createdAt: t.createdAt } : null;
  }
  async revokeMcpToken(userId: string, persist = true) {
    for (const [k, t] of Object.entries(this.acc.data.mcp))
      if (t.userId === userId) delete this.acc.data.mcp[k];
    if (persist) await this.acc.save();
  }
  mcpUser(token: string | undefined): User | null {
    if (!token) return null;
    const t = this.acc.data.mcp[Accounts.tokenKey(token)];
    return t ? (this.user(t.userId) ?? null) : null;
  }

  /** Sign a user out on every device. */
  async endSessionsOf(userId: string) {
    if (!this.user(userId)) throw new HttpError(404, 'No such user.');
    let n = 0;
    for (const [k, s] of Object.entries(this.acc.data.sessions))
      if (s.userId === userId) {
        delete this.acc.data.sessions[k];
        n++;
      }
    await this.acc.save();
    return n;
  }

  /** Counts for the admin panel: songs and bytes per owner, live sessions per user. */
  stats() {
    const now = Date.now();
    const per = new Map<string, { songs: number; bytes: number; sessions: number; shared: number }>();
    const of = (id: string) => {
      let p = per.get(id);
      if (!p) per.set(id, (p = { songs: 0, bytes: 0, sessions: 0, shared: 0 }));
      return p;
    };
    let bytes = 0;
    const songs = Object.values(this.lib.data.songs);
    for (const s of songs) {
      const p = of(s.owner);
      p.songs++;
      p.bytes += s.size;
      bytes += s.size;
      if (Object.keys(s.shares).length) p.shared++;
    }
    let sessions = 0;
    for (const s of Object.values(this.acc.data.sessions))
      if (s.expires > now) {
        sessions++;
        of(s.userId).sessions++;
      }
    return {
      users: this.acc.data.users.length,
      admins: this.acc.data.users.filter((u) => u.admin).length,
      songs: songs.length,
      bytes,
      sessions,
      perUser: this.acc.data.users.map((u) => ({
        ...publicUser(u),
        createdAt: u.createdAt,
        ...(per.get(u.id) ?? { songs: 0, bytes: 0, sessions: 0, shared: 0 }),
      })),
    };
  }

  async endSession(token: string | undefined) {
    if (!token) return;
    delete this.acc.data.sessions[Accounts.tokenKey(token)];
    await this.acc.save();
  }

  // ---------------- library ----------------
  song(id: string): SongEntry | undefined {
    return this.lib.data.songs[id];
  }
  access(userId: string, id: string): Access | null {
    const s = this.song(id);
    if (!s) return null;
    if (s.owner === userId) return 'owner';
    return s.shares[userId] ?? null;
  }

  /** Songs saved before accounts existed belong to whoever sets the server up. */
  async claimUnowned(ids: { id: string; updatedAt: string; size: number; title: string }[], userId: string) {
    let changed = false;
    for (const f of ids)
      if (!this.lib.data.songs[f.id]) {
        this.lib.data.songs[f.id] = {
          owner: userId,
          title: f.title,
          updatedAt: f.updatedAt,
          updatedBy: userId,
          version: 1,
          size: f.size,
          shares: {},
        };
        changed = true;
      }
    if (changed) await this.lib.save();
  }

  listFor(userId: string) {
    const recent = this.lib.data.recent[userId] ?? {};
    return Object.entries(this.lib.data.songs)
      .filter(([, s]) => s.owner === userId || s.shares[userId])
      .map(([id, s]) => {
        const owner = this.user(s.owner);
        return {
          id,
          name: s.title || undefined,
          updatedAt: s.updatedAt,
          size: s.size,
          version: s.version,
          access: (s.owner === userId ? 'owner' : s.shares[userId]) as Access,
          owner: owner ? { id: owner.id, displayName: owner.displayName } : undefined,
          sharedWith: s.owner === userId ? Object.keys(s.shares).length : undefined,
          openedAt: recent[id],
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async recordSave(userId: string, id: string, info: { title: string; size: number }) {
    const now = new Date().toISOString();
    const s = this.lib.data.songs[id];
    if (s)
      Object.assign(s, {
        title: info.title || s.title,
        size: info.size,
        updatedAt: now,
        updatedBy: userId,
        version: s.version + 1,
      });
    else
      this.lib.data.songs[id] = {
        owner: userId,
        title: info.title,
        size: info.size,
        updatedAt: now,
        updatedBy: userId,
        version: 1,
        shares: {},
      };
    (this.lib.data.recent[userId] ??= {})[id] = now;
    await this.lib.save();
    return this.lib.data.songs[id];
  }

  async recordOpen(userId: string, id: string) {
    const r = (this.lib.data.recent[userId] ??= {});
    r[id] = new Date().toISOString();
    // keep the recent list short
    const keep = Object.entries(r)
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, 50);
    this.lib.data.recent[userId] = Object.fromEntries(keep);
    await this.lib.save();
  }

  async removeSong(id: string) {
    delete this.lib.data.songs[id];
    for (const r of Object.values(this.lib.data.recent)) delete r[id];
    await this.lib.save();
  }

  /** A recipient removing a shared song from their own list. */
  async leaveShare(userId: string, id: string) {
    const s = this.song(id);
    if (s) delete s.shares[userId];
    delete this.lib.data.recent[userId]?.[id];
    await this.lib.save();
  }

  async setShare(id: string, userId: string, access: 'view' | 'edit' | null) {
    const s = this.song(id);
    if (!s) throw new HttpError(404, 'No such song.');
    if (!this.user(userId)) throw new HttpError(404, 'No such user.');
    if (userId === s.owner) throw new HttpError(400, 'That’s the owner.');
    if (access) s.shares[userId] = access;
    else delete s.shares[userId];
    await this.lib.save();
  }

  sharesOf(id: string) {
    const s = this.song(id);
    if (!s) return [];
    return Object.entries(s.shares).map(([userId, access]) => ({ userId, access }));
  }
}
