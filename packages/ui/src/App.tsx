import { useEffect, useState } from 'react';
import { detectStorage, type StorageAdapter } from './storage';
import { currentTrack, useStore } from './store';
import { Toolbar } from './components/Toolbar';
import { TrackList } from './components/TrackList';
import { Inspector } from './components/Inspector';
import { ShortcutSheet } from './components/ShortcutSheet';
import { PianoRoll } from './views/PianoRoll';
import { LowerPanel } from './views/LowerPanel';
import { DrumGrid } from './views/DrumGrid';
import { NotationView } from './views/NotationView';
import { Mixer } from './components/Mixer';
import { SongBar } from './components/SongBar';
import { installShortcuts } from './shortcuts';
import { installAudio } from './audio-setup';

export function App() {
  const [storage, setStorage] = useState<StorageAdapter | null>(null);
  const view = useStore((s) => s.view);
  const modal = useStore((s) => s.modal);
  const status = useStore((s) => s.status);
  const trackType = useStore((s) => currentTrack(s)?.type);

  useEffect(() => {
    detectStorage().then(setStorage);
    installAudio();
    return installShortcuts();
  }, []);

  const showRoll = view === 'split' || view === 'roll';
  const showTab = view === 'split' || view === 'tab';

  return (
    <div className="app">
      <Toolbar />
      <div className="body">
        <TrackList />
        <main className="main">
          <SongBar />
          {view === 'notation' ? (
            <NotationView />
          ) : trackType === 'drums' ? (
            <DrumGrid />
          ) : (
            <>
              {showRoll && <PianoRoll />}
              <LowerPanel showVelocity={showRoll} showTab={showTab} />
              {view === 'tab' && <div className="fill" />}
              <Inspector />
            </>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <span>{status}</span>
        <span className="mute">storage: {storage?.kind ?? '…'}</span>
      </footer>
      {modal === 'shortcuts' && <ShortcutSheet />}
      {modal === 'mixer' && <Mixer />}
    </div>
  );
}
