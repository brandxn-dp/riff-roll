import { app, BrowserWindow, ipcMain, protocol, net, shell, Menu, dialog } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { loadWindowState, trackWindowState } from './window-state';
import { buildMenu } from './menu';

// Dev: load the Vite dev server. RIFFROLL_USE_BUILD=1 loads the built UI through app:// like a packaged app.
const DEV_URL =
  process.env.RIFFROLL_DEV_URL ??
  (app.isPackaged || process.env.RIFFROLL_USE_BUILD ? null : 'http://localhost:5173');
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

// app:// is a privileged, secure origin, so AudioWorklet, fetch and Cache Storage behave like https.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function uiDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ui')
    : path.resolve(__dirname, '../../../packages/ui/dist');
}
function instrumentsDir(): string {
  if (process.env.RIFFROLL_INSTRUMENTS_DIR) return process.env.RIFFROLL_INSTRUMENTS_DIR;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'instruments')
    : path.resolve(__dirname, '../../../instruments/packs');
}
function projectsDir(): string {
  return path.join(app.getPath('userData'), 'projects');
}

/** Resolve a request path inside `root`, refusing anything that escapes it. */
function inside(root: string, rel: string): string | null {
  const p = path.resolve(root, '.' + path.posix.normalize('/' + decodeURIComponent(rel)));
  return p.startsWith(path.resolve(root)) ? p : null;
}

function registerAppProtocol() {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    let file: string | null;
    if (url.pathname.startsWith('/instruments/')) {
      file = inside(instrumentsDir(), url.pathname.slice('/instruments/'.length));
    } else {
      file = inside(uiDir(), url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      if (file && !existsSync(file)) file = path.join(uiDir(), 'index.html');
    }
    if (!file) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function registerIpc() {
  const file = (id: string) => {
    if (!ID_RE.test(id)) throw new Error('bad project id');
    return path.join(projectsDir(), `${id}.riff`);
  };
  ipcMain.handle('projects:list', async () => {
    await mkdir(projectsDir(), { recursive: true });
    const out = [];
    for (const f of (await readdir(projectsDir())).filter((x) => x.endsWith('.riff'))) {
      const s = await stat(path.join(projectsDir(), f));
      out.push({ id: f.slice(0, -5), updatedAt: s.mtime.toISOString(), size: s.size });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  ipcMain.handle('projects:load', async (_e, id: string) => new Uint8Array(await readFile(file(id))));
  ipcMain.handle('projects:save', async (_e, id: string, data: Uint8Array) => {
    await mkdir(projectsDir(), { recursive: true });
    const tmp = file(id) + '.tmp';
    await writeFile(tmp, data);
    await rename(tmp, file(id));
  });
  ipcMain.handle('projects:remove', async (_e, id: string) => rm(file(id), { force: true }));
  ipcMain.handle('dialog:open', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Riff Roll / Guitar Pro / MIDI / MusicXML', extensions: ['riff', 'gp', 'gp3', 'gp4', 'gp5', 'gpx', 'mid', 'midi', 'musicxml', 'xml'] },
      ],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    app.addRecentDocument(r.filePaths[0]);
    return { path: r.filePaths[0], name: path.basename(r.filePaths[0]), data: new Uint8Array(await readFile(r.filePaths[0])) };
  });
  ipcMain.handle('dialog:save', async (e, suggested: string, data: Uint8Array, ext: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showSaveDialog(win, { defaultPath: suggested, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, data);
    app.addRecentDocument(r.filePath);
    return r.filePath;
  });
}

async function createWindow(fileToOpen?: string) {
  const state = await loadWindowState();
  const win = new BrowserWindow({
    ...state.bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121419',
    title: 'Riff Roll',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (state.maximized) win.maximize();
  trackWindowState(win);
  win.once('ready-to-show', () => win.show());
  // external links open in the system browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  await win.loadURL(DEV_URL ?? 'app://riffroll/');
  if (fileToOpen) win.webContents.send('file:open-path', fileToOpen);
  if (process.env.RIFFROLL_SMOKE) {
    // CI / dev smoke test: report what the renderer sees, then quit
    setTimeout(async () => {
      const report = await win.webContents.executeJavaScript(
        `JSON.stringify({ title: document.title, text: document.body.innerText.slice(0, 200), bridge: !!window.riffroll, ctx: typeof AudioContext, secure: isSecureContext })`,
      );
      console.log('SMOKE ' + report);
      app.exit(0);
    }, Number(process.env.RIFFROLL_SMOKE) > 1 ? Number(process.env.RIFFROLL_SMOKE) : 3000);
  }
  return win;
}

const fileArg = process.argv.find((a) => a.endsWith('.riff'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    const f = argv.find((a) => a.endsWith('.riff'));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('file:open-path', f);
    }
  });
  app.on('open-file', (e, f) => {
    e.preventDefault();
    BrowserWindow.getAllWindows()[0]?.webContents.send('file:open-path', f);
  });
  app.whenReady().then(async () => {
    registerAppProtocol();
    registerIpc();
    ipcMain.handle('file:read-path', async (_e, p: string) => {
      if (!p.endsWith('.riff')) throw new Error('only .riff files');
      return { path: p, name: path.basename(p), data: new Uint8Array(await readFile(p)) };
    });
    Menu.setApplicationMenu(buildMenu());
    await createWindow(fileArg);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
