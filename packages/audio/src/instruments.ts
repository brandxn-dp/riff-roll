import { Sampler, SampleLoader, defaultFetch, joinUrl } from './sampler';
import { fallbackDrumSfz, fallbackFetch, fallbackSfz } from './fallback';

export interface InstrumentInfo {
  id: string;
  name: string;
  role: 'guitar' | 'bass' | 'drums' | 'ir' | 'other';
  license: string;
  author: string;
  homepage: string;
  attribution: string;
  sfz: string;
  meta?: Record<string, unknown>;
}

/** Loads the instrument index and creates samplers on demand. Shared by the live and offline engines. */
export class InstrumentLibrary {
  private list: Promise<InstrumentInfo[]> | null = null;
  private samplers = new Map<string, Promise<Sampler>>();
  readonly loader: SampleLoader;
  private fallbackLoader: SampleLoader;

  constructor(
    decodeCtx: BaseAudioContext,
    readonly baseUrl = './instruments/',
    fetcher: (url: string) => Promise<ArrayBuffer> = defaultFetch,
  ) {
    this.loader = new SampleLoader(decodeCtx, fetcher);
    this.fallbackLoader = new SampleLoader(decodeCtx, fallbackFetch);
  }

  index(): Promise<InstrumentInfo[]> {
    if (!this.list)
      this.list = fetch(joinUrl(this.baseUrl, 'index.json'), { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { instruments: [] }))
        .then((j: { instruments: InstrumentInfo[] }) => j.instruments ?? [])
        .catch(() => []);
    return this.list;
  }

  /** Forget the cached index (after new instruments were installed). */
  refresh() {
    this.list = null;
  }

  /** Resolve an instrument id to its info, falling back to the first installed instrument with the same role. */
  async resolve(id: string, role: InstrumentInfo['role']): Promise<InstrumentInfo | undefined> {
    const all = await this.index();
    return all.find((i) => i.id === id) ?? all.find((i) => i.role === role);
  }

  /** A sampler for this instrument, or the built-in fallback pluck if no pack is installed. */
  sampler(id: string, role: InstrumentInfo['role']): Promise<Sampler> {
    const key = `${role}:${id}`;
    let p = this.samplers.get(key);
    if (!p) {
      p = (async () => {
        const info = await this.resolve(id, role);
        if (!info) {
          const text =
            role === 'drums'
              ? fallbackDrumSfz()
              : fallbackSfz(role === 'bass' ? 'bass' : role === 'other' ? 'keys' : 'guitar');
          const s = new Sampler(text, 'fallback://', this.fallbackLoader);
          (s as Sampler & { fallback?: boolean }).fallback = true;
          return s;
        }
        const sfzUrl = joinUrl(this.baseUrl, info.sfz);
        const text = await fetch(sfzUrl).then((r) => {
          if (!r.ok) throw new Error(`cannot load ${info.sfz}`);
          return r.text();
        });
        const dir = info.sfz.split('/').slice(0, -1).join('/');
        return new Sampler(text, joinUrl(this.baseUrl, dir).replace(/\/?$/, '/'), this.loader);
      })();
      p.catch(() => this.samplers.delete(key));
      this.samplers.set(key, p);
    }
    return p;
  }
}

export const isFallback = (s: Sampler) => !!(s as Sampler & { fallback?: boolean }).fallback;
