/*
 * Lógica de sala compartida.
 * La usa el servidor (Deno) para el multijugador en línea y el navegador para el modo contra la CPU,
 * así las reglas son idénticas en ambos modos. No depende del DOM.
 */
(function (root) {
  'use strict';

  const PAINTING_COUNT = 10;
  const POSE_COUNT = 10;
  const MAX_PLAYERS = 8;
  const COLOR_COUNT = 8;
  const DEFAULTS = { rounds: 3, hideTime: 120, seekTime: 30 };
  const LIMITS = { rounds: [1, 2, 3, 5], hideTime: [60, 90, 120, 180], seekTime: [20, 30, 45, 60] };
  const MS = { prepare: 3500, checkMin: 2800, checkMax: 7000, seekGrace: 2500, results: 13000 };
  const MISS_PENALTY = 2; // segundos que suma cada toque fallido al buscar
  const EXTRA_SEEK_PER_TARGET = 15; // segundos extra por cada rival a partir del segundo
  const MAX_IMG = 400000;

  const now = () => Date.now();
  const randomId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

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
      this.settings = Object.assign({}, DEFAULTS, opts.settings || {});
      this.phase = 'lobby';
      this.round = 0;
      this.timer = null;
      this.phaseEndsAt = 0;
      this.phaseMsg = { t: 'phase', phase: 'lobby', round: 0, rounds: this.settings.rounds };
      this.deck = [];
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

    publicPlayers() {
      return this.players.map((p) => ({
        id: p.id, name: p.name, score: p.score, connected: p.connected, bot: p.bot,
        ready: p.ready, active: p.active, color: p.color,
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
      const name = cleanName(info.name);
      let p = info.pid ? this.players.find((x) => x.pid === info.pid) : null;
      if (p) {
        p.conn = conn;
        p.connected = true;
      } else {
        if (this.players.length >= MAX_PLAYERS) return { error: 'La sala está llena (máximo ' + MAX_PLAYERS + ')' };
        p = {
          id: 'p' + (++this.idCounter),
          pid: info.pid || randomId(),
          name: this.uniqueName(name),
          conn, connected: true, bot: !!info.bot, score: 0,
          active: !this.inGame(), ready: false, color: this.freeColor(),
        };
        this.players.push(p);
      }
      this.pickHost();
      this.send(p, { t: 'welcome', you: p.id, code: this.code });
      this.broadcastRoom();
      this.sync(p);
      return { player: p };
    }

    /** Envía al jugador el estado de la fase actual (al entrar o reconectar). */
    sync(p) {
      if (this.phase === 'lobby') return;
      const msg = Object.assign({}, this.phaseMsg);
      if (this.timer) msg.duration = Math.max(0, this.phaseEndsAt - now());
      if (this.phase === 'seek') {
        const left = Math.max(0, this.phaseEndsAt - now() - MS.seekGrace);
        msg.limit = Math.min(this.limit * 1000, left);
        msg.resumed = true;
      }
      this.send(p, msg);
    }

    disconnect(p, conn) {
      if (!p || p.conn !== conn || this.destroyed) return;
      p.connected = false;
      p.conn = null;
      if (!this.inGame()) this.players = this.players.filter((x) => x !== p);
      this.pickHost();
      this.broadcastRoom();
      if (this.connectedHumans().length === 0) {
        if (this.onEmpty) this.onEmpty(this);
        return;
      }
      if (this.inGame()) {
        if (this.activeConnected().length < 2) { this.toLobby('No quedan suficientes jugadores. Volviendo a la sala.'); return; }
        if (this.phase === 'hide') this.checkAllReady();
        if (this.phase === 'check') this.checkCollect();
        if (this.phase === 'seek') this.checkSeekDone();
      }
    }

    // ---------- mensajes ----------
    handle(p, msg) {
      if (!p || !msg || typeof msg !== 'object' || this.destroyed) return;
      const isHost = p.id === this.hostId;
      switch (msg.t) {
        case 'settings': {
          if (!isHost || this.inGame()) return;
          for (const key of Object.keys(LIMITS)) {
            const v = Number(msg[key]);
            if (msg[key] != null && LIMITS[key].includes(v)) this.settings[key] = v;
          }
          this.broadcastRoom();
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
          this.broadcastRoom();
          break;
        case 'figure':
          if ((this.phase !== 'check' && this.phase !== 'hide') || !p.active) return;
          if (!this.storeFigure(p, msg.fig)) return;
          this.checkCollect();
          break;
        case 'found': {
          if (this.phase !== 'seek') return;
          const target = String(msg.target);
          if (!this.participants.includes(p.id) || !this.participants.includes(target) || target === p.id) return;
          if (this.finds.some((f) => f.seeker === p.id && f.target === target)) return;
          const time = Math.min(this.limit, Math.max(0, Number(msg.time) || 0));
          this.finds.push({ seeker: p.id, target, time });
          this.broadcast({ t: 'found', seeker: p.id, target, time });
          const mine = this.finds.filter((f) => f.seeker === p.id).length;
          if (mine >= this.participants.length - 1) this.done[p.id] = time;
          this.checkSeekDone();
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
      if (typeof fig.img !== 'string' || !fig.img.startsWith('data:image/png;base64,') || fig.img.length > MAX_IMG) return false;
      this.figures[p.id] = { x, y, pose, img: fig.img, blend: Number.isFinite(blend) ? Math.max(0, Math.min(100, blend)) : 0 };
      return true;
    }

    // ---------- flujo de la partida ----------
    setPhase(phase, ms, next, extra) {
      this.clearTimer();
      this.phase = phase;
      this.phaseEndsAt = ms != null ? now() + ms : 0;
      if (ms != null && next) this.timer = setTimeout(() => { this.timer = null; if (!this.destroyed) next(); }, ms);
      this.phaseMsg = Object.assign({
        t: 'phase', phase, round: this.round, rounds: this.settings.rounds,
        painting: this.painting, seed: this.seed, duration: ms,
      }, extra || {});
      this.broadcast(this.phaseMsg);
    }

    startGame() {
      this.players = this.players.filter((p) => p.connected);
      this.players.forEach((p) => { p.score = 0; });
      this.round = 0;
      this.deck = [];
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
      if (!this.deck.length) {
        this.deck = Array.from({ length: PAINTING_COUNT }, (_, i) => i);
        for (let i = this.deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
      }
      this.painting = this.deck.pop();
      this.seed = Math.floor(Math.random() * 2147483647);
      this.broadcastRoom();
      this.setPhase('prepare', MS.prepare, () => {
        this.setPhase('hide', this.settings.hideTime * 1000, () => this.endHide());
      });
    }

    checkAllReady() {
      if (this.phase !== 'hide') return;
      const act = this.activeConnected();
      if (act.length >= 2 && act.every((p) => p.ready && this.figures[p.id])) this.endHide();
    }

    endHide() {
      if (this.phase !== 'hide') return;
      this.setPhase('check', MS.checkMax, () => this.finishCheck());
      this.checkStarted = now();
      for (const p of this.activeConnected()) {
        if (!p.ready || !this.figures[p.id]) this.send(p, { t: 'collect' });
      }
      this.checkCollect();
    }

    checkCollect() {
      if (this.phase !== 'check') return;
      const missing = this.activeConnected().filter((p) => !this.figures[p.id]);
      if (missing.length) return;
      this.clearTimer();
      const wait = Math.max(0, MS.checkMin - (now() - this.checkStarted));
      this.timer = setTimeout(() => { this.timer = null; if (!this.destroyed) this.finishCheck(); }, wait);
    }

    finishCheck() {
      if (this.phase !== 'check') return;
      this.participants = this.activeConnected().filter((p) => this.figures[p.id]).map((p) => p.id);
      if (this.participants.length < 2) { this.toLobby('No hay suficientes figuras para jugar la ronda.'); return; }
      this.limit = seekLimit(this.settings, this.participants.length);
      const figs = {};
      for (const id of this.participants) figs[id] = this.figures[id];
      this.setPhase('seek', this.limit * 1000 + MS.seekGrace, () => this.endSeek(), {
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
      this.setPhase('results', MS.results, () => (last ? this.final() : this.nextRound()), {
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
    Room, PAINTING_COUNT, POSE_COUNT, MAX_PLAYERS, COLOR_COUNT, DEFAULTS, LIMITS, MS, MISS_PENALTY,
    cleanName, seekLimit, scoreRound,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
