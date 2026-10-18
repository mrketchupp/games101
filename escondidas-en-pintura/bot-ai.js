/* Decisiones de CPU compartidas por navegador y servidor; sin DOM ni temporizadores. */
(function (root) {
  'use strict';

  const LEVEL_KEYS = Object.freeze(['easy', 'normal', 'hard', 'expert']);
  const LEVEL_NAMES = Object.freeze(['Fácil', 'Normal', 'Difícil', 'Experto']);
  const settings = [
    { shift: 10, cell: 10, noise: 22, holes: 4, holeSize: [10, 18], placementCandidates: 2, readyAt: [14, 28], reaction: 3.4, scan: 40, miss: 0.34, gap: 2.5 },
    { shift: 5, cell: 5, noise: 12, holes: 2, holeSize: [7, 12], placementCandidates: 7, readyAt: [20, 36], reaction: 2.6, scan: 35, miss: 0.22, gap: 2.0 },
    { shift: 3, cell: 3, noise: 8, holes: 1, holeSize: [4, 7], placementCandidates: 16, readyAt: [25, 43], reaction: 1.9, scan: 25, miss: 0.13, gap: 1.5 },
    { shift: 1, cell: 2, noise: 5, holes: 1, holeSize: [3, 5], placementCandidates: 28, readyAt: [29, 48], reaction: 1.4, scan: 18, miss: 0.065, gap: 1.15 },
  ];
  const PROFILES = Object.freeze(Object.fromEntries(LEVEL_KEYS.map((key, index) => [key,
    Object.freeze({ ...settings[index], holeSize: Object.freeze(settings[index].holeSize), readyAt: Object.freeze(settings[index].readyAt), key, index, name: LEVEL_NAMES[index] }),
  ])));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function profile(level) {
    const key = Number.isInteger(level) ? LEVEL_KEYS[level] : level;
    return PROFILES[key] || PROFILES.normal;
  }

  /** PRNG estable de 32 bits; no modifica Math.random. */
  function seeded(seed) {
    let state = Number(seed) >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedFor(roundSeed, botId) {
    let hash = (2166136261 ^ (Number(roundSeed) >>> 0)) >>> 0;
    for (const char of String(botId)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash;
  }

  /** Segundos dedicados a pintar, ajustados también a rondas cortas. */
  function readyDelay({ level, hideTime, seed }) {
    const p = profile(level);
    const seconds = Number.isFinite(hideTime) ? Math.max(0, hideTime) : 90;
    const [min, max] = p.readyAt;
    return Math.min(seconds * 0.82, min + seeded(seed)() * (max - min));
  }

  /** blend es el porcentaje real de píxeles camuflados (0..100). */
  function searchPlan({ level, targets, limit, seed }) {
    const p = profile(level);
    const seconds = Number.isFinite(limit) ? Math.max(0, limit) : 0;
    const rng = seeded(seed);
    const unique = new Map();
    const candidates = [];
    for (const item of targets || []) {
      if (!item || typeof item.id !== 'string' || unique.has(item.id)) continue;
      unique.set(item.id, item);
    }
    // El orden de llegada de figuras no debe cambiar las decisiones de la CPU.
    const ordered = [...unique.values()].sort((a, b) => compareIds(a.id, b.id));
    for (const item of ordered) {
      const blend = Number.isFinite(item.blend) ? clamp(item.blend / 100, 0, 1) : 1;
      const difficult = Math.pow(blend, 2.8);
      // Incluso un experto puede pasar por alto una figura bien pintada.
      const failure = p.miss * difficult;
      const roll = rng();
      const jitter = 0.75 + rng() * 0.7;
      const distraction = rng() < p.miss ? 2 + rng() * 5 : 0;
      if (roll < failure) continue;
      const time = p.reaction + (1.4 + p.scan * difficult) * jitter + distraction;
      if (time < seconds) candidates.push({ target: item.id, time });
    }
    // Comparar IDs sin locale conserva el mismo plan en navegador y servidor.
    candidates.sort((a, b) => a.time - b.time || compareIds(a.target, b.target));
    const result = [];
    let previous = 0;
    for (const item of candidates) {
      const time = Math.round(Math.max(item.time, previous + p.gap) * 100) / 100;
      if (time >= seconds) continue;
      result.push({ target: item.target, time });
      previous = time;
    }
    return result;
  }

  root.HideBots = Object.freeze({ LEVEL_KEYS, LEVEL_NAMES, PROFILES, profile, seeded, seedFor, readyDelay, searchPlan });
})(typeof globalThis !== 'undefined' ? globalThis : this);
