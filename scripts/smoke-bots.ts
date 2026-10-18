// Protocolo público real: CPU sin socket, búsqueda del servidor y relevo del anfitrión.
// La imagen de 1 px es un fixture de protocolo; no evalúa el camuflaje visual.
// deno-lint-ignore-file no-explicit-any
import '../escondidas-en-pintura/artworks.js';
import '../escondidas-en-pintura/bot-ai.js';
import '../escondidas-en-pintura/room.js';
const { PROTOCOL_VERSION, CATALOG_VERSION } = (globalThis as any).HideRoom;
const endpoint = Deno.args[0] || 'ws://127.0.0.1:8787/escondidas-en-pintura/ws';
const sockets: WebSocket[] = [];
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
  ws.addEventListener('message', (event) => messages.push(JSON.parse(event.data)));
  return {
    ws, messages,
    async wait(predicate: (m: any) => boolean, timeout = 70_000, from = 0): Promise<any> {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const found = messages.slice(from).find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('No llegó el mensaje esperado: ' + JSON.stringify(messages.slice(from).map((m) => [m.t, m.phase, m.msg])));
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

type Client = ReturnType<typeof client>;

async function paintBots(host: Client, request: any) {
  assert(Array.isArray(request.bots) && request.bots.length > 0, 'El anfitrión debe recibir CPU para pintar');
  for (const bot of request.bots) {
    await host.send({
      t: 'botFigure', botId: bot.id, round: request.round, seed: request.seed,
      fig: { ...fig, x: 300, blend: 40 },
    });
  }
}

async function configure(host: Client, level: number) {
  await host.send({ t: 'settings', rounds: 1, hideTime: 60, seekTime: 20, bots: 1, botLevel: level });
  const room = await host.wait((m) => m.t === 'room' && m.settings.bots === 1 && m.settings.botLevel === level);
  const bots = room.players.filter((p: any) => p.bot);
  assert(bots.length === 1 && bots[0].connected, 'Debe aparecer exactamente una CPU conectada');
  assert(bots[0].botLevel === level, 'El nivel configurado debe aparecer en el roster');
  assert(!Object.hasOwn(bots[0], 'pid'), 'El roster no debe filtrar credenciales de la CPU');
  return bots[0];
}

async function solo() {
  const host = client();
  await host.send({ t: 'create', name: 'Humano con CPU', pid: crypto.randomUUID(), bot: true });
  const welcome = await host.wait((m) => m.t === 'welcome');
  const initial = await host.wait((m) => m.t === 'room');
  assert(!initial.players.find((p: any) => p.id === welcome.you).bot, 'El cliente no puede declararse CPU mediante hello');
  const bot = await configure(host, 3);
  await host.send({ t: 'start' });
  await host.wait((m) => m.phase === 'prepare');
  const paint = await host.wait((m) => m.t === 'botPaint');
  await paintBots(host, paint);
  await host.wait((m) => m.phase === 'hide');
  await host.send({ t: 'submit', fig });
  await host.wait((m) => m.phase === 'check');
  const seek = await host.wait((m) => m.phase === 'seek');
  assert(seek.participants.length === 2 && seek.participants.includes(bot.id), 'Humano y CPU deben participar en la búsqueda');
  await host.send({ t: 'found', target: bot.id, time: 3 });
  const cpuFind = await host.wait((m) => m.t === 'found' && m.seeker === bot.id);
  assert(cpuFind.target === welcome.you && cpuFind.time > 0, 'La CPU experta busca al humano con su propio reloj');
  const results = await host.wait((m) => m.phase === 'results');
  const cpuResult = results.results.find((p: any) => p.id === bot.id);
  assert(cpuResult?.found === 1 && cpuResult.score > 0, 'La CPU debe recibir puntos por su búsqueda autónoma');
  const final = await host.wait((m) => m.phase === 'final');
  assert(final.standings.length === 2, 'La clasificación final debe incluir al humano y la CPU');
  host.ws.close();
  console.log('PASS: un humano + CPU experta; fases, PNG del anfitrión, búsqueda autónoma, puntuación y final.');
}

async function multiplayer() {
  const host = client();
  await host.send({ t: 'create', name: 'Anfitrión inicial', pid: crypto.randomUUID() });
  const welcome = await host.wait((m) => m.t === 'welcome');
  const guest = client(welcome.code);
  await guest.send({ t: 'join', code: welcome.code, name: 'Nuevo anfitrión', pid: crypto.randomUUID() });
  const guestWelcome = await guest.wait((m) => m.t === 'welcome');
  const bot = await configure(host, 0);
  await guest.wait((m) => m.t === 'room' && m.settings.bots === 1);
  const configStart = guest.messages.length;
  await guest.send({ t: 'settings', bots: 7, botLevel: 3 });
  await guest.send({ t: 'ping' });
  await guest.wait((m) => m.t === 'pong', 10_000, configStart);
  assert(!guest.messages.slice(configStart).some((m) => m.t === 'room' && (m.settings.bots !== 1 || m.settings.botLevel !== 0)), 'Solo el anfitrión puede cambiar la CPU');

  await host.send({ t: 'start' });
  await guest.wait((m) => m.phase === 'prepare');
  await host.wait((m) => m.t === 'botPaint');
  assert(!guest.messages.some((m) => m.t === 'botPaint'), 'La petición PNG debe dirigirse únicamente al anfitrión');
  // Se cierra antes de aportar la imagen: el siguiente anfitrión debe recuperarla.
  host.ws.close();
  await guest.wait((m) => m.t === 'room' && m.hostId === guestWelcome.you);
  const reassigned = await guest.wait((m) => m.t === 'botPaint');
  assert(reassigned.bots.some((p: any) => p.id === bot.id), 'El nuevo anfitrión debe recibir la CPU pendiente');
  await paintBots(guest, reassigned);
  await guest.wait((m) => m.phase === 'hide');
  await guest.send({ t: 'submit', fig });
  await guest.wait((m) => m.phase === 'check');
  const seek = await guest.wait((m) => m.phase === 'seek');
  assert(seek.participants.includes(bot.id) && seek.participants.includes(guestWelcome.you), 'El relevo debe conservar al humano y la CPU');
  await guest.send({ t: 'found', target: bot.id, time: 4 });
  const results = await guest.wait((m) => m.phase === 'results');
  assert(results.results.some((p: any) => p.id === bot.id && p.score > 0), 'La CPU debe seguir puntuando después del relevo');
  const final = await guest.wait((m) => m.phase === 'final');
  assert(final.standings.some((p: any) => p.id === bot.id), 'La CPU debe conservarse hasta el final');
  guest.ws.close();
  console.log('PASS: dos humanos + CPU fácil; configuración exclusiva, relevo PNG y partida completada tras desconexión.');
}

try {
  await Promise.all([solo(), multiplayer()]);
} finally {
  for (const ws of sockets) {
    try { ws.close(); } catch { /* conexión ya cerrada */ }
  }
}
