/**
 * Model Context Protocol (MCP) for Riff Roll: lets Claude (or any MCP client) read and edit the song that is open
 * in the editor. The protocol side is stateless JSON-RPC over HTTP POST ("streamable HTTP" with plain JSON
 * replies). Tool calls are run by the editor itself (packages/ui/src/mcp/tools.ts), so every change shows up
 * live and can be undone; the desktop app and the server only carry the calls there and the results back.
 */

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const track = {
  type: ['string', 'number'],
  description: 'Track id, name, or 1-based number. Defaults to the track shown in the editor.',
};
const bar = (what: string) => ({ type: 'number', description: `${what} (1-based)` });
const position = {
  bar: bar('Bar'),
  beat: {
    type: 'number',
    description: 'Position in the bar in quarter notes, 1-based: 1 = downbeat, 1.5 = the "and" of 1, 2.25 …',
  },
  tick: {
    type: 'number',
    description: 'Alternative to bar/beat: absolute position in ticks (960 per quarter).',
  },
};

export const TOOLS = [
  {
    name: 'get_song',
    description:
      'Overview of the song open in Riff Roll: title, tempo, time signatures, key and scale, number of bars, ' +
      'sections, tracks (id, name, type, tuning, instrument, how many notes) and, for drum tracks, the drum lanes ' +
      'you can use with add_drum_hits. Call this first.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_notes',
    description:
      'Notes of a track, or drum hits of a drum track, with ids, pitch, bar/beat, length in quarter notes, ' +
      'velocity, string/fret (guitar and bass; string 1 = highest string, as in tab) and techniques.',
    inputSchema: {
      type: 'object',
      properties: { track, from_bar: bar('First bar'), to_bar: bar('Last bar, inclusive') },
    },
  },
  {
    name: 'get_tab',
    description: 'ASCII tab of a guitar or bass track (default: the first 8 bars).',
    inputSchema: {
      type: 'object',
      properties: { track, from_bar: bar('First bar'), to_bar: bar('Last bar, inclusive') },
    },
  },
  {
    name: 'add_notes',
    description:
      'Add notes to a guitar, bass or other track. Give each note a pitch ("E2", "F#3", or MIDI number), or a ' +
      'string and fret on guitar/bass (string 1 = highest). Length is in quarter notes (1 = quarter, 0.5 = ' +
      'eighth, 0.25 = sixteenth). One undo step.',
    inputSchema: {
      type: 'object',
      required: ['notes'],
      properties: {
        track,
        notes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pitch: { type: ['string', 'number'] },
              string: { type: 'number', description: 'Guitar/bass string, 1 = highest' },
              fret: { type: 'number' },
              ...position,
              length: { type: 'number', description: 'Quarter notes (default 1)' },
              velocity: { type: 'number', description: '1–127 (default 100)' },
              techniques: {
                type: 'object',
                description:
                  'Optional: palmMute, letRing, dead, ghost, hammer, tap (true/false); slide ("shift", "legato", ' +
                  '"in-below", "in-above", "out-down", "out-up"); vibrato ("normal", "wide"); harmonic ' +
                  '("natural", "artificial", "pinch", "tap", "semi"); accent ("normal", "heavy"); bend (semitones, e.g. 1 or 2)',
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'add_drum_hits',
    description:
      'Add drum hits to a drum track. lane is a drum lane id from get_song (e.g. "kick:right", "snare:center", ' +
      '"hihat:closed", "crash1:hit") or just a piece name (kick, snare, hihat, ride, crash1, crash2, china, ' +
      'splash, tom1–tom4). One undo step.',
    inputSchema: {
      type: 'object',
      required: ['hits'],
      properties: {
        track,
        hits: {
          type: 'array',
          items: {
            type: 'object',
            required: ['lane'],
            properties: { lane: { type: 'string' }, ...position, velocity: { type: 'number' } },
          },
        },
      },
    },
  },
  {
    name: 'edit_notes',
    description:
      'Change notes or drum hits in bulk: by ids, or everything in a bar range (default: the whole track). ' +
      'transpose (semitones), shift (quarter notes, + later / − earlier), velocity (set) or velocity_scale ' +
      '(multiply), length (set, quarter notes). One undo step.',
    inputSchema: {
      type: 'object',
      properties: {
        track,
        ids: { type: 'array', items: { type: 'string' } },
        from_bar: bar('First bar'),
        to_bar: bar('Last bar, inclusive'),
        transpose: { type: 'number' },
        shift: { type: 'number' },
        velocity: { type: 'number' },
        velocity_scale: { type: 'number' },
        length: { type: 'number' },
      },
    },
  },
  {
    name: 'delete_notes',
    description: 'Delete notes or drum hits by ids, or everything in a bar range. One undo step.',
    inputSchema: {
      type: 'object',
      properties: {
        track,
        ids: { type: 'array', items: { type: 'string' } },
        from_bar: bar('First bar'),
        to_bar: bar('Last bar, inclusive'),
      },
    },
  },
  {
    name: 'set_song',
    description:
      'Change song settings: title, artist, tempo (bpm for the whole song; set_tempo does part of it), ' +
      'time_signature ("4/4", "7/8"; whole song, removing other changes; set_time_signature does part of it), key ("E minor", "A major", "F# minor"), scale (major, minor, dorian, phrygian, lydian, mixolydian, ' +
      'locrian, harmonic minor, melodic minor, major pentatonic, minor pentatonic, blues…), bars (song length).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        artist: { type: 'string' },
        tempo: { type: 'number' },
        time_signature: { type: 'string' },
        key: { type: 'string' },
        scale: { type: 'string' },
        bars: { type: 'number' },
      },
    },
  },
  {
    name: 'set_tempo',
    description:
      'Tempo for part of the song: bpm from from_bar (default 1) up to and including to_bar, after which the ' +
      'tempo goes back to what it was (leave to_bar out to keep the new tempo to the end). ramp: true glides ' +
      'gradually from the previous tempo to this one, arriving at from_bar. remove: true deletes the tempo change ' +
      'at from_bar. get_song lists the tempo changes.',
    inputSchema: {
      type: 'object',
      properties: {
        bpm: { type: 'number' },
        from_bar: bar('First bar'),
        to_bar: bar('Last bar, inclusive'),
        ramp: { type: 'boolean' },
        remove: { type: 'boolean' },
      },
    },
  },
  {
    name: 'set_time_signature',
    description:
      'Time signature ("7/8", "6/8", "3/4") for part of the song: from from_bar (default 1) up to and including ' +
      'to_bar, then back to the previous one (leave to_bar out to keep it to the end). remove: true deletes the ' +
      'change at from_bar. Notes keep their positions in time, so bar lines after the change move: set time ' +
      'signatures before writing notes in those bars, or rewrite them after.',
    inputSchema: {
      type: 'object',
      properties: {
        signature: { type: 'string' },
        from_bar: bar('First bar'),
        to_bar: bar('Last bar, inclusive'),
        remove: { type: 'boolean' },
      },
    },
  },
  {
    name: 'set_sections',
    description:
      'Replace the song’s section markers, e.g. [{"name":"Intro","bar":1},{"name":"Verse","bar":5}].',
    inputSchema: {
      type: 'object',
      required: ['sections'],
      properties: {
        sections: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, bar: { type: 'number' } } },
        },
      },
    },
  },
  {
    name: 'add_track',
    description:
      'Add a track: type guitar, bass, drums or other (piano, synth …). Optional name and tuning name.',
    inputSchema: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['guitar', 'bass', 'drums', 'other'] },
        name: { type: 'string' },
        tuning: { type: 'string', description: 'e.g. "Drop D", "Standard D", "Bass Drop D"' },
      },
    },
  },
  {
    name: 'update_track',
    description:
      'Change a track: name, mute, solo, volume (0–1.5), pan (−1 left … 1 right), tuning (name), capo, or ' +
      'delete: true to remove it.',
    inputSchema: {
      type: 'object',
      properties: {
        track,
        name: { type: 'string' },
        mute: { type: 'boolean' },
        solo: { type: 'boolean' },
        volume: { type: 'number' },
        pan: { type: 'number' },
        tuning: { type: 'string' },
        capo: { type: 'number' },
        delete: { type: 'boolean' },
      },
    },
  },
  {
    name: 'show',
    description: 'Show something to the user: switch the editor to a track, scroll to a bar, select notes.',
    inputSchema: {
      type: 'object',
      properties: {
        track,
        bar: bar('Bar to scroll to'),
        select: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'playback',
    description: 'Play (optionally from a bar) or stop playback.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string', enum: ['play', 'stop'] }, from_bar: bar('Start bar') },
    },
  },
  {
    name: 'undo',
    description: 'Undo the last change(s) in the editor (yours or the user’s), or redo with redo: true.',
    inputSchema: { type: 'object', properties: { steps: { type: 'number' }, redo: { type: 'boolean' } } },
  },
  {
    name: 'list_songs',
    description: 'The user’s saved songs (id, title, last edited).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'open_song',
    description: 'Open a saved song in the editor by id (from list_songs). The current song is saved first.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
  },
  {
    name: 'new_song',
    description: 'Start a new song (drums, two guitars and bass, 8 bars) and open it.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  },
] as const;

export const INSTRUCTIONS =
  'Riff Roll is a guitar-focused piano roll and tab editor. These tools read and edit the song open in the ' +
  'editor; every change appears live for the user and can be undone with Ctrl+Z. Start with get_song. ' +
  'Positions are bar (1-based) and beat (1-based, in quarter notes); lengths are in quarter notes. On guitar ' +
  'and bass, string 1 is the highest string (as in tab). Riff Roll works out string and fret for notes given ' +
  'by pitch. Songs save automatically.';

interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

/** One JSON-RPC message → its response (null for notifications and responses). */
export async function handleMessage(
  m: Rpc,
  call: CallTool,
  info: { version: string },
): Promise<object | null> {
  if (!m || typeof m !== 'object' || typeof m.method !== 'string') {
    // a client's response to us, or junk
    return m && 'id' in m && !('result' in m || 'error' in m)
      ? fail(m.id ?? null, -32600, 'Invalid request')
      : null;
  }
  const method = m.method;
  const isNote = m.id === undefined || m.id === null;
  const res = await (async () => {
    switch (method) {
      case 'initialize': {
        const asked = String(m.params?.protocolVersion ?? '');
        return reply(m.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'riff-roll', title: 'Riff Roll', version: info.version },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return reply(m.id, {});
      case 'tools/list':
        return reply(m.id, { tools: TOOLS });
      case 'tools/call': {
        const name = String(m.params?.name ?? '');
        if (!TOOLS.some((t) => t.name === name)) return fail(m.id, -32602, `Unknown tool: ${name}`);
        const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          return reply(m.id, await call(name, args));
        } catch (e) {
          return reply(m.id, { content: [{ type: 'text', text: (e as Error).message }], isError: true });
        }
      }
      default:
        if (method.startsWith('notifications/')) return null;
        return fail(m.id, -32601, `Method not found: ${method}`);
    }
  })();
  return isNote ? null : res;
}

/** A POST body (one message or a batch) → the body to send back (null = 202 Accepted, no body). */
export async function handleBody(body: unknown, call: CallTool, info: { version: string }) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, call, info)))).filter(Boolean);
    return out.length ? out : null;
  }
  return handleMessage(body as Rpc, call, info);
}

/** Text result helpers for transports that answer a call themselves. */
export const toolError = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });
