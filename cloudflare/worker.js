import { DurableObject } from 'cloudflare:workers';
import '../escondidas-en-pintura/room.js';

const { Room } = globalThis.HideRoom;
const WS_PATH = '/escondidas-en-pintura/ws';
const INTERNAL_PATH = '/room-socket';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_MESSAGE = 450_000;
const EMPTY_ROOM_TTL = 2 * 60_000;
const HELLO_TIMEOUT = 10_000;
const MAX_SOCKETS = 16;
const CHUNK_SIZE = 64 * 1024;
const MAX_CHUNKS = 256;
const PING = JSON.stringify({ t: 'ping' });
const PONG = JSON.stringify({ t: 'pong' });
const MUTATIONS = new Set(['settings', 'start', 'lobby', 'submit', 'unsubmit', 'figure', 'found', 'seekDone']);

function isUpgrade(request) {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function makeCode() {
  const random = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(random, (byte) => LETTERS[byte % LETTERS.length]).join('');
}

function socketError(socket, message) {
  try { socket.send(JSON.stringify({ t: 'error', msg: message })); } catch { /* already closed */ }
}

function closeSocket(socket, code = 1000, reason = '') {
  try { socket.close(code, reason); } catch { /* already closed */ }
}

function probeSocket() {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.addEventListener('message', (event) => {
    if (typeof event.data !== 'string' || event.data.length > 1024) {
      closeSocket(server, 1008, 'Mensaje no válido');
      return;
    }
    try {
      if (JSON.parse(event.data)?.t === 'ping') server.send(PONG);
      else closeSocket(server, 1008, 'Solo se admite ping');
    } catch { closeSocket(server, 1008, 'Mensaje no válido'); }
  });
  server.addEventListener('close', () => closeSocket(server));
  server.addEventListener('error', () => closeSocket(server, 1011, 'Conexión interrumpida'));
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'games101-multiplayer', transport: 'websocket' }, {
        headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
      });
    }
    if (url.pathname !== WS_PATH) return new Response('No encontrado', { status: 404 });
    if (request.method !== 'GET') return new Response('Método no permitido', { status: 405 });
    if (!isUpgrade(request)) return new Response('Se esperaba una conexión WebSocket', { status: 426 });

    // Only these public parameters are accepted. In particular, a caller cannot
    // forward the internal creation flag or choose the code of a new room.
    for (const key of url.searchParams.keys()) {
      if (!['sala', 'probe'].includes(key) || url.searchParams.getAll(key).length !== 1) {
        return new Response('Parámetros no válidos', { status: 400 });
      }
    }
    const code = url.searchParams.get('sala');
    const probe = url.searchParams.get('probe');
    if (probe !== null) {
      if (probe !== '1' || code !== null) return new Response('Parámetros no válidos', { status: 400 });
      return probeSocket();
    }
    if (code !== null && !/^[A-Z]{4}$/.test(code)) return new Response('Código no válido', { status: 400 });

    const forward = (roomCode, create) => {
      const internal = new URL(`https://rooms.internal${INTERNAL_PATH}`);
      internal.searchParams.set('sala', roomCode);
      if (create) internal.searchParams.set('create', '1');
      return env.ROOMS.getByName(roomCode).fetch(new Request(internal, {
        method: 'GET', headers: request.headers,
      }));
    };
    if (code !== null) return forward(code, false);
    for (let attempt = 0; attempt < 16; attempt++) {
      const response = await forward(makeCode(), true);
      if (response.status !== 409) return response;
    }
    return new Response('No se pudo reservar una sala. Inténtalo de nuevo.', { status: 503 });
  },
};

/** One persistent, hibernatable Durable Object per four-letter room code. */
export class PaintRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.emptySince = null;
    this.chunkCount = 0;
    this.sessions = new Map();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.blockConcurrencyWhile(async () => {
      await this.load();
      for (const socket of ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment();
        if (!attachment || typeof attachment.socketId !== 'string' || socket.readyState !== 1) {
          closeSocket(socket, 1008, 'Sesión no válida');
          continue;
        }
        const session = this.session(socket, attachment);
        if (!attachment.playerId) continue;
        const player = this.room?.get(attachment.playerId);
        if (!player || player.pid !== attachment.pid || player.socketId !== attachment.socketId) {
          this.sessions.delete(socket);
          closeSocket(socket, 4001, 'Conexión reemplazada');
          continue;
        }
        player.conn = session.conn;
        player.connected = true;
      }
      let dirty = false;
      if (this.room) {
        // A worker restart may retain the snapshot after losing a connection.
        // Reconcile it before delivering any new event to the room.
        for (const player of [...this.room.players]) {
          if (player.connected && !player.conn) {
            this.room.disconnect(player, null);
            dirty = true;
          }
        }
        dirty = this.updateEmpty() || dirty;
      }
      await this.flush(dirty);
    });
  }

  // Storage transactions are asynchronous; gate entire mutations so a second
  // message cannot alter the room while the previous snapshot is being saved.
  run(operation) {
    return this.ctx.blockConcurrencyWhile(operation);
  }

  session(socket, attachment) {
    const session = {
      ...attachment,
      conn: { send(message) { if (socket.readyState === 1) socket.send(JSON.stringify(message)); } },
    };
    this.sessions.set(socket, session);
    return session;
  }

  fetch(request) {
    return this.run(async () => {
      const url = new URL(request.url);
      const code = url.searchParams.get('sala');
      const create = url.searchParams.get('create') === '1';
      if (url.pathname !== INTERNAL_PATH || request.method !== 'GET' || !isUpgrade(request) || !/^[A-Z]{4}$/.test(code || '')) {
        return new Response('Petición no válida', { status: 400 });
      }
      let dirty = await this.advance();
      if (create && this.room) {
        await this.flush(dirty);
        return new Response('Código ocupado', { status: 409 });
      }
      if (this.sessions.size >= MAX_SOCKETS) {
        await this.flush(dirty);
        return new Response('Demasiadas conexiones en esta sala', { status: 429 });
      }
      if (create) {
        this.room = new Room(code, { externalTimers: true, onEmpty: () => this.updateEmpty() });
        this.emptySince = Date.now();
        dirty = true;
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      if (!this.room) {
        socketError(server, 'No existe ninguna sala con ese código.');
        closeSocket(server, 1008, 'Sala inexistente');
      } else {
        const attachment = {
          code, canCreate: create, socketId: crypto.randomUUID(),
          pid: null, playerId: null, helloDeadline: Date.now() + HELLO_TIMEOUT,
        };
        server.serializeAttachment(attachment);
        this.session(server, attachment);
      }
      await this.flush(dirty);
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  webSocketMessage(socket, message) {
    return this.run(async () => {
      const session = this.sessions.get(socket);
      if (!session) { closeSocket(socket, 4001, 'Sesión reemplazada'); return; }
      if (typeof message !== 'string' || message.length > MAX_MESSAGE) {
        const dirty = this.detach(socket);
        closeSocket(socket, typeof message === 'string' ? 1009 : 1003, 'Mensaje no válido');
        await this.flush(dirty);
        return;
      }
      let msg;
      try { msg = JSON.parse(message); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      // Noncanonical JSON pings still work, without persisting or moving timers.
      if (msg.t === 'ping') { session.conn.send({ t: 'pong' }); return; }
      let dirty = await this.advance();
      if (!this.room || !this.sessions.has(socket)) {
        socketError(socket, 'La sala ya no existe.');
        closeSocket(socket, 1008, 'Sala cerrada');
        await this.flush(dirty);
        return;
      }
      if (!session.playerId) {
        const validHello = session.canCreate
          ? msg.t === 'create'
          : msg.t === 'join' && String(msg.code || '').toUpperCase().trim() === this.room.code;
        if (!validHello) {
          socketError(socket, 'La petición no coincide con la sala.');
          this.detach(socket);
          closeSocket(socket, 1008, 'Sala no válida');
          await this.flush(dirty);
          return;
        }
        const pid = typeof msg.pid === 'string' ? msg.pid.slice(0, 40) : undefined;
        const previous = pid && this.room.players.find((player) => player.pid === pid);
        const previousSocketId = previous?.socketId;
        const result = this.room.join(session.conn, { name: msg.name, pid });
        if (result.error) {
          socketError(socket, result.error);
          this.detach(socket);
          closeSocket(socket, 1008, 'No se pudo entrar');
          await this.flush(dirty);
          return;
        }
        const player = result.player;
        player.socketId = session.socketId;
        session.pid = player.pid;
        session.playerId = player.id;
        session.helloDeadline = null;
        socket.serializeAttachment({
          code: session.code, canCreate: false, socketId: session.socketId,
          pid: session.pid, playerId: session.playerId, helloDeadline: null,
        });
        // Remove the old socket before closing it. Its delayed close event must
        // never mark the newly reconnected player as disconnected.
        if (previousSocketId) {
          for (const [other, old] of this.sessions) {
            if (other !== socket && old.socketId === previousSocketId) {
              this.sessions.delete(other);
              closeSocket(other, 4001, 'Conexión reemplazada');
            }
          }
        }
        this.updateEmpty();
        dirty = true;
      } else {
        const player = this.room.get(session.playerId);
        if (!player || player.pid !== session.pid || player.socketId !== session.socketId || player.conn !== session.conn) {
          this.sessions.delete(socket);
          closeSocket(socket, 4001, 'Conexión reemplazada');
          await this.flush(dirty);
          return;
        }
        this.room.handle(player, msg);
        dirty = MUTATIONS.has(msg.t) || dirty;
      }
      await this.flush(dirty);
    });
  }

  webSocketClose(socket, code) {
    return this.run(async () => {
      const dirty = this.detach(socket);
      closeSocket(socket, code === 1005 || code === 1006 || code === 1015 ? 1000 : code);
      await this.flush(dirty);
    });
  }

  webSocketError(socket) {
    return this.run(async () => {
      const dirty = this.detach(socket);
      closeSocket(socket, 1011, 'Conexión interrumpida');
      await this.flush(dirty);
    });
  }

  detach(socket) {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);
    if (!session?.playerId || !this.room) return false;
    const player = this.room.get(session.playerId);
    if (!player || player.socketId !== session.socketId || player.conn !== session.conn) return false;
    this.room.disconnect(player, session.conn);
    this.updateEmpty();
    return true;
  }

  updateEmpty() {
    if (!this.room) return false;
    if (this.room.connectedHumans().length) {
      const changed = this.emptySince !== null;
      this.emptySince = null;
      return changed;
    }
    if (this.emptySince === null) { this.emptySince = Date.now(); return true; }
    return false;
  }

  async advance() {
    const now = Date.now();
    for (const [socket, session] of this.sessions) {
      if (!session.playerId && session.helloDeadline <= now) {
        this.sessions.delete(socket);
        closeSocket(socket, 1008, 'Se agotó el tiempo para entrar');
      }
    }
    let dirty = this.updateEmpty();
    if (this.room && this.emptySince !== null && now >= this.emptySince + EMPTY_ROOM_TTL) {
      this.room.destroy();
      this.room = null;
      this.emptySince = null;
      this.chunkCount = 0;
      for (const socket of this.sessions.keys()) closeSocket(socket, 4004, 'Sala cerrada');
      this.sessions.clear();
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return false;
    }
    // The deadline comes from the saved room, so waking from hibernation never
    // grants a fresh full timer to a phase that had already started.
    if (this.room?.tick(now)) dirty = true;
    return dirty;
  }

  alarm() {
    return this.run(async () => { await this.flush(await this.advance()); });
  }

  chunkKey(index) { return `snapshot:${String(index).padStart(4, '0')}`; }

  async load() {
    const meta = await this.ctx.storage.get('meta');
    if (!meta) return;
    if (meta.version !== 1 || !Number.isInteger(meta.chunks) || meta.chunks < 1 || meta.chunks > MAX_CHUNKS) {
      throw new Error('Invalid persisted room metadata');
    }
    const chunks = [];
    for (let offset = 0; offset < meta.chunks; offset += 128) {
      const keys = Array.from({ length: Math.min(128, meta.chunks - offset) }, (_, index) => this.chunkKey(offset + index));
      const values = await this.ctx.storage.get(keys);
      for (const key of keys) {
        const value = values.get(key);
        if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) throw new Error('Missing room snapshot chunk');
        chunks.push(value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      }
    }
    const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const state = JSON.parse(new TextDecoder().decode(bytes));
    this.room = Room.restore(state, { externalTimers: true, onEmpty: () => this.updateEmpty() });
    this.emptySince = meta.emptySince ?? null;
    this.chunkCount = meta.chunks;
  }

  async flush(dirty) {
    if (dirty && this.room) {
      // Pictures are duplicated in phaseMsg for reconnect sync. A whole room
      // can exceed a single storage value's limit; each binary chunk is 64 KiB.
      const bytes = new TextEncoder().encode(JSON.stringify(this.room.snapshot()));
      const count = Math.ceil(bytes.byteLength / CHUNK_SIZE);
      if (count > MAX_CHUNKS) throw new Error('Room snapshot exceeds its storage budget');
      const previousCount = this.chunkCount;
      await this.ctx.storage.transaction(async (transaction) => {
        for (let offset = 0; offset < count; offset += 128) {
          const batch = {};
          for (let index = offset; index < Math.min(offset + 128, count); index++) {
            batch[this.chunkKey(index)] = bytes.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
          }
          await transaction.put(batch);
        }
        await transaction.put('meta', { version: 1, chunks: count, emptySince: this.emptySince });
        for (let offset = count; offset < previousCount; offset += 128) {
          await transaction.delete(Array.from({ length: Math.min(128, previousCount - offset) }, (_, index) => this.chunkKey(offset + index)));
        }
      });
      this.chunkCount = count;
    }
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    const deadlines = [];
    if (this.room?.deadline) deadlines.push(this.room.deadline);
    if (this.room && this.emptySince !== null) deadlines.push(this.emptySince + EMPTY_ROOM_TTL);
    for (const session of this.sessions.values()) {
      if (!session.playerId && session.helloDeadline) deadlines.push(session.helloDeadline);
    }
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }
}
