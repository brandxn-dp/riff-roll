import { useEffect, useState } from 'react';
import { detectStorage, type StorageAdapter } from './storage';

export function App() {
  const [storage, setStorage] = useState<StorageAdapter | null>(null);
  useEffect(() => {
    detectStorage().then(setStorage);
  }, []);
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Riff Roll</div>
        <span className="mute">storage: {storage?.kind ?? '…'}</span>
      </header>
    </div>
  );
}
