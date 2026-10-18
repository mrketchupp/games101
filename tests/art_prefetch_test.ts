import '../escondidas-en-pintura/art-prefetch.js';

const gameSource = await Deno.readTextFile(new URL('../escondidas-en-pintura/game.js', import.meta.url));

type Prefetch = {
  enqueue(urls: string[]): void;
  prioritize(urls: string[]): void;
  hold(): () => void;
  pause(): void;
  resume(): void;
  refresh(): void;
  stop(): void;
  retryFailed(): void;
};

const { create } = (globalThis as typeof globalThis & {
  ArtPrefetch: { create(options: unknown): Prefetch };
}).ArtPrefetch;

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}

function fixture(urls: string[]) {
  let time = 0;
  let nextId = 0;
  let allowed = true;
  const scheduled = new Map<number, { at: number; run: () => void }>();
  const requests: {
    url: string;
    options: RequestInit & { priority: string };
    resolve: (response: Response) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const prefetch = create({
    urls,
    canRun: () => allowed,
    timers: {
      now: () => time,
      setTimeout(run: () => void, delay: number) {
        scheduled.set(++nextId, { at: time + delay, run });
        return nextId;
      },
      clearTimeout(id: number) { scheduled.delete(id); },
    },
    fetch(url: string, options: RequestInit & { priority: string }) {
      return new Promise<Response>((resolve, reject) => {
        requests.push({ url, options, resolve, reject });
        options.signal!.addEventListener('abort', () => reject(new DOMException('Interrumpido', 'AbortError')), { once: true });
      });
    },
  });
  async function flush() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }
  async function tick(ms = 0) {
    const target = time + ms;
    while (true) {
      const next = [...scheduled].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next;
      time = job.at;
      scheduled.delete(id);
      job.run();
      await flush();
    }
    time = target;
    await flush();
  }
  async function complete(index: number, status = 200) {
    requests[index].resolve(new Response(new Uint8Array([1, 2, 3]), { status }));
    await flush();
  }
  return { prefetch, requests, tick, complete, flush, setAllowed: (value: boolean) => { allowed = value; } };
}

Deno.test('precarga una obra cada vez, a baja prioridad y con un segundo entre archivos', async () => {
  const f = fixture(['a.webp', 'b.webp', 'a.webp']);
  await f.tick();
  assert(f.requests.length === 0, 'crear la cola no debe iniciar descargas');
  f.prefetch.resume();
  await f.tick();
  assert(f.requests.length === 1 && f.requests[0].url === 'a.webp', 'debe iniciar sólo la primera obra');
  assert(f.requests[0].options.priority === 'low' && f.requests[0].options.cache === 'default', 'debe usar baja prioridad y caché HTTP');
  await f.tick(10000);
  assert(f.requests.length === 1, 'no debe iniciar otra obra mientras la primera está activa');
  await f.complete(0);
  await f.tick(999);
  assert(f.requests.length === 1, 'debe dejar un segundo libre entre obras');
  await f.tick(1);
  assert(f.requests.length === 2 && f.requests[1].url === 'b.webp', 'debe continuar con la siguiente obra');
  await f.complete(1);
  f.prefetch.enqueue(['a.webp']);
  await f.tick(1000);
  assert(f.requests.length === 2, 'no debe repetir obras ya completadas');
  f.prefetch.stop();
});

Deno.test('la carga prioritaria interrumpe precarga y espera todas las liberaciones', async () => {
  const f = fixture(['a.webp', 'b.webp']);
  f.prefetch.resume();
  await f.tick();
  const releaseA = f.prefetch.hold();
  const releaseB = f.prefetch.hold();
  await f.flush();
  assert(f.requests[0].options.signal!.aborted, 'la obra necesaria debe abortar la descarga especulativa');
  releaseA();
  releaseA();
  await f.tick(10000);
  assert(f.requests.length === 1, 'una liberación duplicada no debe soltar al segundo consumidor');
  releaseB();
  await f.tick();
  assert(f.requests.length === 2, 'debe continuar al terminar todos los consumidores prioritarios');
  await f.complete(1);
  await f.tick(1000);
  assert(f.requests.length === 3 && f.requests[2].url === 'a.webp', 'debe recuperar la descarga abortada');
  f.prefetch.stop();
  await f.flush();
});

Deno.test('la política pausa y aborta la cola; cambios de red o visibilidad permiten reanudar', async () => {
  const f = fixture(['a.webp', 'b.webp']);
  f.setAllowed(false);
  f.prefetch.resume();
  await f.tick(1000);
  assert(f.requests.length === 0, 'canRun falso debe impedir todas las descargas');
  f.setAllowed(true);
  f.prefetch.refresh();
  await f.tick();
  assert(f.requests.length === 1, 'al mejorar las condiciones debe continuar');
  f.setAllowed(false);
  f.prefetch.refresh();
  await f.flush();
  assert(f.requests[0].options.signal!.aborted, 'ocultar pestaña o ahorrar datos debe abortar la precarga activa');
  await f.tick(5000);
  assert(f.requests.length === 1, 'no debe reintentar durante la pausa de política');
  f.setAllowed(true);
  f.prefetch.refresh();
  await f.tick();
  assert(f.requests.length === 2, 'debe reanudar la cola cuando vuelva a estar permitido');
  f.prefetch.stop();
  await f.flush();
});

Deno.test('un fallo no bloquea las demás obras y se recupera con backoff', async () => {
  const f = fixture(['a.webp', 'b.webp']);
  f.prefetch.resume();
  await f.tick();
  await f.complete(0, 503);
  await f.tick(1000);
  assert(f.requests.length === 2 && f.requests[1].url === 'b.webp', 'un fallo no debe retener la cola detrás de él');
  await f.complete(1);
  await f.tick(1999);
  assert(f.requests.length === 2, 'el fallo debe respetar su backoff de tres segundos');
  await f.tick(1);
  assert(f.requests.length === 3 && f.requests[2].url === 'a.webp', 'la obra fallida debe reintentarse');
  await f.complete(2);
  await f.tick(60000);
  assert(f.requests.length === 3, 'una recuperación exitosa debe retirar el trabajo de la cola');
  f.prefetch.stop();
});

Deno.test('los avisos de próximas obras cambian orden sin cancelar trabajo útil ni omitir la pausa', async () => {
  const f = fixture(['a.webp', 'b.webp', 'c.webp']);
  f.prefetch.resume();
  await f.tick();
  f.prefetch.prioritize(['c.webp', 'd.webp']);
  assert(!f.requests[0].options.signal!.aborted, 'priorizar no debe cancelar la descarga activa');
  await f.complete(0);
  f.prefetch.prioritize(['d.webp', 'c.webp']);
  await f.tick(999);
  assert(f.requests.length === 1, 'priorizar tampoco debe omitir la pausa entre archivos');
  await f.tick(1);
  assert(f.requests.length === 2 && f.requests[1].url === 'd.webp', 'debe respetar el orden de los avisos más recientes');
  f.prefetch.stop();
  await f.flush();
});

Deno.test('pause conserva pendientes; stop vacía e impide que un aborto tardío restaure trabajos antiguos', async () => {
  const f = fixture(['a.webp', 'b.webp']);
  f.prefetch.resume();
  await f.tick();
  f.prefetch.pause();
  await f.flush();
  await f.tick(5000);
  assert(f.requests.length === 1, 'pause debe detener también los reintentos');
  f.prefetch.resume();
  await f.tick();
  assert(f.requests.length === 2, 'resume debe conservar el trabajo pendiente');
  f.prefetch.stop();
  f.prefetch.enqueue(['nueva.webp']);
  f.prefetch.resume();
  await f.flush();
  await f.tick(1000);
  assert(f.requests.length === 3 && f.requests[2].url === 'nueva.webp', 'stop no debe resucitar descargas descartadas');
  f.prefetch.stop();
  await f.flush();
});

Deno.test('limita fallos a tres intentos por URL y sólo un reintento explícito reinicia el límite', async () => {
  const f = fixture(['falta.webp']);
  f.prefetch.resume();
  await f.tick();
  await f.complete(0, 404);
  await f.tick(3000);
  await f.complete(1, 404);
  await f.tick(6000);
  await f.complete(2, 404);
  await f.tick(60000);
  assert(f.requests.length === 3, 'un archivo ausente no debe descargarse para siempre');
  const release = f.prefetch.hold();
  release();
  f.prefetch.pause();
  f.prefetch.resume();
  f.prefetch.prioritize(['falta.webp']);
  await f.tick(60000);
  assert(f.requests.length === 3, 'pausar, reanudar o recibir avisos no debe reiniciar intentos fallidos');
  f.prefetch.retryFailed();
  await f.tick();
  assert(f.requests.length === 4, 'recuperar red explícitamente debe permitir otro intento');
  await f.complete(3);
  f.prefetch.stop();
});

Deno.test('consume el archivo por bloques y puede interrumpirlo después de recibir las cabeceras', async () => {
  const f = fixture(['a.webp', 'b.webp']);
  f.prefetch.resume();
  await f.tick();
  let body: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      body = controller;
      controller.enqueue(new Uint8Array([1, 2]));
    },
  }));
  f.requests[0].options.signal!.addEventListener('abort', () => body.error(new DOMException('Interrumpido', 'AbortError')));
  f.requests[0].resolve(response);
  await f.flush();
  await f.tick(5000);
  assert(f.requests.length === 1, 'recibir cabeceras o un bloque no debe liberar la concurrencia');
  const release = f.prefetch.hold();
  await f.flush();
  await f.tick(5000);
  assert(f.requests.length === 1, 'la interrupción de cuerpo tampoco debe reanudar antes de liberar foreground');
  release();
  await f.tick();
  assert(f.requests.length === 2, 'debe reanudar después de interrumpir un cuerpo parcial');
  f.prefetch.stop();
  await f.flush();
});

function clientLoadingFixture() {
  const retrySource = gameSource.slice(gameSource.indexOf('  async function artworkWhenCurrent('), gameSource.indexOf('  function extractPalette('));
  const botSource = gameSource.slice(gameSource.indexOf('  class Bot {'), gameSource.indexOf('  // El servidor decide por las CPU online'));
  const onlineSource = gameSource.slice(gameSource.indexOf('  let onlineBotPhase ='), gameSource.indexOf('  // ---------------------------------------------------------------- conexiones'));
  const retryTimers: (() => void)[] = [];
  const messages: { t: string }[] = [];
  let holds = 0;
  let calls = 0;
  let fail = true;
  const G = {
    mode: 'online', me: 'host',
    room: { hostId: 'host', round: 1 },
    link: { ready: true, send: (msg: { t: string }) => messages.push(msg) },
  };
  const api = new Function('artPrefetch', 'loadArtwork', 'setTimeout', 'Bots', 'getPainting', 'makeBotFigure', 'G',
    retrySource + botSource + onlineSource + `
      onlineBotPhase = {round: 1, seed: 42, phase: 'hide'};
      return {Bot, paintOnlineBots, cancelBotPainting};
    `)(
    { hold() { holds++; return () => { holds--; }; } },
    () => { calls++; return fail ? Promise.reject(new Error('Sin conexión')) : Promise.resolve({}); },
    (run: () => void) => retryTimers.push(run),
    { seedFor: () => 7, profile: () => ({}) },
    () => ({}), () => ({ img: 'figura' }), G,
  );
  const phase = { phase: 'hide', round: 1, seed: 42, painting: 0, collection: 1 };
  const bot = Object.create(api.Bot.prototype);
  Object.assign(bot, { alive: true, phase, player: { id: 'cpu' }, level: {}, send: G.link.send });
  async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
  return { api, G, bot, phase, retryTimers, messages, flush, recover: () => { fail = false; }, holds: () => holds, calls: () => calls };
}

Deno.test('la CPU local reintenta su figura tras un fallo de imagen sin esperar otro mensaje de fase', async () => {
  const f = clientLoadingFixture();
  const pending = f.bot.hide(f.phase, 'submit');
  await f.flush();
  assert(f.retryTimers.length === 1 && f.messages.length === 0, 'un fallo de carga debe dejar un reintento de la CPU');
  f.recover();
  f.retryTimers.shift()!();
  await pending;
  assert(f.calls() === 2 && f.messages[0]?.t === 'submit', 'la CPU debe enviar su figura al recuperarse la imagen');
  assert(f.holds() === 0, 'la recuperación debe liberar la prioridad foreground');
});

Deno.test('cambiar de fase durante un reintento de CPU impide enviar una figura obsoleta', async () => {
  const f = clientLoadingFixture();
  const pending = f.bot.hide(f.phase, 'submit');
  await f.flush();
  f.bot.phase = { ...f.phase, round: 2 };
  f.recover();
  f.retryTimers.shift()!();
  await pending;
  assert(f.messages.length === 0 && f.calls() === 1, 'no debe cargar ni enviar la figura de una fase ya cancelada');
  assert(f.holds() === 0, 'cancelar también debe liberar la prioridad de la carga');
});

Deno.test('la pintura CPU online se recupera sin repetir solicitudes y se cancela al perder la fase', async () => {
  const message = { round: 1, seed: 42, painting: 0, collection: 1, bots: [{ id: 'cpu', level: 1, seed: 7 }] };
  const f = clientLoadingFixture();
  f.api.paintOnlineBots(message);
  await f.flush();
  f.api.paintOnlineBots(message);
  assert(f.calls() === 1, 'el trabajo en recuperación debe seguir deduplicado');
  f.recover();
  f.retryTimers.shift()!();
  await f.flush();
  assert(f.messages[0]?.t === 'botFigure' && f.holds() === 0, 'debe completar la figura online al volver la imagen');

  const canceled = clientLoadingFixture();
  canceled.api.paintOnlineBots(message);
  await canceled.flush();
  canceled.api.cancelBotPainting();
  canceled.recover();
  canceled.retryTimers.shift()!();
  await canceled.flush();
  assert(canceled.messages.length === 0 && canceled.holds() === 0, 'una pintura online cancelada no debe enviar ni retener prioridad');
});

Deno.test('la política real del cliente respeta ahorro de datos, 2G, desconexión y pestaña oculta', () => {
  const policySource = gameSource.slice(gameSource.indexOf('  const artPrefetch ='), gameSource.indexOf('  function syncArtPrefetch('));
  const navigator = { onLine: true, connection: { saveData: false, effectiveType: '4g' } };
  const document = { hidden: false };
  const canRun = new Function('window', 'navigator', 'document', 'location', policySource + ';return artPrefetch;')(
    { HumanArt: { works: [] }, ArtPrefetch: { create: (options: { canRun: () => boolean }) => options.canRun } },
    navigator, document, { protocol: 'https:' },
  );
  assert(canRun(), 'una página visible y conectada puede precargar');
  navigator.connection.saveData = true;
  assert(!canRun(), 'no debe precargar con ahorro de datos');
  navigator.connection.saveData = false;
  for (const type of ['2g', 'slow-2g']) {
    navigator.connection.effectiveType = type;
    assert(!canRun(), 'no debe precargar en conexiones 2G');
  }
  navigator.connection.effectiveType = '4g';
  document.hidden = true;
  assert(!canRun(), 'no debe precargar con la pestaña oculta');
  document.hidden = false;
  navigator.onLine = false;
  assert(!canRun(), 'no debe precargar sin conexión');
});

Deno.test('el historial real reutiliza la guarda tras recargar y consume guardas heredadas al salir', async () => {
  const navigation = gameSource.slice(gameSource.indexOf('  const BackGuard = {'), gameSource.indexOf("  window.addEventListener('beforeunload'"));
  const entries: { eepGuard?: boolean }[] = [{}, { eepGuard: true }, { eepGuard: true }];
  let index = 2;
  let popstate: (event: { state: object }) => void;
  const G = { screen: 'scr-menu', mode: null, code: null };
  const history = {
    get state() { return entries[index]; },
    pushState(state: object) { entries.splice(index + 1); entries.push(state); index++; },
    replaceState(state: object) { entries[index] = state; },
    back() { index--; popstate({ state: entries[index] }); },
  };
  const guard: { armed: boolean; releasing: boolean; arm(): void; release(): void } = new Function('history', 'G', 'location', 'window', '$', 'confirmCancel', 'store', 'confirmBox', 'Tutorial', 'leaveGame',
    navigation + ';return BackGuard;')(
    history, G, { pathname: '/juego/', href: 'https://example.test/juego/' },
    { addEventListener(_name: string, run: typeof popstate) { popstate = run; } },
    () => ({ hidden: true }), null, { set() {} }, () => Promise.resolve(false), {},
    () => { G.screen = 'scr-menu'; guard.release(); },
  );
  G.screen = 'scr-cpu';
  guard.arm();
  assert(index === 2, 'recargar con una guarda existente no debe añadir otra');
  history.back();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert(G.screen === 'scr-menu' && index === 0, 'Atrás debe volver al menú y consumir las guardas antiguas');
  assert(!guard.armed && !guard.releasing, 'salir no debe dejar una guarda pendiente ni navegación bloqueada');
  G.screen = 'scr-cpu';
  guard.arm();
  assert(index === 1 && entries.length === 2, 'la siguiente entrada debe crear una única guarda');
});

Deno.test('el tiempo de carga descuenta búsqueda restante sin alterar su duración ni puntuación absolutas', async () => {
  const waitSource = gameSource.slice(gameSource.indexOf('  function accountArtworkWait('), gameSource.indexOf('  function extractPalette('));
  const seekSource = gameSource.slice(gameSource.indexOf('  async function setupSeek('), gameSource.indexOf('  async function loadFigs('));
  const G = new Function('return {phase: "seek", round: 1, me: "me", seek: null};')();
  const clock = { now: 100000 };
  const api = new Function('G', 'performance', 'meActive', 'loadFigs', 'updateHudSub',
    waitSource + seekSource + ';return {accountArtworkWait,setupSeek,reconcileSeek};')(
    G, { now: () => clock.now }, () => true, () => Promise.resolve({ other: { id: 'other' } }), () => {},
  );
  const message = { phase: 'seek', round: 1, seed: 42, limit: 50000, elapsed: 10000, duration: 52500, participants: ['me', 'other'] };
  const phase = api.accountArtworkWait(message, 5000);
  assert(phase.limit === 45000 && phase.elapsed === 15000, 'cinco segundos de carga deben sumarse al tiempo consumido');
  await api.setupSeek(phase);
  assert(G.seek.start === 85000 && G.seek.limit === 60, 'la búsqueda conserva su límite total y su reloj absoluto');
  G.seek.penalty = 4;
  G.seek.found.set('other', 22);
  api.reconcileSeek({ ...phase, elapsed: 25000, limit: 35000, finds: [{ seeker: 'me', target: 'other', time: 22 }], done: { me: 22 } });
  assert(G.seek.penalty === 4 && G.seek.found.get('other') === 22 && G.seek.done, 'reconectar debe conservar fallos, hallazgos y finalización');
  const late = api.accountArtworkWait({ ...message, limit: 5000, elapsed: 55000 }, 10000);
  assert(late.limit === 0 && late.elapsed === 60000, 'una carga tardía tampoco debe ampliar el tiempo total de la ronda');
  clock.now += 1000;
});

Deno.test('un cliente sin estado local recupera sus hallazgos y finalización del mensaje de búsqueda', async () => {
  const seekSource = gameSource.slice(gameSource.indexOf('  async function setupSeek('), gameSource.indexOf('  async function loadFigs('));
  const G = new Function('return {phase: "seek", round: 1, me: "me", seek: null};')();
  const setup = new Function('G', 'performance', 'meActive', 'loadFigs', 'updateHudSub', seekSource + ';return setupSeek;')(
    G, { now: () => 100000 }, () => true, () => Promise.resolve({ other: { id: 'other' } }), () => {},
  );
  await setup({ round: 1, seed: 42, limit: 20000, elapsed: 40000, participants: ['me', 'other'],
    finds: [{ seeker: 'me', target: 'other', time: 35 }], done: { me: 35 } });
  assert(G.seek.found.get('other') === 35 && G.seek.done && G.seek.loaded, 'la recarga debe recuperar hallazgos y evitar repetir la búsqueda terminada');
});

Deno.test('la carga real mantiene seis imágenes decodificadas y libera promesas y prioridad al terminar', async () => {
  const loading = gameSource.slice(gameSource.indexOf('  function rememberArtwork('), gameSource.indexOf('  /** Una obra necesaria'));
  const works = Array.from({ length: 7 }, (_, i) => ({ title: String(i), file: String(i) + '.jpg' }));
  const catalog = { works };
  let holds = 0;
  const images = new Map();
  const decoded = new Map();
  class Image {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  const load = new Function('window', 'HumanArt', 'artImages', 'decodedArt', 'artPrefetch', 'Image', 'setTimeout', 'clearTimeout',
    loading + ';return loadArtwork;')(
    { HumanArt: catalog }, catalog, images, decoded,
    { hold() { holds++; return () => { holds--; }; } }, Image, () => 1, () => {},
  );
  for (let i = 0; i < works.length; i++) await load(i);
  assert(decoded.size === 6 && !Object.hasOwn(works[0], 'image'), 'una séptima obra debe liberar la imagen decodificada más antigua');
  assert(images.size === 0 && holds === 0, 'la carga no debe retener promesas resueltas ni prioridad foreground');
});
