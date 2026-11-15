/// <reference lib="webworker" />
/** Encodes MP3 off the main thread: receives an Mp3Job, posts progress and then the file bytes. */
import { encodeMp3, type Mp3Job } from './mp3';

self.onmessage = (e: MessageEvent<Mp3Job>) => {
  try {
    const bytes = encodeMp3(e.data, (f) => self.postMessage({ progress: f }));
    self.postMessage({ bytes }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ error: (err as Error).message });
  }
};
