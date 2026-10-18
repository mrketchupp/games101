// Colecciones y reloj sin límite por el protocolo público, con reloj real.
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
function assertFigure(actual: Record<string, unknown> | undefined, expected: typeof fig, message: string) {
  assert(actual && Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value), message);
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
    async send(message: any) {
      const until = Date.now() + 10_000;
      while (ws.readyState === WebSocket.CONNECTING && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
      assert(ws.readyState === WebSocket.OPEN, 'El socket debe permanecer abierto');
      if (message.t === 'create' || message.t === 'join') message = { ...message, protocol: PROTOCOL_VERSION, catalog: CATALOG_VERSION };
      ws.send(JSON.stringify(message));
    },
    async wait(predicate: (message: any) => boolean, from = 0) {
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        const found = messages.slice(from).find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('No llegó el mensaje esperado: ' + JSON.stringify(messages.slice(from).map((m) => [m.t, m.phase, m.msg])));
    },
  };
}
type Client = ReturnType<typeof client>;
async function unchangedAfterHurry(sender: Client) {
  const from = sender.messages.length;
  await sender.send({ t: 'hurry' });
  await sender.send({ t: 'ping' });
  await sender.wait((m) => m.t === 'pong', from);
  assert(!sender.messages.slice(from).some((m) => m.t === 'phase'), 'El hurry no autorizado o repetido no debe reiniciar ni difundir la fase');
}

try {
  let host = client();
  const pid = crypto.randomUUID();
  await host.send({ t: 'create', name: 'Reloj arte', pid });
  const welcome = await host.wait((m) => m.t === 'welcome');
  const guest = client(welcome.code);
  await guest.send({ t: 'join', code: welcome.code, name: 'Pintor invitado', pid: crypto.randomUUID() });
  const guestWelcome = await guest.wait((m) => m.t === 'welcome');
  for (const [collection, hideTime, seekTime] of [[1, 300, 60], [0, 120, 30], [1, 300, 60]]) {
    const from = host.messages.length;
    await host.send({ t: 'settings', collection });
    const room = await host.wait((m) => m.t === 'room' && m.settings.collection === collection, from);
    assert(room.settings.hideTime === hideTime && room.settings.seekTime === seekTime, 'Cambiar colección debe recuperar sus tiempos por defecto');
  }
  const invalidFrom = host.messages.length;
  await host.send({ t: 'settings', hideTime: 60, seekTime: 20 });
  const retained = await host.wait((m) => m.t === 'room', invalidFrom);
  assert(retained.settings.hideTime === 300 && retained.settings.seekTime === 60, 'Arte debe rechazar tiempos exclusivos de patrones');
  const configuredFrom = host.messages.length;
  await host.send({ t: 'settings', rounds: 1, hideTime: 0, seekTime: 30 });
  await host.wait((m) => m.t === 'room' && m.settings.hideTime === 0 && m.settings.seekTime === 30, configuredFrom);
  await host.send({ t: 'start' });
  const hide = await host.wait((m) => m.t === 'phase' && m.phase === 'hide');
  assert(hide.collection === 1 && hide.duration === null && !hide.hurry, 'La fase arte sin límite debe publicar duration null');
  await guest.wait((m) => m.t === 'phase' && m.phase === 'hide');
  await unchangedAfterHurry(guest);

  // Se conserva una entrega lista y otra cancelada; hurry no inicia otra ronda.
  await guest.send({ t: 'submit', fig: { ...fig, x: 300 } });
  await guest.wait((m) => m.t === 'room' && m.players.find((p: any) => p.id === guestWelcome.you)?.ready);
  const canceledFrom = guest.messages.length;
  await guest.send({ t: 'unsubmit' });
  await guest.wait((m) => m.t === 'room' && !m.players.find((p: any) => p.id === guestWelcome.you)?.ready, canceledFrom);
  await host.send({ t: 'submit', fig });
  await host.wait((m) => m.t === 'room' && m.players.find((p: any) => p.id === welcome.you)?.ready);

  host = client(welcome.code);
  await host.send({ t: 'join', code: welcome.code, name: 'Reloj arte', pid });
  const infiniteResume = await host.wait((m) => m.t === 'phase' && m.phase === 'hide');
  assert(infiniteResume.duration === null && infiniteResume.seed === hide.seed, 'Reconectar antes de hurry debe conservar el reloj sin límite y la semilla');
  const hurryFrom = host.messages.length;
  const hurrySentAt = Date.now();
  await host.send({ t: 'hurry' });
  const hurried = await host.wait((m) => m.t === 'phase' && m.hurry, hurryFrom);
  assert(hurried.duration === 30_000 && hurried.seed === hide.seed && hurried.painting === hide.painting && hurried.round === hide.round, 'Hurry añade treinta segundos sin cambiar ronda, obra ni semilla');
  await new Promise((resolve) => setTimeout(resolve, 350));
  await unchangedAfterHurry(host);
  await unchangedAfterHurry(guest);
  await new Promise((resolve) => setTimeout(resolve, 350));

  host = client(welcome.code);
  await host.send({ t: 'join', code: welcome.code, name: 'Reloj arte', pid });
  const resumedRoom = await host.wait((m) => m.t === 'room');
  const resumed = await host.wait((m) => m.t === 'phase' && m.phase === 'hide');
  assert(resumed.hurry === true && resumed.duration < 29_500 && resumed.duration > 20_000, 'La reconexión debe recibir tiempo descontado, sin reiniciar hurry');
  assert(Math.abs(resumed.duration - (30_000 - (Date.now() - hurrySentAt))) < 1000, 'La reconexión conserva el plazo original de hurry');
  assert(resumedRoom.players.find((p: any) => p.id === welcome.you)?.ready === true, 'La figura lista debe seguir lista tras hurry y reconexión');
  assert(resumedRoom.players.find((p: any) => p.id === guestWelcome.you)?.ready === false, 'Cancelar la entrega debe conservarse tras hurry y reconexión');
  assert(resumed.seed === hide.seed && resumed.painting === hide.painting, 'La reconexión no debe regenerar obra ni semilla');
  await unchangedAfterHurry(host);
  await guest.send({ t: 'submit', fig: { ...fig, x: 350 } });
  const seek = await host.wait((m) => m.t === 'phase' && m.phase === 'seek');
  assert(seek.collection === 1 && seek.participants.length === 2, 'Ambas entregas deben permitir buscar en la colección arte');
  assertFigure(seek.figs[welcome.you], fig, 'La figura entregada antes de hurry debe llegar intacta a búsqueda');
  assertFigure(seek.figs[guestWelcome.you], { ...fig, x: 350 }, 'El invitado debe poder volver a entregar después de cancelar');
  await host.send({ t: 'found', target: guestWelcome.you, time: 3 });
  await guest.send({ t: 'found', target: welcome.you, time: 4 });
  const results = await host.wait((m) => m.t === 'phase' && m.phase === 'results');
  assert(results.results.length === 2 && results.results.every((p: any) => p.score > 0), 'La ronda reanudada debe puntuar para ambos');
  console.log('PASS: defaults y tiempos por colección; arte sin límite, hurry exclusivo del anfitrión sin extensión, cancelación, PNG y reloj conservados en reconexiones, búsqueda y puntos.');
} finally {
  for (const ws of sockets) {
    try { ws.close(); } catch { /* conexión ya cerrada */ }
  }
}
