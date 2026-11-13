import { useEffect, useRef, useState } from 'react';
import {
  addSection,
  newId,
  removeSection,
  setTempos,
  setTimeSigs,
  updateSection,
  updateSong,
  type Song,
  SCALES,
} from '@riffroll/core';
import { barMap, songEnd, useStore } from '../store';
import { COL, KEYS_W, pxPerTick } from '../canvas';
import { seek } from '../transport';

const KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
const SECTION_NAMES = ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Bridge', 'Solo', 'Breakdown', 'Outro'];

/** Song-wide controls: jump-to-section chips, tempo/time-signature/key changes, repeats, and a minimap. */
export function SongBar() {
  const song = useStore((s) => s.song);
  const cursor = useStore((s) => s.cursor);
  const st = useStore.getState();
  const bm = barMap(song);
  const bar = bm.barAtTick(cursor);
  const [editing, setEditing] = useState<string | null>(null);

  const addSec = () => {
    const used = new Set(song.sections.map((s) => s.name));
    const name = SECTION_NAMES.find((n) => !used.has(n)) ?? `Section ${song.sections.length + 1}`;
    const tick = bar.start;
    if (song.sections.some((s) => s.tick === tick)) return;
    const id = newId('sec');
    st.exec(addSection({ id, tick, name }));
    setEditing(id);
  };

  const tempoHere = song.tempos.find((t) => t.tick === bar.start);
  const sigHere = song.timeSigs.find((t) => t.bar === bar.index);
  const loop = song.loop;
  const loopBars = loop
    ? [bm.barAtTick(loop.start).index, bm.barAtTick(Math.max(loop.start, loop.end - 1)).index]
    : null;

  return (
    <div className="songbar">
      <div className="secs" role="toolbar" aria-label="Sections">
        <span className="glabel">Sections</span>
        {song.sections.map((s) =>
          editing === s.id ? (
            <input
              key={s.id}
              className="secedit"
              autoFocus
              defaultValue={s.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== s.name) st.exec(updateSection(s.id, { name: v }));
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <span key={s.id} className="secchip">
              <button
                onClick={() => seek(s.tick)}
                onDoubleClick={() => setEditing(s.id)}
                title="Jump (double-click to rename)"
              >
                {s.name}
                <small>{bm.barAtTick(s.tick).index + 1}</small>
              </button>
              <button
                className="x"
                aria-label={`Delete section ${s.name}`}
                onClick={() => st.exec(removeSection(s.id))}
              >
                ×
              </button>
            </span>
          ),
        )}
        <button className="ib small" onClick={addSec} title="Add a section at the cursor's bar">
          + Section
        </button>
      </div>
      <div className="songctl">
        <span className="glabel">Bar {bar.index + 1}</span>
        <button
          className="ib small"
          title="Tempo change at this bar"
          onClick={() => {
            if (tempoHere) return;
            const bpm = Math.round(song.tempos.filter((t) => t.tick <= bar.start).at(-1)?.bpm ?? 120);
            st.exec(setTempos([...song.tempos, { tick: bar.start, bpm }]));
          }}
        >
          + Tempo
        </button>
        {tempoHere && tempoHere.tick > 0 && (
          <span className="inline">
            <input
              type="number"
              aria-label="Tempo at this bar"
              value={tempoHere.bpm}
              min={20}
              max={400}
              onChange={(e) =>
                st.exec(
                  setTempos(
                    song.tempos.map((t) =>
                      t === tempoHere ? { ...t, bpm: Number(e.target.value) || t.bpm } : t,
                    ),
                  ),
                )
              }
            />
            <button
              className="ib small"
              onClick={() => st.exec(setTempos(song.tempos.filter((t) => t !== tempoHere)))}
              aria-label="Remove tempo change"
            >
              ×
            </button>
          </span>
        )}
        {(() => {
          // gradual change: ramp from the tempo point before the cursor to the next one
          const before = [...song.tempos].filter((t) => t.tick <= bar.start).at(-1);
          const hasNext = song.tempos.some((t) => before && t.tick > before.tick);
          return before && hasNext ? (
            <label className="field" title="Ramp the tempo gradually to the next tempo change">
              <input
                type="checkbox"
                checked={!!before.ramp}
                onChange={(e) =>
                  st.exec(
                    setTempos(
                      song.tempos.map((t) =>
                        t === before ? { ...t, ramp: e.target.checked || undefined } : t,
                      ),
                    ),
                  )
                }
              />
              Gradual
            </label>
          ) : null;
        })()}
        <select
          className="mini"
          aria-label="Time signature from this bar"
          value={sigHere ? `${sigHere.num}/${sigHere.den}` : ''}
          onChange={(e) => {
            const others = song.timeSigs.filter((t) => t.bar !== bar.index);
            if (!e.target.value)
              return st.exec(setTimeSigs(others.length ? others : [{ bar: 0, num: 4, den: 4 }]));
            const [num, den] = e.target.value.split('/').map(Number);
            st.exec(setTimeSigs([...others, { bar: bar.index, num, den }]));
          }}
        >
          <option value="">{bar.index === 0 ? 'Time sig' : `Sig (${bar.num}/${bar.den})`}</option>
          {['4/4', '3/4', '2/4', '5/4', '6/8', '7/8', '9/8', '12/8'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <button
          className="ib small"
          disabled={!loopBars}
          title="Turn the loop region into a repeat (×2)"
          onClick={() => {
            if (!loopBars) return;
            const [a, b] = loopBars;
            const others = song.repeats.filter((r) => r.endBar < a || r.startBar > b);
            st.exec(
              updateSong(
                { repeats: [...others, { id: newId('rep'), startBar: a, endBar: b, times: 2 }] },
                'Add repeat',
              ),
            );
          }}
        >
          Repeat loop ×2
        </button>
        {song.repeats.some((r) => bar.index >= r.startBar && bar.index <= r.endBar) && (
          <button
            className="ib small"
            onClick={() =>
              st.exec(
                updateSong(
                  {
                    repeats: song.repeats.filter((r) => !(bar.index >= r.startBar && bar.index <= r.endBar)),
                  },
                  'Remove repeat',
                ),
              )
            }
          >
            Remove repeat
          </button>
        )}
        <select
          className="mini"
          aria-label="Key signature"
          value={`${song.keySig.fifths}:${song.keySig.minor ? 'm' : 'M'}`}
          onChange={(e) => {
            const [f, m] = e.target.value.split(':');
            st.exec(updateSong({ keySig: { fifths: Number(f), minor: m === 'm' } }, 'Key signature'));
          }}
        >
          {KEYS.map((k, i) => (
            <option key={k} value={`${i - 7}:M`}>
              {k} major
            </option>
          ))}
          {MINOR.map((k, i) => (
            <option key={k + 'm'} value={`${i - 7}:m`}>
              {k} minor
            </option>
          ))}
        </select>
        <select
          className="mini"
          aria-label="Scale"
          title="Scale: shades the piano roll rows; Snap to scale keeps notes on it"
          value={song.scale ?? ''}
          onChange={(e) => st.exec(updateSong({ scale: e.target.value || undefined }, 'Scale'))}
        >
          <option value="">{song.keySig.minor ? 'Minor scale' : 'Major scale'}</option>
          {Object.keys(SCALES)
            .filter((n) => n !== 'major' && n !== 'minor')
            .map((n) => (
              <option key={n} value={n}>
                {n[0].toUpperCase() + n.slice(1)}
              </option>
            ))}
        </select>
      </div>
      <Minimap song={song} />
    </div>
  );
}

/** Whole-song overview: note density per track, the visible window, sections. Click to jump. */
function Minimap({ song }: { song: Song }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scrollX = useStore((s) => s.scrollX);
  const zoom = useStore((s) => s.zoom);
  const playhead = useStore((s) => s.playhead);
  // the note layer only changes with the song: render it once into an offscreen canvas, then just blit it
  const layer = useRef<{ song: Song; w: number; h: number; theme: number; cv: HTMLCanvasElement } | null>(
    null,
  );
  const themeRev = useStore((s) => s.themeRev);
  useEffect(() => {
    const cv = ref.current!;
    const w = cv.clientWidth,
      h = cv.clientHeight;
    if (!w || !h) return;
    const d = devicePixelRatio || 1;
    if (cv.width !== w * d || cv.height !== h * d) {
      cv.width = w * d;
      cv.height = h * d;
    }
    const end = songEnd(song);
    const k = w / end;
    let L = layer.current;
    if (!L || L.song !== song || L.w !== w || L.h !== h || L.theme !== themeRev) {
      const off = document.createElement('canvas');
      off.width = w * d;
      off.height = h * d;
      const o = off.getContext('2d')!;
      o.setTransform(d, 0, 0, d, 0, 0);
      o.fillStyle = COL.sunk;
      o.fillRect(0, 0, w, h);
      const rows = song.tracks.length || 1;
      const rh = h / rows;
      song.tracks.forEach((t, i) => {
        o.fillStyle = t.color;
        o.globalAlpha = t.mute ? 0.25 : 0.8;
        for (const n of t.notes) o.fillRect(n.start * k, i * rh + 1, Math.max(1, n.duration * k), rh - 2);
        for (const hh of t.hits) o.fillRect(hh.start * k, i * rh + 1, 1, rh - 2);
      });
      o.globalAlpha = 1;
      o.fillStyle = COL.ink;
      for (const sec of song.sections) o.fillRect(sec.tick * k, 0, 1, h);
      L = layer.current = { song, w, h, theme: themeRev, cv: off };
    }
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(L.cv, 0, 0);
    c.setTransform(d, 0, 0, d, 0, 0);
    const sc = document.querySelector<HTMLElement>('.cvwrap .scroller');
    const viewTicks = sc ? (sc.clientWidth - KEYS_W) / pxPerTick(zoom) : end;
    c.strokeStyle = COL.ink;
    c.lineWidth = 1;
    c.strokeRect((scrollX / pxPerTick(zoom)) * k + 0.5, 0.5, Math.max(4, viewTicks * k), h - 1);
    if (playhead != null) {
      c.fillStyle = COL.head;
      c.fillRect(playhead * k, 0, 1.5, h);
    }
  }, [song, scrollX, zoom, playhead, themeRev]);
  return (
    <canvas
      ref={ref}
      className="minimap"
      aria-label="Song overview"
      onPointerDown={(e) => {
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const tick = ((e.clientX - r.left) / r.width) * songEnd(song);
        const st = useStore.getState();
        const sc = document.querySelector<HTMLElement>('.cvwrap .scroller');
        const view = sc ? sc.clientWidth - KEYS_W : 600;
        st.set({ scrollX: Math.max(0, tick * pxPerTick(st.zoom) - view / 2) });
      }}
    />
  );
}
