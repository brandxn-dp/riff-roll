/**
 * Layout detection. Phones (narrow viewports, or touch-first devices with a small screen) get the mobile layout;
 * tablets and desktops keep the full layout (with larger touch targets on coarse pointers, via CSS).
 * The user can force either layout; the choice is remembered on this device.
 */
import { useStore } from './store';

export type LayoutPref = 'auto' | 'mobile' | 'desktop';
const KEY = 'riffroll.layout';

export function readPref(): LayoutPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'mobile' || v === 'desktop' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function detectMobile(): boolean {
  const w = window.innerWidth;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const shortSide = Math.min(window.screen?.width ?? w, window.screen?.height ?? w);
  // phones: touch-first with a short side under 600 CSS px (covers landscape too), or any very narrow window
  return (coarse && shortSide < 600) || w < 700;
}

export function resolveLayout(pref = readPref()): 'mobile' | 'desktop' {
  return pref === 'auto' ? (detectMobile() ? 'mobile' : 'desktop') : pref;
}

export function setLayoutPref(pref: LayoutPref) {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked: the choice lasts for this session */
  }
  useStore.getState().set({ layoutPref: pref, layout: resolveLayout(pref) });
}

/** Keep the layout in sync with rotation / window resizing (only while the preference is "auto"). */
export function installLayoutWatcher(): () => void {
  useStore.getState().set({ layoutPref: readPref() });
  const update = () => {
    const st = useStore.getState();
    const layout = resolveLayout(st.layoutPref);
    if (layout !== st.layout) {
      // the mobile layout starts on roll + tab, the prototype's phone layout
      st.set({ layout, ...(layout === 'mobile' && st.view === 'roll' ? { view: 'split' } : {}) });
    }
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
  };
}
