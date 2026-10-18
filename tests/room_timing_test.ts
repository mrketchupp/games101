// deno-lint-ignore-file no-explicit-any
import "../escondidas-en-pintura/artworks.js";
import "../escondidas-en-pintura/bot-ai.js";
import "../escondidas-en-pintura/room.js";

const { Room, MS } = (globalThis as any).HideRoom;
const figure = {
  x: 100,
  y: 100,
  pose: 0,
  img: "data:image/png;base64,iVBORw0KGgo=",
  blend: 0,
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function context(settings: Record<string, unknown> = {}, humans = 2) {
  const room = new Room("TIME", { externalTimers: true, settings });
  const messages: any[][] = [];
  const connections: any[] = [];
  const players: any[] = [];
  for (let i = 0; i < humans; i++) {
    const received: any[] = [];
    const conn = {
      send(message: any) {
        received.push(structuredClone(message));
      },
    };
    messages.push(received);
    connections.push(conn);
    players.push(
      room.join(conn, { pid: `human-${i}`, name: `Humano ${i}` }).player,
    );
  }
  return { room, players, messages, connections };
}

function enterSeek(value: ReturnType<typeof context>) {
  const { room, players } = value;
  room.startGame();
  room.tick(room.deadline);
  for (const player of players) {
    room.handle(player, { t: "submit", fig: figure });
  }
  room.tick(room.deadline);
  equal(room.phase, "seek", "The fixture reaches searching");
}

Deno.test("a late prepare alarm announces only the actual hiding time left", () => {
  const { room, messages } = context({ hideTime: 60 });
  try {
    room.startGame();
    const hideAt = room.deadline;
    const processedAt = hideAt + 1500;
    room.tick(processedAt);
    const sent = messages[0].findLast((message) => message.phase === "hide");
    equal(
      [room.phaseStartedAt, room.deadline],
      [hideAt, hideAt + 60_000],
      "A delayed alarm preserves the original hiding deadline",
    );
    equal(
      sent.duration,
      58_500,
      "The wire countdown discounts the processing delay",
    );
    equal(
      room.phaseMsg.duration,
      60_000,
      "The persisted phase retains its canonical duration",
    );
    equal(room.timer, null, "The correction creates no local timer");
  } finally {
    room.destroy();
  }
});

Deno.test("late CPU alarms preserve decisions while reporting remaining search time and elapsed scoring time", () => {
  const { room, messages, players } = context({
    bots: 1,
    botLevel: 3,
    rounds: 1,
  }, 1);
  let onTime: any;
  try {
    room.startGame();
    const bot = room.players.find((player: any) => player.managedBot);
    room.handle(players[0], {
      t: "botFigure",
      botId: bot.id,
      round: room.round,
      seed: room.seed,
      fig: figure,
    });
    room.tick(room.deadline);
    room.handle(players[0], { t: "submit", fig: figure });
    const seekAt = bot.botReadyAt + MS.checkMin;
    const processedAt = seekAt + 5000;
    onTime = Room.restore(room.snapshot(), { externalTimers: true });
    while (onTime.nextWakeAt() && onTime.nextWakeAt() <= processedAt) {
      onTime.tick(onTime.nextWakeAt());
    }
    room.tick(processedAt);
    equal(
      room.phase,
      "seek",
      "The human still has searching time after catch-up",
    );
    const sent = messages[0].findLast((message) => message.phase === "seek");
    equal(
      [sent.duration, sent.limit, sent.elapsed],
      [27_500, 25_000, 5000],
      "The client receives the real remaining time and its original scoring offset",
    );
    equal(
      sent.limit + sent.elapsed,
      room.limit * 1000,
      "Remaining and elapsed preserve the full scoring budget",
    );
    equal(
      [room.phaseMsg.duration, room.phaseMsg.limit],
      [32_500, 30_000],
      "Canonical persisted timings stay unchanged",
    );
    assert(
      !Object.hasOwn(room.phaseMsg, "elapsed"),
      "Processing offsets are transient wire data",
    );
    for (
      const key of [
        "phase",
        "phaseStartedAt",
        "deadline",
        "botActions",
        "finds",
        "done",
        "phaseMsg",
        "figures",
      ]
    ) {
      equal(
        room[key],
        onTime[key],
        `Late delivery does not change persisted ${key}`,
      );
    }
    equal(
      room.phaseStartedAt,
      seekAt,
      "Searching starts at its original logical deadline",
    );
  } finally {
    room.destroy();
    onTime?.destroy();
  }
});

Deno.test("restored seek sync reports the same absolute score clock without clearing finds or CPU plans", () => {
  const original = context({ bots: 1, botLevel: 3 }, 2);
  const { room, players } = original;
  let restored: any;
  try {
    room.startGame();
    const bot = room.players.find((player: any) => player.managedBot);
    room.handle(players[0], {
      t: "botFigure",
      botId: bot.id,
      round: room.round,
      seed: room.seed,
      fig: figure,
    });
    room.tick(room.deadline);
    for (const player of players) {
      room.handle(player, { t: "submit", fig: figure });
    }
    room.tick(bot.botReadyAt);
    room.tick(room.deadline);
    const processedAt = room.phaseStartedAt + 5000;
    room.tick(processedAt);
    room.handle(players[0], { t: "found", target: bot.id, time: 5 });
    room.handle(players[0], { t: "seekDone", elapsed: 5 });
    const snapshot = room.snapshot();
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), {
      externalTimers: true,
    });
    const replay: any[] = [];
    const joined = restored.join({
      send(message: any) {
        replay.push(structuredClone(message));
      },
    }, { pid: "human-0" });
    assert(joined.player, "The original seeker reconnects");
    const sent = replay.find((message) => message.t === "phase" && message.phase === "seek");
    equal(
      [sent.limit, sent.elapsed, sent.duration, sent.resumed],
      [40_000, 5000, 42_500, true],
      "Reconnection receives the original scoring offset and remaining countdown",
    );
    equal(
      sent.limit + sent.elapsed,
      restored.limit * 1000,
      "The client can reconstruct the original total limit",
    );
    equal(
      [sent.finds, sent.done],
      [snapshot.finds, snapshot.done],
      "A fresh client receives accepted findings and completion state",
    );
    assert(
      !Object.hasOwn(sent, "botActions"),
      "Sync cannot expose future CPU decisions",
    );
    for (
      const key of [
        "phaseStartedAt",
        "deadline",
        "finds",
        "done",
        "botActions",
        "phaseMsg",
      ]
    ) {
      equal(restored[key], snapshot[key], `Reconnection preserves ${key}`);
    }
    equal(
      restored.finds.find((find: any) => find.seeker === players[0].id).time,
      5,
      "Accepted human findings keep their original elapsed time",
    );
    const copied = restored.phaseForClient();
    copied.finds[0].time = 999;
    copied.done[players[0].id] = 999;
    equal(
      [restored.finds, restored.done],
      [snapshot.finds, snapshot.done],
      "Wire copies cannot modify authoritative findings or completion state",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("seek sync during the grace period cannot grant extra search or a negative countdown", () => {
  const value = context();
  const { room, players, messages } = value;
  try {
    enterSeek(value);
    room.lastTickAt = room.deadline - 500;
    room.sync(players[0]);
    const sent = messages[0].at(-1);
    equal(
      [sent.duration, sent.limit, sent.elapsed],
      [500, 0, 30_000],
      "The grace period carries no remaining search time",
    );
    equal(
      room.phaseMsg.limit,
      30_000,
      "A sync cannot overwrite the canonical search limit",
    );
  } finally {
    room.destroy();
  }
});

Deno.test("canceling readiness invalidates only that figure and collection waits for its real replacement", () => {
  const { room, players, connections } = context({
    collection: 1,
    hideTime: 0,
    rounds: 1,
  });
  let restored: any;
  try {
    room.startGame();
    room.tick(room.deadline);
    room.handle(players[1], { t: "submit", fig: { ...figure, x: 200 } });
    room.handle(players[1], { t: "unsubmit" });
    room.handle(players[0], { t: "submit", fig: figure });
    equal(
      room.figures[players[1].id],
      undefined,
      "Editing invalidates the canceled PNG",
    );
    equal(
      room.figures[players[0].id],
      figure,
      "The ready player retains their accepted PNG",
    );
    room.handle(players[0], { t: "hurry" });
    equal(
      room.figures[players[0].id],
      figure,
      "Hurry does not clear another player's figure",
    );
    restored = Room.restore(JSON.parse(JSON.stringify(room.snapshot())), {
      externalTimers: true,
    });
    restored.players.forEach((player: any, i: number) => {
      player.conn = connections[i];
    });
    equal(
      restored.figures[players[0].id],
      figure,
      "Persistence also keeps the ready player's figure",
    );
    const replay: any[] = [];
    const host = restored.join({
      send(message: any) {
        replay.push(message);
      },
    }, { pid: "human-0" }).player;
    equal(
      restored.figures[host.id],
      figure,
      "A host reconnect does not clear the ready PNG",
    );
    restored.tick(restored.deadline);
    equal(
      restored.phase,
      "check",
      "Hurry starts collection of the unready player",
    );
    equal(
      restored.deadline,
      restored.checkStarted + MS.checkMax,
      "A canceled PNG cannot shorten the collection window",
    );
    equal(
      restored.figures[players[0].id],
      figure,
      "Collection preserves the ready player's accepted drawing",
    );
    // Represent a replacement response arriving four seconds into the logical collection clock.
    const responseAt = restored.checkStarted + 4000;
    assert(
      !restored.tick(responseAt),
      "The server still waits after the old 2.8-second cutoff",
    );
    restored.lastTickAt = responseAt;
    const replacement = { ...figure, x: 350, blend: 75 };
    restored.handle(restored.get(players[1].id), {
      t: "figure",
      fig: replacement,
    });
    equal(
      restored.figures[players[1].id],
      replacement,
      "The fresh PNG replaces the canceled submission",
    );
    equal(
      restored.deadline,
      responseAt,
      "Once everyone has really delivered, collection can finish immediately",
    );
    restored.tick(responseAt);
    equal(
      restored.phase,
      "seek",
      "The late replacement remains eligible for the round",
    );
    equal(
      restored.phaseMsg.figs[players[1].id],
      replacement,
      "Searching receives the edited drawing",
    );
    equal(
      restored.phaseMsg.figs[players[0].id],
      figure,
      "The other drawing is unchanged through hurry, persistence and reconnect",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("a canceled PNG is never used as fallback when its replacement fails to arrive", () => {
  const { room, players } = context({ hideTime: 60 });
  try {
    room.startGame();
    room.tick(room.deadline);
    room.handle(players[1], { t: "submit", fig: figure });
    room.handle(players[1], { t: "unsubmit" });
    room.handle(players[0], { t: "submit", fig: figure });
    room.tick(room.deadline);
    equal(
      room.deadline,
      room.checkStarted + MS.checkMax,
      "Missing replacement receives the full bounded wait",
    );
    room.tick(room.deadline);
    equal(
      room.phase,
      "lobby",
      "A round with only one current figure returns safely to the lobby",
    );
    assert(
      !room.figures[players[1].id],
      "The canceled PNG cannot reappear after timeout",
    );
  } finally {
    room.destroy();
  }
});
