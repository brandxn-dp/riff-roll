/**
 * Carries MCP tool calls from Claude to the user's open Riff Roll tab and the results back. Each signed-in tab
 * keeps an event stream open (GET /api/mcp/live); a call goes to that user's most recently used tab, which runs it
 * on the open song and posts the result (POST /api/mcp/result).
 */
import type { ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { toolError, type ToolResult } from './protocol.js';

interface Conn {
  id: string;
  userId: string;
  res: ServerResponse;
  active: number;
  ping: NodeJS.Timeout;
}
interface Pending {
  userId: string;
  conn: string;
  resolve: (r: ToolResult) => void;
  timer: NodeJS.Timeout;
}

export class McpRelay {
  private conns = new Map<string, Conn>();
  private pending = new Map<string, Pending>();
  constructor(private timeoutMs = 120_000) {}

  private send(c: Conn, event: string, data: unknown) {
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** A tab connects: start its event stream. */
  open(userId: string, res: ServerResponse): string {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // nginx: don't hold the stream back
    });
    const id = randomBytes(8).toString('hex');
    // comments keep proxies from closing an idle stream
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const c: Conn = { id, userId, res, active: Date.now(), ping };
    this.conns.set(id, c);
    this.send(c, 'hello', { conn: id });
    return id;
  }

  close(connId: string) {
    const c = this.conns.get(connId);
    if (!c) return;
    clearInterval(c.ping);
    this.conns.delete(connId);
    for (const [id, p] of this.pending)
      if (p.conn === connId) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve(toolError('The Riff Roll tab was closed before it answered.'));
      }
  }

  /** The user clicked or typed in this tab: calls go here from now on. */
  touch(connId: string, userId: string) {
    const c = this.conns.get(connId);
    if (c && c.userId === userId) c.active = Date.now();
  }

  connected(userId: string) {
    return [...this.conns.values()].filter((c) => c.userId === userId).length;
  }

  call(userId: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    let best: Conn | null = null;
    for (const c of this.conns.values())
      if (c.userId === userId && (!best || c.active > best.active)) best = c;
    if (!best)
      return Promise.resolve(
        toolError('Riff Roll isn’t open. Open it in a browser, signed in as you, and try again.'),
      );
    const conn = best;
    const id = randomBytes(8).toString('hex');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(toolError('Riff Roll didn’t answer in time (is the tab asleep, or a dialog open?).'));
      }, this.timeoutMs);
      this.pending.set(id, { userId, conn: conn.id, resolve, timer });
      this.send(conn, 'call', { id, name, args });
    });
  }

  /** A tab answers a call. Only the user the call was for can answer it. */
  result(userId: string, id: string, result: unknown): boolean {
    const p = this.pending.get(id);
    if (!p || p.userId !== userId) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    const r = result as ToolResult;
    p.resolve(r && Array.isArray(r.content) ? r : toolError('Bad answer from the Riff Roll tab.'));
    return true;
  }

  closeAll() {
    for (const id of [...this.conns.keys()]) {
      this.conns.get(id)?.res.end();
      this.close(id);
    }
  }
}
