// Local workerd integration: real Durable Object eviction, live sockets, and alarms.
// The PNG is a protocol fixture; this does not assess visual camouflage.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestHarness } from 'wrangler';
import '../escondidas-en-pintura/artworks.js';
import '../escondidas-en-pintura/bot-ai.js';
import '../escondidas-en-pintura/room.js';

const { PROTOCOL_VERSION, CATALOG_VERSION, MS } = globalThis.HideRoom;
const Bots = globalThis.HideBots;
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createTestHarness({ root, workers: [{ configPath: './wrangler.jsonc' }] });
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const humanFigure = { x: 100, y: 100, pose: 0, blend: 0, img: image };
const cpuFigure = { ...humanFigure, x: 300, blend: 40 };
const startedAt = Date.now();
let socket;

function log(message) {
  console.log(`${((Date.now() - startedAt) / 1000).toFixed(2)}s ${message}`);
}

function client(url) {
  const ws = new WebSocket(url);
  socket = ws;
  const events = [];
  const pending = new Set();
  let closed;
  ws.addEventListener('message', (event) => {
    const entry = { message: JSON.parse(event.data), receivedAt: Date.now() };
    events.push(entry);
    if (entry.message.t === 'error') {
      for (const waiter of pending) waiter.fail(new Error(entry.message.msg));
    } else {
      for (const waiter of pending) waiter.check(entry);
    }
  });
  ws.addEventListener('close', (event) => {
    closed = { code: event.code, reason: event.reason };
    for (const waiter of pending) waiter.fail(new Error(`Socket closed: ${JSON.stringify(closed)}`));
  });
  ws.addEventListener('error', () => {
    for (const waiter of pending) waiter.fail(new Error('WebSocket error'));
  });
  return {
    ws, events,
    assertLive() {
      assert.equal(closed, undefined, 'The original socket must never close');
      assert.equal(ws.readyState, WebSocket.OPEN, 'The original socket remains open');
    },
    async send(message) {
      if (ws.readyState === WebSocket.CONNECTING) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('WebSocket open timeout')), 10_000);
          ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
          ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket failed to open')); }, { once: true });
        });
      }
      this.assertLive();
      ws.send(JSON.stringify(message));
    },
    wait(predicate, { timeout = 70_000, from = 0 } = {}) {
      const existing = events.slice(from).find((entry) => predicate(entry.message));
      if (existing) return Promise.resolve(existing);
      if (closed) return Promise.reject(new Error(`Socket already closed: ${JSON.stringify(closed)}`));
      return new Promise((resolve, reject) => {
        const finish = (callback, value) => { clearTimeout(timer); pending.delete(waiter); callback(value); };
        const waiter = {
          check(entry) { if (predicate(entry.message)) finish(resolve, entry); },
          fail(error) { finish(reject, error); },
        };
        const timer = setTimeout(() => waiter.fail(new Error(`Message timeout; received ${JSON.stringify(events.slice(from).map(({ message }) => [message.t, message.phase, message.msg]))}`)), timeout);
        pending.add(waiter);
      });
    },
  };
}

function checkRoster(message, humanId, cpuId) {
  assert.equal(message.players.length, 2, 'One human and one CPU remain in the roster');
  const human = message.players.find((player) => player.id === humanId);
  const cpu = message.players.find((player) => player.id === cpuId);
  assert(human?.connected && !human.bot, 'The same human remains connected');
  assert(cpu?.connected && cpu.bot && cpu.botLevel === 3, 'The same expert CPU remains connected');
  assert.equal(message.hostId, humanId, 'The human remains host');
  assert(!Object.hasOwn(cpu, 'pid'), 'CPU private identity stays private');
}

// Wide enough for ordinary local scheduling jitter, narrower than either
// deliberate pre-eviction interval, so a restarted CPU clock fails the check.
function checkAlarmTime(actual, expected, label, tolerance) {
  const drift = actual - expected;
  assert(Math.abs(drift) < tolerance, `${label} shifted by ${drift.toFixed(0)}ms`);
  log(`${label}: ${drift.toFixed(0)}ms from original CPU schedule`);
}

async function evict(worker, roomCode, phase) {
  log(`Calling evictDurableObject(PaintRoom, ${roomCode}, webSockets=hibernate) during ${phase}`);
  await worker.evictDurableObject('PaintRoom', { name: roomCode, webSockets: 'hibernate' });
  log(`Eviction API resolved during ${phase}`);
}

try {
  const { url } = await server.listen();
  const worker = server.getWorker();
  const health = await server.fetch('/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).cpu, true);
  log(`Local harness ready on ephemeral port ${url.port}`);
  const endpoint = new URL('/escondidas-en-pintura/ws', url);
  endpoint.protocol = 'ws:';
  const host = client(endpoint);
  await host.send({ t: 'create', name: 'Hibernation smoke', pid: crypto.randomUUID(), protocol: PROTOCOL_VERSION, catalog: CATALOG_VERSION });
  const { message: welcome } = await host.wait((message) => message.t === 'welcome');
  assert.equal(welcome.protocol, PROTOCOL_VERSION);
  assert.equal(welcome.catalog, CATALOG_VERSION);
  await host.send({ t: 'settings', rounds: 1, hideTime: 60, seekTime: 20, bots: 1, botLevel: 3 });
  const { message: configured } = await host.wait((message) => message.t === 'room' && message.settings.bots === 1 && message.settings.botLevel === 3);
  const cpu = configured.players.find((player) => player.bot);
  assert(cpu);
  checkRoster(configured, welcome.you, cpu.id);
  await host.send({ t: 'start' });
  const { message: painting } = await host.wait((message) => message.t === 'botPaint');
  assert.deepEqual(painting.bots.map((bot) => bot.id), [cpu.id]);
  await host.send({ t: 'botFigure', botId: cpu.id, round: painting.round, seed: painting.seed, fig: cpuFigure });
  const hide = await host.wait((message) => message.t === 'phase' && message.phase === 'hide');
  await host.send({ t: 'submit', fig: humanFigure });
  const readyDelay = Bots.readyDelay({ level: 3, hideTime: 60, seed: Bots.seedFor(painting.seed, cpu.id) }) * 1000;
  const expectedReadyAt = hide.receivedAt + readyDelay;
  log(`Hide entered; original CPU readiness due in ${(readyDelay / 1000).toFixed(2)}s`);
  await delay(2200);
  const hideBoundary = host.events.length;
  await evict(worker, welcome.code, 'hide');
  host.assertLive();
  // No messages are sent after eviction: the CPU readiness alarm must wake the
  // object, recover the socket attachment, and advance the accepted figures.
  const readyRoster = await host.wait((message) => message.t === 'room' && message.players.some((player) => player.id === cpu.id && player.ready), { from: hideBoundary });
  checkRoster(readyRoster.message, welcome.you, cpu.id);
  const check = await host.wait((message) => message.t === 'phase' && message.phase === 'check', { from: hideBoundary });
  checkAlarmTime(check.receivedAt, expectedReadyAt, 'Hide readiness alarm after eviction', 1400);
  host.assertLive();
  const seek = await host.wait((message) => message.t === 'phase' && message.phase === 'seek', { from: hideBoundary });
  assert.deepEqual(seek.message.participants, [welcome.you, cpu.id]);
  assert.deepEqual(seek.message.figs[welcome.you], humanFigure, 'Accepted human PNG survives hide eviction');
  assert.deepEqual(seek.message.figs[cpu.id], cpuFigure, 'Accepted CPU PNG survives hide eviction');
  checkAlarmTime(seek.receivedAt, check.receivedAt + MS.checkMin, 'Collection alarm', 1000);
  log('PASS hide: original socket, connected roster, accepted PNGs, and alarm-driven phase progression survived eviction');

  const plan = Bots.searchPlan({ level: 3, targets: [{ id: welcome.you, blend: humanFigure.blend }], limit: seek.message.limit / 1000, seed: Bots.seedFor(painting.seed, cpu.id) });
  assert.equal(plan.length, 1, 'The visible human has a deterministic CPU finding');
  const expectedFindAt = seek.receivedAt + plan[0].time * 1000;
  await host.send({ t: 'found', target: cpu.id, time: 1 });
  await host.wait((message) => message.t === 'found' && message.seeker === welcome.you);
  await delay(1100);
  assert(Date.now() < expectedFindAt - 500, 'Eviction occurs before the planned CPU search');
  const seekBoundary = host.events.length;
  await evict(worker, welcome.code, 'seek');
  host.assertLive();
  // Again no client messages until final: autonomous CPU and phase alarms must
  // drive findings, scoring, and the final standings over this same live socket.
  const finding = await host.wait((message) => message.t === 'found' && message.seeker === cpu.id, { from: seekBoundary });
  assert.equal(finding.message.target, welcome.you);
  assert.equal(finding.message.time, plan[0].time, 'The persisted CPU decision is unchanged');
  checkAlarmTime(finding.receivedAt, expectedFindAt, 'Seek CPU finding alarm after eviction', 850);
  const results = await host.wait((message) => message.t === 'phase' && message.phase === 'results', { from: seekBoundary });
  assert.equal(results.message.results.length, 2);
  for (const id of [welcome.you, cpu.id]) {
    const entry = results.message.results.find((result) => result.id === id);
    assert.equal(entry?.found, 1);
    assert(entry.score > 0 && entry.roundPts > 0, 'Both participants score after seek eviction');
  }
  const scoringRoster = await host.wait((message) => message.t === 'room' && message.players.every((player) => player.score > 0), { from: seekBoundary });
  checkRoster(scoringRoster.message, welcome.you, cpu.id);
  const final = await host.wait((message) => message.t === 'phase' && message.phase === 'final', { timeout: MS.results + 5000, from: seekBoundary });
  checkAlarmTime(final.receivedAt, results.receivedAt + MS.results, 'Final standings alarm', 1000);
  assert.deepEqual(final.message.standings.map(({ id, score }) => ({ id, score })).sort((a, b) => a.id.localeCompare(b.id)), results.message.results.map(({ id, score }) => ({ id, score })).sort((a, b) => a.id.localeCompare(b.id)));
  host.assertLive();
  log('PASS seek: original socket, CPU decision and original schedule, autonomous scoring, connected roster, and final standings survived eviction');
  log('PASS actual Worker hibernation smoke: 2 successful local eviction calls; no reconnection, ping shortcut, mocked clocks, direct tick, or snapshot writes');
} catch (error) {
  server.debug();
  throw error;
} finally {
  try { socket?.close(); } catch { /* already closed */ }
  await server.close();
  log('Owned local harness closed');
}
