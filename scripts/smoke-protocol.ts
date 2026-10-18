// Contrato público: versiones exactas y sockets reemplazados sin autoridad.
// deno-lint-ignore-file no-explicit-any
import '../escondidas-en-pintura/artworks.js';
import '../escondidas-en-pintura/bot-ai.js';
import '../escondidas-en-pintura/room.js';

const { PROTOCOL_VERSION, CATALOG_VERSION, ARTWORK_COUNT } = (globalThis as any).HideRoom;
const sockets: WebSocket[] = [];
const endpoint = Deno.args[0] || 'ws://127.0.0.1:8787/escondidas-en-pintura/ws';
const checkReplacedSocket = Deno.args.includes('--replaced-socket');
const fig = {
  x: 100, y: 100, pose: 0, blend: 0,
  img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function client(code?: string) {
  const url = new URL(endpoint);
  if (code) url.searchParams.set('sala', code);
  const ws = new WebSocket(url.href);
  sockets.push(ws);
  const messages: any[] = [];
  let closed: CloseEvent | undefined;
  ws.addEventListener('message', (event) => messages.push(JSON.parse(event.data)));
  ws.addEventListener('close', (event) => { closed = event; });
  return {
    ws, messages,
    async wait(predicate: (m: any) => boolean, from = 0, timeout = 10_000): Promise<any> {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const found = messages.slice(from).find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('No llegó el mensaje esperado: ' + JSON.stringify(messages.slice(from).map((m) => [m.t, m.phase, m.msg])));
    },
    async closeEvent() {
      const until = Date.now() + 10_000;
      while (!closed && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
      assert(closed, 'El servidor debe cerrar la conexión rechazada');
      return closed;
    },
    async send(message: unknown) {
      const until = Date.now() + 10_000;
      while (ws.readyState === WebSocket.CONNECTING && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert(ws.readyState === WebSocket.OPEN, 'El WebSocket debe estar abierto antes de enviar');
      ws.send(JSON.stringify(message));
    },
  };
}

function hello(t: string, extra: Record<string, unknown> = {}) {
  return { t, name: 'Contrato público', pid: crypto.randomUUID(), protocol: PROTOCOL_VERSION, catalog: CATALOG_VERSION, ...extra };
}

async function health() {
  const url = new URL(endpoint);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/health';
  const response = await fetch(url);
  assert(response.ok, '/health debe responder correctamente');
  const body = await response.json();
  const game = body.games?.['escondidas-en-pintura'] || body;
  assert(body.ok === true && game.protocol === 2 && game.artworks === 35 && game.cpu === true, '/health debe publicar protocolo 2, 35 obras y CPU disponible');
  assert(ARTWORK_COUNT === 35 && PROTOCOL_VERSION === 2, 'El cliente debe compartir los valores públicos comprobados');
  return game;
}

async function handshake() {
  await health();
  const host = client();
  const hostHello = hello('create');
  await host.send(hostHello);
  const welcome = await host.wait((m) => m.t === 'welcome');
  assert(welcome.protocol === PROTOCOL_VERSION && welcome.catalog === CATALOG_VERSION, 'Welcome debe devolver la versión y catálogo exactos');
  const initial = await host.wait((m) => m.t === 'room');
  assert(initial.players.length === 1 && initial.players[0].connected, 'La sala válida debe contener solo su anfitrión conectado');
  const invalid = [
    { protocol: undefined }, { protocol: 1 }, { protocol: '2' },
    { catalog: undefined }, { catalog: 'otro-catálogo' },
    { catalog: CATALOG_VERSION.split(',').reverse().join(',') },
  ];
  for (const change of invalid) {
    for (const kind of ['create', 'join']) {
      const before = await health();
      const observerFrom = host.messages.length;
      const rejected = client(kind === 'join' ? welcome.code : undefined);
      // Reutilizar el pid del anfitrión comprueba que la validación ocurre antes de reconectar.
      await rejected.send(hello(kind, { ...hostHello, t: kind, code: welcome.code, ...change }));
      await rejected.wait((m) => m.t === 'error');
      const closed = await rejected.closeEvent();
      assert(closed.code === 1008, 'Una versión incompatible debe cerrarse con 1008');
      assert(!rejected.messages.some((m) => ['welcome', 'room', 'phase', 'botPaint'].includes(m.t)), 'El hello rechazado no debe recibir datos de sala');
      await host.send({ t: 'ping' });
      await host.wait((m) => m.t === 'pong', observerFrom);
      assert(host.ws.readyState === WebSocket.OPEN, 'Un hello inválido no debe reemplazar la conexión existente');
      assert(!host.messages.slice(observerFrom).some((m) => m.t === 'room'), 'Un hello inválido no debe cambiar ni difundir el roster');
      const after = await health();
      if (before.rooms !== undefined) assert(after.rooms === before.rooms, 'Deno no debe crear una sala antes de validar la versión');
    }
  }
  host.ws.close();
  console.log('PASS: /health, welcome exacto y 12 hellos incompatibles rechazados antes de crear, unir o reconectar; roster intacto.');
}

async function replacedSocket() {
  const first = client();
  const identity = hello('create');
  await first.send(identity);
  const welcome = await first.wait((m) => m.t === 'welcome');
  const second = client(welcome.code);
  await second.send({ ...identity, t: 'join', code: welcome.code });
  await second.wait((m) => m.t === 'welcome' && m.you === welcome.you);
  const initial = await second.wait((m) => m.t === 'room');
  const from = second.messages.length;
  await first.send({ t: 'settings', rounds: 5, hideTime: 180, bots: 7, botLevel: 0 });
  assert((await first.closeEvent()).code === 4001, 'El socket antiguo debe cerrarse con 4001 al intentar settings');
  await second.send({ t: 'ping' });
  await second.wait((m) => m.t === 'pong', from);
  assert(!second.messages.slice(from).some((m) => m.t === 'room'), 'El socket antiguo no debe difundir settings');
  // Solicitar una difusión con settings vacío permite observar el estado retenido.
  await second.send({ t: 'settings' });
  const retained = await second.wait((m) => m.t === 'room', from);
  assert(JSON.stringify(retained.settings) === JSON.stringify(initial.settings), 'Los settings del socket antiguo no deben cambiar la sala');
  assert(retained.players.length === 1 && retained.players[0].connected, 'Cerrar el socket antiguo debe conservar la sesión nueva');
  await second.send({ t: 'settings', rounds: 1, hideTime: 60, seekTime: 20, bots: 1, botLevel: 3 });
  await second.wait((m) => m.t === 'room' && m.settings.bots === 1);
  await second.send({ t: 'start' });
  await second.wait((m) => m.phase === 'prepare');
  const third = client(welcome.code);
  await third.send({ ...identity, t: 'join', code: welcome.code });
  await third.wait((m) => m.t === 'welcome' && m.you === welcome.you);
  const request = await third.wait((m) => m.t === 'botPaint');
  const botId = request.bots[0].id;
  await second.send({ t: 'botFigure', botId, round: request.round, seed: request.seed, fig: { ...fig, x: 666 } });
  assert((await second.closeEvent()).code === 4001, 'El socket antiguo debe cerrarse con 4001 al intentar botFigure');
  await third.send({ t: 'botFigure', botId, round: request.round, seed: request.seed, fig: { ...fig, x: 321 } });
  await third.wait((m) => m.phase === 'hide');
  await third.send({ t: 'submit', fig });
  const seek = await third.wait((m) => m.phase === 'seek', 0, 70_000);
  assert(seek.figs[botId].x === 321, 'La imagen CPU debe proceder del socket nuevo; el replay antiguo no debe haber ocupado su lugar');
  const pingFrom = third.messages.length;
  await third.send({ t: 'ping' });
  await third.wait((m) => m.t === 'pong', pingFrom);
  assert(third.ws.readyState === WebSocket.OPEN, 'La sesión nueva debe seguir abierta tras ambos cierres antiguos');
  third.ws.close();
  console.log('PASS: reconexión Deno; settings y botFigure antiguos cierran con 4001 sin mutación, figura y sesión nuevas conservadas.');
}

try {
  await Promise.all([handshake(), ...(checkReplacedSocket ? [replacedSocket()] : [])]);
} finally {
  for (const ws of sockets) {
    try { ws.close(); } catch { /* conexión ya cerrada */ }
  }
}
