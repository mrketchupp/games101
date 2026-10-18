import "../escondidas-en-pintura/bot-ai.js";

type Step = { target: string; time: number };
type PlanInput = {
  level: number | string;
  targets: { id: string; blend: number }[];
  limit: number;
  seed: number;
};
const HideBots = (globalThis as unknown as {
  HideBots: {
    LEVEL_KEYS: string[];
    profile: (level: number | string) => {
      key: string;
      reaction: number;
      placementCandidates: number;
      cell: number;
    };
    seeded: (seed: number) => () => number;
    seedFor: (round: number, id: string) => number;
    readyDelay: (input: { level: string; hideTime: number; seed: number }) => number;
    searchPlan: (input: PlanInput) => Step[];
  };
}).HideBots;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("CPU levels preserve old keys and add a more precise expert", () => {
  assert(
    HideBots.LEVEL_KEYS.join(",") === "easy,normal,hard,expert",
    "Stored level keys remain usable",
  );
  assert(HideBots.profile("invalid").key === "normal", "Invalid level fallback");
  let candidates = 0;
  let cell = Infinity;
  for (let i = 0; i < 4; i++) {
    const p = HideBots.profile(i);
    assert(p.key === HideBots.LEVEL_KEYS[i], "Numeric and string levels agree");
    assert(p.placementCandidates > candidates, "Better CPU explores more places");
    assert(p.cell < cell, "Better CPU paints with finer strokes");
    candidates = p.placementCandidates;
    cell = p.cell;
  }
});

Deno.test("CPU seeds and decisions reproduce across restored rooms", () => {
  const a = HideBots.seeded(HideBots.seedFor(427, "cpu-1"));
  const b = HideBots.seeded(HideBots.seedFor(427, "cpu-1"));
  const c = HideBots.seedFor(427, "cpu-2");
  assert(c !== HideBots.seedFor(427, "cpu-1"), "Each CPU has its own sequence");
  for (let i = 0; i < 100; i++) {
    const n = a();
    assert(n === b() && n >= 0 && n < 1, "Stable bounded random numbers");
  }
  const input = {
    level: "hard",
    targets: [{ id: "a", blend: 60 }, { id: "b", blend: 98 }],
    limit: 40,
    seed: c,
  };
  assert(
    JSON.stringify(HideBots.searchPlan(input)) ===
      JSON.stringify(HideBots.searchPlan(input)),
    "Repeated planning yields identical decisions",
  );
  const targets = [
    { id: "z", blend: 40 },
    { id: "A", blend: 86 },
    { id: "á", blend: 95 },
    { id: "a", blend: 70 },
  ];
  for (const level of HideBots.LEVEL_KEYS) {
    for (let seed = 0; seed < 30; seed++) {
      const common = { level, limit: 60, seed };
      assert(
        JSON.stringify(HideBots.searchPlan({ ...common, targets })) ===
          JSON.stringify(HideBots.searchPlan({
            ...common,
            targets: [...targets].reverse(),
          })),
        "Figure arrival order does not change a restored plan",
      );
    }
  }
});

Deno.test("CPU plans respect reaction time, round limit and unique targets", () => {
  for (const level of HideBots.LEVEL_KEYS) {
    for (let seed = 0; seed < 80; seed++) {
      const plan = HideBots.searchPlan({
        level,
        targets: [
          { id: "a", blend: 0 },
          { id: "a", blend: 0 },
          { id: "b", blend: 70 },
          { id: "c", blend: 100 },
        ],
        limit: 30,
        seed,
      });
      assert(new Set(plan.map((step) => step.target)).size === plan.length, "No duplicate target");
      let previous = 0;
      for (const step of plan) {
        assert(step.time >= HideBots.profile(level).reaction, "No instant finds");
        assert(step.time > previous && step.time < 30, "Ordered finds before deadline");
        previous = step.time;
      }
    }
  }
});

Deno.test("Higher CPU levels find more camouflaged targets and react sooner", () => {
  let previousFound = 0;
  let previousMean = Infinity;
  for (const level of HideBots.LEVEL_KEYS) {
    let found = 0;
    let total = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const plan = HideBots.searchPlan({ level, targets: [{ id: "hidden", blend: 92 }], limit: 30, seed });
      found += plan.length;
      total += plan[0]?.time ?? 30;
    }
    assert(found > previousFound, "Higher difficulty finds more targets");
    if (previousFound > 0) {
      assert(found >= previousFound + 100, "Each level improves perception by at least ten percentage points");
    }
    assert(total / 1000 < previousMean, "Higher difficulty finds them sooner");
    assert(found < 1000, "No difficulty has perfect perception");
    previousFound = found;
    previousMean = total / 1000;
  }
});

Deno.test("Higher CPU levels noticeably shorten ordinary searches", () => {
  let previousMean = Infinity;
  for (const level of HideBots.LEVEL_KEYS) {
    let total = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const plan = HideBots.searchPlan({
        level,
        targets: [{ id: "hidden", blend: 80 }],
        limit: 30,
        seed,
      });
      total += plan[0]?.time ?? 30;
    }
    const mean = total / 1000;
    assert(mean < previousMean - 1, "Each level saves more than a second on average, counting misses");
    previousMean = mean;
  }
});

Deno.test("Extra search time helps every CPU without eliminating mistakes", () => {
  for (const level of HideBots.LEVEL_KEYS) {
    let shortFound = 0;
    let longFound = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const common = { level, targets: [{ id: "hidden", blend: 100 }], seed };
      const short = HideBots.searchPlan({ ...common, limit: 30 });
      const long = HideBots.searchPlan({ ...common, limit: 120 });
      shortFound += short.length;
      longFound += long.length;
      if (short.length) {
        assert(
          JSON.stringify(short) === JSON.stringify(long),
          "Extending a round preserves finds already scheduled",
        );
      }
    }
    assert(longFound > shortFound, "More time reveals additional well-painted targets");
    assert(longFound < 1000, "Even a long round leaves perception mistakes");
  }
});

Deno.test("Camouflage changes CPU perception at every level", () => {
  for (const level of HideBots.LEVEL_KEYS) {
    let exposed = 0;
    let hidden = 0;
    for (let seed = 0; seed < 200; seed++) {
      const common = { level, limit: 35, seed };
      exposed += HideBots.searchPlan({ ...common, targets: [{ id: "x", blend: 0 }] })[0]?.time ?? 35;
      hidden += HideBots.searchPlan({ ...common, targets: [{ id: "x", blend: 100 }] })[0]?.time ?? 35;
    }
    assert(hidden > exposed * 2, "A painted target is harder to spot");
  }
});

Deno.test("CPU readiness scales to the available hide time", () => {
  for (const level of HideBots.LEVEL_KEYS) {
    for (const hideTime of [0, 2, 60, 90, 180]) {
      const input = { level, hideTime, seed: 812 };
      const time = HideBots.readyDelay(input);
      assert(time >= 0 && time <= hideTime, "Readiness stays within hide phase");
      assert(time === HideBots.readyDelay(input), "Readiness is deterministic");
    }
  }
});

Deno.test("No time or no targets produces an empty search plan", () => {
  for (const limit of [0, -5, 0.1, NaN]) {
    assert(HideBots.searchPlan({ level: "expert", targets: [{ id: "x", blend: 0 }], limit, seed: 1 }).length === 0, "No find outside the available time");
  }
  assert(HideBots.searchPlan({ level: "normal", targets: [], limit: 30, seed: 1 }).length === 0, "Nothing to search for");
});
