// Salas multijugador de «Escondidas en Pintura» por WebSocket.
// Lo monta el servidor de la colección (../server.ts) en /escondidas-en-pintura/ws.
// deno-lint-ignore-file no-explicit-any

import "./room.js";

const { Room } = (globalThis as any).HideRoom;

const MAX_MESSAGE = 450_000;
const EMPTY_ROOM_TTL = 2 * 60_000;

export function createMultiplayer() {
  const rooms = new Map<string, any>();
  const cleanup = new Map<string, ReturnType<typeof setTimeout>>();

  function makeCode(): string {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    do {
      code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
    } while (rooms.has(code));
    return code;
  }

  function scheduleCleanup(code: string) {
    if (cleanup.has(code)) clearTimeout(cleanup.get(code));
    cleanup.set(code, setTimeout(() => {
      cleanup.delete(code);
      const room = rooms.get(code);
      if (room && room.connectedHumans().length === 0) {
        room.destroy();
        rooms.delete(code);
        console.log(`[escondidas] sala ${code} cerrada (${rooms.size} activas)`);
      }
    }, EMPTY_ROOM_TTL));
  }

  function handleSocket(ws: WebSocket) {
    let room: any = null;
    let player: any = null;
    const conn = {
      send(msg: unknown) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      },
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string" || ev.data.length > MAX_MESSAGE) return;
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "ping") {
        conn.send({ t: "pong" });
        return;
      }
      if (!room) {
        let target: any = null;
        if (msg.t === "create") {
          const code = makeCode();
          target = new Room(code, { onEmpty: () => scheduleCleanup(code) });
          rooms.set(code, target);
          console.log(`[escondidas] sala ${code} creada (${rooms.size} activas)`);
        } else if (msg.t === "join") {
          target = rooms.get(String(msg.code ?? "").toUpperCase().trim());
          if (!target) {
            conn.send({ t: "error", msg: "No existe ninguna sala con ese código." });
            return;
          }
        } else {
          return;
        }
        const pid = typeof msg.pid === "string" ? msg.pid.slice(0, 40) : undefined;
        const res = target.join(conn, { name: msg.name, pid });
        if (res.error) {
          conn.send({ t: "error", msg: res.error });
          return;
        }
        room = target;
        player = res.player;
        if (cleanup.has(room.code)) {
          clearTimeout(cleanup.get(room.code));
          cleanup.delete(room.code);
        }
        return;
      }
      room.handle(player, msg);
    };

    ws.onclose = () => {
      if (room && player) room.disconnect(player, conn);
    };
    ws.onerror = () => {};
  }

  return {
    /** Responde a la petición de WebSocket del juego. */
    upgrade(req: Request): Response {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Se esperaba una conexión WebSocket", { status: 426 });
      }
      const { socket, response } = Deno.upgradeWebSocket(req, { idleTimeout: 60 });
      handleSocket(socket);
      return response;
    },
    stats() {
      return { rooms: rooms.size };
    },
  };
}
