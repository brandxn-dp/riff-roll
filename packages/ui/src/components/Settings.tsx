import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { NOTE_LENS, SNAPS, currentTrack, useStore } from '../store';
import { useSettings, type AccentId, type Latency, type ThemeId } from '../settings';
import { ACCENTS, THEMES } from '../theme';
import { ACTIONS, bindingsOf, comboOf, conflicts, niceCombo } from '../keymap';
import { setLayoutPref } from '../device';
import { ensureEngine, getEngine, restartAudio, setOutputDevice } from '../audio-setup';
import { testPreview } from '../audio-bridge';
import { adminStats, setServerSignup, signOut, signOutEverywhere, type AdminStats } from '../account';
import { openProjectFolder } from '../files/actions';

type Tab = 'general' | 'editor' | 'appearance' | 'audio' | 'shortcuts' | 'account' | 'server';

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <small className="mute">{hint}</small>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const fmtBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MB`
        : `${(n / 1024 ** 3).toFixed(2)} GB`;
const fmtUptime = (s: number) =>
  s < 3600
    ? `${Math.floor(s / 60)} min`
    : s < 86400
      ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
      : `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;

// ---------------------------------------------------------------- general
function General() {
  const s = useSettings();
  const layoutPref = useStore((st) => st.layoutPref);
  const bridge = window.riffroll;
  const [upd, setUpd] = useState<{ supported: boolean; auto: boolean } | null>(null);
  useEffect(() => {
    void bridge?.updates?.state().then(setUpd);
  }, [bridge]);
  return (
    <>
      <Row label="Layout" hint="Phone layout has big touch controls for small screens.">
        <select
          value={layoutPref}
          onChange={(e) => setLayoutPref(e.target.value as 'auto' | 'mobile' | 'desktop')}
        >
          <option value="auto">Automatic</option>
          <option value="desktop">Desktop</option>
          <option value="mobile">Phone</option>
        </select>
      </Row>
      <Row
        label="Interface size"
        hint={
          bridge?.setZoom ? 'Also Ctrl + / Ctrl − / Ctrl 0.' : 'Use your browser’s zoom: Ctrl + / Ctrl −.'
        }
      >
        <select
          value={s.uiScale}
          disabled={!bridge?.setZoom}
          onChange={(e) => s.update({ uiScale: Number(e.target.value) })}
        >
          {[80, 90, 100, 110, 125, 150].map((v) => (
            <option key={v} value={v}>
              {v} %
            </option>
          ))}
        </select>
      </Row>
      <Row label="Playback">
        <Check
          checked={s.followPlayhead}
          onChange={(v) => s.update({ followPlayhead: v })}
          label="Scroll to follow the playhead"
        />
      </Row>
      {upd?.supported && (
        <Row label="Updates">
          <Check
            checked={upd.auto}
            onChange={(v) => {
              setUpd({ ...upd, auto: v });
              void bridge?.updates?.setAuto(v);
            }}
            label="Check for updates automatically"
          />
          <button className="btn" onClick={() => void bridge?.updates?.check()}>
            Check now
          </button>
        </Row>
      )}
      {bridge && (
        <Row label="Your songs" hint="Where the desktop app keeps them.">
          <button className="btn" onClick={() => void openProjectFolder()}>
            Open project folder
          </button>
        </Row>
      )}
      <Row label="Reset" hint="Theme, audio, editor and shortcuts go back to how they started.">
        <button
          className="btn"
          onClick={() =>
            confirm('Reset every setting on this device?') && useSettings.getState().reset('all')
          }
        >
          Reset all settings
        </button>
      </Row>
      <p className="mute small">Settings are kept on this device and browser.</p>
    </>
  );
}

// ---------------------------------------------------------------- editor
function Editor() {
  const s = useSettings();
  const lanes = useStore((st) => st.lanes);
  return (
    <>
      <Row label="Sound while editing">
        <Check
          checked={s.previewNotes}
          onChange={(v) => s.update({ previewNotes: v })}
          label="Play notes as you place, pick or move them"
        />
      </Row>
      <Row label="Starting grid" hint="Snap and note length when the app opens.">
        <select
          aria-label="Starting snap"
          value={s.defaultSnap}
          onChange={(e) => {
            s.update({ defaultSnap: Number(e.target.value) });
            useStore.getState().set({ snap: Number(e.target.value) });
          }}
        >
          {SNAPS.map((x) => (
            <option key={x.label} value={x.ticks}>
              Snap {x.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Starting note length"
          value={s.defaultNoteLen}
          onChange={(e) => {
            s.update({ defaultNoteLen: Number(e.target.value) });
            useStore.getState().set({ noteLen: Number(e.target.value) });
          }}
        >
          {NOTE_LENS.map((x) => (
            <option key={x.label} value={x.ticks}>
              Notes {x.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Start with">
        <div className="set-col">
          <Check
            checked={s.snapScale}
            onChange={(v) => {
              s.update({ snapScale: v });
              useStore.getState().set({ snapScale: v });
            }}
            label="Snap to scale on"
          />
          <Check
            checked={s.globalView}
            onChange={(v) => s.update({ globalView: v })}
            label="Global view open"
          />
          <Check checked={s.palette} onChange={(v) => s.update({ palette: v })} label="Edit palette open" />
        </div>
      </Row>
      <Row label="Lanes under the piano roll" hint="Also in the Lanes menu next to them.">
        <div className="set-col">
          <Check
            checked={lanes.vel}
            onChange={(v) => useStore.getState().setLanes({ vel: v })}
            label="Velocity lane"
          />
          <Check
            checked={lanes.pedal}
            onChange={(v) => useStore.getState().setLanes({ pedal: v })}
            label="Pedal lane"
          />
        </div>
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- appearance
function Appearance() {
  const s = useSettings();
  const themes: [ThemeId, string][] = [
    ['system', 'Match my system'],
    ...(Object.entries(THEMES).map(([id, t]) => [id, t.label]) as [ThemeId, string][]),
  ];
  return (
    <>
      <h3 className="set-h">Theme</h3>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {themes.map(([id, label]) => {
          const p = id === 'system' ? null : THEMES[id];
          return (
            <button
              key={id}
              role="radio"
              aria-checked={s.theme === id}
              className="theme-card"
              onClick={() => s.update({ theme: id })}
            >
              <span
                className="theme-swatch"
                style={
                  p
                    ? { background: p.bg, borderColor: p.line }
                    : {
                        background: `linear-gradient(135deg, ${THEMES.studio.bg} 50%, ${THEMES.light.bg} 50%)`,
                      }
                }
              >
                {p && (
                  <>
                    <i style={{ background: p.panel }} />
                    <i style={{ background: p.ink, width: '40%' }} />
                    <i style={{ background: ACCENTS[s.accent].color, width: '25%' }} />
                  </>
                )}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <h3 className="set-h">Accent colour</h3>
      <div className="accent-row" role="radiogroup" aria-label="Accent colour">
        {(Object.entries(ACCENTS) as [AccentId, { label: string; color: string }][]).map(([id, a]) => (
          <button
            key={id}
            role="radio"
            aria-checked={s.accent === id}
            aria-label={a.label}
            title={a.label}
            className="accent-dot"
            style={{ background: a.color }}
            onClick={() => s.update({ accent: id })}
          />
        ))}
      </div>
      <Row label="Notation" hint="The score view and printing.">
        <select
          value={s.notationPaper}
          onChange={(e) => s.update({ notationPaper: e.target.value as 'theme' | 'light' })}
        >
          <option value="theme">Follow the theme</option>
          <option value="light">Always black on white</option>
        </select>
      </Row>
      <p className="mute small">
        Track and string colours are part of the song, so they stay the same in every theme.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- audio
interface Device {
  id: string;
  label: string;
}
function Audio() {
  const s = useSettings();
  const [devices, setDevices] = useState<Device[]>([]);
  const [named, setNamed] = useState(true);
  const [info, setInfo] = useState(getEngine()?.info ?? null);
  const [msg, setMsg] = useState('');
  const canPick = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

  const list = async () => {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices();
      const outs = (all ?? []).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
      setNamed(outs.every((d) => d.label));
      setDevices(outs.map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` })));
    } catch {
      setDevices([]);
    }
  };
  useEffect(() => {
    void list();
    const t = setInterval(() => setInfo(getEngine()?.info ?? null), 1000);
    navigator.mediaDevices?.addEventListener?.('devicechange', list);
    return () => {
      clearInterval(t);
      navigator.mediaDevices?.removeEventListener?.('devicechange', list);
    };
  }, []);

  const restart = async (note = 'Audio restarted.') => {
    setMsg('Restarting audio…');
    try {
      const e = await restartAudio();
      setInfo(e.info);
      setMsg(note);
    } catch (err) {
      setMsg(`Couldn’t start audio: ${(err as Error).message}`);
    }
  };
  const test = async () => {
    await (await ensureEngine()).resume();
    const t = currentTrack(useStore.getState());
    if (t) testPreview(t, t.type === 'drums' ? 38 : 60);
  };

  return (
    <>
      <p className="set-status">
        {info
          ? `Running at ${(info.sampleRate / 1000).toFixed(1)} kHz · about ${info.latencyMs} ms output latency · ${info.state}`
          : 'Audio starts the first time you click or press a key.'}
      </p>
      <Row
        label="Output device"
        hint={
          canPick
            ? 'Where Riff Roll plays. Changes right away.'
            : 'This browser always uses the system default output (Chrome, Edge and the desktop app can choose).'
        }
      >
        <select
          value={s.audio.sinkId}
          disabled={!canPick}
          onChange={(e) =>
            void setOutputDevice(e.target.value)
              .then(() => setMsg('Output changed.'))
              .catch((err) => setMsg(`Couldn’t use that device: ${(err as Error).message}`))
          }
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        {canPick && !named && (
          <button
            className="btn"
            title="The browser only shows device names after you allow audio input once"
            onClick={async () => {
              try {
                const m = await navigator.mediaDevices.getUserMedia({ audio: true });
                m.getTracks().forEach((t) => t.stop());
              } catch {
                /* declined: keep the numbered names */
              }
              await list();
            }}
          >
            Show names
          </button>
        )}
      </Row>
      <Row label="Latency" hint="Lower is snappier; raise it if you hear clicks or dropouts.">
        <select
          value={s.audio.latency}
          onChange={(e) => {
            s.updateAudio({ latency: e.target.value as Latency });
            void restart('Latency changed.');
          }}
        >
          <option value="interactive">Lowest</option>
          <option value="balanced">Balanced</option>
          <option value="playback">Safest (fewest dropouts)</option>
        </select>
      </Row>
      <Row label="Sample rate" hint="Leave on the device’s rate unless your interface needs another.">
        <select
          value={s.audio.sampleRate}
          onChange={(e) => {
            s.updateAudio({ sampleRate: Number(e.target.value) });
            void restart('Sample rate changed.');
          }}
        >
          <option value={0}>Device default</option>
          {[44100, 48000, 88200, 96000].map((r) => (
            <option key={r} value={r}>
              {(r / 1000).toFixed(1)} kHz
            </option>
          ))}
        </select>
      </Row>
      <Row label="Check">
        <button className="btn" onClick={() => void test()}>
          Play a test note
        </button>
        <button className="btn" onClick={() => void restart()}>
          Restart audio
        </button>
      </Row>
      {msg && (
        <p className="set-status" role="status">
          {msg}
        </p>
      )}
      <div className="set-note">
        <b>About audio drivers.</b> Riff Roll plays through your system’s audio: WASAPI on Windows, Core Audio
        on macOS, PulseAudio or PipeWire on Linux. ASIO drivers can’t be used by web audio (Chromium, and so
        the desktop app, has no ASIO support). For the lowest latency on Windows, pick your audio interface
        here, set Latency to Lowest, and use a small buffer in the interface’s own control panel. MIDI
        keyboards are set up from the MIDI button in the toolbar.
      </div>
    </>
  );
}

// ---------------------------------------------------------------- shortcuts
function Shortcuts() {
  const keys = useSettings((s) => s.keys);
  const [capture, setCapture] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') return setCapture(null);
      const combo = comboOf(e);
      if (!combo) return; // a lone modifier: wait for the key
      const s = useSettings.getState();
      const next = { ...s.keys };
      const taken = conflicts(combo, capture);
      for (const a of taken) next[a.id] = bindingsOf(a.id).filter((c) => c !== combo);
      const mine = bindingsOf(capture);
      next[capture] = mine.includes(combo) ? mine : [...mine, combo];
      s.update({ keys: next });
      setNote(
        taken.length
          ? `${niceCombo(combo)} was used by “${taken.map((a) => a.label).join('”, “')}”. Moved it.`
          : '',
      );
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ACTIONS.filter(
      (a) =>
        !q ||
        a.label.toLowerCase().includes(q) ||
        a.group.toLowerCase().includes(q) ||
        bindingsOf(a.id).some((c) => niceCombo(c).toLowerCase().includes(q)),
    );
    // keys: re-filter when bindings change
  }, [query, keys]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = [...new Set(shown.map((a) => a.group))];
  const set = (id: string, combos: string[] | undefined) => {
    const next = { ...useSettings.getState().keys };
    if (combos) next[id] = combos;
    else delete next[id];
    useSettings.getState().update({ keys: next });
  };

  return (
    <>
      <div className="set-keys-head">
        <input
          className="search"
          type="search"
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="btn"
          disabled={!Object.keys(keys).length}
          onClick={() => {
            useSettings.getState().reset('keys');
            setNote('Every shortcut is back to its default.');
          }}
        >
          Reset all
        </button>
      </div>
      {note && (
        <p className="set-status" role="status">
          {note}
        </p>
      )}
      {groups.map((g) => (
        <section key={g} className="set-keys">
          <h3 className="set-h">{g}</h3>
          {shown
            .filter((a) => a.group === g)
            .map((a) => {
              const b = bindingsOf(a.id);
              const custom = a.id in keys;
              return (
                <div key={a.id} className="set-key">
                  <span className="set-key-label">
                    {a.label}
                    {custom && <span className="badge">changed</span>}
                  </span>
                  <span className="set-key-binds">
                    {b.map((c) => (
                      <span key={c} className="key-chip">
                        <kbd>{niceCombo(c)}</kbd>
                        <button
                          aria-label={`Remove ${niceCombo(c)} from ${a.label}`}
                          onClick={() =>
                            set(
                              a.id,
                              b.filter((x) => x !== c),
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {!b.length && <span className="mute small">none</span>}
                    <button
                      className={'btn small' + (capture === a.id ? ' capturing' : '')}
                      onClick={() => setCapture(capture === a.id ? null : a.id)}
                    >
                      {capture === a.id ? 'Press keys… (Esc cancels)' : '＋ Add'}
                    </button>
                    {custom && (
                      <button className="btn small ghost" onClick={() => set(a.id, undefined)}>
                        Default
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
        </section>
      ))}
      <p className="mute small">
        Mouse actions, tab entry (frets, techniques) and the global view’s bar keys are fixed; see the cheat
        sheet (?).
      </p>
    </>
  );
}

// ---------------------------------------------------------------- account
function Account() {
  const user = useStore((s) => s.user);
  const st = useStore.getState();
  if (!user) return <p className="mute">Not signed in.</p>;
  return (
    <>
      <Row label="Signed in as" hint={`@${user.username}${user.admin ? ' · admin' : ''}`}>
        <b>{user.displayName}</b>
      </Row>
      <Row label="Profile" hint="Your name, password.">
        <button className="btn" onClick={() => st.set({ modal: 'account' })}>
          Account…
        </button>
      </Row>
      {user.admin && (
        <Row label="People on this server">
          <button className="btn" onClick={() => st.set({ modal: 'users' })}>
            Manage users…
          </button>
        </Row>
      )}
      <Row label="Session">
        <button className="btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- server (admins)
function Server() {
  const me = useStore((s) => s.user);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const refresh = () =>
    adminStats()
      .then((s) => {
        setStats(s);
        setError('');
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void refresh();
  }, []);
  if (error)
    return (
      <p className="auth-error" role="alert">
        {error}
      </p>
    );
  if (!stats) return <p className="mute">Loading…</p>;
  const tiles: [string, string][] = [
    ['Version', stats.version],
    ['Up for', fmtUptime(stats.uptime)],
    ['Users', `${stats.users} (${stats.admins} admin${stats.admins === 1 ? '' : 's'})`],
    ['Songs', String(stats.songs)],
    ['Song storage', fmtBytes(stats.bytes)],
    ['Signed-in sessions', String(stats.sessions)],
    ['Instruments', String(stats.instruments)],
    ['Memory', fmtBytes(stats.memory)],
    ['Runs on', `Node ${stats.node} · ${stats.platform}`],
  ];
  return (
    <>
      <div className="stat-grid">
        {tiles.map(([k, v]) => (
          <div key={k} className="stat" title={`${k}: ${v}`}>
            <span className="mute small">{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <Row
        label="Sign-up"
        hint={`Without this, only admins add people. Starts as RIFFROLL_SIGNUP says (${stats.signupFromEnv ? 'open' : 'closed'}); this switch is saved on the server.`}
      >
        <Check
          checked={stats.signup}
          onChange={(v) =>
            void setServerSignup(v)
              .then((r) => {
                setStats({ ...stats, signup: r.signup });
                useStore.getState().set({ auth: { ...useStore.getState().auth, signup: r.signup } });
              })
              .catch((e) => setError((e as Error).message))
          }
          label="Anyone can create an account from the sign-in screen"
        />
      </Row>
      {stats.basicAuth && (
        <p className="mute small">HTTP basic auth (RIFFROLL_BASIC_AUTH) also guards this server.</p>
      )}
      <div className="set-keys-head">
        <h3 className="set-h">People</h3>
        <span className="spacer" />
        <button className="btn" onClick={() => void refresh()}>
          Refresh
        </button>
        <button className="btn" onClick={() => useStore.getState().set({ modal: 'users' })}>
          Add / edit users…
        </button>
      </div>
      {note && (
        <p className="set-status" role="status">
          {note}
        </p>
      )}
      <div className="admin-table" role="table" aria-label="Users">
        <div role="row" className="admin-tr head">
          <span role="columnheader">Name</span>
          <span role="columnheader">Songs</span>
          <span role="columnheader">Storage</span>
          <span role="columnheader">Sessions</span>
          <span role="columnheader" />
        </div>
        {stats.perUser.map((u) => (
          <div role="row" className="admin-tr" key={u.id}>
            <span role="cell">
              {u.displayName} <span className="mute small">@{u.username}</span>
              {u.admin && <span className="badge">admin</span>}
            </span>
            <span role="cell">
              {u.songs}
              {u.shared ? <span className="mute small"> ({u.shared} shared)</span> : null}
            </span>
            <span role="cell">{fmtBytes(u.bytes)}</span>
            <span role="cell">{u.sessions}</span>
            <span role="cell">
              {u.id !== me?.id && u.sessions > 0 && (
                <button
                  className="btn small"
                  onClick={() =>
                    void signOutEverywhere(u.id)
                      .then((r) => {
                        setNote(
                          `Signed ${u.displayName} out of ${r.ended} session${r.ended === 1 ? '' : 's'}.`,
                        );
                        return refresh();
                      })
                      .catch((e) => setError((e as Error).message))
                  }
                >
                  Sign out
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- window
export function Settings() {
  const tab = useStore((s) => s.settingsTab) as Tab;
  const accounts = useStore((s) => s.auth.accounts);
  const user = useStore((s) => s.user);
  const tabs: [Tab, string][] = [
    ['general', 'General'],
    ['editor', 'Editor'],
    ['appearance', 'Appearance'],
    ['audio', 'Audio'],
    ['shortcuts', 'Shortcuts'],
    ...(accounts && user ? ([['account', 'Account']] as [Tab, string][]) : []),
    ...(accounts && user?.admin ? ([['server', 'Server admin']] as [Tab, string][]) : []),
  ];
  const cur = tabs.some(([t]) => t === tab) ? tab : 'general';
  const go = (t: Tab) => useStore.getState().set({ settingsTab: t });
  return (
    <Modal title="Settings" wide>
      <div className="settings">
        <nav className="set-tabs" role="tablist" aria-label="Settings pages">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={cur === t} onClick={() => go(t)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="set-page" role="tabpanel" aria-label={tabs.find(([t]) => t === cur)?.[1]}>
          {cur === 'general' && <General />}
          {cur === 'editor' && <Editor />}
          {cur === 'appearance' && <Appearance />}
          {cur === 'audio' && <Audio />}
          {cur === 'shortcuts' && <Shortcuts />}
          {cur === 'account' && <Account />}
          {cur === 'server' && <Server />}
        </div>
      </div>
    </Modal>
  );
}
