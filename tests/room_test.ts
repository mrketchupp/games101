import "../escondidas-en-pintura/artworks.js";
import "../escondidas-en-pintura/bot-ai.js";
import "../escondidas-en-pintura/room.js";

// deno-lint-ignore no-explicit-any
const HideRoom = (globalThis as any).HideRoom;
const { Room, MS, PAINTING_COUNT, ARTWORK_COUNT, COLLECTIONS, collectionOf } = HideRoom;

type Message = {
  t: string;
  phase?: string;
  duration?: number | null;
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

Deno.test("room settings default safely and only accept supported numeric values", () => {
  const defaults = {
    rounds: 3,
    hideTime: 120,
    seekTime: 30,
    difficulty: 1,
    collection: 0,
    bots: 0,
    botLevel: 1,
  };
  const invalid = [-1, 3, "2", null, false, [], {}, NaN, Infinity];
  for (const value of invalid) {
    const room = new Room("TEST", {
      externalTimers: true,
      settings: {
        rounds: 4,
        hideTime: 0,
        seekTime: "30",
        difficulty: value,
        collection: value,
        unknown: "ignored",
      },
    });
    try {
      assertEquals(
        room.settings,
        defaults,
        "Invalid constructor settings use defaults",
      );
    } finally {
      room.destroy();
    }
  }
  const { room, players } = makeRoom();
  try {
    room.handle(players[0], { t: "settings", difficulty: 2, collection: 1 });
    assertEquals(
      [room.settings.difficulty, room.settings.collection],
      [2, 1],
      "The host can choose a supported difficulty and collection",
    );
    for (const value of [...invalid, 2.5]) {
      room.handle(players[0], {
        t: "settings",
        difficulty: value,
        collection: value,
        unknown: "ignored",
      });
      assertEquals(
        room.settings,
        { ...defaults, difficulty: 2, collection: 1, hideTime: 300, seekTime: 60 },
        "Invalid messages retain the last valid settings",
      );
    }
    room.handle(players[0], { t: "settings", difficulty: 0, collection: 0 });
    assertEquals(
      [room.settings.difficulty, room.settings.collection],
      [0, 0],
      "Zero selects easy patterns rather than falling back to defaults",
    );
  } finally {
    room.destroy();
  }
});

Deno.test("only the host can change settings while the room is in the lobby", () => {
  const { room, players } = makeRoom();
  try {
    room.handle(players[1], { t: "settings", difficulty: 2, collection: 1 });
    assertEquals(
      [room.settings.difficulty, room.settings.collection],
      [1, 0],
      "A guest cannot change lobby settings",
    );
    room.handle(players[0], { t: "settings", difficulty: 0, collection: 1 });
    room.handle(players[0], { t: "start" });
    room.handle(players[0], { t: "settings", difficulty: 2, collection: 0 });
    assertEquals(
      [room.settings.difficulty, room.settings.collection],
      [0, 1],
      "The active round keeps the selected board settings",
    );
    room.final();
    room.handle(players[0], { t: "settings", difficulty: 2, collection: 0 });
    assertEquals(
      [room.settings.difficulty, room.settings.collection],
      [0, 1],
      "The final standings also keep the played settings",
    );
    room.handle(players[0], { t: "lobby" });
    room.handle(players[0], { t: "settings", difficulty: 2, collection: 0 });
    assertEquals(
      [room.settings.difficulty, room.settings.collection],
      [2, 0],
      "Returning to the lobby enables host changes again",
    );
  } finally {
    room.destroy();
  }
});

Deno.test("all phases and restored sync carry the selected board settings", () => {
  const { room, players, messages } = makeRoom({
    settings: { rounds: 1, difficulty: 2, collection: 1 },
  });
  let restored;
  try {
    room.handle(players[0], { t: "start" });
    advance(room);
    for (const player of players) {
      room.handle(player, { t: "submit", fig: figure });
    }
    advance(room);
    const snapshot = room.snapshot();
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), {
      externalTimers: true,
    });
    assertEquals(
      restored.snapshot(),
      snapshot,
      "New snapshots preserve every game field",
    );
    const synced: Message[] = [];
    const player = restored.players[0];
    player.conn = {
      send(message: Message) {
        synced.push(message);
      },
    };
    restored.sync(player);
    assertEquals(
      [synced[0].phase, synced[0].difficulty, synced[0].collection],
      ["seek", 2, 1],
      "A reconnect receives the persisted difficulty and artwork collection",
    );
    advance(room);
    advance(room);
    room.handle(players[0], { t: "lobby" });
    const phases = messages[0].filter((message) => message.t === "phase");
    assertEquals(
      phases.map((message) => message.phase),
      ["prepare", "hide", "check", "seek", "results", "final", "lobby"],
      "The game exercised every phase transition",
    );
    assert(
      phases.every((message) =>
        message.difficulty === 2 && message.collection === 1
      ),
      "Every phase identifies the same board settings",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("legacy snapshots retain the ongoing round and receive compatible defaults", () => {
  const { room, players } = makeRoom({
    settings: { rounds: 5, hideTime: 90, seekTime: 45 },
  });
  let restored;
  try {
    room.handle(players[0], { t: "start" });
    advance(room);
    room.handle(players[0], { t: "submit", fig: figure });
    const snapshot = room.snapshot();
    delete snapshot.settings.difficulty;
    delete snapshot.settings.collection;
    delete snapshot.phaseMsg.difficulty;
    delete snapshot.phaseMsg.collection;
    delete snapshot.deckCollection;
    delete snapshot.deckCount;
    delete snapshot.lastPainting;
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), {
      externalTimers: true,
    });
    assertEquals(
      restored.settings,
      { rounds: 5, hideTime: 90, seekTime: 45, difficulty: 0, collection: 0, bots: 0, botLevel: 1 },
      "A legacy game retains its original untextured background and room choices",
    );
    for (
      const key of [
        "phase",
        "round",
        "painting",
        "seed",
        "deadline",
        "deck",
        "figures",
      ]
    ) {
      assertEquals(
        restored[key],
        snapshot[key],
        `Legacy restoration preserves ${key}`,
      );
    }
    const synced: Message[] = [];
    restored.players[1].conn = {
      send(message: Message) {
        synced.push(message);
      },
    };
    restored.sync(restored.players[1]);
    assertEquals(
      [synced[0].difficulty, synced[0].collection],
      [0, 0],
      "Legacy reconnects identify the original untextured board settings",
    );
    restored.handle(restored.players[1], { t: "submit", fig: figure });
    assertEquals(
      restored.phase,
      "check",
      "The restored ongoing round remains playable",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("legacy lobby snapshots use normal difficulty for the next new game", () => {
  const { room, players } = makeRoom();
  let restored;
  try {
    const snapshot = room.snapshot();
    delete snapshot.settings.difficulty;
    delete snapshot.settings.collection;
    delete snapshot.phaseMsg.difficulty;
    delete snapshot.phaseMsg.collection;
    delete snapshot.deckCollection;
    delete snapshot.deckCount;
    delete snapshot.lastPainting;
    restored = Room.restore(snapshot, { externalTimers: true });
    restored.handle(restored.get(players[0].id), { t: "start" });
    assertEquals(
      [
        restored.phase,
        restored.phaseMsg.difficulty,
        restored.phaseMsg.collection,
      ],
      ["prepare", 1, 0],
      "Only ongoing legacy games retain easy backgrounds; a new game uses normal patterns",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("legacy artwork games reject joins without reinterpreting their figures or painting indices", () => {
  for (const phase of ["prepare", "hide", "check", "seek", "results", "final"]) {
    for (const gallerySource of ["room", "settings", "phase"]) {
      const { room, players } = makeRoom();
      let restored;
      let restoredAgain;
      try {
        room.handle(players[0], { t: "start" });
        const snapshot = room.snapshot();
        delete snapshot.legacyArtRoom;
        delete snapshot.settings.collection;
        delete snapshot.settings.difficulty;
        delete snapshot.phaseMsg.collection;
        delete snapshot.phaseMsg.difficulty;
        snapshot.phase = phase;
        snapshot.phaseMsg.phase = phase;
        snapshot.painting = 11;
        snapshot.phaseMsg.painting = 11;
        snapshot.figures = { [players[0].id]: { ...figure } };
        snapshot.phaseMsg.figs = { [players[0].id]: { ...figure } };
        if (gallerySource === "room") snapshot.gallery = "arte";
        if (gallerySource === "settings") snapshot.settings.gallery = "arte";
        if (gallerySource === "phase") snapshot.phaseMsg.gallery = "arte";
        restored = Room.restore(snapshot, { externalTimers: true });
        assert(restored.legacyArtRoom, "Every legacy artwork phase and gallery field is identified before catch-up");
        const before = restored.snapshot();
        const sent: Message[] = [];
        const joined = restored.join({ send: (message: Message) => sent.push(message) }, { pid: "human-0" });
        assertEquals(joined, { error: "Esta sala pertenece a una versión anterior. Crea una sala nueva para continuar." }, "An incompatible artwork room explains how to continue");
        assertEquals(sent, [], "The rejected player receives no mismatched board or figure sync");
        assertEquals(restored.snapshot(), before, "Rejecting a join does not reset the legacy game");
        for (const key of ["painting", "seed", "figures"]) {
          assertEquals(restored[key], snapshot[key], `Legacy artwork detection preserves ${key}`);
        }
        assertEquals(restored.phaseMsg.figs, snapshot.phaseMsg.figs, "The old PNGs remain exactly as saved");
        restored.tick(restored.deadline + 1_000_000);
        assert(restored.legacyArtRoom, "Catch-up cannot silently upgrade an incompatible artwork room");
        restoredAgain = Room.restore(restored.snapshot(), { externalTimers: true });
        assert(restoredAgain.legacyArtRoom, "The compatibility marker survives subsequent snapshots with normalized settings");
        assert(restoredAgain.join({ send() {} }, { pid: "human-0" }).error, "A later restore still directs players to a new room");
      } finally {
        room.destroy();
        restored?.destroy();
        restoredAgain?.destroy();
      }
    }
  }
});

Deno.test("legacy classic games retain their untextured board and accept reconnecting players", () => {
  const { room, players } = makeRoom();
  let restored;
  try {
    room.handle(players[0], { t: "start" });
    advance(room);
    room.handle(players[0], { t: "submit", fig: figure });
    const snapshot = room.snapshot();
    delete snapshot.settings.collection;
    delete snapshot.settings.difficulty;
    snapshot.settings.gallery = "clasico";
    snapshot.gallery = "clasico";
    snapshot.phaseMsg.gallery = "clasico";
    restored = Room.restore(snapshot, { externalTimers: true });
    assertEquals(restored.legacyArtRoom, false, "Only legacy artwork games need a new room");
    assertEquals([restored.settings.collection, restored.settings.difficulty], [0, 0], "The original classic game retains its untextured board");
    const sent: Message[] = [];
    const joined = restored.join({ send: (message: Message) => sent.push(message) }, { pid: "human-0" });
    assert(joined.player && !joined.error, "A classic player can reconnect normally");
    assertEquals(sent.map((message) => message.t), ["welcome", "room", "phase"], "The reconnect receives a normal board sync");
    for (const key of ["phase", "painting", "seed", "deadline", "figures"]) {
      assertEquals(restored[key], snapshot[key], `Classic reconnection preserves ${key}`);
    }
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("an old artwork lobby can join and choose the current collection without a legacy-game block", () => {
  const { room } = makeRoom();
  let restored;
  try {
    const snapshot = room.snapshot();
    delete snapshot.settings.collection;
    delete snapshot.settings.difficulty;
    snapshot.settings.gallery = "arte";
    snapshot.gallery = "arte";
    snapshot.phaseMsg.gallery = "arte";
    restored = Room.restore(snapshot, { externalTimers: true });
    const joined = restored.join({ send() {} }, { pid: "human-0" });
    assert(joined.player && !joined.error, "An unstarted lobby has no artwork PNGs to reinterpret");
    assertEquals([restored.legacyArtRoom, restored.settings.collection, restored.settings.difficulty], [false, 0, 1], "The old lobby receives current safe defaults");
    restored.handle(joined.player, { t: "settings", collection: 1 });
    restored.handle(joined.player, { t: "start" });
    assertEquals([restored.phase, restored.settings.collection, restored.legacyArtRoom], ["prepare", 1, false], "The host can start a new game using the current artwork catalog");
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("current collection snapshots ignore obsolete gallery labels", () => {
  for (const collection of [0, 1]) {
    const { room, players } = makeRoom({ settings: { collection } });
    let restored;
    try {
      room.handle(players[0], { t: "start" });
      const snapshot = room.snapshot();
      snapshot.gallery = "arte";
      snapshot.settings.gallery = "arte";
      snapshot.phaseMsg.gallery = "arte";
      restored = Room.restore(snapshot, { externalTimers: true });
      assertEquals(restored.legacyArtRoom, false, "An explicit collection already identifies the current board format");
      const joined = restored.join({ send() {} }, { pid: "human-0" });
      assert(joined.player && !joined.error, "Stale metadata does not block a current-format game");
      assertEquals(restored.settings.collection, collection, "Reconnection keeps the explicit collection");
    } finally {
      room.destroy();
      restored?.destroy();
    }
  }
});

Deno.test("each collection uses every painting before refilling its persisted deck", () => {
  for (const [collection, count] of [[0, PAINTING_COUNT], [1, ARTWORK_COUNT]]) {
    const { room, players } = makeRoom({ settings: { collection } });
    let restored;
    try {
      room.handle(players[0], { t: "start" });
      const first = [room.painting];
      restored = Room.restore(room.snapshot(), { externalTimers: true });
      for (let i = 1; i < count; i++) {
        restored.nextRound();
        first.push(restored.painting);
      }
      assertEquals(
        first.slice().sort((a, b) => a - b),
        Array.from({ length: count }, (_, i) => i),
        "Restoration preserves a nonrepeating full collection",
      );
      assertEquals(
        restored.deck,
        [],
        "The deck is exhausted exactly once per collection",
      );
      const second = [];
      for (let i = 0; i < count; i++) {
        restored.nextRound();
        second.push(restored.painting);
      }
      assertEquals(
        second.slice().sort((a, b) => a - b),
        Array.from({ length: count }, (_, i) => i),
        "The second cycle also exhausts the collection without premature repetition",
      );
      assert(
        second[0] !== first.at(-1),
        "Refilling the deck never repeats the immediately preceding painting",
      );
    } finally {
      room.destroy();
      restored?.destroy();
    }
  }
});

Deno.test("consecutive games in the same room retain their unplayed collection", () => {
  for (const [collection, count] of [[0, PAINTING_COUNT], [1, ARTWORK_COUNT]]) {
    const { room, players } = makeRoom({ settings: { rounds: 1, collection } });
    try {
      const cycles: number[][] = [[], []];
      for (let i = 0; i < count * 2; i++) {
        room.handle(players[0], { t: "start" });
        cycles[Math.floor(i / count)].push(room.painting);
        room.final();
        if (i % 2 === 0) room.handle(players[0], { t: "lobby" });
      }
      for (const cycle of cycles) {
        assertEquals(
          cycle.slice().sort((a, b) => a - b),
          Array.from({ length: count }, (_, i) => i),
          "Replays and lobby restarts preserve all unplayed paintings",
        );
      }
      assert(
        cycles[0].at(-1) !== cycles[1][0],
        "A new game also avoids a repeat at the cycle boundary",
      );
    } finally {
      room.destroy();
    }
  }
});

Deno.test("a fresh room can draw painting zero and a refilled deck avoids its real last draw", () => {
  const originalRandom = Math.random;
  const { room, players } = makeRoom();
  try {
    // This shuffle puts index zero at the end, where pop() takes the next painting.
    Math.random = () => 0;
    assertEquals(
      room.lastPainting,
      null,
      "The initial painting placeholder is not history",
    );
    room.handle(players[0], { t: "start" });
    assertEquals(
      room.painting,
      0,
      "A fresh room is allowed to draw index zero",
    );
    room.deck = [];
    room.nextRound();
    assert(
      room.painting !== 0,
      "A refill swaps away a real immediately repeated draw",
    );
  } finally {
    Math.random = originalRandom;
    room.destroy();
  }
});

Deno.test("CPU deck state transfers history without transferring game state or mutable arrays", () => {
  const { room, players } = makeRoom({ settings: { collection: 1 } });
  let replay;
  try {
    room.handle(players[0], { t: "start" });
    const history = room.deckState();
    replay = makeRoom({ settings: { collection: 1 }, deckState: history });
    assertEquals(
      replay.room.deckState(),
      history,
      "The constructor reuses compatible CPU history",
    );
    assertEquals(
      [replay.room.phase, replay.room.round, replay.room.lastPainting],
      ["lobby", 0, room.painting],
      "Deck history does not restore the previous match",
    );
    const next = history.deck.at(-1);
    history.deck.length = 0;
    assert(
      replay.room.deck.length > 0,
      "The constructor clones the supplied deck",
    );
    assert(room.deck.length > 0, "Exporting history clones the original deck");
    replay.room.handle(replay.players[0], { t: "start" });
    assertEquals(
      replay.room.painting,
      next,
      "The next CPU game continues the saved deck",
    );
    assert(
      replay.room.painting !== room.painting,
      "The next CPU game avoids the preceding artwork",
    );
  } finally {
    room.destroy();
    replay?.room.destroy();
  }
});

Deno.test("CPU deck history validates ownership, catalog size and painting indexes", () => {
  const base = {
    deck: [0, 1],
    deckCollection: 1,
    deckCount: ARTWORK_COUNT,
    lastPainting: 2,
  };
  const invalid = [
    { ...base, deckCollection: 0 },
    { ...base, deckCount: ARTWORK_COUNT - 1 },
    { ...base, deck: [0, 0] },
    { ...base, deck: [2] },
    { ...base, deck: [-1] },
    { ...base, deck: [ARTWORK_COUNT] },
    { ...base, deck: ["0"] },
    { ...base, deck: null },
  ];
  for (const deckState of invalid) {
    const room = new Room("CPU", {
      externalTimers: true,
      settings: { collection: 1 },
      deckState,
    });
    try {
      assertEquals(
        room.deck,
        [],
        "Invalid history is replaced with a new deck",
      );
      assertEquals(
        room.deckCount,
        ARTWORK_COUNT,
        "History always uses the live catalog count",
      );
      assertEquals(
        room.deckCollection,
        1,
        "History always uses the selected collection",
      );
    } finally {
      room.destroy();
    }
  }
});

Deno.test("restoring an older catalog refills the expanded deck without changing the current round", () => {
  const { room, players } = makeRoom({ settings: { collection: 1 } });
  let restored;
  try {
    room.handle(players[0], { t: "start" });
    const snapshot = room.snapshot();
    snapshot.deck = [1];
    snapshot.deckCount = ARTWORK_COUNT - 1;
    snapshot.lastPainting = 0;
    snapshot.painting = 0;
    snapshot.phaseMsg.painting = 0;
    restored = Room.restore(snapshot, { externalTimers: true });
    for (
      const key of [
        "phase",
        "round",
        "painting",
        "seed",
        "deadline",
        "phaseMsg",
      ]
    ) {
      assertEquals(
        restored[key],
        snapshot[key],
        `A catalog update preserves ${key}`,
      );
    }
    assertEquals(
      restored.deck,
      [],
      "A different catalog count invalidates the remaining deck",
    );
    assertEquals(
      restored.deckCount,
      ARTWORK_COUNT,
      "The expanded catalog is used next round",
    );
    const cycle = [];
    for (let i = 0; i < ARTWORK_COUNT; i++) {
      restored.nextRound();
      cycle.push(restored.painting);
    }
    assert(
      cycle[0] !== 0,
      "A catalog update avoids immediately repeating the current painting",
    );
    assertEquals(
      cycle.slice().sort((a, b) => a - b),
      Array.from({ length: ARTWORK_COUNT }, (_, i) => i),
      "The new cycle includes every index from the expanded catalog",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("four-artwork legacy snapshots infer their original catalog size", () => {
  const { room, players } = makeRoom({ settings: { collection: 1 } });
  let restored;
  try {
    room.handle(players[0], { t: "start" });
    const snapshot = room.snapshot();
    snapshot.deck = [1, 2, 3];
    snapshot.painting = 0;
    snapshot.phaseMsg.painting = 0;
    delete snapshot.deckCount;
    delete snapshot.lastPainting;
    restored = Room.restore(snapshot, { externalTimers: true });
    assertEquals(
      [restored.painting, restored.lastPainting],
      [0, 0],
      "A legacy artwork match retains its current board and real last draw",
    );
    assertEquals(
      restored.deck,
      ARTWORK_COUNT === 4 ? [1, 2, 3] : [],
      "The old four-artwork deck survives only if the live catalog still has four artworks",
    );
    assertEquals(
      restored.deckCount,
      ARTWORK_COUNT,
      "Subsequent draws use the live catalog size",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

Deno.test("changing collections discards stale decks and restoration detects old deck ownership", () => {
  const { room, players } = makeRoom();
  let restored;
  try {
    room.handle(players[0], { t: "start" });
    room.toLobby();
    const patternDeck = room.deck.slice();
    room.handle(players[0], { t: "settings", difficulty: 2 });
    assertEquals(
      room.deck,
      patternDeck,
      "Changing difficulty retains collection ownership",
    );
    room.handle(players[0], { t: "settings", collection: 1 });
    assertEquals(
      room.deck,
      [],
      "Changing collection discards the previous painting deck",
    );
    assertEquals(
      room.deckCollection,
      1,
      "New decks belong to the artwork collection",
    );
    const snapshot = room.snapshot();
    snapshot.deck = [9, 8, 7];
    snapshot.deckCollection = 0;
    restored = Room.restore(snapshot, { externalTimers: true });
    assertEquals(
      restored.deck,
      [],
      "Restoration drops a deck belonging to another collection",
    );
    restored.nextRound();
    assert(
      restored.painting >= 0 && restored.painting < ARTWORK_COUNT,
      "A stale pattern index cannot appear in an artwork round",
    );
  } finally {
    room.destroy();
    restored?.destroy();
  }
});

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

Deno.test("collections retain distinct supported timers and reset defaults when switching", () => {
  assertEquals(collectionOf(0), COLLECTIONS[0], "Patterns expose their collection rules");
  assertEquals(collectionOf(1), COLLECTIONS[1], "Artwork exposes its collection rules");
  for (const value of ["1", null, false, -1, 2, {}]) {
    assertEquals(collectionOf(value), COLLECTIONS[0], "Invalid collection keys safely select patterns");
  }
  for (const collection of [0, 1]) {
    const rules = collectionOf(collection);
    const constructed = new Room("TIMERS", { externalTimers: true, settings: { collection } });
    try {
      assertEquals([constructed.settings.hideTime, constructed.settings.seekTime], [rules.hideDefault, rules.seekDefault], "Constructor uses the selected collection defaults");
    } finally {
      constructed.destroy();
    }
    const { room, players } = makeRoom({ settings: { collection } });
    try {
      for (const hideTime of rules.hideTime) {
        for (const seekTime of rules.seekTime) {
          room.handle(players[0], { t: "settings", hideTime, seekTime });
          assertEquals([room.settings.hideTime, room.settings.seekTime], [hideTime, seekTime], "The collection accepts every advertised timer pair");
        }
      }
      const timers = [room.settings.hideTime, room.settings.seekTime];
      for (const value of ["180", null, false, -1, 1, 200, NaN, Infinity]) {
        room.handle(players[0], { t: "settings", hideTime: value, seekTime: value });
        assertEquals([room.settings.hideTime, room.settings.seekTime], timers, "Invalid timer messages retain both supported choices");
      }
      const next = 1 - collection;
      room.handle(players[0], { t: "settings", collection: next });
      assertEquals([room.settings.hideTime, room.settings.seekTime], [collectionOf(next).hideDefault, collectionOf(next).seekDefault], "Switching collection selects its own defaults");
      room.handle(players[0], { t: "settings", collection, hideTime: rules.hideTime.at(-1), seekTime: rules.seekTime.at(-1) });
      assertEquals([room.settings.hideTime, room.settings.seekTime], [rules.hideTime.at(-1), rules.seekTime.at(-1)], "An atomic collection change accepts valid explicit times");
      const invalidHide = collection ? 60 : 600;
      const invalidSeek = collection ? 20 : 120;
      room.handle(players[0], { t: "settings", hideTime: invalidHide, seekTime: invalidSeek });
      assertEquals([room.settings.hideTime, room.settings.seekTime], [rules.hideTime.at(-1), rules.seekTime.at(-1)], "Times belonging only to the other collection are rejected");
      const invalidRoom = new Room("BADTIMERS", { externalTimers: true, settings: { collection, hideTime: invalidHide, seekTime: invalidSeek } });
      try {
        assertEquals([invalidRoom.settings.hideTime, invalidRoom.settings.seekTime], [rules.hideDefault, rules.seekDefault], "Invalid constructor times normalize to collection defaults");
      } finally {
        invalidRoom.destroy();
      }
    } finally {
      room.destroy();
    }
  }
});

Deno.test("unlimited artwork hiding restores and only the host can start its final thirty seconds", () => {
  const { room, players } = makeRoom({ settings: { collection: 1, hideTime: 0 } });
  let restored;
  try {
    room.handle(players[0], { t: "hurry" });
    assertEquals(room.phase, "lobby", "Hurry has no effect outside hiding");
    room.handle(players[0], { t: "start" });
    advance(room);
    assertEquals([room.phase, room.deadline, room.phaseEndsAt, room.transition, room.phaseMsg.duration, room.nextWakeAt()], ["hide", 0, 0, null, null, 0], "Unlimited hiding has no deadline or timer transition");
    assert(!room.tick(room.phaseStartedAt + 600_000), "Elapsed time alone cannot finish unlimited hiding");
    room.handle(players[0], { t: "submit", fig: figure });
    room.handle(players[1], { t: "figure", fig: { ...figure, x: 300 } });
    const snapshot = room.snapshot();
    restored = Room.restore(JSON.parse(JSON.stringify(snapshot)), { externalTimers: true });
    assertEquals(restored.snapshot(), snapshot, "Unlimited hiding survives a JSON persistence cycle");
    const replay: Message[] = [];
    restored.players[0].conn = { send: (message: Message) => replay.push(message) };
    restored.sync(restored.players[0]);
    assertEquals([replay[0].phase, replay[0].duration], ["hide", null], "Reconnecting players receive the unlimited duration explicitly");
    room.handle(players[1], { t: "hurry" });
    assertEquals(room.snapshot(), snapshot, "A guest cannot set the final deadline");
    room.lastTickAt = room.phaseStartedAt + 60_000;
    const startedAt = room.phaseStartedAt;
    const hurryAt = room.time();
    const state = {
      seed: room.seed, figures: structuredClone(room.figures), ready: room.players.map((p: { ready: boolean }) => p.ready),
      deck: room.deck.slice(), finds: room.finds.slice(), done: { ...room.done },
    };
    room.handle(players[0], { t: "hurry" });
    assertEquals([room.deadline, room.phaseEndsAt, room.transition, room.phaseMsg.duration, room.phaseMsg.hurry], [hurryAt + MS.hurry, hurryAt + 30_000, "endHide", 30_000, true], "The host sets exactly thirty final seconds from the current logical clock");
    assertEquals(room.phaseStartedAt, startedAt, "Hurry preserves the original start of hiding");
    assertEquals({ seed: room.seed, figures: room.figures, ready: room.players.map((p: { ready: boolean }) => p.ready), deck: room.deck, finds: room.finds, done: room.done }, state, "Hurry retains paintings, readiness, seeds and round history");
    const hurried = room.snapshot();
    room.handle(players[0], { t: "hurry" });
    assertEquals(room.snapshot(), hurried, "Repeated hurry messages cannot extend the deadline");
    restored.destroy();
    restored = Room.restore(hurried, { externalTimers: true });
    assertEquals([restored.deadline, restored.phaseStartedAt, restored.phaseMsg.hurry], [hurried.deadline, startedAt, true], "Persistence preserves the shortened deadline and original start");
    assert(!restored.tick(restored.deadline - 1), "The last thirty seconds cannot expire early");
    advance(restored);
    assertEquals(restored.phase, "check", "The final deadline advances to collection");
    advance(restored);
    assertEquals(restored.phase, "seek", "Collected figures continue into searching");
    const seekState = restored.snapshot();
    restored.handle(restored.players[0], { t: "hurry" });
    assertEquals(restored.snapshot(), seekState, "Hurry cannot alter searching or its plans");
  } finally {
    room.destroy();
    restored?.destroy();
  }
  const finite = makeRoom({ settings: { collection: 1, hideTime: 180 } });
  try {
    finite.room.handle(finite.players[0], { t: "start" });
    advance(finite.room);
    const before = finite.room.snapshot();
    finite.room.handle(finite.players[0], { t: "hurry" });
    assertEquals(finite.room.snapshot(), before, "A timed round keeps its chosen deadline");
  } finally {
    finite.room.destroy();
  }
});
