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
import { FileMenu, SongTitle } from './components/FileMenu';
import { SignIn } from './components/SignIn';
import { Home } from './components/Home';
import { ShareDialog } from './components/ShareDialog';
import { UsersDialog } from './components/UsersDialog';
import { AccountDialog } from './components/AccountDialog';
import { VelocityDialog } from './components/VelocityDialog';
import { DocBanner } from './components/DocBanner';
import { goHome } from './files/actions';
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
  const screen = useStore((s) => s.screen);
  const user = useStore((s) => s.user);

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
      {modal === 'share' && <ShareDialog />}
      {modal === 'users' && <UsersDialog />}
      {modal === 'account' && <AccountDialog />}
      {modal === 'velocity' && <VelocityDialog />}
      {modal === 'about' && <About />}
      {modal === 'tone' && <ToneEditor />}
      {modal === 'instruments' && <Instruments />}
    </>
  );
  if (screen === 'loading') return <div className="auth-screen" aria-busy="true" />;
  if (screen === 'signin') return <SignIn />;
  if (screen === 'home')
    return (
      <>
        <Home />
        {modals}
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
            <button
              className="btn"
              onClick={() => void goHome()}
              title="All songs (Ctrl+O)"
              aria-label="All songs"
            >
              ⌂
            </button>
            <FileMenu />
            <SongTitle />
          </>
        }
      />
      <div className="body">
        <TrackList />
        <main className="main">
          <DocBanner />
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
        <span className="mute">
          {user ? `${user.displayName} · ` : ''}storage: {storage?.kind ?? '…'}
        </span>
      </footer>
      {modals}
    </div>
  );
}
