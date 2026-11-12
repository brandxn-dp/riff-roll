import credits from '../credits.json';
import { Modal } from './Modal';

/** About / credits, generated from instruments/manifest.json (pnpm notices). */
export function About() {
  return (
    <Modal title="About Riff Roll" wide>
      <p>
        Songwriting for rock bands: draw in the piano roll, get colour-coded tab, stomp from clean to distorted in one
        track, and hear it through sampled instruments and an amp sim.
      </p>
      <h3 className="h3">Instruments and samples</h3>
      <ul className="credits">
        {credits.instruments.map((i) => (
          <li key={i.name}>
            <strong>{i.name}</strong> by {i.author} — {i.license}
            <br />
            <span className="mute">{i.attribution}</span>{' '}
            <a href={i.url} target="_blank" rel="noreferrer">
              source
            </a>
          </li>
        ))}
      </ul>
      <h3 className="h3">Software</h3>
      <ul className="credits">
        {credits.software.map((s) => (
          <li key={s.name}>
            <strong>{s.name}</strong> — {s.license}{' '}
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.url.replace(/^https?:\/\//, '')}
            </a>
          </li>
        ))}
      </ul>
      <p className="mute">Cabinet impulse responses are synthesised by Riff Roll itself; no third-party IR files are included.</p>
    </Modal>
  );
}
