import { NO_INPUT, type MatchInput, type MatchState } from '../../core/match';
import type { ClientInput, ClientMessage, ServerMessage } from '../../net/protocol';

export interface OnlineHandlers {
  /** A new match: the scene loads the map and creates the match with this seed. */
  start(map: string, seed: number): void;
  /** The full state at `tick` (joining a running match, or after a resync). */
  state(tick: number, state: MatchState): void;
  /** Seat, peer or error changed: refresh the HUD. */
  changed(): void;
}

/**
 * The client side of a match by link (see src/net/protocol.ts): the socket, the seat, and
 * the server's confirmed input per tick, which the scene steps through.
 */
export class Online {
  room: string | null = null;
  /** Our team. */
  seat: number | null = null;
  peer = false;
  started = false;
  error: string | null = null;
  /** The last tick the server has confirmed. */
  upTo = 0;
  /** Diagnostics (?debug=1): round trip to the server, and full states received. */
  pingMs: number | null = null;
  states = 0;
  private ws!: WebSocket;
  private readonly inputs = new Map<number, MatchInput>();
  private readonly sums = new Map<number, number>();
  private readonly ping: number;
  /** Failed reconnects in a row; the error shows only after a few. */
  private retries = 0;
  private closed = false;

  /** Joins the room `code`, or creates a room when it is null. */
  constructor(
    code: string | null,
    private readonly on: OnlineHandlers,
  ) {
    this.room = code;
    this.connect();
    this.ping = window.setInterval(() => {
      this.send({ t: 'ping', at: performance.now() });
    }, 2000);
  }

  /**
   * Opens the socket and joins (or creates) the room. A dropped connection (a phone freezing
   * a background tab, a network switch) reconnects to the same room, and the server sends
   * the running state.
   */
  private connect(): void {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${window.location.host}/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.send(this.room ? { t: 'join', room: this.room } : { t: 'create' });
    });
    ws.addEventListener('message', (e: MessageEvent<string>) => {
      this.retries = 0;
      this.receive(JSON.parse(e.data) as ServerMessage);
    });
    ws.addEventListener('close', () => {
      if (this.closed || this.error) return;
      this.retries++;
      if (this.retries > 5) {
        this.error = "Зв'язок із сервером втрачено";
        this.on.changed();
        return;
      }
      window.setTimeout(() => {
        this.connect();
      }, 500 * this.retries);
    });
  }

  /** The link a friend opens to join this room. */
  get link(): string {
    const url = new URL(window.location.href);
    url.search = this.room ? `?room=${this.room}` : '';
    return url.toString();
  }

  private send(message: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  sendInput(input: ClientInput): void {
    this.send({ t: 'input', input });
  }

  rematch(): void {
    this.send({ t: 'rematch' });
  }

  resync(): void {
    this.send({ t: 'resync' });
  }

  /** The confirmed input of tick `n` (idle when the server sent none). */
  inputFor(n: number): MatchInput {
    const input = this.inputs.get(n) ?? NO_INPUT;
    this.inputs.delete(n);
    return input;
  }

  /** The server's checksum after tick `n`, if it sent one. */
  checksumFor(n: number): number | undefined {
    const sum = this.sums.get(n);
    this.sums.delete(n);
    return sum;
  }

  private receive(m: ServerMessage): void {
    switch (m.t) {
      case 'room':
        this.room = m.room;
        this.seat = m.seat;
        this.on.changed();
        break;
      case 'peer':
        this.peer = m.present;
        this.on.changed();
        break;
      case 'start':
        this.started = true;
        this.peer = true;
        this.upTo = 0;
        this.inputs.clear();
        this.sums.clear();
        this.on.start(m.map, m.seed);
        this.on.changed();
        break;
      case 'state':
        this.states++;
        this.started = true;
        this.upTo = m.tick;
        this.inputs.clear();
        this.sums.clear();
        this.on.state(m.tick, m.state);
        this.on.changed();
        break;
      case 'ticks':
        for (const [tick, input] of m.inputs) this.inputs.set(tick, input);
        if (m.sum) this.sums.set(m.sum[0], m.sum[1]);
        this.upTo = m.upTo;
        break;
      case 'pong':
        this.pingMs = Math.round(performance.now() - m.at);
        break;
      case 'error':
        this.error = m.message === 'room not found' ? 'Кімнату не знайдено' : m.message;
        this.on.changed();
        break;
    }
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.ping);
    this.ws.close();
  }
}
