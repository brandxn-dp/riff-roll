import { TRACK_COLORS, addTrack, makeTrack, removeTrack, updateTrack, type TrackType } from '@riffroll/core';
import { useStore } from '../store';

const ICON: Record<TrackType, string> = { guitar: 'GTR', bass: 'BASS', drums: 'DRM', other: 'OTH' };
const NAME: Record<TrackType, string> = { guitar: 'Guitar', bass: 'Bass', drums: 'Drums', other: 'Other' };

export function TrackList() {
  const song = useStore((s) => s.song);
  const trackId = useStore((s) => s.trackId);
  const st = useStore.getState();
  const anySolo = song.tracks.some((t) => t.solo);

  const add = (type: TrackType) => {
    const count = song.tracks.filter((t) => t.type === type).length + 1;
    const name = type === 'drums' ? 'Drums' : `${NAME[type]} ${count}`;
    const t = makeTrack(type, name, TRACK_COLORS[song.tracks.length % TRACK_COLORS.length]);
    st.exec(addTrack(t));
    st.set({ trackId: t.id, selection: new Set() });
  };

  return (
    <nav className="tracks" aria-label="Tracks">
      {song.tracks.map((t) => (
        <div
          key={t.id}
          className={
            'trk' + (t.id === trackId ? ' on' : '') + (t.mute || (anySolo && !t.solo) ? ' muted' : '')
          }
          style={{ ['--tc' as string]: t.color }}
          role="button"
          tabIndex={0}
          aria-current={t.id === trackId ? 'true' : undefined}
          aria-label={`${t.name} (${t.type})${t.mute ? ', muted' : ''}${t.solo ? ', solo' : ''}`}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
              e.preventDefault();
              (e.currentTarget as HTMLElement).click();
            }
          }}
          onClick={() => {
            if (t.id !== trackId)
              st.set({
                trackId: t.id,
                selection: new Set(),
                focusId: null,
                view: t.type === 'drums' ? 'drums' : st.view === 'drums' ? 'split' : st.view,
              });
          }}
        >
          <label className="tcolor" title="Track colour" onClick={(e) => e.stopPropagation()}>
            <input
              type="color"
              value={t.color}
              onChange={(e) => st.exec(updateTrack(t.id, { color: e.target.value }, 'Track colour'))}
              aria-label="Track colour"
            />
            <span className="tkind">{ICON[t.type]}</span>
          </label>
          <input
            className="tname"
            value={t.name}
            aria-label="Track name"
            onChange={(e) => st.exec(updateTrack(t.id, { name: e.target.value }, 'Rename track'))}
            onClick={(e) => t.id !== trackId && e.preventDefault()}
          />
          <div className="tbtns">
            <button
              aria-pressed={t.mute}
              title="Mute"
              onClick={(e) => {
                e.stopPropagation();
                st.exec(updateTrack(t.id, { mute: !t.mute }, 'Mute'));
              }}
            >
              M
            </button>
            <button
              aria-pressed={t.solo}
              title="Solo"
              onClick={(e) => {
                e.stopPropagation();
                st.exec(updateTrack(t.id, { solo: !t.solo }, 'Solo'));
              }}
            >
              S
            </button>
          </div>
          <div className="tsub">
            {t.type === 'drums'
              ? `${t.hits.length} hits`
              : t.type === 'other'
                ? `${t.notes.length} notes`
                : `${t.tuning.name} · ${t.notes.length} notes`}
          </div>
          {song.tracks.length > 1 && t.id === trackId && (
            <button
              className="tdel"
              title="Delete track"
              aria-label="Delete track"
              onClick={(e) => {
                e.stopPropagation();
                const next = song.tracks.find((x) => x.id !== t.id)!;
                st.exec(removeTrack(t.id));
                st.set({ trackId: next.id, selection: new Set() });
              }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="addtrk">
        <span className="glabel">Add</span>
        <button onClick={() => add('guitar')}>Guitar</button>
        <button onClick={() => add('bass')}>Bass</button>
        <button onClick={() => add('drums')}>Drums</button>
        <button
          onClick={() => add('other')}
          title="Piano, synth, strings… (any instrument you add under Instruments)"
        >
          Other
        </button>
      </div>
    </nav>
  );
}
