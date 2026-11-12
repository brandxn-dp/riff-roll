/**
 * Print / PDF: render every track (notation + tab, light theme) into a print-only container and open the system
 * print dialog. "Save as PDF" in that dialog produces the PDF on every OS (and in Electron).
 */
import * as alphaTab from '@coderline/alphatab';
import { songToAlphaTex } from '@riffroll/core';
import { useStore } from '../store';
import { alphaTabSettings } from '../views/NotationView';

export function printScore(trackIds?: string[]) {
  const song = useStore.getState().song;
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  document.body.appendChild(root);
  document.body.classList.add('printing');
  const settings = alphaTabSettings(false) as { display: Record<string, unknown> };
  settings.display.scale = 0.85;
  settings.display.layoutMode = alphaTab.LayoutMode.Page;
  const api = new alphaTab.AlphaTabApi(root, settings as never);
  useStore.getState().set({ status: 'Preparing print…' });
  const cleanup = () => {
    api.destroy();
    root.remove();
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', cleanup);
  };
  let printed = false;
  api.renderFinished.on(() => {
    if (printed) return;
    printed = true;
    useStore.getState().set({ status: '' });
    window.addEventListener('afterprint', cleanup);
    // let the browser lay out the SVGs before opening the dialog
    setTimeout(() => window.print(), 300);
  });
  api.error.on((e) => {
    useStore.getState().set({ status: `Print failed: ${String((e as Error)?.message ?? e)}` });
    cleanup();
  });
  api.tex(songToAlphaTex(song, trackIds).tex);
}
