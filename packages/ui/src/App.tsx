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
import { FileMenu, ProjectsDialog, SongTitle } from './components/FileMenu';
import { About } from './components/About';
import { ToneEditor } from './components/ToneEditor';
import { Instruments } from './components/Instruments';
import { installFileActions } from './files/wire';
import { installMidi } from './midiInput';
import { InputControls } from './components/InputControls';
import { installShortcuts } from './shortcuts';
import { installAudio } from './audio-setup';
import { MobileApp } from './components/mobile/MobileApp';
import { installLayoutWatcher } from './device';

export function App() {
  const [storage, setStorage] = useState<StorageAdapter | null>(null);
  const view = useStore((s) => s.view);
  const modal = useStore((s) => s.modal);
  const status = useStore((s) => s.status);
  const trackType = useStore((s) => currentTrack(s)?.type);
  const layout = useStore((s) => s.layout);

  useEffect(() => {
    detectStorage().then(setStorage);
    installAudio();
    const offFiles = installFileActions();
    const offMidi = installMidi();
    const offKeys = installShortcuts();
    const offLayout = installLayoutWatcher();
    return () => {
      offLayout();
      offFiles();
      offMidi();
      offKeys();
    };
  }, []);

  const modals = (
    <>
      {modal === 'shortcuts' && <ShortcutSheet />}
      {modal === 'mixer' && <Mixer />}
      {modal === 'files' && <ProjectsDialog />}
      {modal === 'about' && <About />}
      {modal === 'tone' && <ToneEditor />}
      {modal === 'instruments' && <Instruments />}
    </>
  );
  if (layout === 'mobile') return <MobileApp modals={modals} />;

  const showRoll = view === 'split' || view === 'roll';
  const showTab = view === 'split' || view === 'tab';

  return (
    <div className="app">
      <Toolbar
        right={<InputControls />}
        left={
          <>
            <FileMenu />
            <SongTitle />
          </>
        }
      />
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
        <span role="status" aria-live="polite">
          {status}
        </span>
        <span className="mute">storage: {storage?.kind ?? '…'}</span>
      </footer>
      {modals}
    </div>
  );
}
