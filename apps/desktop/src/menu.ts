import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { autoCheckEnabled, checkForUpdatesNow, setAutoCheck, updatesSupported } from './updater';

export interface RecentSong {
  id: string;
  title: string;
}

/** Native menu. Items forward a command string to the renderer, which owns all app logic. */
export function buildMenu(recent: RecentSong[] = []): Menu {
  const send = (cmd: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', cmd);
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Song', accelerator: 'CmdOrCtrl+N', click: send('file:new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('file:open') },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? [
                ...recent.map((r, i) => ({
                  label: `${i < 9 ? `&${i + 1} ` : ''}${r.title.replace(/&/g, '&&') || 'Untitled'}`,
                  click: send(`project:open:${r.id}`),
                })),
                { type: 'separator' as const },
                { label: 'Clear Recently Opened', click: send('recent:clear') },
              ]
            : [{ label: 'No recent songs', enabled: false }],
        },
        { label: 'All Songs', click: send('file:home') },
        { label: 'Open Project Folder', click: send('file:open-folder') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('file:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('file:save-as') },
        { type: 'separator' },
        { label: 'Export WAV…', click: send('export:wav') },
        { label: 'Export MIDI…', click: send('export:midi') },
        { label: 'Export MusicXML…', click: send('export:musicxml') },
        { label: 'Print Tab…', accelerator: 'CmdOrCtrl+P', click: send('export:print') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('edit:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('edit:redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'Shift+/', click: send('help:shortcuts') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }, { role: 'reload' as const }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', click: () => void checkForUpdatesNow() },
        ...(updatesSupported()
          ? [
              {
                label: 'Check for Updates Automatically',
                type: 'checkbox' as const,
                checked: autoCheckEnabled(),
                click: (item: Electron.MenuItem) => setAutoCheck(item.checked),
              },
            ]
          : []),
        { type: 'separator' },
        { label: 'About / Credits', click: send('help:about') },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
