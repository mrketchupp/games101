// Dos conexiones independientes ejercitan el protocolo público, incluyendo una ronda completa.
import '../escondidas-en-pintura/artworks.js';
import '../escondidas-en-pintura/bot-ai.js';
import '../escondidas-en-pintura/room.js';
const { PROTOCOL_VERSION, CATALOG_VERSION } = (globalThis as unknown as { HideRoom: { PROTOCOL_VERSION: number; CATALOG_VERSION: string } }).HideRoom;
const endpoint = Deno.args[0] || 'ws://127.0.0.1:8787/escondidas-en-pintura/ws';
const sockets: WebSocket[] = [];
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function client(url: string) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  const messages: Record<string, unknown>[] = [];
  ws.addEventListener('message', (event) => messages.push(JSON.parse(event.data)));
  return {
    ws, messages,
    async wait(predicate: (m: Record<string, unknown>) => boolean, timeout = 20_000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('No llegó el mensaje esperado: ' + JSON.stringify(messages.map((m) => [m.t, m.phase, m.msg])));
    },
    async send(message: unknown) {
      const until = Date.now() + 10_000;
      while (ws.readyState === WebSocket.CONNECTING && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert(ws.readyState === WebSocket.OPEN, 'El WebSocket no se abrió');
      const value = message as Record<string, unknown>;
      if (value.t === 'create' || value.t === 'join') message = { ...value, protocol: PROTOCOL_VERSION, catalog: CATALOG_VERSION };
      ws.send(JSON.stringify(message));
    },
  };
}

try {
  const probeUrl = new URL(endpoint);
  probeUrl.searchParams.set('probe', '1');
  const probe = client(probeUrl.href);
  await probe.send({ t: 'ping' });
  await probe.wait((m) => m.t === 'pong');
  probe.ws.close();

  const host = client(endpoint);
  await host.send({ t: 'create', name: 'Prueba A', pid: crypto.randomUUID() });
  const welcome = await host.wait((m) => m.t === 'welcome');
  assert(welcome.protocol === PROTOCOL_VERSION && welcome.catalog === CATALOG_VERSION, 'El servidor debe usar la misma versión y catálogo que el cliente');
  const joinUrl = new URL(endpoint);
  joinUrl.searchParams.set('sala', String(welcome.code));
  const guestPid = crypto.randomUUID();
  const guest = client(joinUrl.href);
  await guest.send({ t: 'join', code: welcome.code, name: 'Prueba B', pid: guestPid });
  const guestWelcome = await guest.wait((m) => m.t === 'welcome');
  assert(guestWelcome.protocol === PROTOCOL_VERSION && guestWelcome.catalog === CATALOG_VERSION, 'Los dos jugadores deben compartir protocolo y catálogo');
  assert(welcome.code === guestWelcome.code && welcome.you !== guestWelcome.you, 'Deben ser dos humanos distintos en la misma sala');

  // Una sesión vieja no debe expulsar al jugador que acaba de reconectarse.
  const replacement = client(joinUrl.href);
  await replacement.send({ t: 'join', code: welcome.code, name: 'Prueba B', pid: guestPid });
  const rejoined = await replacement.wait((m) => m.t === 'welcome');
  assert(rejoined.you === guestWelcome.you, 'La reconexión debe conservar el jugador');
  const roster = await replacement.wait((m) => m.t === 'room');
  assert((roster.players as { connected: boolean }[]).filter((p) => p.connected).length === 2, 'Ambos jugadores deben seguir conectados');

  await host.send({ t: 'settings', rounds: 1, hideTime: 60, seekTime: 20 });
  await host.send({ t: 'start' });
  await Promise.all([host.wait((m) => m.phase === 'hide'), replacement.wait((m) => m.phase === 'hide')]);
  const idleMs = Number(Deno.args[1] || 0);
  if (idleMs > 0) await new Promise((resolve) => setTimeout(resolve, idleMs));
  const fig = {
    x: 100, y: 100, pose: 0, blend: 50,
    img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  };
  await host.send({ t: 'submit', fig });
  await replacement.send({ t: 'submit', fig: { ...fig, x: 300 } });
  const seeks = await Promise.all([host.wait((m) => m.phase === 'seek'), replacement.wait((m) => m.phase === 'seek')]);
  assert(seeks.every((m) => (m.participants as string[]).length === 2), 'Ambos deben recibir las dos figuras');
  await host.send({ t: 'found', target: guestWelcome.you, time: 3 });
  await replacement.send({ t: 'found', target: welcome.you, time: 5 });
  const results = await host.wait((m) => m.phase === 'results');
  assert((results.results as { score: number }[]).every((p) => p.score > 0), 'Ambos deben recibir puntos');
  const final = await replacement.wait((m) => m.phase === 'final');
  assert((final.standings as unknown[]).length === 2, 'Debe terminar la ronda con dos clasificados');

  const badUrl = new URL(endpoint);
  badUrl.searchParams.set('sala', 'IIII'); // El generador nunca usa I.
  const missing = client(badUrl.href);
  // Deno valida el código al recibir join; el Worker también puede rechazarlo al conectar.
  missing.ws.addEventListener('open', () => {
    missing.ws.send(JSON.stringify({ t: 'join', code: 'IIII', name: 'Prueba sin sala', protocol: PROTOCOL_VERSION, catalog: CATALOG_VERSION }));
  }, { once: true });
  await missing.wait((m) => m.t === 'error');
  console.log('PASS: ping, crear/unir, reconectar, dos figuras, búsqueda, puntos, final y sala inexistente.');
} finally {
  for (const ws of sockets) {
    try { ws.close(); } catch { /* conexión ya cerrada */ }
  }
}
