import { useEffect, useState } from 'react';
import { useStore } from '../store';
import {
  createServerToken,
  desktopMcp,
  getServerToken,
  revokeServerToken,
  serverMcpUrl,
  type McpState,
} from '../mcp/connect';

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? 'Copied' : label}
    </button>
  );
}

function Snippet({ title, text }: { title: string; text: string }) {
  return (
    <div className="mcp-snippet">
      <div className="mcp-snippet-head">
        <span>{title}</span>
        <Copy text={text} />
      </div>
      <pre>{text}</pre>
    </div>
  );
}

/** How to point Claude Code and Claude Desktop at an MCP address with a token. */
function HowTo({ url, token }: { url: string; token: string }) {
  const plainHttp = url.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url);
  const code = `claude mcp add --transport http riff-roll ${url} --header "Authorization: Bearer ${token}"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        'riff-roll': {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            url,
            ...(plainHttp ? ['--allow-http'] : []),
            '--header',
            'Authorization:${RIFFROLL_AUTH}',
          ],
          env: { RIFFROLL_AUTH: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  return (
    <>
      <h3 className="set-h">Connect Claude</h3>
      <Snippet title="Claude Code: run this once in a terminal" text={code} />
      <Snippet
        title="Claude Desktop: add to claude_desktop_config.json (Settings → Developer → Edit Config), then restart Claude"
        text={desktop}
      />
      <p className="mute small">
        Then ask Claude things like “write a palm-muted chug riff in drop D for bars 1–4 on Guitar 1”, “add a
        basic rock beat to the drums”, or “transpose the chorus up a whole step”. Every change shows up here
        right away and Ctrl+Z undoes it. Claude Desktop needs Node.js installed for the npx command.
      </p>
    </>
  );
}

function Desktop() {
  const bridge = desktopMcp()!;
  const [s, setS] = useState<McpState | null>(null);
  const [show, setShow] = useState(false);
  const [port, setPort] = useState('');
  useEffect(() => {
    void bridge.state().then((x) => {
      setS(x);
      setPort(String(x.port));
    });
  }, [bridge]);
  if (!s) return <p className="mute">Loading…</p>;
  const masked = show ? s.token : s.token.slice(0, 6) + '•'.repeat(18);
  return (
    <>
      <div className="set-row">
        <div className="set-label">
          <span>Let Claude use Riff Roll</span>
          <small className="mute">
            Turns on an MCP endpoint that only this computer can reach. Claude can then read and edit the open
            song.
          </small>
        </div>
        <div className="set-ctl">
          <label className="check">
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => void bridge.set({ enabled: e.target.checked }).then(setS)}
            />
            On
          </label>
          <span className={'mcp-dot' + (s.running ? ' on' : '')} />
          <span className="small">{s.running ? 'Listening' : s.enabled ? 'Not running' : 'Off'}</span>
        </div>
      </div>
      {s.error && (
        <p className="auth-error" role="alert">
          {s.error}
        </p>
      )}
      <div className="set-row">
        <div className="set-label">
          <span>Port</span>
          <small className="mute">Change it if another program uses {s.port}.</small>
        </div>
        <div className="set-ctl">
          <input
            className="mcp-port"
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onBlur={() => Number(port) !== s.port && void bridge.set({ port: Number(port) }).then(setS)}
          />
          <code className="mcp-url">{s.url}</code>
          <Copy text={s.url} />
        </div>
      </div>
      <div className="set-row">
        <div className="set-label">
          <span>Token</span>
          <small className="mute">Claude sends this with every request. A new one disconnects the old.</small>
        </div>
        <div className="set-ctl">
          <code className="mcp-url">{masked}</code>
          <button className="btn small" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'}
          </button>
          <Copy text={s.token} />
          <button
            className="btn small"
            onClick={() =>
              confirm('Make a new token? Claude stops working until you give it the new one.') &&
              void bridge.regenerate().then(setS)
            }
          >
            New token
          </button>
        </div>
      </div>
      {s.enabled && <HowTo url={s.url} token={s.token} />}
    </>
  );
}

function Server() {
  const [info, setInfo] = useState<{ token: { createdAt: string } | null; tabs: number } | null>(null);
  const [fresh, setFresh] = useState('');
  const [error, setError] = useState('');
  const refresh = () =>
    getServerToken()
      .then(setInfo)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void refresh();
  }, []);
  const url = serverMcpUrl();
  if (error)
    return (
      <p className="auth-error" role="alert">
        {error} (this needs Riff Roll 0.3.4 or newer on the server)
      </p>
    );
  if (!info) return <p className="mute">Loading…</p>;
  return (
    <>
      <p className="set-status">
        Claude works on the song open in your most recently used Riff Roll tab, so keep one open while you use
        it.
        {info.tabs ? ` Tabs listening now: ${info.tabs}.` : ''}
      </p>
      <div className="set-row">
        <div className="set-label">
          <span>Address</span>
          <small className="mute">Claude connects here.</small>
        </div>
        <div className="set-ctl">
          <code className="mcp-url">{url}</code>
          <Copy text={url} />
        </div>
      </div>
      <div className="set-row">
        <div className="set-label">
          <span>Your token</span>
          <small className="mute">
            Lets Claude act as you on this server. It’s shown once; a new one replaces the old.
          </small>
        </div>
        <div className="set-ctl">
          {info.token ? (
            <span className="small">Made {new Date(info.token.createdAt).toLocaleString()}</span>
          ) : (
            <span className="small mute">None yet</span>
          )}
          <button
            className="btn small"
            onClick={() =>
              (!info.token || confirm('Make a new token? The old one stops working.')) &&
              void createServerToken()
                .then((r) => {
                  setFresh(r.token);
                  return refresh();
                })
                .catch((e) => setError((e as Error).message))
            }
          >
            {info.token ? 'New token' : 'Make a token'}
          </button>
          {info.token && (
            <button
              className="btn small"
              onClick={() =>
                void revokeServerToken()
                  .then(() => {
                    setFresh('');
                    return refresh();
                  })
                  .catch((e) => setError((e as Error).message))
              }
            >
              Turn off
            </button>
          )}
        </div>
      </div>
      {fresh ? (
        <>
          <p className="set-status">Copy it now: it won’t be shown again.</p>
          <HowTo url={url} token={fresh} />
        </>
      ) : (
        info.token && (
          <p className="mute small">Lost the token? Make a new one and update Claude’s settings with it.</p>
        )
      )}
      {url.startsWith('http://') && (
        <p className="mute small">
          This server is on plain http, so the token travels unencrypted on your network. The claude.ai
          website (custom connectors) can only reach servers on public https addresses; Claude Code and Claude
          Desktop work on your network.
        </p>
      )}
    </>
  );
}

/** Settings → Claude: connect Claude (Code or Desktop) to Riff Roll over MCP. */
export function ClaudeSettings() {
  const accounts = useStore((s) => s.auth.accounts);
  const user = useStore((s) => s.user);
  if (desktopMcp()) return <Desktop />;
  if (accounts && user) return <Server />;
  return (
    <p className="set-status">
      Connecting Claude works in the desktop app, and on a Riff Roll server with accounts (Docker / Unraid).
      This browser-only copy keeps your songs inside the browser, where Claude can’t reach them.
    </p>
  );
}
