/**
 * Room server: WebSocket rooms on /ws, plus the built game (dist/) as static files, so one
 * process serves everything. Usage: npm run server (PORT, default 8787).
 */

import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { NET_TICK_RATE } from '../src/net/protocol';
import { loadMaps } from './maps';
import { Room, type Peer } from './room';

const PORT = Number(process.env['PORT'] ?? 8787);
const STATIC_DIR = resolve('dist');
const MAPS_DIR = existsSync(join(STATIC_DIR, 'maps')) ? join(STATIC_DIR, 'maps') : 'public/maps';
/** Room codes skip look-alike letters and digits. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
/** Empty rooms are dropped after this long. */
const EMPTY_ROOM_MS = 5 * 60 * 1000;
/** Messages larger than this are refused. */
const MAX_MESSAGE_BYTES = 2048;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const maps = loadMaps(MAPS_DIR);
const rooms = new Map<string, { room: Room; emptySince: number | null }>();

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS.charAt(randomInt(CODE_CHARS.length));
    if (!rooms.has(code)) return code;
  }
}

function parse(data: unknown): ClientMessage | null {
  try {
    const text = String(data);
    if (text.length > MAX_MESSAGE_BYTES) return null;
    const msg = JSON.parse(text) as unknown;
    if (typeof msg !== 'object' || msg === null || !('t' in msg)) return null;
    return msg as ClientMessage;
  } catch {
    return null;
  }
}

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
  if (!file.startsWith(STATIC_DIR + sep) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (ws: WebSocket) => {
  const peer: Peer = {
    send(message: ServerMessage) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
  };
  let room: Room | null = null;

  ws.on('message', (data) => {
    const msg = parse(data);
    if (!msg) return;
    if (msg.t === 'create' && !room) {
      const code = newCode();
      room = new Room(code, maps, () => randomInt(2 ** 31));
      rooms.set(code, { room, emptySince: null });
      room.join(peer);
    } else if (msg.t === 'join' && !room) {
      const entry = typeof msg.room === 'string' ? rooms.get(msg.room.toUpperCase()) : undefined;
      if (!entry || entry.room.join(peer) === null) {
        peer.send({ t: 'error', message: entry ? 'room is full' : 'room not found' });
        return;
      }
      room = entry.room;
      entry.emptySince = null;
    } else if (room) {
      room.onMessage(peer, msg);
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.leave(peer);
    const entry = rooms.get(room.id);
    if (entry && room.empty) entry.emptySince = Date.now();
  });
});

// One clock for all rooms, catching up if the event loop was late.
const TICK_MS = 1000 / NET_TICK_RATE;
let next = performance.now();
setInterval(() => {
  const now = performance.now();
  let steps = 0;
  while (next <= now && steps < 10) {
    for (const { room } of rooms.values()) room.step();
    next += TICK_MS;
    steps++;
  }
  if (next < now) next = now;
  for (const [code, entry] of rooms) {
    if (entry.emptySince !== null && Date.now() - entry.emptySince > EMPTY_ROOM_MS) {
      rooms.delete(code);
    }
  }
}, TICK_MS / 2);

http.listen(PORT, () => {
  console.log(`room server on :${PORT} (maps from ${MAPS_DIR})`);
});
