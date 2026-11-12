import { contextBridge, ipcRenderer } from 'electron';

// Narrow API: no generic ipcRenderer access is exposed to the page.
contextBridge.exposeInMainWorld('riffroll', {
  platform: process.platform,
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    load: (id: string) => ipcRenderer.invoke('projects:load', id),
    save: (id: string, data: Uint8Array) => ipcRenderer.invoke('projects:save', id, data),
    remove: (id: string) => ipcRenderer.invoke('projects:remove', id),
  },
  dialogs: {
    open: () => ipcRenderer.invoke('dialog:open'),
    save: (suggested: string, data: Uint8Array, ext: string) =>
      ipcRenderer.invoke('dialog:save', suggested, data, ext),
  },
  readPath: (p: string) => ipcRenderer.invoke('file:read-path', p),
  onMenuCommand: (fn: (cmd: string) => void) => {
    const h = (_e: unknown, cmd: string) => fn(cmd);
    ipcRenderer.on('menu:command', h);
    return () => ipcRenderer.removeListener('menu:command', h);
  },
  onOpenPath: (fn: (p: string) => void) => {
    const h = (_e: unknown, p: string) => fn(p);
    ipcRenderer.on('file:open-path', h);
    return () => ipcRenderer.removeListener('file:open-path', h);
  },
});
