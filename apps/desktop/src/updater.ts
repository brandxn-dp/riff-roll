/**
 * Updates from GitHub releases (electron-updater): the installed Windows app (and the Linux AppImage) checks on
 * start and every few hours, downloads in the background, and offers to restart when the update is ready.
 * Help → Check for Updates… checks on demand. The macOS build is unsigned, and macOS only installs signed updates,
 * so there it just points to the releases page.
 */
import { BrowserWindow, app, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RELEASES = 'https://github.com/brandxn-dp/riff-roll/releases/latest';
const settingsFile = () => path.join(app.getPath('userData'), 'updates.json');

export function updatesSupported(): boolean {
  return (
    app.isPackaged &&
    (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE))
  );
}

export function autoCheckEnabled(): boolean {
  try {
    if (existsSync(settingsFile())) return JSON.parse(readFileSync(settingsFile(), 'utf8')).auto !== false;
  } catch {
    /* default */
  }
  return true;
}

export function setAutoCheck(on: boolean) {
  try {
    writeFileSync(settingsFile(), JSON.stringify({ auto: on }));
  } catch {
    /* not remembered */
  }
  if (on) void check(false);
}

const win = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
let manual = false;
let busy = false;
let readyVersion: string | null = null;

async function check(isManual: boolean) {
  if (busy) {
    if (isManual)
      void dialog.showMessageBox({
        type: 'info',
        message: 'Already checking for updates or downloading one.',
      });
    return;
  }
  manual = isManual;
  busy = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    busy = false;
    if (isManual)
      void dialog
        .showMessageBox({
          type: 'warning',
          message: 'Couldn’t check for updates.',
          detail: `${(e as Error).message}\n\nYou can always download the latest version from GitHub.`,
          buttons: ['OK', 'Open the download page'],
        })
        .then((r) => {
          if (r.response === 1) void shell.openExternal(RELEASES);
        });
  }
}

/** Ask to restart now; "Later" installs it when the app quits. */
async function promptRestart(version: string) {
  const w = win();
  const opts = {
    type: 'info' as const,
    message: `Riff Roll ${version} is ready to install.`,
    detail: 'Restart now to update (your song is saved first), or it installs the next time you quit.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  };
  const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
  if (r.response !== 0) return;
  // save the open song before the app closes (autosave may still be waiting)
  for (const bw of BrowserWindow.getAllWindows()) bw.webContents.send('menu:command', 'file:save');
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 900);
}

export function initUpdater() {
  if (!updatesSupported()) return;
  // test hook: RIFFROLL_UPDATE_LOG=<file> logs every step, checks now, downloads, then exits without installing
  const log = process.env.RIFFROLL_UPDATE_LOG;
  if (log) {
    const w = (m: string) =>
      appendFileSync(
        log,
        `${new Date().toISOString()} ${m}
`,
      );
    w(`current ${app.getVersion()}`);
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('update-available', (i) => w(`available ${i.version}`));
    autoUpdater.on('update-not-available', (i) => w(`not-available ${i.version}`));
    autoUpdater.on('download-progress', (p) => w(`progress ${Math.round(p.percent)}%`));
    autoUpdater.on('update-downloaded', (i) => {
      w(`downloaded ${i.version} ${i.downloadedFile}`);
      app.exit(0);
    });
    autoUpdater.on('error', (e) => {
      w(`error ${e?.message ?? e}`);
      app.exit(1);
    });
    autoUpdater.autoDownload = true;
    void autoUpdater.checkForUpdates();
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    if (manual)
      void dialog.showMessageBox({
        type: 'info',
        message: `Riff Roll ${info.version} is available.`,
        detail: 'It’s downloading in the background; you’ll be asked to restart when it’s ready.',
      });
  });
  autoUpdater.on('update-not-available', () => {
    busy = false;
    if (manual)
      void dialog.showMessageBox({
        type: 'info',
        message: 'Riff Roll is up to date.',
        detail: `You have the latest version (${app.getVersion()}).`,
      });
  });
  autoUpdater.on('download-progress', (p) => win()?.setProgressBar(p.percent / 100));
  autoUpdater.on('update-downloaded', (info) => {
    busy = false;
    win()?.setProgressBar(-1);
    readyVersion = info.version;
    void promptRestart(info.version);
  });
  autoUpdater.on('error', (e) => {
    busy = false;
    win()?.setProgressBar(-1);
    if (manual)
      void dialog
        .showMessageBox({
          type: 'warning',
          message: 'The update didn’t work.',
          detail: `${e?.message ?? e}\n\nYou can download the latest version from GitHub instead.`,
          buttons: ['OK', 'Open the download page'],
        })
        .then((r) => {
          if (r.response === 1) void shell.openExternal(RELEASES);
        });
  });
  if (autoCheckEnabled()) {
    setTimeout(() => void check(false), 8_000);
    setInterval(() => autoCheckEnabled() && void check(false), 6 * 60 * 60 * 1000);
  }
}

/** Help → Check for Updates… */
export async function checkForUpdatesNow() {
  if (readyVersion) return promptRestart(readyVersion);
  if (!updatesSupported()) {
    const r = await dialog.showMessageBox({
      type: 'info',
      message: app.isPackaged
        ? 'Automatic updates aren’t available for this version of Riff Roll.'
        : 'Updates are checked in the installed app, not in development.',
      detail:
        process.platform === 'darwin'
          ? 'macOS only installs signed updates. Download the latest version from GitHub.'
          : `You have version ${app.getVersion()}. The latest version is on GitHub.`,
      buttons: ['OK', 'Open the download page'],
    });
    if (r.response === 1) void shell.openExternal(RELEASES);
    return;
  }
  return check(true);
}
