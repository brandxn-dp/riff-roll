/**
 * Receives Claude's tool calls and runs them on the open song. Desktop app: from the main process over IPC (the
 * local MCP endpoint lives there). Docker server: from an event stream the server pushes calls down, answering
 * with a POST; the tab you last used is the one that gets the calls.
 */
import { useStore } from '../store';
import { runTool, type ToolResult } from './tools';

export interface McpBridge {
  state(): Promise<McpState>;
  set(p: { enabled?: boolean; port?: number }): Promise<McpState>;
  regenerate(): Promise<McpState>;
  onCall(fn: (c: { id: string; name: string; args: Record<string, unknown> }) => void): () => void;
  result(id: string, result: ToolResult): void;
}
export interface McpState {
  enabled: boolean;
  port: number;
  token: string;
  url: string;
  running: boolean;
  error: string;
}

export const desktopMcp = () => (window.riffroll as { mcp?: McpBridge } | undefined)?.mcp;

/** The server's MCP address for this page (works under a sub-path too). */
export const serverMcpUrl = () => new URL('./mcp', location.href).href;

function serverStream(): () => void {
  let es: EventSource | null = null;
  let conn = '';
  let last = 0;
  const post = (url: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  // calls go to the tab you're using
  const active = () => {
    if (!conn || Date.now() - last < 5000) return;
    last = Date.now();
    void post('./api/mcp/active', { conn }).catch(() => {});
  };
  const connect = () => {
    es?.close();
    es = new EventSource('./api/mcp/live');
    es.addEventListener('hello', (e) => {
      conn = JSON.parse((e as MessageEvent).data).conn;
      last = 0;
      if (document.hasFocus()) active();
    });
    es.addEventListener('call', (e) => {
      const c = JSON.parse((e as MessageEvent).data) as {
        id: string;
        name: string;
        args: Record<string, unknown>;
      };
      void runTool(c.name, c.args).then((result) => post('./api/mcp/result', { id: c.id, result }));
    });
  };
  connect();
  window.addEventListener('focus', active);
  window.addEventListener('pointerdown', active, true);
  window.addEventListener('keydown', active, true);
  return () => {
    es?.close();
    window.removeEventListener('focus', active);
    window.removeEventListener('pointerdown', active, true);
    window.removeEventListener('keydown', active, true);
  };
}

export function installMcp(): () => void {
  const d = desktopMcp();
  if (d) return d.onCall((c) => void runTool(c.name, c.args).then((r) => d.result(c.id, r)));
  // server with accounts: listen while someone is signed in
  let off: (() => void) | null = null;
  const sync = () => {
    const s = useStore.getState();
    const want = s.auth.accounts && !!s.user;
    if (want && !off) off = serverStream();
    if (!want && off) {
      off();
      off = null;
    }
  };
  sync();
  const unsub = useStore.subscribe((s, p) => {
    if (s.user !== p.user || s.auth !== p.auth) sync();
  });
  return () => {
    unsub();
    off?.();
  };
}

// ---- server tokens (Settings → Claude)
async function j<T>(method: string, url: string): Promise<T> {
  const r = await fetch(url, { method, cache: 'no-store' });
  const b = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(b.error || `Request failed (${r.status})`);
  return b;
}
export const getServerToken = () =>
  j<{ token: { createdAt: string } | null; tabs: number }>('GET', './api/mcp/token');
export const createServerToken = () => j<{ token: string }>('POST', './api/mcp/token');
export const revokeServerToken = () => j('DELETE', './api/mcp/token');
