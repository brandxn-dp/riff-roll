import { app, screen, type BrowserWindow } from 'electron';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

interface WindowState {
  bounds: { x?: number; y?: number; width: number; height: number };
  maximized: boolean;
}

const file = () => path.join(app.getPath('userData'), 'window-state.json');

export async function loadWindowState(): Promise<WindowState> {
  const fallback: WindowState = { bounds: { width: 1400, height: 900 }, maximized: false };
  try {
    const s = JSON.parse(await readFile(file(), 'utf8')) as WindowState;
    // only restore a position that is still on a connected display
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      const { x = -1e9, y = -1e9 } = s.bounds;
      return x >= b.x - 50 && y >= b.y - 50 && x < b.x + b.width && y < b.y + b.height;
    });
    if (!visible) {
      delete s.bounds.x;
      delete s.bounds.y;
    }
    return s;
  } catch {
    return fallback;
  }
}

export function trackWindowState(win: BrowserWindow) {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
      writeFile(file(), JSON.stringify(state)).catch(() => {});
    }, 300);
  };
  win.on('resize', save);
  win.on('move', save);
  win.on('close', save);
}
