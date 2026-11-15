/**
 * Interface size (Settings → General) everywhere, not only in the desktop app:
 * - desktop app: the window's own zoom (Electron), like Ctrl + / −;
 * - phones and tablets: the viewport width, so the browser itself scales the page (real page zoom: touch and
 *   layout maths stay exact);
 * - desktop browsers: CSS `zoom` on the page. Chromium then reports pointer positions and element rectangles in
 *   zoomed pixels while the editors draw in CSS pixels, so pointer maths goes through `px()` and `rectOf()`.
 */

/** the CSS zoom factor in effect (1 unless a desktop browser uses a non-100 % interface size) */
let Z = 1;

/** a pointer coordinate (or a distance between two) in CSS pixels */
export const px = (v: number) => v / Z;

/** an element's rectangle in CSS pixels */
export function rectOf(el: Element): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  return Z === 1 ? r : { left: r.left / Z, top: r.top / Z, width: r.width / Z, height: r.height / Z };
}

let scale = 1;
let offOrient: (() => void) | null = null;

/** How the interface size is applied on this device. */
export function uiScaleMode(): 'app' | 'viewport' | 'css' {
  const bridge = window.riffroll as { setZoom?: (f: number) => void } | undefined;
  if (bridge?.setZoom) return 'app';
  return window.matchMedia?.('(pointer: coarse)').matches ? 'viewport' : 'css';
}

function setViewport() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  if (scale === 1) {
    meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    return;
  }
  // a layout viewport narrower (bigger UI) or wider (smaller UI) than the screen; the browser fits it to the screen
  const portrait = window.matchMedia?.('(orientation: portrait)').matches ?? true;
  const sw = portrait ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  meta.content = `width=${Math.round(sw / scale)}, viewport-fit=cover`;
}

/** Apply an interface size in percent (100 = normal). */
export function applyUiScale(percent: number) {
  scale = Math.max(0.5, Math.min(2, (percent || 100) / 100));
  const mode = uiScaleMode();
  offOrient?.();
  offOrient = null;
  if (mode === 'app') {
    (window.riffroll as unknown as { setZoom: (f: number) => void }).setZoom(scale);
    Z = 1;
    document.documentElement.style.removeProperty('zoom');
  } else if (mode === 'viewport') {
    Z = 1;
    document.documentElement.style.removeProperty('zoom');
    setViewport();
    const on = () => setTimeout(setViewport, 150);
    window.addEventListener('orientationchange', on);
    offOrient = () => window.removeEventListener('orientationchange', on);
  } else {
    Z = scale;
    if (scale === 1) document.documentElement.style.removeProperty('zoom');
    else document.documentElement.style.setProperty('zoom', String(scale));
  }
  // layouts and canvases re-measure
  window.dispatchEvent(new Event('resize'));
}
