/** Titles and "recently opened" for the single-user stores (desktop app, browser-only), kept in localStorage. */
const KEY = 'riffroll.local-meta';
type Meta = Record<string, { title?: string; openedAt?: string }>;

function read(): Meta {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Meta;
  } catch {
    return {};
  }
}
function write(m: Meta) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage blocked: titles come from the files instead */
  }
}
export function localMeta(id: string) {
  return read()[id] ?? {};
}
export function noteLocal(id: string, patch: { title?: string; openedAt?: string }) {
  const m = read();
  m[id] = { ...m[id], ...patch };
  write(m);
}
export function forgetLocal(id: string) {
  const m = read();
  delete m[id];
  write(m);
}
