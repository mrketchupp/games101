/*
 * Lógica de sala compartida.
 * La usa el servidor (Deno) para el multijugador en línea y el navegador para el modo contra la CPU,
 * así las reglas son idénticas en ambos modos. No depende del DOM.
 */
(function (root) {
  'use strict';

  const PAINTING_COUNT = 10;
  const ARTWORK_COUNT = root.HumanArt.works.length;
  const PROTOCOL_VERSION = 2;
  const CATALOG_VERSION = root.HumanArt.works.map((work) => work.id).join(',');
  const POSE_COUNT = 10;
  const MAX_PLAYERS = 8;
  const COLOR_COUNT = 8;
  const DEFAULTS = { rounds: 3, hideTime: 120, seekTime: 30, difficulty: 1, collection: 0, bots: 0, botLevel: 1 };
  const LIMITS = {
    rounds: [1, 2, 3, 5], hideTime: [60, 90, 120, 180, 300, 600, 0], seekTime: [20, 30, 45, 60, 90, 120],
    difficulty: [0, 1, 2], collection: [0, 1],
    bots: [0, 1, 2, 3, 4, 5, 6, 7], botLevel: [0, 1, 2, 3],
  };
  // Cada colección conserva sus tiempos; 0 permite pintar arte sin límite.
  const COLLECTIONS = {
    0: { count: PAINTING_COUNT, hideTime: [60, 90, 120, 180], seekTime: [20, 30, 45, 60], hideDefault: 120, seekDefault: 30 },
    1: { count: ARTWORK_COUNT, hideTime: [180, 300, 600, 0], seekTime: [30, 45, 60, 90, 120], hideDefault: 300, seekDefault: 60 },
  };
  const MS = { prepare: 3500, checkMin: 2800, checkMax: 7000, seekGrace: 2500, results: 13000, hurry: 30000 };
  const MISS_PENALTY = 2; // segundos que suma cada toque fallido al buscar
  const EXTRA_SEEK_PER_TARGET = 15; // segundos extra por cada rival a partir del segundo
  const MAX_IMG = 400000;

  const now = () => Date.now();
  const randomId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

  function collectionOf(value) {
    return COLLECTIONS[LIMITS.collection.includes(value) ? value : DEFAULTS.collection];
  }

  function validSettings(settings) {
    const result = Object.assign({}, DEFAULTS);
    for (const key of Object.keys(LIMITS)) {
      if (settings && LIMITS[key].includes(settings[key])) result[key] = settings[key];
    }
    const collection = collectionOf(result.collection);
    if (!collection.hideTime.includes(settings?.hideTime)) result.hideTime = collection.hideDefault;
    if (!collection.seekTime.includes(settings?.seekTime)) result.seekTime = collection.seekDefault;
    return result;
  }

  function cleanName(name) {
    return String(name == null ? '' : name)
      // deno-lint-ignore no-control-regex
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 16);
  }

  function seekLimit(settings, participantCount) {
    return settings.seekTime + EXTRA_SEEK_PER_TARGET * Math.max(0, participantCount - 2);
  }

  /** Puntos de la ronda: rapidez al encontrar + aguantar sin que te encuentren. */
  function scoreRound(participants, finds, limit) {
    const pts = {};
    participants.forEach((id) => { pts[id] = 0; });
    for (const f of finds) pts[f.seeker] += 100 + Math.round(100 * Math.max(0, 1 - f.time / limit));
    for (const hider of participants) {
      for (const seeker of participants) {
        if (seeker === hider) continue;
        const f = finds.find((x) => x.seeker === seeker && x.target === hider);
        pts[hider] += f ? Math.round(80 * Math.min(1, f.time / limit)) : 150;
      }
    }
    return pts;
  }

  class Room {
    constructor(code, opts = {}) {
      this.code = code;
      this.players = [];
      this.hostId = null;
      this.settings = validSettings(opts.settings);
      this.legacyArtRoom = false;
      this.phase = 'lobby';
      this.round = 0;
      this.timer = null;
      this.externalTimers = !!opts.externalTimers;
      this.deadline = 0;
      this.transition = null;
      this.phaseEndsAt = 0;
      this.phaseStartedAt = 0;
      this.lastTickAt = 0;
      this.botActions = [];
      this.phaseMsg = {
        t: 'phase', phase: 'lobby', round: 0, rounds: this.settings.rounds,
        difficulty: this.settings.difficulty, collection: this.settings.collection,
      };
      this.deck = [];
      this.deckCollection = this.settings.collection;
      this.deckCount = this.settings.collection === 1 ? ARTWORK_COUNT : PAINTING_COUNT;
      this.lastPainting = null;
      if (opts.deckState) this.loadDeck(opts.deckState);
      this.painting = 0;
      this.seed = 0;
      this.figures = {};
      this.participants = [];
      this.finds = [];
      this.done = {};
      this.limit = 0;
      this.checkStarted = 0;
      this.idCounter = 0;
      this.destroyed = false;
      this.onEmpty = opts.onEmpty || null;
    }

    // ---------- utilidades ----------
    get(id) { return this.players.find((p) => p.id === id) || null; }
    connected() { return this.players.filter((p) => p.connected); }
    connectedHumans() { return this.players.filter((p) => p.connected && !p.bot); }
    activeConnected() { return this.players.filter((p) => p.connected && p.active); }
    inGame() { return ['prepare', 'hide', 'check', 'seek', 'results'].includes(this.phase); }

    send(p, msg) { if (p && p.connected && p.conn) { try { p.conn.send(msg); } catch { /* conexión rota */ } } }
    broadcast(msg) { for (const p of this.players) this.send(p, msg); }

    clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
    destroy() { this.destroyed = true; this.clearTimer(); }

    time() { return this._tickAt ?? Math.max(now(), this.phaseStartedAt, this.lastTickAt); }

    /** Próximo trabajo de la sala, incluidos los movimientos de las CPU gestionadas. */
    nextWakeAt() {
      if (this.destroyed || !this.connectedHumans().length) return 0;
      const phaseAt = this.deadline && this.transition ? this.deadline : Infinity;
      const botAt = this.botActions.length ? this.botActions[0].at : Infinity;
      const at = Math.min(phaseAt, botAt);
      return Number.isFinite(at) ? at : 0;
    }

    reconcileBots() {
      if (this.phase !== 'lobby') return;
      const managed = this.players.filter((p) => p.managedBot);
      const available = MAX_PLAYERS - this.players.length + managed.length;
      const count = Math.min(this.settings.bots, available);
      this.settings.bots = count;
      const remove = new Set(managed.slice(count));
      this.players = this.players.filter((p) => !remove.has(p));
      for (let i = managed.length; i < count; i++) {
        this.players.push({
          id: 'p' + (++this.idCounter), pid: 'bot-' + root.crypto.randomUUID(),
          name: this.uniqueName('CPU ' + (i + 1)), conn: null, connected: true,
          bot: true, managedBot: true, botLevel: this.settings.botLevel,
          score: 0, active: true, ready: false, color: this.freeColor(), botReadyAt: 0,
        });
      }
      for (const p of this.players) if (p.managedBot) p.botLevel = this.settings.botLevel;
    }

    requestBotPaint(player = this.get(this.hostId)) {
      if (!player || player.id !== this.hostId || player.bot || !player.connected ||
          !['prepare', 'hide', 'check'].includes(this.phase)) return;
      const bots = this.activeConnected().filter((p) => p.managedBot && !this.figures[p.id]).map((p) => ({
        id: p.id, level: p.botLevel, seed: root.HideBots.seedFor(this.seed, p.id),
      }));
      if (bots.length) this.send(player, {
        t: 'botPaint', round: this.round, seed: this.seed, painting: this.painting,
        difficulty: this.settings.difficulty, collection: this.settings.collection, bots,
      });
    }

    planBotActions() {
      if (!['hide', 'seek'].includes(this.phase)) return;
      for (const p of this.activeConnected().filter((p) => p.managedBot)) {
        const seed = root.HideBots.seedFor(this.seed, p.id);
        const base = { botId: p.id, round: this.round, seed: this.seed };
        if (this.phase === 'hide') {
          // Sin límite humano, las CPU siguen pintando con un plazo razonable.
          const hideTime = this.settings.hideTime || collectionOf(this.settings.collection).hideDefault;
          const requested = root.HideBots.readyDelay({ level: p.botLevel, hideTime, seed });
          const delay = Math.max(0.1, Math.min(hideTime - 0.05, Number(requested) || 0.1));
          p.botReadyAt = this.phaseStartedAt + delay * 1000;
          this.botActions.push({ ...base, type: 'ready', at: p.botReadyAt });
        } else if (this.participants.includes(p.id)) {
          const targets = this.participants.filter((id) => id !== p.id).map((id) => ({
            id, blend: this.figures[id].blend,
          }));
          const planned = root.HideBots.searchPlan({ level: p.botLevel, targets, limit: this.limit, seed });
          const seen = new Set();
          const plan = planned.filter((step) => {
            if (!targets.some((target) => target.id === step.target) || seen.has(step.target) ||
                !Number.isFinite(step.time) || step.time <= 0 || step.time >= this.limit) return false;
            seen.add(step.target);
            return true;
          }).sort((a, b) => a.time - b.time);
          for (const step of plan) this.botActions.push({
            ...base, type: 'found', at: this.phaseStartedAt + step.time * 1000,
            target: step.target, time: step.time,
          });
          const doneAt = plan.length === targets.length ? Math.min(this.limit, (plan.at(-1)?.time || 0) + 0.25) : this.limit;
          this.botActions.push({ ...base, type: 'done', at: this.phaseStartedAt + doneAt * 1000, time: doneAt });
        }
      }
      this.botActions.sort((a, b) => a.at - b.at);
    }

    runBotAction(action) {
      const p = this.get(action.botId);
      if (!p || !p.managedBot || !p.connected || !p.active || action.round !== this.round || action.seed !== this.seed) return;
      if (action.type === 'ready' && this.phase === 'hide' && this.figures[p.id]) {
        p.ready = true;
        this.broadcastRoom();
        this.checkAllReady();
      } else if (action.type === 'found' && this.phase === 'seek') {
        this.recordFind(p, action.target, action.time);
      } else if (action.type === 'done' && this.phase === 'seek' && this.participants.includes(p.id)) {
        if (!(p.id in this.done)) this.done[p.id] = action.time;
        this.checkSeekDone();
      }
    }

    recordFind(p, target, elapsed) {
      if (!this.participants.includes(p.id) || !this.participants.includes(target) || target === p.id) return;
      if (this.finds.some((f) => f.seeker === p.id && f.target === target)) return;
      const time = Math.min(this.limit, Math.max(0, Number(elapsed) || 0));
      this.finds.push({ seeker: p.id, target, time });
      this.broadcast({ t: 'found', seeker: p.id, target, time });
      const mine = this.finds.filter((f) => f.seeker === p.id).length;
      if (mine >= this.participants.length - 1) this.done[p.id] = time;
      this.checkSeekDone();
    }

    /** Solo el historial del mazo; permite reutilizarlo sin jugadores ni temporizadores. */
    deckState() {
      return {
        deck: this.deck.slice(), deckCollection: this.deckCollection,
        deckCount: this.deckCount, lastPainting: this.lastPainting,
      };
    }

    loadDeck(state = {}) {
      const count = this.settings.collection === 1 ? ARTWORK_COUNT : PAINTING_COUNT;
      const sameCollection = state.deckCollection === this.settings.collection;
      const validIndex = (value) => Number.isInteger(value) && value >= 0 && value < count;
      const validDeck = sameCollection && state.deckCount === count && Array.isArray(state.deck) &&
        state.deck.every(validIndex) && new Set(state.deck).size === state.deck.length &&
        !state.deck.includes(state.lastPainting);
      this.deck = validDeck ? state.deck.slice() : [];
      this.deckCollection = this.settings.collection;
      this.deckCount = count;
      this.lastPainting = sameCollection && validIndex(state.lastPainting) ? state.lastPainting : null;
    }

    /** Estado persistible: las conexiones y los temporizadores pertenecen al proceso. */
    snapshot() {
      const state = {};
      for (const key of Object.keys(this)) {
        if (['timer', 'onEmpty', 'destroyed', '_tickAt'].includes(key)) continue;
        state[key] = key === 'players'
          ? this.players.map((p) => Object.assign({}, p, { conn: null }))
          : this[key];
      }
      return structuredClone(state);
    }

    static restore(state, opts = {}) {
      const room = new Room(state.code, opts);
      const copy = structuredClone(state);
      for (const key of Object.keys(room)) {
        if (['timer', 'onEmpty', 'destroyed', 'externalTimers'].includes(key)) continue;
        if (Object.hasOwn(copy, key)) room[key] = copy[key];
      }
      // Los PNG antiguos de arte usaban otros índices y recortes: no se pueden reinterpretar.
      room.legacyArtRoom = !!room.legacyArtRoom || (
        !Object.hasOwn(copy.settings || {}, 'collection') &&
        [copy.gallery, copy.settings?.gallery, copy.phaseMsg?.gallery].includes('arte') &&
        (room.inGame() || room.phase === 'final')
      );
      room.settings = validSettings(room.settings);
      // Una partida antigua se pintó sin tramas: no cambiamos su fondo al reanudarla.
      if (room.inGame() && !Object.hasOwn(copy.settings || {}, 'difficulty')) room.settings.difficulty = 0;
      room.phaseMsg = Object.assign({}, room.phaseMsg, {
        difficulty: room.settings.difficulty, collection: room.settings.collection,
      });
      // Antes del catálogo ampliado había 4 obras. Cambiar el mazo no altera la ronda actual.
      const deckCollection = Object.hasOwn(copy, 'deckCollection') ? copy.deckCollection : 0;
      const hasHistory = room.round > 0 || room.seed !== 0 || room.deck.length > 0;
      room.loadDeck({
        deck: room.deck, deckCollection,
        deckCount: Object.hasOwn(copy, 'deckCount') ? copy.deckCount : (deckCollection === 1 ? 4 : PAINTING_COUNT),
        lastPainting: Object.hasOwn(copy, 'lastPainting') ? copy.lastPainting : (hasHistory ? room.painting : null),
      });
      room.players.forEach((p) => { p.conn = null; });
      if (!Object.hasOwn(copy, 'phaseStartedAt')) {
        room.phaseStartedAt = room.deadline && room.phaseMsg.duration ? room.deadline - room.phaseMsg.duration : 0;
      }
      room.externalTimers = !!(opts.externalTimers ?? copy.externalTimers);
      room.phaseEndsAt = room.deadline;
      room.scheduleTimer();
      return room;
    }

    /** El servidor persistente llama tick(); CPU y servidor local usan el reloj normal. */
    scheduleTimer() {
      this.clearTimer();
      const wakeAt = this.nextWakeAt();
      if (this.externalTimers || this._tickAt != null || !wakeAt) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.tick()) this.scheduleTimer();
      }, Math.max(0, wakeAt - now()));
    }

    tick(timestamp = now()) {
      if (!Number.isFinite(timestamp) || !this.nextWakeAt() || timestamp < this.nextWakeAt()) return false;
      this.clearTimer();
      this.lastTickAt = Math.max(this.lastTickAt, timestamp);
      let changed = false;
      try {
        for (let i = 0; i < 1000; i++) {
          const at = this.nextWakeAt();
          if (!at || at > timestamp) break;
          this._tickAt = at;
          const action = this.botActions[0];
          if (action && action.at === at) {
            this.botActions.shift();
            this.runBotAction(action);
          } else {
            const transition = this.transition;
            this.deadline = 0;
            this.phaseEndsAt = 0;
            this.transition = null;
            switch (transition) {
              case 'hide': this.setPhase('hide', this.settings.hideTime > 0 ? this.settings.hideTime * 1000 : null, 'endHide'); break;
              case 'endHide': this.endHide(); break;
              case 'finishCheck': this.finishCheck(); break;
              case 'endSeek': this.endSeek(); break;
              case 'nextRound': this.nextRound(); break;
              case 'final': this.final(); break;
              default: break;
            }
          }
          changed = true;
        }
      } finally {
        delete this._tickAt;
        this.scheduleTimer();
      }
      return changed;
    }

    publicPlayers() {
      return this.players.map((p) => ({
        id: p.id, name: p.name, score: p.score, connected: p.connected, bot: p.bot,
        ready: p.ready, active: p.active, color: p.color,
        managedBot: !!p.managedBot, botLevel: p.botLevel,
      }));
    }

    broadcastRoom() {
      this.broadcast({
        t: 'room', code: this.code, hostId: this.hostId, settings: this.settings,
        phase: this.phase, round: this.round, players: this.publicPlayers(),
      });
    }

    pickHost() {
      const host = this.get(this.hostId);
      if (host && host.connected && !host.bot) return;
      const next = this.players.find((p) => p.connected && !p.bot);
      this.hostId = next ? next.id : null;
    }

    freeColor() {
      const used = new Set(this.players.map((p) => p.color));
      for (let i = 0; i < COLOR_COUNT; i++) if (!used.has(i)) return i;
      return this.players.length % COLOR_COUNT;
    }

    uniqueName(name) {
      const base = name || 'Jugador';
      let n = base;
      let i = 2;
      while (this.players.some((p) => p.name.toLowerCase() === n.toLowerCase())) n = base.slice(0, 13) + ' ' + i++;
      return n;
    }

    // ---------- conexión ----------
    join(conn, info = {}) {
      if (this.destroyed) return { error: 'La sala ya no existe' };
      if (this.legacyArtRoom) return { error: 'Esta sala pertenece a una versión anterior. Crea una sala nueva para continuar.' };
      const name = cleanName(info.name);
      if (info.pid && this.players.some((x) => x.managedBot && x.pid === info.pid)) return { error: 'No puedes reconectar como una CPU.' };
      let p = info.pid ? this.players.find((x) => !x.managedBot && x.pid === info.pid) : null;
      if (p) {
        p.conn = conn;
        p.connected = true;
      } else {
        if (this.players.length >= MAX_PLAYERS) return { error: 'La sala está llena (máximo ' + MAX_PLAYERS + ')' };
        p = {
          id: 'p' + (++this.idCounter),
          pid: info.pid || randomId(),
          name: this.uniqueName(name),
          conn, connected: true, bot: !!info.bot, score: 0, botLevel: info.bot ? info.botLevel : undefined,
          active: !this.inGame(), ready: false, color: this.freeColor(),
        };
        this.players.push(p);
      }
      this.reconcileBots();
      this.pickHost();
      this.send(p, { t: 'welcome', you: p.id, code: this.code, protocol: PROTOCOL_VERSION, catalog: CATALOG_VERSION });
      this.broadcastRoom();
      this.sync(p);
      this.scheduleTimer();
      return { player: p };
    }

    /** Envía al jugador el estado de la fase actual (al entrar o reconectar). */
    sync(p) {
      if (this.phase === 'lobby') return;
      const msg = this.phaseForClient();
      if (this.phase === 'seek') msg.resumed = true;
      this.send(p, msg);
      this.requestBotPaint(p);
    }

    /** La fase persistida conserva sus plazos originales; el mensaje descuenta lo ya transcurrido. */
    phaseForClient() {
      const at = Math.max(this.time(), this.lastTickAt);
      const msg = Object.assign({}, this.phaseMsg, {
        difficulty: this.settings.difficulty, collection: this.settings.collection,
      });
      if (this.deadline) msg.duration = Math.max(0, this.deadline - at);
      if (this.phase === 'seek') {
        const left = Math.max(0, this.deadline - at - MS.seekGrace);
        msg.limit = Math.min(this.limit * 1000, left);
        msg.elapsed = Math.min(this.limit * 1000, Math.max(0, at - this.phaseStartedAt));
        msg.finds = this.finds.map((find) => Object.assign({}, find));
        msg.done = Object.assign({}, this.done);
      }
      return msg;
    }

    disconnect(p, conn) {
      if (!p || p.conn !== conn || this.destroyed) return;
      p.connected = false;
      p.conn = null;
      if (!this.inGame()) this.players = this.players.filter((x) => x !== p);
      this.pickHost();
      this.broadcastRoom();
      if (this.connectedHumans().length === 0) {
        this.clearTimer();
        if (this.onEmpty) this.onEmpty(this);
        return;
      }
      this.requestBotPaint();
      if (this.inGame()) {
        if (this.activeConnected().length < 2) { this.toLobby('No quedan suficientes jugadores. Volviendo a la sala.'); return; }
        if (this.phase === 'hide') this.checkAllReady();
        if (this.phase === 'check') this.checkCollect();
        if (this.phase === 'seek') this.checkSeekDone();
      }
    }

    // ---------- mensajes ----------
    handle(p, msg) {
      if (!p || this.get(p.id) !== p || !p.connected || p.managedBot || !msg || typeof msg !== 'object' || this.destroyed) return;
      const isHost = p.id === this.hostId;
      switch (msg.t) {
        case 'settings': {
          if (!isHost || this.phase !== 'lobby') return;
          const previousCollection = this.settings.collection;
          if (LIMITS.collection.includes(msg.collection) && msg.collection !== previousCollection) {
            const collection = collectionOf(msg.collection);
            Object.assign(this.settings, { collection: msg.collection, hideTime: collection.hideDefault, seekTime: collection.seekDefault });
          }
          const collection = collectionOf(this.settings.collection);
          for (const key of Object.keys(LIMITS)) {
            const allowed = key === 'hideTime' || key === 'seekTime' ? collection[key] : LIMITS[key];
            if (!allowed.includes(msg[key])) continue;
            if (key === 'bots' && msg[key] > MAX_PLAYERS - this.players.filter((player) => !player.managedBot).length) {
              this.send(p, { t: 'notice', msg: 'No hay plazas suficientes para tantas CPU (máximo 8 jugadores).' });
              continue;
            }
            this.settings[key] = msg[key];
          }
          this.reconcileBots();
          if (previousCollection !== this.settings.collection) {
            this.loadDeck();
          }
          this.broadcastRoom();
          break;
        }
        case 'hurry':
          // Añadir el último plazo no reinicia figuras, semillas ni planes de CPU.
          if (!isHost || this.phase !== 'hide' || this.settings.hideTime !== 0 || this.deadline) return;
          this.deadline = this.time() + MS.hurry;
          this.phaseEndsAt = this.deadline;
          this.transition = 'endHide';
          this.phaseMsg = Object.assign({}, this.phaseMsg, { duration: MS.hurry, hurry: true });
          this.scheduleTimer();
          this.broadcast(this.phaseForClient());
          break;
        case 'botFigure': {
          if (!isHost || !['prepare', 'hide', 'check'].includes(this.phase) || msg.round !== this.round || msg.seed !== this.seed) return;
          const bot = this.get(msg.botId);
          if (!bot || !bot.managedBot || !bot.active || !bot.connected || this.figures[bot.id] || !this.storeFigure(bot, msg.fig)) return;
          if (this.phase === 'check' || (this.phase === 'hide' && this.time() >= bot.botReadyAt)) bot.ready = true;
          this.broadcastRoom();
          if (this.phase === 'hide') this.checkAllReady();
          if (this.phase === 'check') this.checkCollect();
          break;
        }
        case 'start':
          if (!isHost || this.inGame()) return;
          if (this.connected().length < 2) { this.send(p, { t: 'notice', msg: 'Hacen falta al menos 2 jugadores.' }); return; }
          this.startGame();
          break;
        case 'lobby':
          if (!isHost || this.phase !== 'final') return;
          this.toLobby();
          break;
        case 'submit':
          if (this.phase !== 'hide' || !p.active) return;
          if (!this.storeFigure(p, msg.fig)) return;
          p.ready = true;
          this.broadcastRoom();
          this.checkAllReady();
          break;
        case 'unsubmit':
          if (this.phase !== 'hide' || !p.active) return;
          p.ready = false;
          delete this.figures[p.id];
          this.broadcastRoom();
          break;
        case 'figure':
          if ((this.phase !== 'check' && this.phase !== 'hide') || !p.active) return;
          if (!this.storeFigure(p, msg.fig)) return;
          this.checkCollect();
          break;
        case 'found': {
          if (this.phase !== 'seek') return;
          this.recordFind(p, String(msg.target), msg.time);
          break;
        }
        case 'seekDone':
          if (this.phase !== 'seek' || !this.participants.includes(p.id)) return;
          if (!(p.id in this.done)) this.done[p.id] = Math.min(this.limit, Math.max(0, Number(msg.elapsed) || 0));
          this.checkSeekDone();
          break;
        case 'emote': {
          const e = String(msg.e || '');
          if (!['👀', '😂', '😱', '🎨', '👍', '🔥'].includes(e)) return;
          this.broadcast({ t: 'emote', from: p.id, e });
          break;
        }
        default:
          break;
      }
    }

    storeFigure(p, fig) {
      if (!fig || typeof fig !== 'object') return false;
      const x = Math.round(Number(fig.x));
      const y = Math.round(Number(fig.y));
      const pose = Math.round(Number(fig.pose));
      const blend = Number(fig.blend);
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 2000 || Math.abs(y) > 2000) return false;
      if (!(pose >= 0 && pose < POSE_COUNT)) return false;
      if (typeof fig.img !== 'string' || fig.img.length > MAX_IMG || !fig.img.startsWith('data:image/png;base64,iVBORw0KGgo')) return false;
      const payload = fig.img.slice('data:image/png;base64,'.length);
      const base64 = /^[A-Za-z0-9+/]+={0,2}$/.exec(payload);
      if (payload.length % 4 !== 0 || !base64 || base64[0].length !== payload.length) return false;
      this.figures[p.id] = { x, y, pose, img: fig.img, blend: Number.isFinite(blend) ? Math.max(0, Math.min(100, blend)) : 0 };
      return true;
    }

    // ---------- flujo de la partida ----------
    setPhase(phase, ms, transition, extra) {
      this.clearTimer();
      this.phaseStartedAt = this.time();
      this.phase = phase;
      this.deadline = ms != null ? this.phaseStartedAt + ms : 0;
      this.phaseEndsAt = this.deadline;
      this.transition = ms != null ? transition : null;
      this.botActions = [];
      const ahead = Math.min(2, Math.max(0, this.settings.rounds - this.round));
      const preload = this.settings.collection === 1 && ahead > 0 && this.inGame()
        ? this.deck.slice(-ahead).reverse() : [];
      this.phaseMsg = Object.assign({
        t: 'phase', phase, round: this.round, rounds: this.settings.rounds,
        painting: this.painting, seed: this.seed, duration: ms,
        difficulty: this.settings.difficulty, collection: this.settings.collection,
        preload,
      }, extra || {});
      this.planBotActions();
      this.broadcast(this.phaseForClient());
      this.requestBotPaint();
      this.scheduleTimer();
    }

    startGame() {
      this.players = this.players.filter((p) => p.connected);
      this.players.forEach((p) => { p.score = 0; });
      this.round = 0;
      this.nextRound();
    }

    nextRound() {
      this.players = this.players.filter((p) => p.connected);
      this.pickHost();
      if (this.connected().length < 2) { this.toLobby('No quedan suficientes jugadores.'); return; }
      this.round++;
      this.players.forEach((p) => { p.active = true; p.ready = false; });
      this.figures = {};
      this.finds = [];
      this.done = {};
      this.participants = [];
      this.loadDeck(this.deckState());
      if (!this.deck.length) {
        this.deck = Array.from({ length: this.deckCount }, (_, i) => i);
        for (let i = this.deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
        const last = this.deck.length - 1;
        if (last > 0 && this.deck[last] === this.lastPainting) {
          [this.deck[0], this.deck[last]] = [this.deck[last], this.deck[0]];
        }
      }
      this.painting = this.deck.pop();
      this.lastPainting = this.painting;
      this.seed = Math.floor(Math.random() * 2147483647);
      this.broadcastRoom();
      this.setPhase('prepare', MS.prepare, 'hide');
    }

    checkAllReady() {
      if (this.phase !== 'hide') return;
      const act = this.activeConnected();
      if (act.length >= 2 && act.every((p) => p.ready && this.figures[p.id])) this.endHide();
    }

    endHide() {
      if (this.phase !== 'hide') return;
      this.checkStarted = this.time();
      this.setPhase('check', MS.checkMax, 'finishCheck');
      for (const p of this.activeConnected()) {
        if (!p.ready || !this.figures[p.id]) this.send(p, { t: 'collect' });
      }
      this.checkCollect();
    }

    checkCollect() {
      if (this.phase !== 'check') return;
      const missing = this.activeConnected().filter((p) => !this.figures[p.id]);
      if (missing.length) return;
      this.deadline = Math.max(this.time(), this.checkStarted + MS.checkMin);
      this.phaseEndsAt = this.deadline;
      this.scheduleTimer();
    }

    finishCheck() {
      if (this.phase !== 'check') return;
      this.participants = this.activeConnected().filter((p) => this.figures[p.id]).map((p) => p.id);
      if (this.participants.length < 2) { this.toLobby('No hay suficientes figuras para jugar la ronda.'); return; }
      this.limit = seekLimit(this.settings, this.participants.length);
      const figs = {};
      for (const id of this.participants) figs[id] = this.figures[id];
      this.setPhase('seek', this.limit * 1000 + MS.seekGrace, 'endSeek', {
        limit: this.limit * 1000, figs, participants: this.participants.slice(),
      });
    }

    checkSeekDone() {
      if (this.phase !== 'seek') return;
      const pending = this.participants.filter((id) => {
        const p = this.get(id);
        return p && p.connected && !(id in this.done);
      });
      if (!pending.length) this.endSeek();
    }

    endSeek() {
      if (this.phase !== 'seek') return;
      const L = this.limit;
      const pts = scoreRound(this.participants, this.finds, L);
      const targets = this.participants.length - 1;
      const entries = this.participants.map((id) => {
        const p = this.get(id);
        const mine = this.finds.filter((f) => f.seeker === id);
        if (p) p.score += pts[id];
        return {
          id, name: p ? p.name : '?', color: p ? p.color : 0, bot: p ? p.bot : false,
          found: mine.length, targets,
          time: mine.length === targets ? Math.max(...mine.map((f) => f.time)) : null,
          foundBy: this.finds.filter((f) => f.target === id).map((f) => ({ id: f.seeker, time: f.time })),
          blend: this.figures[id] ? this.figures[id].blend : 0,
          roundPts: pts[id], score: p ? p.score : 0,
        };
      });
      entries.sort((a, b) => b.roundPts - a.roundPts);
      const figs = {};
      for (const id of this.participants) figs[id] = this.figures[id];
      const last = this.round >= this.settings.rounds;
      this.broadcastRoom();
      this.setPhase('results', MS.results, last ? 'final' : 'nextRound', {
        results: entries, finds: this.finds.slice(), limit: L * 1000, figs, last,
      });
    }

    final() {
      const standings = this.players
        .filter((p) => p.connected || p.score > 0)
        .map((p) => ({ id: p.id, name: p.name, score: p.score, color: p.color, bot: p.bot }))
        .sort((a, b) => b.score - a.score);
      this.players.forEach((p) => { p.ready = false; p.active = true; });
      this.setPhase('final', null, null, { standings });
      this.broadcastRoom();
    }

    toLobby(notice) {
      this.clearTimer();
      this.players = this.players.filter((p) => p.connected);
      this.players.forEach((p) => { p.ready = false; p.active = true; p.score = 0; });
      this.round = 0;
      this.pickHost();
      if (notice) this.broadcast({ t: 'notice', msg: notice });
      this.setPhase('lobby', null, null);
      this.broadcastRoom();
    }
  }

  root.HideRoom = {
    Room, PAINTING_COUNT, ARTWORK_COUNT, PROTOCOL_VERSION, CATALOG_VERSION, POSE_COUNT, MAX_PLAYERS, COLOR_COUNT, DEFAULTS, LIMITS, MS, MISS_PENALTY,
    COLLECTIONS, collectionOf, cleanName, seekLimit, scoreRound,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
