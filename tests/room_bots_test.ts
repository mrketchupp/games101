// deno-lint-ignore-file no-explicit-any
import "../escondidas-en-pintura/artworks.js";
import "../escondidas-en-pintura/bot-ai.js";
import "../escondidas-en-pintura/room.js";

const { Room, MS, MAX_PLAYERS, PROTOCOL_VERSION, CATALOG_VERSION } = (globalThis as any).HideRoom;
const Bots = (globalThis as any).HideBots;
const figure = {
  x: 100, y: 100, pose: 0,
  img: "data:image/png;base64,iVBORw0KGgo=",
  blend: 0,
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function makeRoom(humans = 1, settings: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  const room = new Room("BOTS", { externalTimers: true, settings, ...options });
  const messages: any[][] = [];
  const connections: any[] = [];
  const players: any[] = [];
  for (let i = 0; i < humans; i++) {
    const received: any[] = [];
    const connection = { send: (message: any) => received.push(structuredClone(message)) };
    messages.push(received);
    connections.push(connection);
    players.push(room.join(connection, { name: `Humano ${i + 1}`, pid: `human-${i}` }).player);
  }
  return { room, players, messages, connections };
}

const managed = (room: any) => room.players.filter((player: any) => player.managedBot);
function advance(room: any) {
  assert(room.deadline > 0, "The current phase has a deadline");
  assert(room.tick(room.deadline), "The persisted deadline advances the game");
}
function paint(room: any, host: any, bot: any, fig = figure) {
  room.handle(host, { t: "botFigure", botId: bot.id, round: room.round, seed: room.seed, fig });
}
function startHiding(context: ReturnType<typeof makeRoom>) {
  const { room, players } = context;
  room.handle(players[0], { t: "start" });
  for (const bot of managed(room)) paint(room, players[0], bot);
  advance(room);
  equal(room.phase, "hide", "Preparing starts the hiding phase");
  for (const human of players) room.handle(human, { t: "submit", fig: figure });
}
function startSeeking(context: ReturnType<typeof makeRoom>) {
  startHiding(context);
  const { room } = context;
  const readyAt = Math.max(...managed(room).map((bot: any) => bot.botReadyAt));
  assert(room.tick(readyAt), "The server marks its CPUs ready");
  equal(room.phase, "check", "All submitted figures finish hiding");
  advance(room);
  equal(room.phase, "seek", "Collection enters searching");
}

Deno.test("managed CPUs are host-controlled lobby participants with private identities", () => {
  const { room, players } = makeRoom(2);
  try {
    equal([room.settings.bots, room.settings.botLevel], [0, 1], "Rooms default to no CPU and normal level");
    room.handle(players[1], { t: "settings", bots: 2, botLevel: 3 });
    equal(managed(room).length, 0, "A guest cannot add CPU participants");
    room.handle(players[0], { t: "settings", bots: 2, botLevel: 3 });
    const bots = managed(room);
    equal(bots.length, 2, "The requested CPU count joins the roster");
    assert(bots.every((bot: any) => bot.bot && bot.connected && bot.conn === null && bot.botLevel === 3), "Managed CPUs have no socket and share the chosen level");
    assert(bots.every((bot: any) => !Object.hasOwn(room.publicPlayers().find((p: any) => p.id === bot.id), "pid")), "The public roster omits CPU reconnect credentials");
    equal(room.hostId, players[0].id, "A CPU cannot become host");
    for (const value of [-1, 8, 1.5, "1", null, true]) {
      room.handle(players[0], { t: "settings", bots: value, botLevel: value });
      equal([room.settings.bots, room.settings.botLevel], [2, 3], "Invalid numeric settings retain the last supported choices");
    }
    room.handle(players[0], { t: "start" });
    room.handle(players[0], { t: "settings", bots: 0, botLevel: 0 });
    equal([managed(room).length, room.settings.botLevel], [2, 3], "An active game keeps its CPU participants and level");
    room.final();
    room.handle(players[0], { t: "settings", bots: 0 });
    equal(managed(room).length, 2, "Standings also preserve the played CPU roster");
    room.handle(players[0], { t: "lobby" });
    room.handle(players[0], { t: "settings", bots: 0, botLevel: 0 });
    equal(room.players.map((p: any) => p.id), players.map((p) => p.id), "Removing CPUs in the lobby preserves the human players");
  } finally {
    room.destroy();
  }
});

Deno.test("humans and CPUs share the eight-player capacity without replacing players", () => {
  const { room, players, messages } = makeRoom();
  try {
    room.handle(players[0], { t: "settings", bots: 7 });
    equal(room.players.length, MAX_PLAYERS, "One human can fill the remaining seven places with CPUs");
    const ids = room.players.map((p: any) => p.id);
    assert(room.join({ send() {} }, { name: "Sin plaza", pid: "extra" }).error, "A full room rejects another human");
    equal(room.players.map((p: any) => p.id), ids, "A rejected join leaves every CPU identity intact");
    room.handle(players[0], { t: "settings", bots: 6 });
    const guest = room.join({ send() {} }, { name: "Invitado", pid: "extra" }).player;
    assert(guest && !guest.bot, "A human can use a place freed by the host");
    room.handle(players[0], { t: "settings", bots: 7 });
    equal([room.players.length, room.settings.bots], [8, 6], "A CPU request cannot exceed total room capacity");
    assert(messages[0].some((message) => message.t === "notice"), "The host receives the capacity explanation");
    equal(room.get(guest.id), guest, "An oversized CPU request preserves the guest");
  } finally {
    room.destroy();
  }
});

Deno.test("one human and an expert CPU complete autonomous hiding, searching and scoring", () => {
  const context = makeRoom(1, { bots: 1, botLevel: 3, rounds: 1, seekTime: 20 });
  const { room, players, messages } = context;
  try {
    const bot = managed(room)[0];
    startHiding(context);
    equal(bot.ready, false, "An early PNG does not skip CPU painting time");
    equal(room.nextWakeAt(), bot.botReadyAt, "The next alarm uses CPU readiness before the hide deadline");
    assert(!room.tick(bot.botReadyAt - 1), "A CPU cannot become ready before its persisted time");
    room.tick(bot.botReadyAt);
    equal(room.phase, "check", "CPU readiness completes hiding without a client ready message");
    equal(room.deadline, bot.botReadyAt + MS.checkMin, "Collection is anchored to CPU readiness");
    advance(room);
    equal(room.participants, [players[0].id, bot.id], "The human and virtual CPU both search");
    const cpuFind = room.botActions.find((action: any) => action.type === "found");
    assert(cpuFind && cpuFind.target === players[0].id && cpuFind.time > 0, "An expert searches a visible human after a real delay");
    room.handle(players[0], { t: "found", target: bot.id, time: 3 });
    room.tick(cpuFind.at);
    equal(room.phase, "results", "The server CPU finding its target completes the search");
    assert(room.phaseMsg.results.every((result: any) => result.score > 0), "Human and CPU receive round points");
    assert(messages[0].some((message) => message.t === "found" && message.seeker === bot.id), "The human receives the autonomous CPU finding");
    advance(room);
    equal(room.phase, "final", "A one-round game reaches final standings");
    equal(room.phaseMsg.standings.length, 2, "The standings include the virtual CPU");
    equal([room.nextWakeAt(), room.botActions.length, room.timer], [0, 0, null], "The completed external game has no remaining work");
  } finally {
    room.destroy();
  }
});

Deno.test("two humans and multiple CPUs share targets, timers and final results", () => {
  const context = makeRoom(2, { bots: 2, botLevel: 2, rounds: 1, seekTime: 20 });
  const { room, players } = context;
  try {
    startSeeking(context);
    equal(room.participants.length, 4, "All two humans and two CPUs participate");
    equal(room.limit, 50, "The search limit scales with all participants");
    for (const bot of managed(room)) {
      const expected = Bots.searchPlan({
        level: bot.botLevel,
        targets: room.participants.filter((id: string) => id !== bot.id).map((id: string) => ({ id, blend: room.figures[id].blend })),
        limit: room.limit, seed: Bots.seedFor(room.seed, bot.id),
      });
      equal(room.botActions.filter((action: any) => action.botId === bot.id && action.type === "found").map((action: any) => ({ target: action.target, time: action.time })), expected, "The room follows the same deterministic search decisions as the browser");
    }
    for (const player of players) room.handle(player, { t: "seekDone", elapsed: room.limit });
    const lastFindAt = Math.max(...room.botActions.filter((action: any) => action.type === "found").map((action: any) => action.at));
    room.tick(lastFindAt);
    equal(room.phase, "results", "Server CPU actions complete after the humans finish");
    equal(room.phaseMsg.results.length, 4, "Every participant is scored");
    for (const bot of managed(room)) {
      const findings = room.finds.filter((find: any) => find.seeker === bot.id);
      equal(findings.length, 3, "A CPU finds each visible opponent once");
      assert(findings.every((find: any) => find.target !== bot.id && find.time > 0 && find.time <= room.limit), "CPU findings contain only valid timed opponents");
    }
    advance(room);
    equal(room.phaseMsg.standings.length, 4, "Final standings preserve all human and CPU scores");
  } finally {
    room.destroy();
  }
});

Deno.test("CPU PNG submissions require the current host, round, seed, identity and bounded figure", () => {
  const { room, players } = makeRoom(2, { bots: 1 });
  try {
    room.handle(players[0], { t: "start" });
    const bot = managed(room)[0];
    const valid = { t: "botFigure", botId: bot.id, round: room.round, seed: room.seed, fig: figure };
    room.handle(players[1], valid);
    room.handle(bot, valid);
    room.handle({ ...players[0] }, valid);
    for (const changed of [
      { round: room.round + 1 }, { seed: room.seed + 1 }, { botId: players[1].id },
      { fig: { ...figure, img: "data:image/jpeg;base64,AAAA" } },
      { fig: { ...figure, img: "data:image/png;base64,AAAA" } },
      { fig: { ...figure, img: "data:image/png;base64,iVBORw0KGgo=漢" } },
      { fig: { ...figure, img: "data:image/png;base64,iVBORw0KGgo===" } },
      { fig: { ...figure, img: "data:image/png;base64,iVBORw0KGgo" } },
      { fig: { ...figure, img: "data:image/png;base64,iVBORw0KGgo\n" } },
      { fig: { ...figure, img: "data:image/png;base64,iVBORw0KGgoA" + "A".repeat(400000) } },
      { fig: { ...figure, x: Infinity } }, { fig: { ...figure, pose: 10 } },
    ]) room.handle(players[0], { ...valid, ...changed });
    equal(room.figures, {}, "Unauthorized and invalid submissions cannot create any figure");
    room.handle(players[0], valid);
    equal(room.figures[bot.id], figure, "The current host can submit the matching CPU figure");
    room.handle(players[0], { ...valid, fig: { ...figure, x: 999 } });
    equal(room.figures[bot.id].x, 100, "A replay cannot replace an accepted CPU figure");
    room.handle(players[1], { t: "submit", botId: bot.id, fig: { ...figure, x: 500 } });
    equal(room.figures[bot.id].x, 100, "A human submission cannot name another player as its author");
  } finally {
    room.destroy();
  }
});

Deno.test("welcome messages identify the exact protocol and ordered artwork catalog", () => {
  const { room, messages } = makeRoom();
  try {
    const welcome = messages[0].find((message) => message.t === "welcome");
    equal(welcome.protocol, 2, "The welcome declares the new board-aware protocol");
    equal(welcome.protocol, PROTOCOL_VERSION, "The exported protocol matches the wire contract");
    equal(welcome.catalog, (globalThis as any).HumanArt.works.map((work: any) => work.id).join(","), "The ordered IDs detect differing artwork indices");
    equal(welcome.catalog, CATALOG_VERSION, "The exported catalog matches the wire contract");
    assert(welcome.catalog.length < 1024, "The exact catalog fingerprint fits in a small handshake");
  } finally {
    room.destroy();
  }
});

Deno.test("managed CPU identities cannot reconnect or send player messages", () => {
  const { room, players, messages } = makeRoom(1, { bots: 1 });
  try {
    const bot = managed(room)[0];
    const before = room.snapshot();
    const joined = room.join({ send() {} }, { name: "Impostor", pid: bot.pid });
    assert(joined.error && !joined.player, "Even a known private CPU identity cannot be used for a join");
    room.handle(bot, { t: "start" });
    room.handle(bot, { t: "settings", bots: 0 });
    equal(room.snapshot(), before, "CPU objects cannot drive the public player protocol");
    assert(!JSON.stringify(messages).includes(bot.pid), "No welcome or room message exposes the private CPU identity");
    room.handle(players[0], { t: "start" });
    const humanFigure = { ...figure, x: 321 };
    advance(room);
    room.handle(players[0], { t: "submit", botId: bot.id, fig: humanFigure });
    equal(room.figures[players[0].id], humanFigure, "The socket player remains the author of its submission");
    assert(!room.figures[bot.id], "A human cannot supply a CPU PNG using the human submission route");
  } finally {
    room.destroy();
  }
});

Deno.test("a new host receives only pending CPU paintings and the previous host loses authority", () => {
  const { room, players, connections, messages } = makeRoom(2, { bots: 2 });
  try {
    room.handle(players[0], { t: "start" });
    const [painted, pending] = managed(room);
    paint(room, players[0], painted);
    const from = messages[1].length;
    room.disconnect(players[0], connections[0]);
    equal(room.hostId, players[1].id, "The remaining human becomes host");
    const replay = messages[1].slice(from);
    equal(replay.map((message) => message.t), ["room", "botPaint"], "The new host learns its role before receiving painting work");
    equal(replay[1].bots.map((bot: any) => bot.id), [pending.id], "Host failover preserves accepted PNGs and retries only missing ones");
    paint(room, players[0], pending);
    assert(!room.figures[pending.id], "The disconnected former host cannot complete the work");
    paint(room, players[1], pending);
    assert(room.figures[pending.id], "The replacement host can complete the pending PNG");
    const reconnected: any[] = [];
    room.join({ send: (message: any) => reconnected.push(message) }, { pid: "human-0" });
    equal(reconnected.map((message) => message.t), ["welcome", "room", "phase"], "A returning former host receives its current phase without stealing painting authority");
    equal(room.hostId, players[1].id, "Reconnection does not take hosting away from the active human");
  } finally {
    room.destroy();
  }
});

Deno.test("hiding snapshots preserve CPU readiness deadlines and replay pending PNGs after reconnect", () => {
  const { room, players } = makeRoom(1, { bots: 2 });
  let restored: any;
  try {
    room.handle(players[0], { t: "start" });
    const [painted] = managed(room);
    paint(room, players[0], painted);
    advance(room);
    const snapshot = room.snapshot();
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), { externalTimers: true });
    equal(restored.snapshot(), snapshot, "A hide snapshot retains every serializable game field");
    equal([restored.deadline, restored.nextWakeAt(), restored.botActions], [room.deadline, room.nextWakeAt(), room.botActions], "Restoration preserves both phase and CPU deadlines");
    const replay: any[] = [];
    const host = restored.join({ send: (message: any) => replay.push(message) }, { pid: "human-0" }).player;
    equal(replay.map((message) => message.t), ["welcome", "room", "phase", "botPaint"], "Host reconnect receives room and phase before pending paint work");
    equal(replay.at(-1).bots.map((bot: any) => bot.id), [managed(restored)[1].id], "Reconnection does not regenerate accepted paintings");
    equal(restored.deadline, snapshot.deadline, "Reconnection does not restart the hiding clock");
    for (const instance of [room, restored]) {
      const currentHost = instance === room ? players[0] : host;
      for (const bot of managed(instance)) if (!instance.figures[bot.id]) paint(instance, currentHost, bot);
      instance.handle(currentHost, { t: "submit", fig: figure });
      instance.tick(Math.max(...managed(instance).map((bot: any) => bot.botReadyAt)));
    }
    equal(restored.snapshot(), room.snapshot(), "Restored and uninterrupted CPU readiness produce the same state");
    equal(room.phase, "check", "Both versions remain playable after all CPUs finish painting");
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("search snapshots preserve CPU decisions, deadlines and scoring without restarting the timer", () => {
  const context = makeRoom(1, { bots: 1, botLevel: 3, rounds: 1, seekTime: 20 });
  const { room, players } = context;
  let restored: any;
  try {
    startSeeking(context);
    const snapshot = room.snapshot();
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), { externalTimers: true });
    equal(restored.snapshot(), snapshot, "A seek snapshot preserves all planned searches");
    const replay: any[] = [];
    const host = restored.join({ send: (message: any) => replay.push(message) }, { pid: "human-0" }).player;
    equal(replay.map((message) => message.t), ["welcome", "room", "phase"], "A seeker reconnect receives no painting work");
    equal([restored.deadline, restored.nextWakeAt()], [snapshot.deadline, room.nextWakeAt()], "Rejoining preserves CPU and phase alarm timestamps");
    assert(replay[2].resumed && replay[2].limit <= room.limit * 1000, "Seek sync resumes the remaining search time");
    for (const instance of [room, restored]) {
      instance.handle(instance === room ? players[0] : host, { t: "found", target: managed(instance)[0].id, time: 4 });
      instance.tick(instance.nextWakeAt());
    }
    equal(restored.snapshot(), room.snapshot(), "The same restored CPU decisions produce identical findings and scores");
    equal(restored.phase, "results", "The restored CPU independently finishes searching");
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("a late CPU image observes elapsed painting time and a missing image cannot stall humans", () => {
  const context = makeRoom(1, { bots: 1 });
  const second = makeRoom(2, { bots: 1 });
  try {
    const { room, players } = context;
    room.handle(players[0], { t: "start" });
    advance(room);
    room.handle(players[0], { t: "submit", fig: figure });
    const bot = managed(room)[0];
    room.tick(bot.botReadyAt);
    equal(room.phase, "hide", "Elapsed CPU painting time still waits for its PNG");
    paint(room, players[0], bot);
    equal(room.phase, "check", "The late PNG immediately uses the already elapsed readiness deadline");

    second.room.handle(second.players[0], { t: "start" });
    advance(second.room);
    for (const human of second.players) second.room.handle(human, { t: "submit", fig: figure });
    advance(second.room);
    equal(second.room.phase, "check", "Missing CPU art waits only until the bounded collection phase");
    advance(second.room);
    equal(second.room.participants, second.players.map((human) => human.id), "Humans with figures can proceed when a CPU PNG never arrives");
    equal(second.room.botActions, [], "An excluded CPU receives no search plan");
    const excluded = managed(second.room)[0];
    paint(second.room, second.players[0], excluded);
    assert(!second.room.figures[excluded.id], "A PNG arriving during search cannot change the fixed participant set");
  } finally {
    context.room.destroy();
    second.room.destroy();
  }
});

Deno.test("virtual CPUs neither keep an empty room alive nor become host", () => {
  const empty: any[] = [];
  const { room, players, connections } = makeRoom(1, { bots: 2 }, { onEmpty: (value: any) => empty.push(value) });
  try {
    room.handle(players[0], { t: "start" });
    const wakeAt = room.nextWakeAt();
    room.disconnect(players[0], connections[0]);
    equal([room.connectedHumans().length, room.hostId, room.nextWakeAt(), room.timer], [0, null, 0, null], "Only disconnected humans determine room cleanup and timer suspension");
    equal(empty, [room], "The room reports emptiness even while CPUs remain connected");
    assert(!room.tick(wakeAt + 1_000_000), "CPU participants cannot advance an abandoned room");
    const replay: any[] = [];
    const human = room.join({ send: (message: any) => replay.push(message) }, { pid: "human-0" }).player;
    equal(room.hostId, human.id, "A reconnecting human regains hosting from the empty state");
    equal(room.nextWakeAt(), wakeAt, "The original pending deadline survives temporary human absence");
    assert(replay.some((message) => message.t === "botPaint"), "The returning host receives the pending CPU paintings");
  } finally {
    room.destroy();
  }
});

Deno.test("local CPU socket players retain their protocol alongside managed multiplayer CPUs", () => {
  const { room, players } = makeRoom();
  try {
    const localConnection = { send() {} };
    const local = room.join(localConnection, { name: "CPU local", pid: "local-cpu", bot: true, botLevel: 2 }).player;
    room.handle(players[0], { t: "settings", bots: 1 });
    equal([local.bot, !!local.managedBot, local.conn], [true, false, localConnection], "A local CPU remains a socket player, separate from managed CPU participants");
    room.handle(players[0], { t: "start" });
    advance(room);
    room.handle(local, { t: "submit", fig: figure });
    equal(room.figures[local.id], figure, "Local CPU clients can still submit their own figures");
    assert(!room.botActions.some((action: any) => action.botId === local.id), "The server does not duplicate local CPU timers");
    equal(room.hostId, players[0].id, "Local and managed CPUs both leave hosting to humans");
  } finally {
    room.destroy();
  }
});

Deno.test("delayed alarms catch up in order using original CPU and phase deadlines", () => {
  const context = makeRoom(1, { bots: 1, botLevel: 3, rounds: 1, seekTime: 20 });
  const { room, players, messages } = context;
  try {
    startHiding(context);
    const readyAt = managed(room)[0].botReadyAt;
    const seekAt = readyAt + MS.checkMin;
    room.tick(seekAt + 1);
    equal(room.phase, "seek", "One late alarm processes readiness and collection without skipping the live search");
    equal(room.phaseStartedAt, seekAt, "Search begins at the persisted collection deadline");
    equal(room.deadline, seekAt + room.limit * 1000 + MS.seekGrace, "The delayed alarm does not shift the search deadline");
    equal(messages[0].filter((message) => message.t === "phase").map((message) => message.phase), ["prepare", "hide", "check", "seek"], "Catch-up broadcasts every real transition in order");
    const deadline = room.deadline;
    room.tick(deadline);
    equal(room.phase, "results", "The original search deadline ends unfinished human searching");
    equal(room.deadline, deadline + MS.results, "Results retain their full scheduled duration");
    advance(room);
    equal(room.phase, "final", "Catch-up does not lose the final standings transition");
    assert(room.get(players[0].id).score > 0, "The human is scored despite the delayed alarms");
  } finally {
    room.destroy();
  }
});

Deno.test("CPUs paint normally in unlimited artwork rounds and can complete them without a hurry timer", () => {
  const context = makeRoom(1, { bots: 1, botLevel: 3, collection: 1, hideTime: 0, rounds: 1 });
  const { room, players } = context;
  let restored: any;
  try {
    startHiding(context);
    const bot = managed(room)[0];
    const expected = Bots.readyDelay({ level: bot.botLevel, hideTime: 300, seed: Bots.seedFor(room.seed, bot.id) });
    equal([room.deadline, room.phaseMsg.duration, room.settings.seekTime], [0, null, 60], "Artwork keeps the human timer unlimited and its longer search default");
    equal(bot.botReadyAt, room.phaseStartedAt + expected * 1000, "CPU readiness uses the normal five-minute artwork budget");
    assert(bot.botReadyAt > room.phaseStartedAt + 1000, "Unlimited hiding cannot reduce CPU painting to an instant");
    equal(room.nextWakeAt(), bot.botReadyAt, "An unlimited round still schedules its CPU action");
    const snapshot = room.snapshot();
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), { externalTimers: true });
    equal(restored.snapshot(), snapshot, "Persistence retains a CPU action without a phase deadline");
    restored.tick(bot.botReadyAt);
    equal(restored.phase, "check", "The restored CPU becomes ready and completes hiding with the human");
    advance(restored);
    equal(restored.phase, "seek", "Unlimited hiding advances into a finite search");
    const cpuFind = restored.botActions.find((action: any) => action.type === "found");
    assert(cpuFind, "The expert retains a finite search plan");
    restored.handle(restored.get(players[0].id), { t: "found", target: bot.id, time: 2 });
    restored.tick(cpuFind.at);
    equal(restored.phase, "results", "Both players complete the artwork search");
    advance(restored);
    equal(restored.phase, "final", "An unlimited artwork game can finish autonomously");
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("hurry preserves pending CPU painting work and its original deadlines", () => {
  const { room, players } = makeRoom(2, { bots: 2, botLevel: 3, collection: 1, hideTime: 0, rounds: 1 });
  let restored: any;
  try {
    room.handle(players[0], { t: "start" });
    for (const bot of managed(room)) paint(room, players[0], bot);
    advance(room);
    room.handle(players[0], { t: "submit", fig: figure });
    room.handle(players[1], { t: "figure", fig: { ...figure, x: 200 } });
    const before = {
      started: room.phaseStartedAt, seed: room.seed, round: room.round,
      actions: structuredClone(room.botActions), figures: structuredClone(room.figures),
      readyAt: managed(room).map((bot: any) => bot.botReadyAt),
    };
    room.lastTickAt = room.phaseStartedAt + 500;
    room.handle(players[0], { t: "hurry" });
    equal({
      started: room.phaseStartedAt, seed: room.seed, round: room.round,
      actions: room.botActions, figures: room.figures,
      readyAt: managed(room).map((bot: any) => bot.botReadyAt),
    }, before, "Hurry keeps accepted PNGs, deterministic plans and CPU deadlines unchanged");
    equal(room.deadline, before.started + 500 + MS.hurry, "Hurry adds its deadline to the existing hiding phase");
    equal(room.nextWakeAt(), Math.min(room.deadline, ...before.actions.map((action: any) => action.at)), "The next alarm uses the earliest original CPU action or final deadline");
    const snapshot = room.snapshot();
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), { externalTimers: true });
    equal(restored.snapshot(), snapshot, "A hurried CPU round survives persistence exactly");
    for (const instance of [room, restored]) {
      const endAt = instance.deadline;
      instance.tick(endAt);
      equal(instance.phase, "check", "The final deadline collects the human who was still painting");
      equal(instance.botActions.length, 0, "Collection discards obsolete painting actions");
      advance(instance);
      equal(instance.phase, "seek", "Every accepted human and CPU painting enters search");
      equal(instance.participants.length, 4, "The final deadline preserves all four participant figures");
    }
    equal(restored.snapshot(), room.snapshot(), "Restored hurry produces the same search decisions and phase times");
  } finally {
    room.destroy();
    restored?.destroy();
  }
});
