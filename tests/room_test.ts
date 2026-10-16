import "../escondidas-en-pintura/room.js";
import "../escondidas-en-pintura/artworks.js";

// deno-lint-ignore no-explicit-any
const { Room, MS, ART_COUNT, GALLERIES } = (globalThis as any).HideRoom;
// deno-lint-ignore no-explicit-any
const { Artworks } = globalThis as any;

type Message = {
  t: string;
  phase?: string;
  duration?: number;
  [key: string]: unknown;
};
type Connection = { send(message: Message): void };
type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  conn: Connection | null;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function makeRoom(options: Record<string, unknown> = {}) {
  const room = new Room("TEST", { externalTimers: true, ...options });
  const messages: Message[][] = [[], []];
  const connections = messages.map((received): Connection => ({
    send(message) {
      received.push(structuredClone(message));
    },
  }));
  const players = connections.map((conn, i): Player =>
    room.join(conn, { name: ["Ana", "Luis"][i], pid: `human-${i}` }).player
  );
  return { room, messages, connections, players };
}

const figure = {
  x: 100,
  y: 100,
  pose: 0,
  blend: 50,
  img: "data:image/png;base64,iVBORw0KGgo=",
};

function advance(room: { deadline: number; tick(timestamp: number): boolean }) {
  assert(room.deadline > 0, "Timed phases have a persisted deadline");
  assert(room.tick(room.deadline), "A due deadline advances the phase");
}

Deno.test("external timers create no local timer and reject an early tick", () => {
  const { room, players } = makeRoom();
  try {
    room.handle(players[0], { t: "start" });
    assertEquals(
      room.phase,
      "prepare",
      "Starting a room prepares the painting",
    );
    assertEquals(
      room.timer,
      null,
      "External mode does not create a setTimeout",
    );
    assertEquals(room.transition, "hide", "The next action is serializable");
    const before = room.snapshot();
    assertEquals(
      room.tick(room.deadline - 1),
      false,
      "An early alarm is harmless",
    );
    assertEquals(
      room.snapshot(),
      before,
      "An early tick changes no game state",
    );
    advance(room);
    assertEquals(room.phase, "hide", "A due prepare deadline starts hiding");
    assertEquals(
      room.transition,
      "endHide",
      "Hiding has a serializable next action",
    );
    assertEquals(room.timer, null, "Advancing still creates no local timer");
  } finally {
    room.destroy();
  }
});

Deno.test("JSON snapshots restore room state and accept reinjected connections", () => {
  const { room, messages, players } = makeRoom();
  let restored;
  try {
    room.handle(players[0], { t: "start" });
    const snapshot = room.snapshot();
    for (const key of ["timer", "onEmpty", "destroyed"]) {
      assert(!Object.hasOwn(snapshot, key), `Snapshots omit ${key}`);
    }
    for (const player of snapshot.players) {
      assertEquals(
        player.conn,
        null,
        "Connection functions are omitted before cloning",
      );
    }
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), {
      externalTimers: true,
    });
    assertEquals(
      restored.snapshot(),
      snapshot,
      "JSON persistence preserves the game state",
    );
    assertEquals(
      restored.timer,
      null,
      "External restoration does not schedule a local timer",
    );
    for (const player of restored.players) {
      assert(
        player.connected && player.conn === null,
        "Connection status survives without process objects",
      );
    }
    const delivered: Message[][] = [[], []];
    restored.players.forEach((player: Player, i: number) => {
      player.conn = {
        send(message) {
          delivered[i].push(message);
        },
      };
    });
    const originalCounts = messages.map((received) => received.length);
    restored.broadcast({ t: "notice", msg: "Restored" });
    assertEquals(
      delivered.map((received) => received.length),
      [1, 1],
      "Both reinjected connections receive broadcasts",
    );
    assertEquals(
      messages.map((received) => received.length),
      originalCounts,
      "Old process connections are never reused",
    );
    snapshot.players[0].name = "Changed snapshot";
    assertEquals(
      restored.players[0].name,
      "Ana",
      "Restored state does not share mutable snapshot data",
    );
    advance(restored);
    assertEquals(
      restored.phase,
      "hide",
      "The restored deadline remains executable",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("two humans complete two rounds with early findings, deadlines and final scores", () => {
  const { room, players } = makeRoom({ settings: { rounds: 2, seekTime: 30 } });
  try {
    room.handle(players[0], { t: "start" });
    advance(room);
    for (const player of players) {
      room.handle(player, { t: "submit", fig: figure });
    }
    assertEquals(room.phase, "check", "Both ready players end hiding early");
    advance(room);
    assertEquals(
      room.participants,
      players.map((player) => player.id),
      "Both humans participate in searching",
    );
    room.handle(players[0], { t: "found", target: players[1].id, time: 5 });
    room.handle(players[1], { t: "found", target: players[0].id, time: 8 });
    assertEquals(
      room.phase,
      "results",
      "Everyone finding their target ends searching early",
    );
    assertEquals(
      players.map((player) => player.score),
      [204, 186],
      "Speed and hiding award the expected scores",
    );
    assertEquals(
      room.transition,
      "nextRound",
      "An intermediate result advances to another round",
    );
    advance(room);
    assertEquals(room.round, 2, "The results deadline starts round two");
    advance(room);
    for (const player of players) {
      room.handle(player, { t: "submit", fig: figure });
    }
    advance(room);
    assertEquals(room.phase, "seek", "Round two reaches searching");
    advance(room);
    assertEquals(
      room.phase,
      "results",
      "A search deadline also ends the round",
    );
    assertEquals(
      room.transition,
      "final",
      "The final round schedules the standings",
    );
    advance(room);
    assertEquals(
      room.phase,
      "final",
      "The final results deadline completes the game",
    );
    assertEquals(
      room.phaseMsg.standings.map((player: Player) => player.score),
      [354, 336],
      "Scores carry across rounds",
    );
    assertEquals(
      [room.deadline, room.transition, room.timer],
      [0, null, null],
      "Completed games have no pending work",
    );
    assertEquals(
      room.tick(Date.now() + 1_000_000),
      false,
      "A completed game cannot advance again",
    );
  } finally {
    room.destroy();
  }
});

Deno.test("collecting the missing figure shortens the check deadline and updates sync", () => {
  const { room, players, messages } = makeRoom();
  try {
    room.handle(players[0], { t: "start" });
    advance(room);
    room.handle(players[0], { t: "submit", fig: figure });
    advance(room);
    assertEquals(
      room.phase,
      "check",
      "The hiding deadline starts figure collection",
    );
    assertEquals(
      room.deadline,
      room.checkStarted + MS.checkMax,
      "A missing figure retains the full collection timeout",
    );
    assert(
      messages[1].some((message) => message.t === "collect"),
      "The unready player is asked for their figure",
    );
    room.handle(players[1], { t: "figure", fig: figure });
    assertEquals(
      room.deadline,
      room.checkStarted + MS.checkMin,
      "Receiving all figures shortens the deadline",
    );
    assertEquals(
      room.phaseEndsAt,
      room.deadline,
      "The compatibility deadline stays synchronized",
    );
    room.sync(players[0]);
    const synced = messages[0].at(-1);
    assert(
      synced?.t === "phase" && typeof synced.duration === "number",
      "Sync sends the phase with a remaining duration",
    );
    assert(
      synced.duration > 0 && synced.duration <= MS.checkMin,
      "Sync uses the shortened deadline without a local timer",
    );
    assertEquals(
      room.tick(room.deadline - 1),
      false,
      "Collection cannot finish before its shortened deadline",
    );
    advance(room);
    assertEquals(room.phase, "seek", "The shortened deadline starts searching");
    assertEquals(
      room.timer,
      null,
      "Figure collection creates no timer in external mode",
    );
  } finally {
    room.destroy();
  }
});

Deno.test("a collection timeout without enough figures returns safely to the lobby", () => {
  const { room, players } = makeRoom();
  try {
    room.handle(players[0], { t: "start" });
    advance(room);
    room.handle(players[0], { t: "submit", fig: figure });
    advance(room);
    advance(room);
    assertEquals(
      room.phase,
      "lobby",
      "A round with one figure cannot enter searching",
    );
    assertEquals(
      [room.round, room.deadline, room.transition],
      [0, 0, null],
      "Returning to the lobby clears round scheduling",
    );
  } finally {
    room.destroy();
  }
});

Deno.test("default CPU timers still advance phases and resume after restoration", async () => {
  const room = new Room("CPU");
  let restored;
  let safetyTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reachedHide = new Promise<void>((resolve, reject) => {
      safetyTimer = setTimeout(
        () => reject(new Error("CPU timer did not advance within one second")),
        1000,
      );
      room.join({
        send(message: Message) {
          if (message.phase === "hide") resolve();
        },
      }, { name: "Ana" });
    });
    room.setPhase("prepare", 0, "hide");
    assertEquals(
      room.externalTimers,
      false,
      "The default remains local timers",
    );
    assert(room.timer !== null, "CPU mode creates a timer");
    restored = Room.restore(room.snapshot());
    assert(
      restored.timer !== null,
      "Restoration resumes a pending local timer",
    );
    await reachedHide;
    assertEquals(
      room.phase,
      "hide",
      "The real local timer advances the original room",
    );
    // Both zero-delay timers run before this next turn of the event loop.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(
      restored.phase,
      "hide",
      "The restored real timer also advances",
    );
  } finally {
    if (safetyTimer !== undefined) clearTimeout(safetyTimer);
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("the art gallery matches the artwork files and uses its own timings", async () => {
  assertEquals(ART_COUNT, Artworks.count, "room.js and artworks.js agree on the number of artworks");
  for (const art of Artworks.list) {
    const info = await Deno.stat(new URL(`../escondidas-en-pintura/obras/${art.file}`, import.meta.url));
    assert(info.isFile && info.size > 10_000, `${art.file} exists`);
  }
  const { room, players } = makeRoom();
  try {
    assertEquals(room.settings.gallery, "clasico", "Rooms start with the classic paintings");
    room.handle(players[1], { t: "settings", gallery: "arte" });
    assertEquals(room.settings.gallery, "clasico", "Only the host changes the gallery");
    room.handle(players[0], { t: "settings", gallery: "arte" });
    assertEquals(
      [room.settings.gallery, room.settings.hideTime, room.settings.seekTime],
      ["arte", GALLERIES.arte.hideDefault, GALLERIES.arte.seekDefault],
      "Switching gallery applies its default times",
    );
    room.handle(players[0], { t: "settings", hideTime: 90, seekTime: 20 });
    assertEquals(
      [room.settings.hideTime, room.settings.seekTime],
      [GALLERIES.arte.hideDefault, GALLERIES.arte.seekDefault],
      "Classic-only times are rejected for artworks",
    );
    room.handle(players[0], { t: "settings", hideTime: 600, seekTime: 120 });
    assertEquals([room.settings.hideTime, room.settings.seekTime], [600, 120], "Longer times are accepted");
    for (const bad of ["__proto__", ["arte"], "toString"]) {
      room.handle(players[0], { t: "settings", gallery: bad });
      assertEquals(room.settings.gallery, "arte", `Invalid gallery ${JSON.stringify(bad)} is ignored`);
    }
    const seen = new Set();
    for (let round = 0; round < ART_COUNT; round++) {
      room.round = 0;
      room.nextRound();
      assertEquals(room.phaseMsg.gallery, "arte", "Phase messages name the gallery");
      assert(room.painting >= 0 && room.painting < ART_COUNT, "Artwork index is in range");
      seen.add(room.painting);
    }
    assertEquals(seen.size, ART_COUNT, "A full deck shows every artwork once");
  } finally {
    room.destroy();
  }
});

Deno.test("unlimited hiding waits for everyone until the host gives the last 30 seconds", () => {
  const { room, messages, players } = makeRoom({ settings: { gallery: "arte", hideTime: 0, rounds: 1 } });
  try {
    room.handle(players[0], { t: "start" });
    advance(room);
    assertEquals(room.phase, "hide", "Hiding starts");
    assertEquals([room.deadline, room.transition], [0, null], "Unlimited hiding has no deadline");
    assertEquals(room.phaseMsg.duration, null, "Clients receive no duration");
    assertEquals(room.tick(Date.now() + 3_600_000), false, "Even an hour later nothing advances by itself");
    room.handle(players[1], { t: "hurry" });
    assertEquals(room.deadline, 0, "Only the host can hurry");
    room.handle(players[0], { t: "submit", fig: figure });
    room.handle(players[0], { t: "hurry" });
    assertEquals(room.transition, "endHide", "Hurry schedules the end of hiding");
    const last = messages[1].at(-1)!;
    assertEquals([last.phase, last.duration, last.hurry], ["hide", MS.hurry, true], "Everyone hears about the last 30 seconds");
    const deadline = room.deadline;
    room.handle(players[0], { t: "hurry" });
    assertEquals(room.deadline, deadline, "A second hurry does not move the deadline");
    const restored = Room.restore(JSON.parse(JSON.stringify(room.snapshot())), { externalTimers: true });
    assertEquals(restored.deadline, deadline, "The hurried deadline survives a restart");
    restored.destroy();
    advance(room);
    assertEquals(room.phase, "check", "The hurried deadline ends hiding");
  } finally {
    room.destroy();
  }
});

Deno.test("rooms saved before galleries restore as classic", () => {
  const { room } = makeRoom();
  try {
    const old = room.snapshot();
    delete old.settings.gallery;
    delete old.gallery;
    const restored = Room.restore(old, { externalTimers: true });
    assertEquals(restored.settings.gallery, "clasico", "Missing gallery means classic");
    restored.nextRound();
    assertEquals(restored.phaseMsg.gallery, "clasico", "Rounds use classic paintings");
    restored.destroy();
  } finally {
    room.destroy();
  }
});
