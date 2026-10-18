/* Escondidas en Pintura — cliente del juego (interfaz, dibujo, red y bots de la CPU). */
(function () {
  'use strict';

  const { Room, MISS_PENALTY, collectionOf } = window.HideRoom;
  const Bots = window.HideBots;
  const PW = Paintings.W;
  const PH = Paintings.H;
  const FB = Figure.BOX;
  const TAU = Math.PI * 2;
  const MAX_ZOOM = 8;

  const TUT_PAINTING = 0; // «Ondas» con franjas anchas: fácil de entender
  const TUT_SEED = 42;
  const TUT_SIDE_MIN = 240; // ancho mínimo a la derecha del cuadro para poner la tarjeta del tutorial al lado

  const PLAYER_COLORS = ['#ffd23f', '#4cc9f0', '#ff6b9a', '#7ae582', '#c77dff', '#ff9f43', '#f1f3f5', '#5c7cfa'];
  const BOT_NAMES = ['Pincelín', 'Brochita', 'Acuarela', 'Picasso.exe', 'Manchitas', 'Óleo', 'Garabato', 'Pastelito'];
  const BRUSH_SIZES = [4, 8, 14, 24, 40];
  const TAP_SLOP = { mouse: 8, touch: 14 };
  const HIT_TOLERANCE = { mouse: 9, touch: 14 };

  // ---------------------------------------------------------------- utilidades
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const fmtClock = (sec) => {
    const s = Math.max(0, Math.ceil(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const makeCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const hex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('eep:' + k);
        return v == null ? d : JSON.parse(v);
      } catch { return d; }
    },
    set(k, v) { try { localStorage.setItem('eep:' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  function tabId() {
    try {
      let id = sessionStorage.getItem('eep:pid');
      if (!id) {
        id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        sessionStorage.setItem('eep:pid', id);
      }
      return id;
    } catch {
      return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  }

  // ---------------------------------------------------------------- sonido
  const Sound = (() => {
    let ctx = null;
    let muted = store.get('muted', false);
    function ac() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(f, d = 0.12, type = 'sine', v = 0.15, when = 0, slide = 0) {
      if (muted) return;
      const c = ac();
      if (!c) return;
      const t = c.currentTime + when;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + d + 0.03);
    }
    return {
      unlock() { ac(); },
      tick() { tone(880, 0.07, 'square', 0.05); },
      go() { tone(523, 0.12, 'triangle', 0.16); tone(784, 0.22, 'triangle', 0.16, 0.1); },
      found() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.16, i * 0.07)); },
      miss() { tone(200, 0.2, 'sawtooth', 0.07, 0, 0.55); },
      pop() { tone(700, 0.06, 'sine', 0.12); },
      lock() { tone(440, 0.07, 'square', 0.06); tone(660, 0.08, 'square', 0.06, 0.06); },
      ready() { tone(587, 0.1, 'triangle', 0.14); tone(880, 0.18, 'triangle', 0.14, 0.08); },
      caught() { tone(392, 0.22, 'triangle', 0.14, 0, 0.5); },
      fanfare() { [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, i * 0.11)); },
      toggle() { muted = !muted; store.set('muted', muted); return muted; },
      get muted() { return muted; },
    };
  })();

  // ---------------------------------------------------------------- cuadros
  const paintCache = new Map();
  const artImages = new Map();
  const decodedArt = new Map();
  let phaseRevision = 0;
  const artPrefetch = window.ArtPrefetch.create({
    urls: (window.HumanArt?.works || []).map((work) => work.file).filter(Boolean),
    canRun: () => {
      const connection = navigator.connection;
      return location.protocol !== 'file:' && !document.hidden && navigator.onLine !== false &&
        !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType);
    },
  });

  function syncArtPrefetch(collection, preload) {
    if (collection !== 1) { artPrefetch.pause(); return; }
    if (Array.isArray(preload)) {
      const urls = preload.filter(Number.isInteger).map((idx) => window.HumanArt?.works[idx]?.file).filter(Boolean);
      artPrefetch.prioritize(urls);
    }
    artPrefetch.resume();
  }

  document.addEventListener('visibilitychange', () => artPrefetch.refresh());
  navigator.connection?.addEventListener('change', () => artPrefetch.refresh());
  window.addEventListener('offline', () => artPrefetch.refresh());
  window.addEventListener('online', () => { artPrefetch.retryFailed(); artPrefetch.refresh(); });

  function rememberArtwork(idx, image) {
    decodedArt.delete(idx);
    decodedArt.set(idx, image);
    HumanArt.works[idx].image = image;
    while (decodedArt.size > 6) {
      const oldest = decodedArt.keys().next().value;
      if (HumanArt.works[oldest].image === decodedArt.get(oldest)) delete HumanArt.works[oldest].image;
      decodedArt.delete(oldest);
    }
  }

  function loadArtwork(idx) {
    const work = window.HumanArt && HumanArt.works[idx];
    if (!work) return Promise.reject(new Error('La obra no está disponible.'));
    if (work.image) { rememberArtwork(idx, work.image); return Promise.resolve(work.image); }
    if (artImages.has(idx)) return artImages.get(idx);
    const release = artPrefetch.hold();
    const pending = new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => image.onerror(), 15000);
      image.fetchPriority = 'high';
      image.onload = () => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        rememberArtwork(idx, image);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        image.src = '';
        reject(new Error('No se pudo cargar «' + work.title + '». Revisa tu conexión y vuelve a intentarlo.'));
      };
      if (!work.file) image.crossOrigin = 'anonymous';
      image.src = work.file || work.imageUrl;
    });
    artImages.set(idx, pending);
    pending.finally(() => {
      if (artImages.get(idx) === pending) artImages.delete(idx);
      release();
    }).catch(() => {});
    return pending;
  }

  /** Una obra necesaria se reintenta mientras siga perteneciendo a la fase que la pidió. */
  async function artworkWhenCurrent(idx, current, failed = () => {}) {
    const release = artPrefetch.hold();
    try {
      while (current()) {
        try { await loadArtwork(idx); return current(); }
        catch (error) {
          if (!current()) return false;
          failed(error);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      return false;
    } finally {
      release();
    }
  }

  function accountArtworkWait(message, elapsed) {
    const m = { ...message };
    if (m.duration != null) m.duration = Math.max(0, m.duration - elapsed);
    if (m.phase === 'seek' && m.limit != null) {
      m.elapsed = Math.max(0, Number(m.elapsed) || 0) + Math.min(elapsed, m.limit);
      m.limit = Math.max(0, m.limit - elapsed);
    }
    return m;
  }

  function extractPalette(data) {
    const counts = new Map();
    const step = 4 * 5;
    for (let i = 0; i < data.length; i += step) {
      // Agrupa tonos cercanos: las reproducciones tienen miles de colores únicos.
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const bucket = counts.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++;
      bucket.r += data[i]; bucket.g += data[i + 1]; bucket.b += data[i + 2];
      counts.set(key, bucket);
    }
    const total = data.length / step;
    return [...counts.values()]
      .filter((c) => c.count / total > 0.003)
      .sort((a, b) => b.count - a.count)
      .slice(0, 18)
      .map((c) => hex(Math.round(c.r / c.count), Math.round(c.g / c.count), Math.round(c.b / c.count)));
  }

  function getPainting(idx, seed, difficulty = 0, collection = 0) {
    const key = [collection, difficulty, idx, seed].join(':');
    let p = paintCache.get(key);
    if (!p) {
      const canvas = makeCanvas(PW, PH);
      let name;
      let work = null;
      if (collection === 1) {
        work = HumanArt.works[idx];
        const image = work.image;
        if (!image) throw new Error('La obra aún no se ha cargado.');
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        canvas.getContext('2d').drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, PW, PH);
        name = work.shortTitle || work.title;
      } else {
        Paintings.render(idx, seed, canvas, difficulty);
        name = Paintings.names[idx % Paintings.count];
      }
      const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, PW, PH).data;
      p = { canvas, data, idx, seed, difficulty, collection, work, name, palette: extractPalette(data) };
      paintCache.set(key, p);
      if (paintCache.size > 6) paintCache.delete(paintCache.keys().next().value);
    }
    return p;
  }

  /**
   * % de la figura cuyo color coincide (casi) con el cuadro que tapa. En las obras de arte, llenas de textura,
   * basta con que ese color aparezca a 2 píxeles o menos.
   */
  function computeBlend(figData, fx, fy, painting) {
    const pdata = painting.data;
    const r = painting.collection === 1 ? 2 : 0;
    let total = 0;
    let ok = 0;
    for (let j = 0; j < FB; j++) {
      const py = fy + j;
      if (py < 0 || py >= PH) continue;
      for (let i = 0; i < FB; i++) {
        const k = (j * FB + i) * 4;
        if (figData[k + 3] < 200) continue;
        const px = fx + i;
        if (px < 0 || px >= PW) continue;
        total++;
        let hit = false;
        for (let dy = -r; dy <= r && !hit; dy++) {
          const qy = py + dy;
          if (qy < 0 || qy >= PH) continue;
          for (let dx = -r; dx <= r; dx++) {
            const qx = px + dx;
            if (qx < 0 || qx >= PW) continue;
            const q = (qy * PW + qx) * 4;
            const dr = figData[k] - pdata[q];
            const dg = figData[k + 1] - pdata[q + 1];
            const db = figData[k + 2] - pdata[q + 2];
            if (dr * dr + dg * dg + db * db < 1600) { hit = true; break; }
          }
        }
        if (hit) ok++;
      }
    }
    return total ? Math.round((ok / total) * 1000) / 10 : 0;
  }

  function loadFigure(src) {
    return new Promise((resolve) => {
      const img = new Image();
      const done = () => {
        const c = makeCanvas(FB, FB);
        const x = c.getContext('2d', { willReadFrequently: true });
        if (img.naturalWidth) x.drawImage(img, 0, 0);
        resolve({ canvas: c, data: x.getImageData(0, 0, FB, FB).data });
      };
      img.onload = done;
      img.onerror = done;
      img.src = src;
    });
  }

  function makeOutline(src, color, t) {
    const c = makeCanvas(FB + t * 2, FB + t * 2);
    const x = c.getContext('2d');
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * TAU;
      x.drawImage(src, t + Math.cos(ang) * t, t + Math.sin(ang) * t);
    }
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // ---------------------------------------------------------------- CPU: pintura local y decisiones compartidas
  const BOT_LEVELS = Bots.PROFILES; // también lo usa Pincelín en el tutorial
  const botMasks = new Map();

  function botMask(pose) {
    if (!botMasks.has(pose)) {
      const canvas = makeCanvas(FB, FB);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      Figure.drawMask(ctx, pose, '#ffffff');
      const image = ctx.getImageData(0, 0, FB, FB);
      const samples = [];
      for (let y = 0; y < FB; y += 6) {
        for (let x = 0; x < FB; x += 6) {
          if (image.data[(y * FB + x) * 4 + 3] > 200) samples.push([x, y]);
        }
      }
      botMasks.set(pose, { image, samples });
    }
    return botMasks.get(pose);
  }

  function makeBotFigure(p, L, opts = {}) {
    const rng = opts.rng || (opts.seed != null ? Bots.seeded(opts.seed) : Math.random);
    const integer = (min, max) => Math.floor(min + rng() * (max - min + 1));
    // Antes de pintar, prueba zonas y poses. Las texturas simples admiten pinceles más gruesos.
    let best = null;
    const count = opts.x != null && opts.y != null && opts.pose != null ? 1 : L.placementCandidates;
    for (let n = 0; n < count; n++) {
      const pose = opts.pose != null ? opts.pose : integer(0, Figure.POSES.length - 1);
      const { bbox } = Figure.shape(pose);
      const { x, y } = Figure.clampPos(pose,
        opts.x != null ? opts.x : -bbox.x0 + rng() * (PW - (bbox.x1 - bbox.x0)),
        opts.y != null ? opts.y : -bbox.y0 + rng() * (PH - (bbox.y1 - bbox.y0)), PW, PH);
      let cost = 0;
      const samples = botMask(pose).samples;
      for (const [i, j] of samples) {
        const q = ((y + j) * PW + x + i) * 4;
        const px = clamp(x + Math.floor(i / L.cell) * L.cell + (L.cell >> 1), 0, PW - 1);
        const py = clamp(y + Math.floor(j / L.cell) * L.cell + (L.cell >> 1), 0, PH - 1);
        const a = (py * PW + px) * 4;
        const b = (clamp(y + j + L.shift, 0, PH - 1) * PW + clamp(x + i + L.shift, 0, PW - 1)) * 4;
        for (let channel = 0; channel < 3; channel++) {
          cost += Math.abs(p.data[q + channel] - p.data[a + channel]);
          cost += Math.abs(p.data[q + channel] - p.data[b + channel]) * 0.5;
        }
      }
      cost /= Math.max(1, samples.length);
      if (!best || cost < best.cost) best = { pose, x, y, cost };
    }
    const { pose, x, y } = best;
    const c = makeCanvas(FB, FB);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    // Copia la máscara para conservar la caché entre jugadores y rondas.
    const source = botMask(pose).image;
    const img = ctx.createImageData(FB, FB);
    img.data.set(source.data);
    const d = img.data;
    const sx = integer(-L.shift, L.shift);
    const sy = integer(-L.shift, L.shift);
    const cell = L.cell;
    const noise = new Map();
    for (let j = 0; j < FB; j++) {
      for (let i = 0; i < FB; i++) {
        const k = (j * FB + i) * 4;
        if (!d[k + 3]) continue;
        const ci = Math.floor(i / cell);
        const cj = Math.floor(j / cell);
        const px = clamp(x + ci * cell + (cell >> 1) + sx, 0, PW - 1);
        const py = clamp(y + cj * cell + (cell >> 1) + sy, 0, PH - 1);
        const q = (py * PW + px) * 4;
        const key = ci * 4096 + cj;
        let n = noise.get(key);
        if (n == null) { n = Math.round((rng() * 2 - 1) * L.noise); noise.set(key, n); }
        d[k] = clamp(p.data[q] + n, 0, 255);
        d[k + 1] = clamp(p.data[q + 1] + n, 0, 255);
        d[k + 2] = clamp(p.data[q + 2] + n, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    // Siempre queda un pequeño descuido, incluso en un fondo de un solo color.
    const samples = botMask(pose).samples;
    for (let h = 0; h < L.holes; h++) {
      const [hx, hy] = samples[integer(0, samples.length - 1)];
      const q = ((y + hy) * PW + x + hx) * 4;
      const brightness = (p.data[q] + p.data[q + 1] + p.data[q + 2]) / 3;
      ctx.fillStyle = brightness > 135 ? '#35344c' : Figure.WHITE;
      const w = integer(L.holeSize[0], L.holeSize[1]);
      const height = integer(L.holeSize[0], L.holeSize[1]);
      ctx.fillRect(hx - w / 2, hy - height / 2, w, height);
    }
    ctx.globalCompositeOperation = 'source-over';
    const data = ctx.getImageData(0, 0, FB, FB).data;
    return { x, y, pose, img: c.toDataURL('image/png'), blend: computeBlend(data, x, y, p) };
  }

  class Bot {
    constructor(room, name, level) {
      this.room = room;
      this.level = Bots.profile(level);
      this.timers = [];
      this.alive = true;
      this.phase = null;
      this.conn = {
        send: (m) => {
          const c = structuredClone(m);
          setTimeout(() => { if (this.alive) this.onMessage(c); }, 0);
        },
      };
      this.player = room.join(this.conn, { name, bot: true, level: this.level.key, botLevel: this.level.index }).player;
    }

    later(fn, ms) { this.timers.push(setTimeout(() => { if (this.alive) fn(); }, ms)); }
    clear() { this.timers.forEach(clearTimeout); this.timers = []; }
    destroy() { this.alive = false; this.clear(); }
    send(msg) { setTimeout(() => { if (this.alive) this.room.handle(this.player, msg); }, 0); }

    onMessage(m) {
      if (m.t === 'phase') {
        // Un aviso de últimos 30 s mantiene el dibujo y la preparación ya iniciados.
        if (m.phase === 'hide' && this.phase?.phase === 'hide' && m.round === this.phase.round && m.seed === this.phase.seed) return;
        this.clear();
        this.phase = m;
        if (m.phase === 'hide') {
          const sec = Bots.readyDelay({ level: this.level.key, hideTime: m.duration == null ? collectionOf(m.collection).hideDefault : m.duration / 1000, seed: Bots.seedFor(m.seed, this.player.id) });
          this.later(() => this.hide(m, 'submit').catch(() => {}), sec * 1000);
        } else if (m.phase === 'seek') {
          this.seek(m).catch(() => {});
        }
      } else if (m.t === 'collect' && this.phase) {
        this.hide(this.phase, 'figure').catch(() => {});
      }
    }

    async hide(m, type) {
      const current = () => this.alive && this.phase === m;
      if (m.collection === 1 && !await artworkWhenCurrent(m.painting, current)) return;
      if (!current()) return;
      if (!this.fig || this.figSeed !== m.seed || this.figRound !== m.round) {
        this.fig = makeBotFigure(getPainting(m.painting, m.seed, m.difficulty, m.collection), this.level, { seed: Bots.seedFor(m.seed, this.player.id) });
        this.figSeed = m.seed;
        this.figRound = m.round;
      }
      this.send({ t: type, fig: this.fig });
    }

    async seek(m) {
      const elapsed = Math.max(0, Number(m.elapsed) || 0);
      const start = performance.now() - elapsed;
      const current = () => this.alive && this.phase === m;
      if (m.collection === 1 && !await artworkWhenCurrent(m.painting, current)) return;
      if (!current()) return;
      const p = getPainting(m.painting, m.seed, m.difficulty, m.collection);
      const limit = (m.limit + elapsed) / 1000;
      const targets = [];
      for (const id of m.participants) {
        if (id === this.player.id || !m.figs[id]) continue;
        const f = m.figs[id];
        const img = await loadFigure(f.img);
        if (!this.alive || this.phase !== m) return;
        targets.push({ id, blend: computeBlend(img.data, f.x, f.y, p) });
      }
      const plan = Bots.searchPlan({ level: this.level.key, targets, limit, seed: Bots.seedFor(m.seed, this.player.id) });
      const setup = (performance.now() - start) / 1000;
      for (const { target, time } of plan) {
        this.later(() => this.send({ t: 'found', target, time }), Math.max(0, time - setup) * 1000);
      }
      const end = plan.length === targets.length ? (plan.at(-1)?.time || 0) : limit;
      this.later(() => this.send({ t: 'seekDone', elapsed: end }), Math.max(0, end - setup) * 1000 + 250);
    }
  }

  // El servidor decide por las CPU online; el anfitrión solo aporta el dibujo de sus figuras.
  let onlineBotPhase = null;
  let botPaintRevision = 0;
  const botPaintJobs = new Map();
  function cancelBotPainting() { botPaintRevision++; botPaintJobs.clear(); }

  function paintOnlineBots(m) {
    if (G.mode !== 'online' || G.room?.hostId !== G.me || !Array.isArray(m.bots)) return;
    const revision = botPaintRevision;
    const link = G.link;
    const current = () => revision === botPaintRevision && G.mode === 'online' && G.link === link &&
      link?.ready && G.room?.hostId === G.me && G.room.round === m.round &&
      // Los mensajes phase avanzan antes de la siguiente difusión del roster (room).
      onlineBotPhase?.round === m.round && onlineBotPhase.seed === m.seed &&
      ['prepare', 'hide', 'check'].includes(onlineBotPhase.phase);
    if (!current()) return;
    for (const bot of m.bots) {
      const key = [m.round, m.seed, m.painting, m.collection, m.difficulty, bot.id, bot.level, bot.seed].join(':');
      if (botPaintJobs.has(key)) continue;
      const job = {};
      botPaintJobs.set(key, job);
      const run = async () => {
        if (m.collection === 1 && !await artworkWhenCurrent(m.painting, current)) {
          if (botPaintJobs.get(key) === job) botPaintJobs.delete(key);
          return;
        }
        if (!current()) { if (botPaintJobs.get(key) === job) botPaintJobs.delete(key); return; }
        const p = getPainting(m.painting, m.seed, m.difficulty, m.collection);
        const fig = makeBotFigure(p, Bots.profile(bot.level), { seed: bot.seed });
        if (!current()) { if (botPaintJobs.get(key) === job) botPaintJobs.delete(key); return; }
        link.send({ t: 'botFigure', botId: bot.id, round: m.round, seed: m.seed, fig });
      };
      run().catch(() => { if (botPaintJobs.get(key) === job) botPaintJobs.delete(key); });
    }
  }

  // ---------------------------------------------------------------- conexiones
  class LocalLink {
    constructor(room, onMessage) {
      this.room = room;
      this.onMessage = onMessage;
      this.conn = {
        send: (m) => {
          const c = structuredClone(m);
          setTimeout(() => { if (this.onMessage) this.onMessage(c); }, 0);
        },
      };
    }
    join(info) { this.player = this.room.join(this.conn, info).player; }
    send(msg) {
      const m = structuredClone(msg);
      setTimeout(() => { if (this.player && this.onMessage) this.room.handle(this.player, m); }, 0);
    }
    close() {
      if (this.player) this.room.disconnect(this.player, this.conn);
      this.onMessage = null;
    }
  }

  /** Puede usar un servidor remoto; en local, el multijugador vive junto al juego. */
  function wsUrl(hello) {
    const configured = window.EEP_CONFIG && window.EEP_CONFIG.websocketUrl;
    const url = new URL(typeof configured === 'string' && configured.trim() ? configured.trim() : 'ws', location.href);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Servidor no disponible');
    url.searchParams.delete('sala');
    url.searchParams.delete('probe');
    if (hello && hello.t === 'join') url.searchParams.set('sala', hello.code);
    else if (!hello) url.searchParams.set('probe', '1');
    return url.href;
  }

  let serverCheck = null;
  /** Comprueba el mismo canal que usan las salas, también entre dominios. */
  function serverAvailable() {
    if (!serverCheck) {
      serverCheck = new Promise((resolve) => {
        let ws;
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (ws) {
            ws.onopen = ws.onmessage = ws.onclose = null;
            try { ws.close(); } catch { /* ya cerrado */ }
          }
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 8000);
        try { ws = new WebSocket(wsUrl()); } catch { finish(false); return; }
        ws.onopen = () => ws.send(JSON.stringify({ t: 'ping' }));
        ws.onmessage = (ev) => {
          try { if (JSON.parse(ev.data).t === 'pong') finish(true); } catch { /* mensaje desconocido */ }
        };
        ws.onclose = ws.onerror = () => finish(false);
      }).finally(() => { serverCheck = null; });
    }
    return serverCheck;
  }

  class NetLink {
    constructor(hello, onMessage, onState) {
      this.hello = { ...hello, protocol: window.HideRoom.PROTOCOL_VERSION, catalog: window.HideRoom.CATALOG_VERSION };
      this.onMessage = onMessage;
      this.onState = onState;
      this.tries = 0;
      this.closed = false;
      this.welcomed = false;
      this.ready = false;
      // El llamador guarda el enlace antes de recibir un posible fallo de conexión.
      this.retry = setTimeout(() => this.open(), 0);
    }
    open() {
      if (this.closed) return;
      this.ready = false;
      let ws;
      try { ws = new WebSocket(wsUrl(this.hello)); } catch { this.fail(this.welcomed ? 'lost' : 'failed'); return; }
      this.ws = ws;
      let disconnected = false;
      const disconnect = () => {
        if (this.ws !== ws || disconnected) return;
        disconnected = true;
        this.ready = false;
        clearTimeout(this.timeout);
        clearTimeout(this.pongTimeout);
        clearInterval(this.ping);
        if (this.closed) return;
        if (!this.welcomed) { this.fail('failed'); return; }
        if (this.tries++ < 6) {
          if (this.tries === 1) this.onState('reconnecting');
          this.retry = setTimeout(() => this.open(), Math.min(4000, 500 * this.tries));
        } else {
          this.fail('lost');
        }
      };
      this.timeout = setTimeout(() => {
        if (this.ws === ws && !this.ready) {
          ws.close();
          disconnect();
        }
      }, 8000);
      ws.onopen = () => {
        if (this.closed || disconnected || this.ws !== ws) return;
        ws.send(JSON.stringify(this.hello));
      };
      ws.onmessage = (ev) => {
        if (this.closed || disconnected || this.ws !== ws) return;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'pong') { clearTimeout(this.pongTimeout); return; }
        if (m.t === 'error' && !this.ready) {
          this.fail('rejected', m.msg);
          return;
        }
        if (m.t === 'welcome') {
          if (m.protocol == null || m.catalog == null || m.protocol !== window.HideRoom.PROTOCOL_VERSION ||
              m.catalog !== window.HideRoom.CATALOG_VERSION) {
            this.fail('rejected', 'Esta sala usa otra versión del juego. Actualiza la página o vuelve a intentarlo cuando el servidor esté actualizado.');
            return;
          }
          const reconnecting = this.welcomed;
          this.welcomed = true;
          this.ready = true;
          this.tries = 0;
          clearTimeout(this.timeout);
          this.hello = {
            t: 'join', code: m.code, name: this.hello.name, pid: this.hello.pid,
            protocol: window.HideRoom.PROTOCOL_VERSION, catalog: window.HideRoom.CATALOG_VERSION,
          };
          clearInterval(this.ping);
          this.ping = setInterval(() => {
            this.send({ t: 'ping' });
            this.pongTimeout = setTimeout(() => { ws.close(); disconnect(); }, 8000);
          }, 20000);
          if (this.onMessage) this.onMessage(m);
          if (reconnecting) this.onState('open');
          return;
        }
        if (this.onMessage) this.onMessage(m);
      };
      ws.onerror = () => {}; // onclose o el límite de espera resuelven el intento.
      ws.onclose = disconnect;
    }
    fail(state, message) {
      if (this.closed) return;
      this.close();
      this.onState(state, message);
    }
    send(m) { if (this.ready && this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
    close() {
      this.closed = true;
      this.ready = false;
      this.onMessage = null;
      clearTimeout(this.retry);
      clearTimeout(this.timeout);
      clearTimeout(this.pongTimeout);
      clearInterval(this.ping);
      try { this.ws.close(); } catch { /* ya cerrado */ }
    }
  }

  // ---------------------------------------------------------------- estado
  const view = $('#view');
  const G = {
    pid: tabId(),
    mode: null, // 'cpu' | 'online'
    link: null,
    localRoom: null,
    bots: [],
    me: null,
    code: null,
    room: null,
    screen: 'scr-menu',
    phase: 'none',
    phaseMsg: null,
    phaseEnd: null,
    phaseDur: 0,
    round: 0,
    rounds: 0,
    painting: null,
    figRound: -1,
    fig: { x: 300, y: 300, pose: 0, locked: false },
    paintCanvas: makeCanvas(FB, FB),
    figCanvas: makeCanvas(FB, FB),
    undo: [],
    redo: [],
    stroke: null,
    tool: 'brush',
    color: store.get('color', '#f24d6b'),
    size: store.get('size', 14),
    recent: [],
    submitted: false,
    seek: null,
    figs: {},
    results: null,
    peek: false,
    fx: [],
    hover: null,
    spaceDown: false,
    lastCount: null,
    myBlend: 0,
    view: { ctx: view.getContext('2d'), dpr: 1, w: 1, h: 1, fit: 1, z: 1, s: 1, ox: 0, oy: 0 },
  };
  G.paintCtx = G.paintCanvas.getContext('2d', { willReadFrequently: true });
  G.figCtx = G.figCanvas.getContext('2d', { willReadFrequently: true });

  const playerById = (id) => (G.room && G.room.players.find((p) => p.id === id)) || null;
  const nameOf = (id) => (playerById(id) || {}).name || '¿?';
  const colorOf = (id) => PLAYER_COLORS[((playerById(id) || {}).color || 0) % PLAYER_COLORS.length];
  const meActive = () => {
    const p = playerById(G.me);
    return !!(p && p.active);
  };
  const canEdit = () => G.phase === 'hide' && meActive() && !G.submitted;

  // ---------------------------------------------------------------- pantallas y avisos
  function showScreen(id) {
    G.screen = id;
    if (id === 'scr-cpu') syncArtPrefetch(cpuOpts.collection);
    else if (id === 'scr-menu' || id === 'scr-online' || G.mode === 'tutorial') syncArtPrefetch(0);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    document.body.classList.toggle('show-menu-bg', id !== 'scr-game');
    if (id === 'scr-game') requestAnimationFrame(layout);
    if (id !== 'scr-menu') BackGuard.arm();
  }

  function toast(msg, kind = '') {
    const box = $('#toasts');
    const t = el('div', 'toast ' + kind, msg);
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, 2700);
  }

  let bannerTimer = 0;
  function banner(text) {
    const b = $('#banner');
    b.textContent = text;
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetHeight;
    b.style.animation = '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.hidden = true; }, 1650);
  }

  let confirmCancel = null;
  function confirmBox(text, yes = 'Salir', no = 'Seguir jugando') {
    if (confirmCancel) confirmCancel();
    return new Promise((resolve) => {
      $('#confirm-text').textContent = text;
      $('#btn-confirm-yes').textContent = yes;
      $('#btn-confirm-no').textContent = no;
      $('#confirm').hidden = false;
      const done = (v) => {
        $('#confirm').hidden = true;
        $('#btn-confirm-yes').onclick = null;
        $('#btn-confirm-no').onclick = null;
        confirmCancel = null;
        resolve(v);
      };
      confirmCancel = () => done(false);
      $('#btn-confirm-yes').onclick = () => done(true);
      $('#btn-confirm-no').onclick = () => done(false);
    });
  }

  function playerName() {
    const n = window.HideRoom.cleanName($('#in-name').value);
    return n || 'Jugador';
  }

  // ---------------------------------------------------------------- fondo del menú
  function renderMenuBackground() {
    const idx = randInt(0, Paintings.count - 1);
    const p = getPainting(idx, randInt(1, 1e9));
    const c = makeCanvas(PW, PH);
    const x = c.getContext('2d');
    x.drawImage(p.canvas, 0, 0);
    // una figura a medio camuflar, como en el juego
    const f = makeCanvas(FB, FB);
    const fx = f.getContext('2d');
    Figure.drawMask(fx, 0, Figure.WHITE);
    fx.globalCompositeOperation = 'source-atop';
    const ox = 420;
    const oy = 330;
    fx.drawImage(p.canvas, ox, oy + 110, FB, FB - 110, 0, 110, FB, FB - 110);
    x.drawImage(f, ox, oy);
    $('#menu-bg').style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.85)})`;
  }

  // ---------------------------------------------------------------- vista (zoom y desplazamiento)
  function layout() {
    const stage = $('#stage');
    const frame = $('#frame');
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const border = parseFloat(getComputedStyle(frame).borderLeftWidth) || 14;
    let size = Math.max(180, Math.floor(Math.min(r.width - 16, r.height - 22)));
    // en el tutorial, hacemos sitio a la tarjeta de Pincelín al lado o debajo del cuadro
    // (lo que deje el cuadro más grande)
    let tutNarrow = false;
    if (G.mode === 'tutorial' && (r.width - size) / 2 < TUT_SIDE_MIN) {
      const beside = Math.floor(Math.min(r.width - TUT_SIDE_MIN * 2, r.height - 22));
      const below = Math.floor(Math.min(r.width - 16, r.height - 62 - 190));
      if (beside >= below && beside >= 240) {
        size = beside;
      } else if (below >= 240) {
        size = below;
        tutNarrow = true;
      }
    }
    stage.classList.toggle('tut-narrow', tutNarrow);
    frame.style.width = size + 'px';
    frame.style.height = size + 'px';
    // herramientas a la izquierda si caben; si no, en fila encima del cuadro; y si tampoco, dentro
    const roomX = !tutNarrow && (r.width - size) / 2 >= 92;
    const roomY = tutNarrow || (r.height - size) / 2 >= 62;
    $('#side-tools').classList.toggle('top', !roomX && roomY);
    $('#side-tools').classList.toggle('inside', !roomX && !roomY);
    const inner = size - border * 2;
    const v = G.view;
    v.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.width = Math.round(inner * v.dpr);
    view.height = Math.round(inner * v.dpr);
    const old = v.fit;
    v.fit = inner / PW;
    v.w = inner;
    v.h = inner;
    if (old && old !== v.fit) {
      v.ox *= v.fit / old;
      v.oy *= v.fit / old;
    }
    clampView();
  }

  function clampView() {
    const v = G.view;
    v.s = v.fit * v.z;
    const pw = PW * v.s;
    const ph = PH * v.s;
    v.ox = pw <= v.w ? (v.w - pw) / 2 : clamp(v.ox, v.w - pw, 0);
    v.oy = ph <= v.h ? (v.h - ph) / 2 : clamp(v.oy, v.h - ph, 0);
  }

  function zoomAt(factor, sx, sy) {
    const v = G.view;
    const px = (sx - v.ox) / v.s;
    const py = (sy - v.oy) / v.s;
    v.z = clamp(v.z * factor, 1, MAX_ZOOM);
    v.s = v.fit * v.z;
    v.ox = sx - px * v.s;
    v.oy = sy - py * v.s;
    clampView();
    if (factor > 1 && v.z > 1) tutEvent('zoom');
  }

  function zoomCenter(factor) {
    const v = G.view;
    let cx = v.w / 2;
    let cy = v.h / 2;
    if (G.phase === 'hide' && v.z === 1 && factor > 1) {
      // al acercar por primera vez, centramos en la figura
      const b = Figure.shape(G.fig.pose).bbox;
      cx = v.ox + (G.fig.x + (b.x0 + b.x1) / 2) * v.s;
      cy = v.oy + (G.fig.y + (b.y0 + b.y1) / 2) * v.s;
    }
    zoomAt(factor, cx, cy);
  }

  function resetZoom() {
    G.view.z = 1;
    clampView();
  }

  function fromScreen(sx, sy) {
    const v = G.view;
    return { sx, sy, x: (sx - v.ox) / v.s, y: (sy - v.oy) / v.s };
  }

  function toPaint(e) {
    const r = view.getBoundingClientRect();
    return fromScreen(e.clientX - r.left, e.clientY - r.top);
  }

  // ---------------------------------------------------------------- figura propia
  function recomposite() {
    const c = G.figCtx;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, FB, FB);
    Figure.drawMask(c, G.fig.pose, Figure.WHITE);
    c.globalCompositeOperation = 'source-atop';
    c.drawImage(G.paintCanvas, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }

  function resetOwnFigure(round) {
    G.figRound = round;
    G.fig.pose = 0;
    G.fig.locked = false;
    const b = Figure.shape(0).bbox;
    const p = Figure.clampPos(0, Math.round(PW / 2 - (b.x0 + b.x1) / 2 + randInt(-120, 120)),
      Math.round(PH / 2 - (b.y0 + b.y1) / 2 + randInt(-120, 120)), PW, PH);
    G.fig.x = p.x;
    G.fig.y = p.y;
    G.paintCtx.clearRect(0, 0, FB, FB);
    G.undo = [];
    G.redo = [];
    G.stroke = null;
    G.submitted = false;
    G.tool = 'brush';
    recomposite();
  }

  function moveFigureTo(x, y) {
    const p = Figure.clampPos(G.fig.pose, x, y, PW, PH);
    G.fig.x = p.x;
    G.fig.y = p.y;
  }

  function setPose(i) {
    if (!canEdit()) return;
    G.fig.pose = i;
    moveFigureTo(G.fig.x, G.fig.y);
    recomposite();
    Sound.pop();
    $$('.pose-btn').forEach((b, k) => b.classList.toggle('on', k === i));
    tutEvent('posed');
  }

  function setLocked(locked, quiet) {
    if (!canEdit()) return;
    G.fig.locked = locked;
    if (!locked && G.tool === 'pick') G.tool = 'brush';
    if (!quiet) Sound.lock();
    updateControls();
  }

  function pushUndo() {
    G.undo.push(G.paintCtx.getImageData(0, 0, FB, FB));
    const trimmed = G.undo.length > 40 ? G.undo.shift() : null;
    G.redo = [];
    return trimmed;
  }

  function undo() {
    if (!canEdit() || !G.undo.length) return;
    G.stroke = null;
    G.redo.push(G.paintCtx.getImageData(0, 0, FB, FB));
    G.paintCtx.putImageData(G.undo.pop(), 0, 0);
    recomposite();
    updateControls();
  }

  function redo() {
    if (!canEdit() || !G.redo.length) return;
    G.stroke = null;
    G.undo.push(G.paintCtx.getImageData(0, 0, FB, FB));
    G.paintCtx.putImageData(G.redo.pop(), 0, 0);
    recomposite();
    updateControls();
  }

  function beginStroke(pt) {
    const redo = G.redo;
    const trimmed = pushUndo();
    const x = pt.x - G.fig.x;
    const y = pt.y - G.fig.y;
    G.stroke = { x, y, redo, trimmed };
    const c = G.paintCtx;
    c.fillStyle = G.color;
    c.beginPath();
    c.arc(x, y, G.size / 2, 0, TAU);
    c.fill();
    addRecent(G.color);
    recomposite();
    updateControls();
    tutEvent('stroke');
  }

  function continueStroke(pt) {
    if (!G.stroke) return;
    const c = G.paintCtx;
    const x = pt.x - G.fig.x;
    const y = pt.y - G.fig.y;
    c.strokeStyle = G.color;
    c.lineWidth = G.size;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(G.stroke.x, G.stroke.y);
    c.lineTo(x, y);
    c.stroke();
    G.stroke.x = x;
    G.stroke.y = y;
  }

  function cancelStroke() {
    if (G.stroke && G.undo.length) {
      G.paintCtx.putImageData(G.undo.pop(), 0, 0);
      if (G.stroke.trimmed) G.undo.unshift(G.stroke.trimmed);
      G.redo = G.stroke.redo;
    }
    G.stroke = null;
    recomposite();
    updateControls();
  }

  function colorAt(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!G.painting || x < 0 || y < 0 || x >= PW || y >= PH) return null;
    const lx = x - G.fig.x;
    const ly = y - G.fig.y;
    if (meActive() && G.phase === 'hide' && lx >= 0 && ly >= 0 && lx < FB && ly < FB) {
      const d = G.figCtx.getImageData(lx, ly, 1, 1).data;
      if (d[3] > 200) return hex(d[0], d[1], d[2]);
    }
    const k = (y * PW + x) * 4;
    const d = G.painting.data;
    return hex(d[k], d[k + 1], d[k + 2]);
  }

  function figurePayload() {
    recomposite();
    const data = G.figCtx.getImageData(0, 0, FB, FB).data;
    G.myBlend = computeBlend(data, G.fig.x, G.fig.y, G.painting);
    return { x: G.fig.x, y: G.fig.y, pose: G.fig.pose, img: G.figCanvas.toDataURL('image/png'), blend: G.myBlend };
  }

  function sendFigure(type) {
    if (!G.link || !G.painting || !meActive()) return;
    if (G.stroke) { G.stroke = null; recomposite(); }
    G.link.send({ t: type, fig: figurePayload() });
  }

  function toggleReady() {
    if (G.phase !== 'hide' || !meActive()) return;
    if (!G.submitted) {
      if (G.stroke) G.stroke = null;
      sendFigure('submit');
      G.submitted = true;
      G.fig.locked = true;
      Sound.ready();
    } else {
      G.submitted = false;
      G.link.send({ t: 'unsubmit' });
    }
    closePopovers();
    updateControls();
  }

  // ---------------------------------------------------------------- pincel y colores
  function setColor(c, quiet) {
    if (!/^#[0-9a-f]{6}$/i.test(c)) return;
    G.color = c.toLowerCase();
    store.set('color', G.color);
    $('#tb-swatch').style.background = G.color;
    $('#color-big-fill').style.background = G.color;
    $('#in-color').value = G.color;
    $$('#palette button, #recent button').forEach((b) => b.classList.toggle('on', b.dataset.c === G.color));
    if (!quiet) Sound.pop();
  }

  function setSize(s) {
    G.size = s;
    store.set('size', s);
    $$('.size-btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === s));
  }

  function addRecent(c) {
    if (G.recent[0] === c) return;
    G.recent = [c, ...G.recent.filter((x) => x !== c)].slice(0, 10);
    renderSwatches($('#recent'), G.recent);
  }

  function renderSwatches(box, colors) {
    box.replaceChildren();
    for (const c of colors) {
      const b = el('button');
      b.style.background = c;
      b.dataset.c = c;
      b.title = c;
      b.setAttribute('aria-label', 'Color ' + c);
      b.classList.toggle('on', c === G.color);
      b.onclick = () => { setColor(c); if (canEdit() && !G.fig.locked) setLocked(true, true); G.tool = 'brush'; updateControls(); };
      box.append(b);
    }
  }

  function setTool(t) {
    if (t === 'pick' && !canEdit()) return;
    G.tool = t;
    updateControls();
  }

  function pickColorAt(pt) {
    const c = colorAt(pt.x, pt.y);
    if (c) {
      setColor(c);
      addRecent(c);
      G.fx.push({ kind: 'swatch', x: pt.x, y: pt.y, t0: performance.now(), color: c });
      tutEvent('picked');
    }
    G.tool = 'brush';
    if (canEdit() && !G.fig.locked) setLocked(true, true);
    updateControls();
  }

  // ---------------------------------------------------------------- popovers
  function closePopovers() {
    $('#pop-poses').hidden = true;
    $('#pop-brush').hidden = true;
  }

  function togglePopover(id) {
    const p = $(id);
    const open = p.hidden;
    closePopovers();
    p.hidden = !open;
  }

  function buildPoseGrid() {
    const grid = $('#pose-grid');
    Figure.POSES.forEach((pose, i) => {
      const b = el('button', 'pose-btn');
      const c = makeCanvas(92, 92);
      const x = c.getContext('2d');
      const { bbox } = Figure.shape(i);
      const bw = bbox.x1 - bbox.x0;
      const bh = bbox.y1 - bbox.y0;
      const s = 80 / Math.max(bw, bh);
      Figure.drawMask(x, i, '#1b1530', s, 46 - (bbox.x0 + bw / 2) * s, 46 - (bbox.y0 + bh / 2) * s);
      b.append(c, el('span', null, pose.name));
      b.title = pose.name;
      b.onclick = () => setPose(i);
      grid.append(b);
    });
  }

  function buildBrushPanel() {
    const sizes = $('#sizes');
    for (const s of BRUSH_SIZES) {
      const b = el('button', 'size-btn');
      b.dataset.s = s;
      b.title = 'Tamaño ' + s;
      const dot = el('i');
      const d = Math.max(5, Math.min(30, s * 0.75));
      dot.style.width = d + 'px';
      dot.style.height = d + 'px';
      b.append(dot);
      b.onclick = () => { setSize(s); Sound.pop(); };
      sizes.append(b);
    }
    setSize(BRUSH_SIZES.includes(G.size) ? G.size : 14);
    $('#in-color').addEventListener('input', (e) => setColor(e.target.value, true));
    $('#in-color').addEventListener('change', (e) => { addRecent(e.target.value); if (canEdit() && !G.fig.locked) setLocked(true, true); });
    $('#btn-pick2').onclick = () => { closePopovers(); if (canEdit() && !G.fig.locked) setLocked(true, true); setTool('pick'); };
    setColor(G.color, true);
  }

  // ---------------------------------------------------------------- controles
  function updateControls() {
    const hide = G.phase === 'hide';
    const editing = canEdit();
    const playing = hide && meActive();
    $('#toolbar').classList.toggle('off', !playing);
    $('#tb-poses').disabled = !editing;
    $('#tb-lock').disabled = !editing;
    $('#tb-brush').disabled = !editing;
    $('#tb-ready').disabled = !playing;
    $('#tb-lock').classList.toggle('unlocked', !G.fig.locked);
    $('#tb-lock-label').textContent = G.fig.locked ? 'Desbloquear' : 'Bloquear';
    $('#tb-ready-label').textContent = G.submitted ? 'Editar' : '¡Listo!';
    $('#tb-brush').classList.toggle('active-tool', editing && G.fig.locked && G.tool === 'brush');
    for (const act of ['pick', 'undo', 'redo']) {
      const b = $(`.stool[data-act="${act}"]`);
      b.hidden = !playing;
      b.disabled = !editing || (act === 'undo' && !G.undo.length) || (act === 'redo' && !G.redo.length);
    }
    $('.stool[data-act="pick"]').classList.toggle('on', G.tool === 'pick');
    $('.stool[data-act="hand"]').hidden = !editing;
    $('.stool[data-act="hand"]').classList.toggle('on', G.tool === 'hand');
    $('#side-tools').hidden = !['hide', 'seek', 'results', 'check', 'prepare'].includes(G.phase);
    const host = G.room && G.room.hostId === G.me;
    $('#btn-hurry').hidden = !(G.mode === 'online' && hide && G.phaseEnd == null && host);
    if (!editing) closePopovers();
    updateStatus();
    setCursor();
  }

  function setStatus(main, hint) {
    $('#status').textContent = main || '';
    $('#status-hint').textContent = hint || '';
  }

  function updateStatus() {
    const ph = G.phase;
    if (ph === 'loading') return setStatus('CARGANDO LA OBRA…', 'Puedes salir y volver a intentarlo cuando quieras');
    if (ph === 'prepare') return setStatus('¡PREPÁRENSE!', 'Un nuevo cuadro… ¡fíjate bien en él!');
    if (ph === 'hide') {
      if (!meActive()) return setStatus('LOS DEMÁS SE ESTÁN ESCONDIENDO', 'Jugarás en la siguiente ronda');
      if (G.submitted) return setStatus('¡LISTO! ESPERANDO A LOS DEMÁS', 'Pulsa Editar si quieres retocar tu figura');
      if (!G.fig.locked) return setStatus('MUEVE TU FIGURA AL LUGAR', 'Arrástrala, elige una pose y pulsa Bloquear para pintarla');
      if (G.tool === 'pick') return setStatus('TOCA EL CUADRO PARA COGER UN COLOR', 'Luego pinta tu figura con él');
      return setStatus('FIGURA BLOQUEADA · ¡PÍNTALA!', 'Copia los colores del cuadro para que se camufle');
    }
    if (ph === 'check') return setStatus('COMPROBANDO TU MEZCLA…', '');
    if (ph === 'seek') {
      const s = G.seek;
      if (!s || !s.participant) return setStatus('¡A BUSCAR!', 'Mira cómo buscan los demás');
      if (s.done) {
        return setStatus(s.reason === 'all' ? '¡ENCONTRASTE A TODOS!' : '¡SE ACABÓ TU TIEMPO!',
          G.mode === 'tutorial' ? '' : 'Esperando a que terminen los demás…');
      }
      return setStatus('¡ENCUÉNTRALOS!', `Toca donde creas que se esconden · cada fallo resta ${MISS_PENALTY} s`);
    }
    if (ph === 'results') return setStatus('RESULTADOS DE LA RONDA', '');
    return setStatus('', '');
  }

  function setCursor() {
    view.className = '';
    if (action && (action.type === 'pan' || action.type === 'pinch')) view.classList.add('grabbing');
    else if (G.spaceDown || (canEdit() && G.tool === 'hand')) view.classList.add('grab');
    else if (canEdit() && G.tool === 'pick') view.classList.add('none');
    else if (canEdit() && !G.fig.locked) view.classList.add('move');
    else if (canEdit() || (G.phase === 'seek' && G.seek && G.seek.participant && !G.seek.done)) view.classList.add('none');
  }

  // ---------------------------------------------------------------- entrada (ratón / táctil)
  const pointers = new Map();
  let action = null;
  const slopOf = (type) => type === 'mouse' ? TAP_SLOP.mouse : TAP_SLOP.touch;

  function startPinch() {
    if (action && action.type === 'paint') cancelStroke();
    const [a, b] = [...pointers.values()];
    action = {
      type: 'pinch',
      d0: Math.max(10, Math.hypot(a.sx - b.sx, a.sy - b.sy)),
      cx0: (a.sx + b.sx) / 2,
      cy0: (a.sy + b.sy) / 2,
      z0: G.view.z,
      ox0: G.view.ox,
      oy0: G.view.oy,
    };
  }

  function updatePinch() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const v = G.view;
    const d = Math.max(10, Math.hypot(a.sx - b.sx, a.sy - b.sy));
    const cx = (a.sx + b.sx) / 2;
    const cy = (a.sy + b.sy) / 2;
    const s0 = v.fit * action.z0;
    const px = (action.cx0 - action.ox0) / s0;
    const py = (action.cy0 - action.oy0) / s0;
    v.z = clamp((action.z0 * d) / action.d0, 1, MAX_ZOOM);
    v.s = v.fit * v.z;
    v.ox = cx - px * v.s;
    v.oy = cy - py * v.s;
    clampView();
    if (v.z > action.z0 + 0.1) tutEvent('zoom');
  }

  view.addEventListener('pointerdown', (e) => {
    Sound.unlock();
    closePopovers();
    // Un nuevo puntero principal recupera los pointerup perdidos al cambiar de aplicación.
    if (e.isPrimary) {
      for (const [id, p] of pointers) if (p.type === e.pointerType) pointers.delete(id);
      if (!pointers.size && action) {
        if (action.type === 'paint') { G.stroke = null; recomposite(); }
        action = null;
      }
    }
    try { view.setPointerCapture(e.pointerId); } catch { /* ignorar */ }
    const pt = toPaint(e);
    pointers.set(e.pointerId, { sx: pt.sx, sy: pt.sy, x0: pt.sx, y0: pt.sy, t0: performance.now(), type: e.pointerType });
    if (pointers.size === 2) { startPinch(); setCursor(); return; }
    if (pointers.size > 2) return;
    if (e.button === 1 || e.button === 2 || G.spaceDown || (G.tool === 'hand' && canEdit())) {
      action = { type: 'pan', sx: pt.sx, sy: pt.sy, ox: G.view.ox, oy: G.view.oy };
      setCursor();
      return;
    }
    if (canEdit()) {
      if (G.tool === 'pick') { action = { type: 'pick' }; return; }
      if (!G.fig.locked) { action = { type: 'move', px: pt.x, py: pt.y, fx: G.fig.x, fy: G.fig.y }; return; }
      beginStroke(pt);
      action = { type: 'paint' };
      return;
    }
    action = { type: 'tap', sx: pt.sx, sy: pt.sy, ox: G.view.ox, oy: G.view.oy, slop: slopOf(e.pointerType) };
  });

  view.addEventListener('pointermove', (e) => {
    const pt = toPaint(e);
    G.hover = pt;
    const p = pointers.get(e.pointerId);
    if (p) { p.sx = pt.sx; p.sy = pt.sy; }
    if (!p || !action) return;
    switch (action.type) {
      case 'pinch': updatePinch(); break;
      case 'pan':
        G.view.ox = action.ox + (pt.sx - action.sx);
        G.view.oy = action.oy + (pt.sy - action.sy);
        clampView();
        break;
      case 'tap':
        if (Math.hypot(pt.sx - action.sx, pt.sy - action.sy) > action.slop) {
          action = { type: 'pan', sx: action.sx, sy: action.sy, ox: action.ox, oy: action.oy };
          G.view.ox = action.ox + (pt.sx - action.sx);
          G.view.oy = action.oy + (pt.sy - action.sy);
          clampView();
          setCursor();
        }
        break;
      case 'move':
        moveFigureTo(action.fx + Math.round(pt.x - action.px), action.fy + Math.round(pt.y - action.py));
        break;
      case 'paint': {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ce of (evs.length ? evs : [e])) continueStroke(toPaint(ce));
        recomposite();
        break;
      }
      default: break;
    }
  });

  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (!action) return;
    const done = e.type === 'pointerup';
    if (action.type === 'pinch') {
      const rest = [...pointers.values()];
      if (rest.length >= 2) {
        startPinch();
      } else if (rest.length === 1) {
        // Un toque junto a un pulgar inmóvil que sujeta el móvil sigue siendo un intento.
        const still = (point) => Math.hypot(point.sx - point.x0, point.sy - point.y0) < slopOf(point.type);
        const tapWhileResting = done && G.phase === 'seek' && p.type === 'touch' && rest[0].type === 'touch'
          && performance.now() - p.t0 < 350 && p.t0 - rest[0].t0 > 300 && still(p) && still(rest[0]);
        if (tapWhileResting) {
          G.view.z = action.z0;
          G.view.ox = action.ox0;
          G.view.oy = action.oy0;
          clampView();
          guess(fromScreen(p.x0, p.y0), p.type);
        }
        action = { type: 'pan', sx: rest[0].sx, sy: rest[0].sy, ox: G.view.ox, oy: G.view.oy };
      } else {
        action = null;
      }
      setCursor();
      return;
    }
    const pt = toPaint(e);
    if (action.type === 'paint') {
      if (done) { G.stroke = null; recomposite(); }
      else cancelStroke();
    } else if (action.type === 'pick' && done) pickColorAt(pt);
    else if (action.type === 'tap' && done && G.phase === 'seek') guess(pt, e.pointerType);
    action = null;
    setCursor();
  }
  view.addEventListener('pointerup', endPointer);
  view.addEventListener('pointercancel', endPointer);
  view.addEventListener('lostpointercapture', endPointer);
  view.addEventListener('pointerleave', () => { if (!action) G.hover = null; });
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const pt = toPaint(e);
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)), pt.sx, pt.sy);
  }, { passive: false });
  // Safari: gestos de pellizco del trackpad
  view.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => { if (G.screen === 'scr-game') e.preventDefault(); }, { passive: false });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Intro/Espacio sobre un botón con foco ya lo pulsan; no repetimos la acción del juego
    if (tag === 'BUTTON' && (e.key === 'Enter' || e.code === 'Space')) return;
    if (e.code === 'Space' && G.screen === 'scr-game') {
      if (!G.spaceDown) { G.spaceDown = true; setCursor(); }
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $(G.screen === 'scr-game' ? '#btn-fullscreen' : '#btn-fullscreen-menu').click();
      return;
    }
    if (G.screen !== 'scr-game') return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    // en teclados españoles [ y ] necesitan Alt/Opción, así que los aceptamos antes de filtrar Alt
    if (e.key === '[' || e.key === ']') {
      const i = BRUSH_SIZES.indexOf(G.size) + (e.key === ']' ? 1 : -1);
      setSize(BRUSH_SIZES[clamp(i, 0, BRUSH_SIZES.length - 1)]);
      return;
    }
    if (mod || e.altKey) return;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case '+': case '=': zoomCenter(1.4); break;
      case '-': case '_': zoomCenter(1 / 1.4); break;
      case '0': resetZoom(); break;
      case '1': case '2': case '3': case '4': case '5': setSize(BRUSH_SIZES[Number(e.key) - 1]); break;
      case 'Escape': closePopovers(); if (G.tool !== 'brush') setTool('brush'); break;
      case 'Enter': if (G.phase === 'hide') toggleReady(); break;
      default:
        if (k === 'i') setTool(G.tool === 'pick' ? 'brush' : 'pick');
        else if (k === 'l') setLocked(!G.fig.locked);
        else if (k === 'p' && canEdit()) togglePopover('#pop-poses');
        else if (k === 'b' && canEdit()) togglePopover('#pop-brush');
        else if (e.key.startsWith('Arrow') && canEdit() && !G.fig.locked) {
          e.preventDefault();
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          moveFigureTo(G.fig.x + dx, G.fig.y + dy);
        }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { G.spaceDown = false; setCursor(); }
  });
  window.addEventListener('blur', () => {
    G.spaceDown = false;
    if (action?.type === 'paint') { G.stroke = null; recomposite(); }
    action = null;
    pointers.clear();
    setCursor();
  });

  // ---------------------------------------------------------------- búsqueda
  function seekElapsed() {
    const s = G.seek;
    return (performance.now() - s.start) / 1000 + s.penalty;
  }

  function hitFig(t, x, y, tol) {
    const lx = Math.round(x - t.x);
    const ly = Math.round(y - t.y);
    const r = Math.ceil(tol);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > tol * tol) continue;
        const i = lx + dx;
        const j = ly + dy;
        if (i < 0 || j < 0 || i >= FB || j >= FB) continue;
        if (t.data[(j * FB + i) * 4 + 3] > 100) return true;
      }
    }
    return false;
  }

  function guess(pt, pointerType = 'mouse') {
    const s = G.seek;
    if (!s || !s.participant || s.done || !s.loaded) return;
    if (pt.x < 0 || pt.y < 0 || pt.x >= PW || pt.y >= PH) return;
    const tol = Math.max(3, (pointerType === 'mouse' ? HIT_TOLERANCE.mouse : HIT_TOLERANCE.touch) / G.view.s);
    for (const t of s.targets) {
      if (s.found.has(t.id) || !hitFig(t, pt.x, pt.y, tol)) continue;
      const time = Math.round(Math.min(s.limit, seekElapsed()) * 100) / 100;
      s.found.set(t.id, time);
      G.link.send({ t: 'found', target: t.id, time });
      G.fx.push({ kind: 'burst', x: pt.x, y: pt.y, t0: performance.now(), color: '#5ff3ff' });
      Sound.found();
      toast(`¡Encontraste a ${nameOf(t.id)}! (${time.toFixed(1)} s)`, 'good');
      updateHudSub();
      if (s.found.size >= s.targets.length) finishSeek('all');
      return;
    }
    s.penalty += MISS_PENALTY;
    s.misses.push({ x: pt.x, y: pt.y });
    G.fx.push({ kind: 'text', x: pt.x, y: pt.y, t0: performance.now(), text: `-${MISS_PENALTY}s`, color: '#ff5a6a' });
    Sound.miss();
    if (seekElapsed() >= s.limit) finishSeek('time');
  }

  function finishSeek(reason) {
    const s = G.seek;
    if (!s || s.done) return;
    s.done = true;
    s.reason = reason;
    const elapsed = Math.round(Math.min(s.limit, seekElapsed()) * 100) / 100;
    G.link.send({ t: 'seekDone', elapsed });
    banner(reason === 'all' ? '¡LOS ENCONTRASTE!' : '¡TIEMPO!');
    updateControls();
  }

  async function setupSeek(m) {
    const token = {};
    const previous = G.seek?.round === m.round && G.seek.seed === m.seed ? G.seek : null;
    G.seek = {
      round: m.round, seed: m.seed,
      start: performance.now(),
      limit: m.limit / 1000,
      penalty: 0,
      targets: [],
      found: new Map(),
      misses: [],
      done: false,
      ...previous,
      token,
      loaded: false,
      participant: m.participants.includes(G.me) && meActive(),
    };
    reconcileSeek(m);
    const figs = await loadFigs(m.figs);
    if (G.phase !== 'seek' || G.round !== m.round || !G.seek || G.seek.token !== token) return;
    G.figs = figs;
    G.seek.targets = m.participants.filter((id) => id !== G.me && G.figs[id]).map((id) => G.figs[id]);
    G.seek.loaded = true;
    updateHudSub();
  }

  function reconcileSeek(m) {
    const s = G.seek;
    if (!s || s.round !== m.round || s.seed !== m.seed) return;
    if (Number.isFinite(m.elapsed)) {
      const elapsed = Math.max(0, m.elapsed);
      s.start = Math.min(s.start, performance.now() - elapsed);
      s.limit = (Math.max(0, m.limit) + elapsed) / 1000;
    }
    for (const found of m.finds || []) {
      if (found.seeker === G.me && !s.found.has(found.target)) s.found.set(found.target, found.time);
    }
    if (m.done && Object.hasOwn(m.done, G.me)) {
      s.done = true;
      s.reason = s.found.size >= m.participants.length - 1 ? 'all' : 'time';
    }
  }

  async function loadFigs(figs) {
    const out = {};
    await Promise.all(Object.keys(figs || {}).map(async (id) => {
      const f = figs[id];
      const img = await loadFigure(f.img);
      out[id] = { id, x: f.x, y: f.y, pose: f.pose, blend: f.blend, canvas: img.canvas, data: img.data, outline: null };
    }));
    return out;
  }

  function onFound(m) {
    if (m.seeker === G.me) {
      if (G.seek && !G.seek.found.has(m.target)) {
        G.seek.found.set(m.target, Number(m.time));
        updateHudSub();
      }
      return;
    }
    if (m.target === G.me) {
      toast(`¡${nameOf(m.seeker)} te encontró! (${Number(m.time).toFixed(1)} s)`, 'bad');
      Sound.caught();
      if (G.figs[G.me]) G.figs[G.me].caught = true;
    } else {
      toast(`${nameOf(m.seeker)} encontró a ${nameOf(m.target)}`);
    }
  }

  // ---------------------------------------------------------------- fases
  function hideOverlays() {
    $('#ov-countdown').hidden = true;
    $('#ov-check').hidden = true;
    $('#ov-results').hidden = true;
    $('#btn-unpeek').hidden = true;
  }

  async function enterPhase(m) {
    const revision = ++phaseRevision;
    const receivedAt = performance.now();
    syncArtPrefetch(m.collection ?? G.room?.settings.collection ?? 0, m.preload);
    if (m.collection === 1 && !['lobby', 'final'].includes(m.phase)) {
      const work = HumanArt.works[m.painting];
      if (!work || !work.image) {
        G.phase = 'loading';
        G.painting = null;
        if (!(m.phase === 'seek' && G.seek?.round === m.round && G.seek.seed === m.seed)) G.seek = null;
        G.stroke = null;
        action = null;
        pointers.clear();
        closePopovers();
        showScreen('scr-game');
        hideOverlays();
        $('#ov-countdown').hidden = false;
        $('#count-num').textContent = '…';
        $('#count-paint').textContent = 'Cargando obra…';
        updateControls();
        updateHudSub();
      }
      const current = () => revision === phaseRevision;
      if (!await artworkWhenCurrent(m.painting, current, () => {
        $('#count-paint').textContent = 'No se pudo descargar. Reintentando…';
      })) return;
      m = accountArtworkWait(m, performance.now() - receivedAt);
    }
    const same = m.phase === G.phase && m.round === G.round && m.phase !== 'lobby';
    const hurried = !!G.phaseMsg?.hurry;
    G.phaseMsg = m;
    G.phaseEnd = m.duration != null ? performance.now() + m.duration : null;
    G.phaseDur = m.duration || 0;
    if (same) {
      if (m.phase === 'seek') reconcileSeek(m);
      if (m.phase === 'hide' && m.hurry && !hurried) { banner('¡ÚLTIMOS 30 S!'); Sound.go(); }
      updateControls();
      updateHudSub();
      return;
    }
    G.phase = m.phase;
    G.round = m.round;
    G.rounds = m.rounds;
    G.lastCount = null;
    closePopovers();
    action = null;
    pointers.clear();

    if (m.phase === 'lobby') {
      G.seek = null;
      G.figs = {};
      if (G.mode === 'online') showScreen('scr-lobby');
      else { leaveGame(); }
      return;
    }
    if (m.phase === 'final') { showFinal(m); return; }

    if (!G.painting || G.painting.idx !== m.painting || G.painting.seed !== m.seed ||
        G.painting.difficulty !== (m.difficulty ?? 0) || G.painting.collection !== (m.collection ?? 0)) {
      try { G.painting = getPainting(m.painting, m.seed, m.difficulty, m.collection); }
      catch {
        leaveGame();
        toast('No se pudo leer la imagen del cuadro. Vuelve a intentarlo.', 'bad');
        return;
      }
      renderSwatches($('#palette'), G.painting.palette);
    }
    const credit = $('#art-credit');
    credit.replaceChildren();
    credit.hidden = !G.painting.work;
    if (G.painting.work) {
      const work = G.painting.work;
      const source = el('a', '', work.title + ' — ' + work.artist + ' · ' + work.date + ' · ' + work.museum + ' · ' + work.license);
      source.href = work.source;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      credit.append(source);
    }
    if (m.phase === 'prepare' || G.figRound !== m.round) resetOwnFigure(m.round);
    if (G.screen !== 'scr-game') showScreen('scr-game');
    $('#hud-round').textContent = G.mode === 'tutorial' ? 'Tutorial' : `Ronda ${m.round}/${m.rounds}`;
    $('#hud-paint').textContent = G.painting.name;
    $('#hud-paint').title = G.painting.work ? G.painting.work.title : G.painting.name;
    hideOverlays();
    $('#spectate').hidden = meActive();

    switch (m.phase) {
      case 'prepare':
        G.seek = null;
        G.figs = {};
        G.results = null;
        G.fx = [];
        resetZoom();
        $('#ov-countdown').hidden = false;
        $('#count-paint').textContent = '«' + G.painting.name + '»';
        break;
      case 'hide':
        G.tool = 'brush';
        banner('¡ESCÓNDETE!');
        Sound.go();
        break;
      case 'check':
        if (G.stroke) { G.stroke = null; recomposite(); }
        resetZoom();
        showCheck();
        break;
      case 'seek':
        G.fx = [];
        resetZoom();
        setupSeek(m);
        banner('¡ENCUÉNTRALOS!');
        Sound.go();
        break;
      case 'results':
        clearTimeout(bannerTimer);
        $('#banner').hidden = true;
        resetZoom();
        setupResults(m);
        break;
      default: break;
    }
    updateControls();
    updateHudSub();
  }

  function showCheck() {
    $('#ov-check').hidden = false;
    const fill = $('#check-fill');
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth;
    fill.style.transition = '';
    if (!meActive()) {
      $('#check-pct').textContent = '…';
      $('#check-rate').textContent = 'Comprobando las mezclas de todos';
      return;
    }
    const blend = computeBlend(G.figCtx.getImageData(0, 0, FB, FB).data, G.fig.x, G.fig.y, G.painting);
    G.myBlend = blend;
    requestAnimationFrame(() => { fill.style.width = blend + '%'; });
    const t0 = performance.now();
    const pct = $('#check-pct');
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1500);
      const e = 1 - Math.pow(1 - k, 3);
      pct.textContent = Math.round(blend * e) + '%';
      if (k < 1 && G.phase === 'check') requestAnimationFrame(step);
    };
    step();
    $('#check-rate').textContent = blend >= 97 ? '¡Eres invisible! 🫥'
      : blend >= 90 ? '¡Muy bien camuflado! 🎨'
        : blend >= 75 ? 'Nada mal… pero se te ve un poco'
          : blend >= 50 ? 'Hmm, se nota bastante 👀'
            : '¡Se te ve a kilómetros! 😅';
  }

  async function setupResults(m) {
    G.results = m;
    G.peek = false;
    if (G.seek && !G.seek.done) G.seek.done = true;
    if (!Object.keys(G.figs).length) {
      const figs = await loadFigs(m.figs);
      if (G.phase !== 'results' || G.round !== m.round || G.results !== m) return;
      G.figs = figs;
    }
    for (const id of Object.keys(G.figs)) G.figs[id].outline = makeOutline(G.figs[id].canvas, colorOf(id), 4);
    const tiles = $('#res-tiles');
    tiles.replaceChildren();
    for (const e of m.results) {
      const t = el('div', 'tile' + (e.id === G.me ? ' me' : ''));
      const av = el('div', 'avatar big');
      av.style.setProperty('--c', PLAYER_COLORS[e.color % PLAYER_COLORS.length]);
      t.append(el('div', 'ttime', e.time != null ? e.time.toFixed(2) + 's' : `${e.found}/${e.targets}`));
      t.append(av);
      if (e.time == null) t.append(el('div', 'xmark', '✗'));
      t.append(el('div', 'tname', e.name + (e.id === G.me ? ' (tú)' : '')));
      const info = el('div', 'tinfo');
      info.append(`Encontró ${e.found}/${e.targets}`, el('br'),
        `Lo encontraron ${e.foundBy.length}/${e.targets}`, el('br'), `Mezcla ${Math.round(e.blend)}%`);
      t.append(info);
      const pts = el('div', 'tpts', '+' + e.roundPts);
      pts.append(' ', el('small', null, `(total ${e.score})`));
      t.append(pts);
      tiles.append(t);
    }
    $('#next-label').textContent = m.last ? 'Resultados finales…' : 'Siguiente ronda…';
    if (G.phase === 'results') $('#ov-results').hidden = false;
    const mine = m.results.find((e) => e.id === G.me);
    if (mine && m.results[0] && m.results[0].id === G.me) Sound.fanfare();
    else Sound.ready();
  }

  function showFinal(m) {
    showScreen('scr-final');
    const st = m.standings || [];
    const podium = $('#podium');
    podium.replaceChildren();
    const order = [1, 0, 2];
    for (const i of order) {
      const p = st[i];
      if (!p) continue;
      const pod = el('div', 'pod p' + (i + 1));
      const av = el('div', 'avatar big');
      av.style.setProperty('--c', PLAYER_COLORS[p.color % PLAYER_COLORS.length]);
      const block = el('div', 'block');
      block.append(el('div', 'place', String(i + 1)), el('div', 'score', p.score + ' pts'));
      pod.append(av, el('div', 'pname', p.name + (p.id === G.me ? ' (tú)' : '')), block);
      podium.append(pod);
    }
    const list = $('#standings');
    list.replaceChildren();
    st.slice(3).forEach((p, k) => {
      const li = el('li', p.id === G.me ? 'me' : '');
      const av = el('div', 'avatar');
      av.style.setProperty('--c', PLAYER_COLORS[p.color % PLAYER_COLORS.length]);
      li.append(el('span', 'pos', String(k + 4)), av, el('span', 'pname', p.name), el('span', 'score', p.score + ' pts'));
      list.append(li);
    });
    const isHost = G.room && G.room.hostId === G.me;
    $('#btn-final-again').hidden = !isHost;
    $('#btn-final-lobby').hidden = !(isHost && G.mode === 'online');
    $('#final-hint').textContent = isHost ? '' : 'Esperando a que el anfitrión decida qué hacer…';
    const winner = st[0];
    if (winner && winner.id === G.me) { $('.final-title').textContent = '¡Has ganado! 🏆'; Sound.fanfare(); }
    else $('.final-title').textContent = '¡Fin de la partida!';
  }

  // ---------------------------------------------------------------- HUD
  function updateHudSub() {
    const sub = $('#hud-sub');
    const players = (G.room && G.room.players) || [];
    const act = players.filter((p) => p.active && p.connected);
    let text = '';
    if (G.mode === 'tutorial' && (G.phase === 'hide' || G.phase === 'check')) text = 'SIN PRISA';
    else if (G.phase === 'prepare') text = `${act.length} JUGADORES`;
    else if (G.phase === 'hide') text = `LISTOS ${act.filter((p) => p.ready).length}/${act.length}`;
    else if (G.phase === 'check') text = 'COMPROBANDO';
    else if (G.phase === 'seek') {
      const s = G.seek;
      text = s && s.participant ? `ENCONTRADOS ${s.found.size}/${s.targets.length || '…'}` : 'BUSCANDO…';
    } else if (G.phase === 'results') text = 'TEMPORIZADORES';
    sub.textContent = text;
    sub.hidden = !text;
  }

  function updateTimer(now) {
    const timer = $('#hud-timer');
    if (G.mode === 'tutorial') {
      // en el tutorial no hay reloj: cada paso espera a que el jugador lo haga
      timer.textContent = '';
      timer.classList.remove('hurry');
      return;
    }
    let remain = G.phaseEnd != null ? (G.phaseEnd - now) / 1000 : 0;
    const s = G.seek;
    if (G.phase === 'seek' && s && s.participant) remain = s.done ? 0 : s.limit - seekElapsed();
    if (['results', 'prepare', 'check', 'loading'].includes(G.phase)) timer.textContent = '';
    else timer.textContent = G.phase === 'hide' && G.phaseEnd == null ? '∞' : fmtClock(remain);
    const hurry = (G.phase === 'hide' && G.phaseEnd != null && remain <= 10) || (G.phase === 'seek' && s && s.participant && !s.done && remain <= 5);
    timer.classList.toggle('hurry', hurry && remain > 0);
    const whole = Math.ceil(remain);
    if (G.phase === 'prepare') {
      const n = clamp(Math.ceil(remain - 0.5), 1, 3);
      if (n !== G.lastCount) {
        G.lastCount = n;
        const num = $('#count-num');
        num.textContent = String(n);
        num.style.animation = 'none';
        void num.offsetWidth;
        num.style.animation = '';
        Sound.tick();
      }
    } else if (hurry && whole !== G.lastCount && whole > 0) {
      G.lastCount = whole;
      Sound.tick();
    }
    if (G.phase === 'results' && G.phaseDur) {
      const k = clamp(1 - remain / (G.phaseDur / 1000), 0, 1);
      $('#next-fill').style.width = (k * 100).toFixed(1) + '%';
    }
    if (G.phase === 'seek' && s && s.participant && s.loaded && !s.done && seekElapsed() >= s.limit) finishSeek('time');
  }

  // ---------------------------------------------------------------- dibujo
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawLabel(ctx, text, sx, sy, bg) {
    ctx.font = '900 13px Nunito, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 16;
    roundRect(ctx, sx - w / 2, sy - 24, w, 21, 10);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#1b1530';
    ctx.stroke();
    ctx.fillStyle = '#1b1530';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, sx, sy - 13);
  }

  function figTop(f) {
    const b = Figure.shape(f.pose).bbox;
    const v = G.view;
    return { sx: v.ox + (f.x + (b.x0 + b.x1) / 2) * v.s, sy: v.oy + (f.y + b.y0) * v.s - 4 };
  }

  function draw(now) {
    const v = G.view;
    const ctx = v.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#241a14';
    ctx.fillRect(0, 0, view.width, view.height);
    if (!G.painting) return;
    ctx.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
    ctx.imageSmoothingEnabled = v.s * v.dpr < 2.2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(G.painting.canvas, 0, 0);
    const ph = G.phase;

    if ((ph === 'prepare' || ph === 'hide' || ph === 'check') && meActive()) {
      ctx.drawImage(G.figCanvas, G.fig.x, G.fig.y);
      if (ph === 'hide' && !G.fig.locked && !G.submitted) {
        const b = Figure.shape(G.fig.pose).bbox;
        const pad = 6 / v.s;
        ctx.save();
        ctx.setLineDash([9 / v.s, 6 / v.s]);
        ctx.lineDashOffset = -now / 45 / v.s;
        ctx.lineWidth = 4 / v.s;
        ctx.strokeStyle = '#1b1530';
        ctx.strokeRect(G.fig.x + b.x0 - pad, G.fig.y + b.y0 - pad, b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2);
        ctx.lineWidth = 2 / v.s;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(G.fig.x + b.x0 - pad, G.fig.y + b.y0 - pad, b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2);
        ctx.restore();
      }
    } else if (ph === 'seek') {
      const s = G.seek;
      for (const id of Object.keys(G.figs)) {
        const f = G.figs[id];
        if (s && s.participant && id === G.me) continue;
        if (s && s.found.has(id)) {
          if (!f.outline) f.outline = makeOutline(f.canvas, '#5ff3ff', 4);
          ctx.drawImage(f.outline, f.x - 4, f.y - 4);
        }
        ctx.drawImage(f.canvas, f.x, f.y);
      }
    } else if (ph === 'results') {
      for (const id of Object.keys(G.figs)) {
        const f = G.figs[id];
        if (f.outline) ctx.drawImage(f.outline, f.x - 4, f.y - 4);
        ctx.drawImage(f.canvas, f.x, f.y);
      }
    }

    // ---- capa en coordenadas de pantalla
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    const toS = (x, y) => [v.ox + x * v.s, v.oy + y * v.s];

    if (ph === 'seek' && G.seek) {
      for (const mm of G.seek.misses) {
        const [x, y] = toS(mm.x, mm.y);
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, TAU);
        ctx.fillStyle = '#5ff3ff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      for (const [id] of G.seek.found) {
        const f = G.figs[id];
        if (!f) continue;
        const t = figTop(f);
        drawLabel(ctx, nameOf(id) + ' ✓', t.sx, t.sy, '#5ff3ff');
      }
    }
    if (ph === 'results') {
      for (const id of Object.keys(G.figs)) {
        const t = figTop(G.figs[id]);
        drawLabel(ctx, nameOf(id) + (id === G.me ? ' (tú)' : ''), t.sx, t.sy, colorOf(id));
      }
    }

    // efectos
    G.fx = G.fx.filter((f) => now - f.t0 < 900);
    for (const f of G.fx) {
      const k = (now - f.t0) / 900;
      const [x, y] = toS(f.x, f.y);
      ctx.globalAlpha = 1 - k;
      if (f.kind === 'burst') {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x, y, 10 + k * (60 + i * 30), 0, TAU);
          ctx.lineWidth = 5 - i;
          ctx.strokeStyle = f.color;
          ctx.stroke();
        }
      } else if (f.kind === 'text') {
        ctx.font = '400 26px "Lilita One", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#1b1530';
        ctx.strokeText(f.text, x, y - 20 - k * 30);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, x, y - 20 - k * 30);
      } else if (f.kind === 'swatch') {
        ctx.beginPath();
        ctx.arc(x, y, 14 + k * 16, 0, TAU);
        ctx.fillStyle = f.color;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // cursor
    const h = G.hover;
    if (h && !(action && (action.type === 'pan' || action.type === 'pinch')) && !G.spaceDown && G.tool !== 'hand') {
      if (canEdit() && G.tool === 'pick') {
        const c = colorAt(h.x, h.y);
        if (c) {
          ctx.beginPath();
          ctx.arc(h.sx, h.sy - 30, 16, 0, TAU);
          ctx.fillStyle = c;
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#1b1530';
          ctx.beginPath();
          ctx.arc(h.sx, h.sy - 30, 18, 0, TAU);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(h.sx, h.sy, 3, 0, TAU);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.stroke();
        }
      } else if (canEdit() && G.fig.locked) {
        const r = Math.max(2, (G.size / 2) * v.s);
        ctx.beginPath();
        ctx.arc(h.sx, h.sy, r, 0, TAU);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(27,21,48,.8)';
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else if (ph === 'seek' && G.seek && G.seek.participant && !G.seek.done) {
        ctx.beginPath();
        ctx.arc(h.sx, h.sy, 15, 0, TAU);
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = 'rgba(255,255,255,.75)';
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ff3d55';
        ctx.stroke();
      }
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (G.screen !== 'scr-game') return;
    updateTimer(now);
    draw(now);
    Tutorial.update(now);
  }

  // ---------------------------------------------------------------- mensajes del servidor / sala
  function onMessage(m) {
    switch (m.t) {
      case 'welcome':
        cancelBotPainting();
        G.me = m.you;
        G.code = m.code;
        if (G.mode === 'online') {
          setBusy(false);
          showOnlineNotice(null);
          history.replaceState(history.state, '', '?sala=' + m.code);
        }
        break;
      case 'room':
        if (G.room && (G.room.hostId !== m.hostId || G.room.round !== m.round)) cancelBotPainting();
        G.room = m;
        syncArtPrefetch(m.settings.collection);
        if (G.mode === 'online' && m.phase === 'lobby' && (G.phase === 'none' || G.phase === 'lobby')) {
          G.phase = 'lobby';
          if (G.screen !== 'scr-lobby') showScreen('scr-lobby');
        }
        renderLobby();
        updateHudSub();
        if (G.screen === 'scr-game') updateControls();
        break;
      case 'phase':
        if (G.mode === 'online') {
          if (!onlineBotPhase || onlineBotPhase.round !== m.round || onlineBotPhase.seed !== m.seed || !['prepare', 'hide', 'check'].includes(m.phase)) cancelBotPainting();
          onlineBotPhase = { round: m.round, seed: m.seed, phase: m.phase };
        }
        if (m.phase === 'prepare' && m.collection === 1 && G.mode === 'cpu' && G.localRoom) {
          cpuArtDeck = G.localRoom.deckState();
          store.set('artDeck', cpuArtDeck);
        }
        enterPhase(m);
        break;
      case 'botPaint':
        paintOnlineBots(m);
        break;
      case 'collect':
        if (G.phase === 'check' || G.phase === 'hide') sendFigure('figure');
        break;
      case 'found':
        onFound(m);
        break;
      case 'notice':
        toast(m.msg);
        break;
      case 'error':
        if (!G.me) {
          $('#online-err').textContent = m.msg;
          setBusy(false);
          if (G.link) G.link.close();
          G.link = null;
          G.mode = null;
        } else {
          toast(m.msg, 'bad');
        }
        break;
      default:
        break;
    }
  }

  function renderLobby() {
    if (!G.room || G.mode !== 'online') return;
    const r = G.room;
    $('#lobby-code').textContent = r.code;
    const box = $('#lobby-players');
    box.replaceChildren();
    for (const p of r.players) {
      const chip = el('div', 'player-chip' + (p.connected ? '' : ' off') + (p.id === G.me ? ' me' : ''));
      const av = el('div', 'avatar');
      av.style.setProperty('--c', PLAYER_COLORS[p.color % PLAYER_COLORS.length]);
      const info = el('div');
      info.style.minWidth = '0';
      info.append(el('div', 'pname', p.name));
      const tags = [];
      if (p.id === r.hostId) tags.push('anfitrión');
      if (p.id === G.me) tags.push('tú');
      if (p.bot) tags.push('CPU · ' + Bots.profile(p.botLevel).name);
      if (!p.connected) tags.push('desconectado');
      if (tags.length) info.append(el('div', 'tag', tags.join(' · ')));
      chip.append(av, info);
      box.append(chip);
    }
    const isHost = r.hostId === G.me;
    updateCollectionTimes($('#lobby-settings'), r.settings.collection);
    const humanCount = r.players.filter((p) => !p.bot).length;
    const botCapacity = window.HideRoom.MAX_PLAYERS - humanCount;
    $$('[data-room]').forEach((seg) => {
      const key = seg.dataset.room;
      const disabled = !isHost || r.phase !== 'lobby' || (key === 'difficulty' && r.settings.collection === 1);
      seg.classList.toggle('locked', disabled);
      seg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', Number(b.dataset.v) === r.settings[key]);
        b.disabled = disabled || (key === 'bots' && Number(b.dataset.v) > botCapacity);
      });
    });
    $('#room-bot-help').textContent = `Hasta ${botCapacity} CPU con ${humanCount} ${humanCount === 1 ? 'persona' : 'personas'} en la sala. Máximo ${window.HideRoom.MAX_PLAYERS} participantes.`;
    $('#room-paint-help').textContent = paintingHelp(r.settings.collection, r.settings.difficulty);
    const count = r.players.filter((p) => p.connected).length;
    const start = $('#btn-lobby-start');
    start.hidden = !isHost;
    start.disabled = count < 2;
    $('#lobby-hint').textContent = isHost
      ? (count < 2 ? 'Comparte el código o el enlace con tus amigos (mínimo 2 jugadores).' : `¡${count} jugadores listos! Pulsa Empezar cuando queráis.`)
      : 'Esperando a que el anfitrión empiece la partida…';
  }

  // ---------------------------------------------------------------- entrar y salir
  function setBusy(b) {
    $('#btn-create').disabled = b;
    $('#btn-join').disabled = b;
    $('#btn-online-retry').disabled = b;
  }

  function showOnlineNotice(kind) {
    $('#online-offline').hidden = kind !== 'file';
    $('#online-static').hidden = kind !== 'unavailable';
    $('#online-forms').hidden = kind === 'file';
  }

  function leaveGame() {
    phaseRevision++;
    syncArtPrefetch(0);
    if (confirmCancel) confirmCancel();
    cancelBotPainting();
    onlineBotPhase = null;
    // Al volver al menú desaparece el control: salimos también de pantalla completa.
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreen === document.documentElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    }
    if (G.link) G.link.close();
    G.link = null;
    setBusy(false);
    G.bots.forEach((b) => b.destroy());
    G.bots = [];
    if (G.localRoom) G.localRoom.destroy();
    G.localRoom = null;
    G.mode = null;
    G.me = null;
    G.code = null;
    G.room = null;
    G.phase = 'none';
    G.round = 0;
    G.figRound = -1;
    G.seek = null;
    G.figs = {};
    G.painting = null;
    G.phaseMsg = null;
    G.results = null;
    G.stroke = null;
    action = null;
    pointers.clear();
    closePopovers();
    renderMenuBackground();
    showScreen('scr-menu');
    BackGuard.release();
  }

  const savedCpu = store.get('cpu', {}) || {};
  const cpuOpts = Object.assign({ bots: 1, diff: 'normal', rounds: 3, hideTime: 90, seekTime: 30, collection: 0, difficulty: 1 }, savedCpu);
  // Conserva las preferencias guardadas por la versión publicada de las galerías.
  if (savedCpu.collection == null && savedCpu.gallery === 'arte') cpuOpts.collection = 1;
  let cpuArtDeck = store.get('artDeck', null);
  for (const [key, fallback] of Object.entries({ bots: 1, rounds: 3, collection: 0, difficulty: 1 })) {
    const choices = key === 'bots' ? [1, 2, 3, 4, 5, 6, 7] : window.HideRoom.LIMITS[key];
    if (!choices.includes(cpuOpts[key])) cpuOpts[key] = fallback;
  }
  const cpuCollection = collectionOf(cpuOpts.collection);
  if (!cpuCollection.hideTime.includes(cpuOpts.hideTime)) cpuOpts.hideTime = cpuCollection.hideDefault;
  if (savedCpu.seekTime == null || !cpuCollection.seekTime.includes(cpuOpts.seekTime)) cpuOpts.seekTime = cpuCollection.seekDefault;
  cpuOpts.diff = Bots.profile(cpuOpts.diff).key;

  function markSeg(seg, value) {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(value)));
  }

  function updateCollectionTimes(container, collection) {
    const info = collectionOf(collection);
    for (const key of ['hideTime', 'seekTime']) {
      container.querySelectorAll(`[data-cpu="${key}"] button, [data-room="${key}"] button`).forEach((b) => {
        b.hidden = !info[key].includes(Number(b.dataset.v));
      });
    }
  }

  function paintingHelp(collection, difficulty) {
    if (collection === 1) return HumanArt.works.length + ' obras de dominio público, con autor y fuente. Se recortan para el tablero; conservan sus colores y texturas originales.';
    return [
      'Zonas amplias de color: empieza practicando la posición y el pincel.',
      'Trazos que cruzan la figura: combina el color del fondo con sus detalles.',
      'Tramas más densas y contrastadas: usa pinceles pequeños y elige colores del cuadro.',
    ][difficulty ?? 1];
  }

  function updateCpuPaintingOptions() {
    if (G.screen === 'scr-cpu') syncArtPrefetch(cpuOpts.collection);
    updateCollectionTimes($('#scr-cpu'), cpuOpts.collection);
    markSeg($('[data-cpu="hideTime"]'), cpuOpts.hideTime);
    markSeg($('[data-cpu="seekTime"]'), cpuOpts.seekTime);
    $$('[data-cpu="difficulty"] button').forEach((b) => { b.disabled = cpuOpts.collection === 1; });
    $('#cpu-paint-help').textContent = paintingHelp(cpuOpts.collection, cpuOpts.difficulty);
  }

  function startCpu() {
    if (G.screen !== 'scr-cpu' || G.mode === 'cpu') return;
    if (G.link) leaveGame();
    store.set('cpu', cpuOpts);
    const room = new Room('CPU', {
      settings: { rounds: cpuOpts.rounds, hideTime: cpuOpts.hideTime, seekTime: cpuOpts.seekTime, difficulty: cpuOpts.difficulty, collection: cpuOpts.collection, bots: 0 },
      deckState: cpuOpts.collection === 1 ? store.get('artDeck', cpuArtDeck) : undefined,
    });
    G.mode = 'cpu';
    G.localRoom = room;
    G.link = new LocalLink(room, onMessage);
    G.link.join({ name: playerName(), pid: G.pid });
    const names = shuffle(BOT_NAMES);
    for (let i = 0; i < cpuOpts.bots; i++) G.bots.push(new Bot(room, names[i], cpuOpts.diff));
    G.link.send({ t: 'start' });
  }

  function connectOnline(hello) {
    if (G.mode === 'online' && G.link && !G.link.ready) return;
    if (G.link) leaveGame();
    showScreen('scr-online');
    showOnlineNotice(null);
    $('#online-err').textContent = '';
    setBusy(true);
    G.mode = 'online';
    const returnOnline = (message, unavailable) => {
      const code = G.code;
      leaveGame();
      if (code) $('#in-code').value = code;
      showScreen('scr-online');
      showOnlineNotice(unavailable ? 'unavailable' : null);
      $('#online-err').textContent = message;
    };
    G.link = new NetLink(hello, onMessage, (state, message) => {
      if (state === 'failed' || state === 'lost') {
        returnOnline(state === 'lost' ? 'Se perdió la conexión. Puedes volver a unirte o crear otra sala.' : '', true);
      } else if (state === 'rejected') {
        returnOnline(message || 'La sala ya no está disponible. Puedes crear otra.', false);
      } else if (state === 'reconnecting') {
        toast('Conexión perdida. Reconectando…', 'bad');
      } else if (state === 'open') {
        toast('¡Reconectado!', 'good');
      }
    });
  }

  // ---------------------------------------------------------------- tutorial
  // Una ronda de práctica guiada por Pincelín. El propio tutorial hace de servidor: envía las fases
  // al cliente como lo haría una sala, y avanza de paso cuando el jugador hace lo que se le pide.

  class TutorialLink {
    constructor(tut) { this.tut = tut; }
    send(msg) {
      const m = structuredClone(msg);
      setTimeout(() => this.tut.onClientMessage(m), 0);
    }
    close() { this.tut.stop(); }
  }

  function tutEvent(name) {
    if (Tutorial.active) Tutorial.flags[name] = (Tutorial.flags[name] || 0) + 1;
  }

  /** Rectángulo en pantalla de una figura del cuadro (recortado a la parte visible del lienzo). */
  function figScreenRect(x, y, pose) {
    const b = Figure.shape(pose).bbox;
    const r = view.getBoundingClientRect();
    const v = G.view;
    const x0 = Math.max(r.left, r.left + v.ox + (x + b.x0) * v.s);
    const y0 = Math.max(r.top, r.top + v.oy + (y + b.y0) * v.s);
    const x1 = Math.min(r.right, r.left + v.ox + (x + b.x1) * v.s);
    const y1 = Math.min(r.bottom, r.top + v.oy + (y + b.y1) * v.s);
    if (x1 - x0 < 4 || y1 - y0 < 4) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function elRect(sel) {
    const e = $(sel);
    if (!e || !e.offsetParent) return null;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function tutorialSteps(T) {
    const elapsed = () => (performance.now() - T.stepStart) / 1000;
    return [
      {
        id: 'intro', center: true, next: '¡Vamos!',
        title: '¡Hola! Soy Pincelín',
        text: 'Te enseño a jugar en un minuto. En cada ronda todos os escondéis en el mismo cuadro… ¡pintándoos para camuflaros!',
      },
      {
        id: 'move', target: 'figure',
        title: 'Esta es tu figura',
        text: () => (G.fig.locked ? 'Pulsa Desbloquear y arrástrala' : 'Arrástrala')
          + ' a otro sitio del cuadro. Truco: donde hay pocos colores es más fácil esconderse.',
        enter: () => { T.from = { x: G.fig.x, y: G.fig.y }; },
        done: () => Math.hypot(G.fig.x - T.from.x, G.fig.y - T.from.y) >= 40,
        nextWhen: () => elapsed() > 20,
      },
      {
        id: 'pose', target: () => ($('#pop-poses').hidden ? '#tb-poses' : '#pop-poses'),
        title: 'Elige una pose',
        text: () => (T.since('posed') > 0
          ? '¡Bien! Prueba las que quieras y toca fuera del menú para cerrarlo.'
          : 'Pulsa Poses y prueba otra postura. Algunas encajan mejor en las formas del cuadro.'),
        done: () => T.since('posed') > 0 && $('#pop-poses').hidden,
        next: 'Saltar paso',
      },
      {
        id: 'lock', target: '#tb-lock',
        title: 'Bloquéala',
        text: 'Cuando te guste el sitio, pulsa Bloquear: la figura se queda quieta y ya puedes pintarla.',
        done: () => G.fig.locked,
      },
      {
        id: 'pick', target: () => (G.tool === 'pick' ? 'figure' : '.stool[data-act="pick"]'),
        title: 'Copia un color',
        text: () => (G.tool === 'pick'
          ? 'Ahora toca el cuadro justo al lado de tu figura para copiar ese color.'
          : 'Pulsa Elegir color y después toca el cuadro justo al lado de tu figura.'),
        done: () => T.since('picked') > 0,
        nextWhen: () => elapsed() > 25,
      },
      {
        id: 'paint', target: 'figure', meter: true,
        title: '¡A pintar!',
        text: () => (G.fig.locked
          ? 'Pinta encima de tu figura. Si el fondo cambia de color, copia el nuevo color y sigue pintando.'
          : 'Pulsa Bloquear para poder pintar tu figura.'),
        done: () => T.blend >= 85,
        nextWhen: () => T.since('stroke') >= 3,
      },
      {
        id: 'zoom', target: '.stool[data-act="zoomin"]', meter: true, next: 'Siguiente',
        title: 'Los detalles',
        text: 'Acércate con la lupa (o con la rueda del ratón o pellizcando) para repasar los bordes. Si te equivocas, pulsa Deshacer.',
        done: () => T.since('zoom') > 0,
      },
      {
        id: 'ready', target: '#tb-ready', meter: true,
        title: '¿Terminaste?',
        text: 'Pinta todo lo que quieras. Cuando estés contento con tu camuflaje, pulsa ¡Listo!',
      },
      {
        id: 'check', target: '.check-card', ring: false, next: 'Siguiente',
        title: 'Tu mezcla',
        text: () => `Tu figura se parece al cuadro en un ${Math.round(G.myBlend)}%. Cuanto más alto, más difícil será que te encuentren.`,
        onNext: () => T.startSeek(),
      },
      {
        id: 'seek', target: () => (T.hint ? 'hint' : 'frame'), ring: () => !!T.hint,
        title: '¡Ahora busca tú!',
        text: () => (T.hint
          ? 'Pista: estoy dentro del círculo amarillo. ¡Tócame!'
          : 'Me he escondido en el cuadro. ¡Encuéntrame y tócame! Ojo: cada fallo resta 2 segundos.'),
        nextWhen: () => (!T.hint && elapsed() > 8) || elapsed() > 40,
        nextLabel: () => (T.hint ? 'Enséñame dónde está' : 'Dame una pista'),
        onNext: () => {
          if (!T.hint) T.giveHint();
          else { T.foundTime = null; T.goId('found'); }
        },
        tick: () => { if (!T.hint && elapsed() > 25) T.giveHint(); },
      },
      {
        id: 'found', target: 'botfig', next: 'Siguiente',
        title: () => (T.foundTime != null ? '¡Me encontraste!' : '¡Estaba aquí!'),
        text: () => (T.foundTime != null
          ? `Tardaste ${T.foundTime.toFixed(1)} s. En una partida de verdad tendrás poco tiempo para encontrar a todos.`
          : 'A la próxima seguro que me encuentras: busca bordes que no encajan y manchas blancas.'),
        onNext: () => T.showResults(),
      },
      {
        id: 'results', target: '.results', ring: false, next: 'Siguiente',
        title: 'Temporizadores',
        text: () => (T.botTime < 30
          ? `Yo tardé ${T.botTime.toFixed(1)} s en encontrarte. Encontrar rápido da puntos… ¡y que no te encuentren, también!`
          : '¡No te encontré! Por eso ganas 150 puntos extra. Encontrar rápido a los demás también da puntos.'),
      },
      {
        id: 'end', center: true, end: true,
        title: '¡Ya sabes jugar! 🏆',
        text: 'Practica contra la CPU o invita a tus amigos a una sala. ¡Que no te encuentren!',
      },
    ];
  }

  const Tutorial = {
    active: false,
    i: -1,
    steps: [],
    flags: {},
    snap: {},
    blend: 0,
    lastCheck: 0,
    stepStart: 0,
    from: null,
    hint: null,
    myFig: null,
    botFig: null,
    foundTime: null,
    botTime: 99,
    invite: '',
    cardW: 0,

    start() {
      const inv = (new URLSearchParams(location.search).get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (G.link) leaveGame();
      store.set('tutorialSeen', true);
      Object.assign(this, {
        active: true, flags: {}, snap: {}, blend: 0, lastCheck: 0, hint: null, myFig: null, botFig: null,
        foundTime: null, botTime: 99, cardW: 0, invite: inv.length === 4 ? inv : '',
      });
      this.steps = tutorialSteps(this);
      G.mode = 'tutorial';
      G.link = new TutorialLink(this);
      G.figRound = -1;
      document.body.classList.add('tutorial');
      const me = { id: 'me', name: playerName(), score: 0, connected: true, bot: false, ready: false, active: true, color: 0 };
      const bot = { id: 'bot', name: 'Pincelín', score: 0, connected: true, bot: true, ready: true, active: true, color: 1 };
      this.deliver({ t: 'welcome', you: 'me', code: 'TUTORIAL' });
      this.deliver({
        t: 'room', code: 'TUTORIAL', hostId: 'me', settings: { rounds: 1, hideTime: 120, seekTime: 30 },
        phase: 'hide', round: 1, players: [me, bot],
      });
      this.phase('hide');
      this.go(0);
    },

    /** Lo llama la conexión al cerrarse (salir, saltar o terminar). */
    stop() {
      if (!this.active) return;
      this.active = false;
      this.i = -1;
      $('#coach').hidden = true;
      $('#coach-ring').hidden = true;
      $('#coach-backdrop').hidden = true;
      document.body.classList.remove('tutorial');
      $('#stage').classList.remove('tut-narrow');
    },

    finish(next) {
      const invite = this.invite;
      leaveGame();
      if (next === 'cpu') {
        showScreen('scr-cpu');
      } else if (next === 'online' || next === 'join') {
        $('#btn-online').onclick();
        if (next === 'join' && invite) {
          $('#in-code').value = invite;
          connectOnline({ t: 'join', code: invite, name: playerName(), pid: G.pid });
        }
      }
    },

    deliver(msg) {
      const m = structuredClone(msg);
      setTimeout(() => { if (this.active) onMessage(m); }, 0);
    },

    phase(name, extra) {
      this.deliver(Object.assign({
        t: 'phase', phase: name, round: 1, rounds: 1, painting: TUT_PAINTING, seed: TUT_SEED, duration: null,
      }, extra || {}));
    },

    since(name) { return (this.flags[name] || 0) - (this.snap[name] || 0); },

    go(i) {
      this.i = i;
      this.stepStart = performance.now();
      this.snap = Object.assign({}, this.flags);
      const s = this.steps[i];
      if (s.enter) s.enter();
      this.render();
    },

    goId(id) { this.go(this.steps.findIndex((s) => s.id === id)); },

    next() {
      const s = this.steps[this.i];
      Sound.pop();
      if (s.onNext) s.onNext();
      else this.go(this.i + 1);
    },

    onClientMessage(m) {
      if (!this.active) return;
      if (m.t === 'submit' && G.phase === 'hide') {
        this.myFig = m.fig;
        closePopovers();
        this.phase('check');
        this.goId('check');
      } else if (m.t === 'found' && G.phase === 'seek' && m.target === 'bot') {
        this.foundTime = m.time;
        this.goId('found');
      }
    },

    startSeek() {
      // Pincelín se esconde (con camuflaje fácil) lejos de donde se escondió el jugador
      const p = getPainting(TUT_PAINTING, TUT_SEED);
      const b = Figure.shape(1).bbox;
      const mine = this.myFig;
      const mx = mine ? mine.x + FB / 2 : PW / 2;
      const my = mine ? mine.y + FB / 2 : PH / 2;
      let best = null;
      for (let k = 0; k < 30; k++) {
        const x = Math.round(-b.x0 + 40 + Math.random() * (PW - (b.x1 - b.x0) - 80));
        const y = Math.round(-b.y0 + 40 + Math.random() * (PH - (b.y1 - b.y0) - 80));
        const d = Math.hypot(x + FB / 2 - mx, y + FB / 2 - my);
        if (!best || d > best.d) best = { x, y, d };
        if (d > 300) break;
      }
      this.botFig = makeBotFigure(p, BOT_LEVELS.easy, { pose: 1, x: best.x, y: best.y });
      this.hint = null;
      this.phase('seek', {
        limit: 999000, figs: { me: mine, bot: this.botFig }, participants: ['me', 'bot'],
      });
      this.goId('seek');
    },

    giveHint() {
      const f = this.botFig;
      const b = Figure.shape(f.pose).bbox;
      this.hint = {
        x: f.x + (b.x0 + b.x1) / 2 + randInt(-35, 35),
        y: f.y + (b.y0 + b.y1) / 2 + randInt(-35, 35),
        r: 140,
      };
      Sound.pop();
      this.render();
    },

    showResults() {
      const mine = this.myFig;
      const bot = this.botFig;
      const t = this.foundTime;
      const limit = Math.max(30, Math.ceil(t || 0) + 1);
      // Pincelín busca con la misma fórmula que un bot «Normal», sin azar
      const vis = 1 - (mine ? mine.blend : 0) / 100;
      this.botTime = Math.round((1.5 + 50 * Math.pow(Math.max(0, 1 - vis / 0.4), 2.5)) * 100) / 100;
      const finds = [];
      if (t != null) finds.push({ seeker: 'me', target: 'bot', time: t });
      if (this.botTime < 30) finds.push({ seeker: 'bot', target: 'me', time: this.botTime });
      const pts = window.HideRoom.scoreRound(['me', 'bot'], finds, limit);
      const entry = (id, name, color, fig) => {
        const own = finds.filter((f) => f.seeker === id);
        return {
          id, name, color, bot: id === 'bot', found: own.length, targets: 1,
          time: own.length ? own[0].time : null,
          foundBy: finds.filter((f) => f.target === id).map((f) => ({ id: f.seeker, time: f.time })),
          blend: fig ? fig.blend : 0, roundPts: pts[id], score: pts[id],
        };
      };
      const results = [entry('me', playerName(), 0, mine), entry('bot', 'Pincelín', 1, bot)]
        .sort((a, b) => b.roundPts - a.roundPts);
      this.phase('results', { results, finds, limit: limit * 1000, figs: { me: mine, bot }, last: true });
      this.goId('results');
    },

    render() {
      const s = this.steps[this.i];
      const card = $('#coach');
      card.hidden = false;
      $('#coach-progress-fill').style.width = ((this.i + 1) / this.steps.length) * 100 + '%';
      this.renderText();
      $('#coach-meter').hidden = !s.meter;
      const actions = $('#coach-actions');
      actions.replaceChildren();
      if (s.end) {
        const col = el('div', 'coach-end');
        const add = (label, cls, next) => {
          const b = el('button', 'btn ' + cls, label);
          b.onclick = () => this.finish(next);
          col.append(b);
        };
        if (this.invite) add(`Unirme a la sala ${this.invite}`, 'green', 'join');
        add('Jugar contra la CPU', this.invite ? 'blue' : 'green', 'cpu');
        if (!this.invite) add('Multijugador en línea', 'blue', 'online');
        add('Volver al menú', 'ghost', 'menu');
        actions.append(col);
      } else {
        const skip = el('button', 'coach-skip', 'Saltar tutorial');
        skip.onclick = () => this.finish('menu');
        const next = el('button', 'btn green small');
        next.id = 'coach-next';
        next.onclick = () => this.next();
        actions.append(skip, next);
        this.updateNext();
      }
      this.place();
    },

    renderText() {
      const s = this.steps[this.i];
      const val = (v) => (typeof v === 'function' ? v() : v);
      const title = val(s.title);
      const text = val(s.text);
      if ($('#coach-title').textContent !== title) $('#coach-title').textContent = title;
      if ($('#coach-text').textContent !== text) $('#coach-text').textContent = text;
    },

    updateNext() {
      const s = this.steps[this.i];
      const b = $('#coach-next');
      if (!b) return;
      b.hidden = !(s.next || (s.nextWhen && s.nextWhen()));
      const label = s.nextLabel ? s.nextLabel() : s.next || 'Siguiente';
      if (b.textContent !== label) b.textContent = label;
    },

    /** Cada fotograma: comprueba si el paso está hecho y recoloca la tarjeta y el anillo. */
    update(now) {
      if (!this.active || this.i < 0) return;
      const s = this.steps[this.i];
      if (now - this.lastCheck > 150) {
        this.lastCheck = now;
        if (s.meter && G.phase === 'hide' && G.painting) {
          this.blend = computeBlend(G.figCtx.getImageData(0, 0, FB, FB).data, G.fig.x, G.fig.y, G.painting);
          $('#coach-meter-fill').style.width = this.blend + '%';
          $('#coach-meter-pct').textContent = Math.round(this.blend) + '%';
        }
        if (s.tick) s.tick();
        if (this.steps[this.i] !== s) return;
        if (s.done && s.done()) {
          Sound.ready();
          this.go(this.i + 1);
          return;
        }
        this.renderText();
        this.updateNext();
      }
      this.place();
    },

    hintRect() {
      if (!this.hint) return null;
      const r = view.getBoundingClientRect();
      const v = G.view;
      const R = this.hint.r * v.s;
      return { x: r.left + v.ox + this.hint.x * v.s - R, y: r.top + v.oy + this.hint.y * v.s - R, w: R * 2, h: R * 2 };
    },

    place() {
      const s = this.steps[this.i];
      const card = $('#coach');
      const ring = $('#coach-ring');
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      $('#coach-backdrop').hidden = !s.center;

      const tgt = typeof s.target === 'function' ? s.target() : s.target;
      let rect = null;
      if (tgt === 'figure') rect = figScreenRect(G.fig.x, G.fig.y, G.fig.pose);
      else if (tgt === 'botfig') rect = this.botFig && figScreenRect(this.botFig.x, this.botFig.y, this.botFig.pose);
      else if (tgt === 'hint') rect = this.hintRect();
      else if (tgt === 'frame') rect = elRect('#frame');
      else if (tgt) rect = elRect(tgt);
      const wantRing = typeof s.ring === 'function' ? s.ring() : s.ring !== false;
      const showRing = !!rect && wantRing && !s.center;
      ring.hidden = !showRing;
      if (showRing) {
        const circle = tgt === 'hint';
        const pad = circle ? 0 : 6;
        ring.classList.toggle('circle', circle);
        ring.style.left = rect.x - pad + 'px';
        ring.style.top = rect.y - pad + 'px';
        ring.style.width = rect.w + pad * 2 + 'px';
        ring.style.height = rect.h + pad * 2 + 'px';
      }

      const fr = $('#frame').getBoundingClientRect();
      const side = vw - fr.right >= TUT_SIDE_MIN;
      const w = s.center ? Math.min(380, vw - 24) : side ? Math.min(330, vw - fr.right - 28) : Math.min(420, vw - 20);
      if (this.cardW !== w) {
        card.style.width = w + 'px';
        this.cardW = w;
      }
      const ch = card.offsetHeight;
      let x;
      let y;
      if (s.center) {
        x = (vw - w) / 2;
        y = (vh - ch) / 2;
      } else if (side) {
        // a la derecha del cuadro, a la altura de lo que señala
        x = fr.right + 16;
        y = clamp((rect ? rect.y + rect.h / 2 : fr.top + fr.height / 2) - ch / 2, 10, vh - ch - 10);
      } else {
        // pantallas estrechas: debajo del cuadro, o arriba del todo si hay un menú abierto
        x = (vw - w) / 2;
        if (!$('#pop-poses').hidden || !$('#pop-brush').hidden) y = 8;
        else y = Math.max(8, Math.min(fr.bottom + 12, $('.controls').getBoundingClientRect().top - ch - 2));
        // si taparía justo lo que señala, mejor arriba del todo
        const covers = (top) => !!rect && top < rect.y + rect.h && top + ch > rect.y;
        if (covers(y) && !covers(8)) y = 8;
      }
      card.style.left = Math.round(x) + 'px';
      card.style.top = Math.round(y) + 'px';
    },
  };

  // ---------------------------------------------------------------- navegación
  // Una sola entrada propia permite volver al menú; al salir se consume, sin acumular guardas.
  const BackGuard = {
    armed: !!history.state?.eepGuard,
    releasing: false,
    arm() {
      if (this.armed || this.releasing) return;
      if (history.state?.eepGuard) { this.armed = true; return; }
      try {
        history.pushState({ eepGuard: true }, '', G.mode === 'online' && G.code ? '?sala=' + G.code : location.href);
        this.armed = true;
      } catch { /* sin historial disponible */ }
    },
    release() {
      if (this.releasing) return;
      if (history.state?.eepGuard) {
        this.armed = false;
        this.releasing = true;
        history.back();
      } else {
        history.replaceState(null, '', location.pathname);
      }
    },
  };

  window.addEventListener('popstate', async (e) => {
    if (BackGuard.releasing) {
      BackGuard.releasing = false;
      // Las versiones anteriores podían acumular guardas; consumirlas también evita atraparse tras recargar.
      if (e.state?.eepGuard) { BackGuard.armed = true; BackGuard.release(); return; }
      history.replaceState(null, '', location.pathname);
      if (G.screen !== 'scr-menu') BackGuard.arm();
      return;
    }
    if (e.state?.eepGuard && !BackGuard.armed) { BackGuard.armed = true; return; }
    if (!BackGuard.armed) return;
    BackGuard.armed = false;
    if (confirmCancel) { confirmCancel(); BackGuard.arm(); return; }
    if (!$('#howto').hidden || !$('#welcome').hidden) {
      $('#howto').hidden = true;
      if (!$('#welcome').hidden) { $('#welcome').hidden = true; store.set('tutorialSeen', true); }
      BackGuard.arm();
      return;
    }
    if (G.screen === 'scr-menu') return;
    if (G.mode === 'tutorial') {
      BackGuard.arm();
      if (await confirmBox('¿Salir del tutorial?')) Tutorial.finish('menu');
    } else if (G.screen === 'scr-game' || (G.mode === 'online' && ['scr-lobby', 'scr-final'].includes(G.screen))) {
      BackGuard.arm();
      if (await confirmBox(G.screen === 'scr-game' ? '¿Salir de la partida?' : '¿Salir de la sala?')) leaveGame();
    } else leaveGame();
  });

  window.addEventListener('beforeunload', (e) => {
    if (!((G.mode === 'online' && G.me) || (G.mode === 'cpu' && G.screen === 'scr-game'))) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------------------------------------------------------------- botones
  function bindSeg(selector, getVal, onPick) {
    $$(selector).forEach((seg) => {
      const key = seg.dataset.cpu || seg.dataset.room;
      seg.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => onPick(key, b.dataset.v, seg));
      });
      const cur = getVal(key);
      if (cur != null) seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(cur) === b.dataset.v));
    });
  }

  function init() {
    const names = [$('#in-name'), $('#in-name-online')];
    names.forEach((inp) => {
      inp.value = store.get('name', '');
      inp.addEventListener('input', () => {
        names.forEach((o) => { if (o !== inp) o.value = inp.value; });
        store.set('name', inp.value);
      });
    });
    if (Sound.muted) document.body.classList.add('muted');

    buildPoseGrid();
    buildBrushPanel();
    renderSwatches($('#recent'), []);
    renderMenuBackground();

    $('#btn-cpu').onclick = () => { Sound.unlock(); showScreen('scr-cpu'); };
    $('#btn-online').onclick = () => {
      Sound.unlock();
      const offline = location.protocol === 'file:';
      showOnlineNotice(offline ? 'file' : null);
      $('#online-err').textContent = '';
      showScreen('scr-online');
      if (offline) return;
      setBusy(false);
      setTimeout(() => $('#in-code').focus(), 50);
      serverAvailable().then((ok) => {
        if (G.screen === 'scr-online' && !G.link) showOnlineNotice(ok ? null : 'unavailable');
      });
    };
    $('#btn-online-retry').onclick = () => {
      setBusy(true);
      serverAvailable().then((ok) => {
        if (G.screen !== 'scr-online' || G.link) return;
        setBusy(false);
        showOnlineNotice(ok ? null : 'unavailable');
        if (ok) $('#online-err').textContent = '';
      });
    };
    $('#btn-howto').onclick = () => { $('#howto').hidden = false; };
    $('#btn-howto-close').onclick = () => { $('#howto').hidden = true; };
    $('#btn-howto-tutorial').onclick = () => { $('#howto').hidden = true; Sound.unlock(); Tutorial.start(); };
    $('#btn-welcome-yes').onclick = () => { $('#welcome').hidden = true; Sound.unlock(); Tutorial.start(); };
    $('#btn-welcome-no').onclick = () => { $('#welcome').hidden = true; store.set('tutorialSeen', true); };
    $('#howto').addEventListener('click', (e) => { if (e.target.id === 'howto') $('#howto').hidden = true; });
    $$('[data-back]').forEach((b) => { b.onclick = () => leaveGame(); });

    bindSeg('[data-cpu]', (k) => cpuOpts[k], (key, val, seg) => {
      cpuOpts[key] = key === 'diff' ? val : Number(val);
      if (key === 'collection') {
        const info = collectionOf(cpuOpts.collection);
        cpuOpts.hideTime = info.hideDefault;
        cpuOpts.seekTime = info.seekDefault;
      }
      markSeg(seg, val);
      store.set('cpu', cpuOpts);
      updateCpuPaintingOptions();
    });
    updateCpuPaintingOptions();
    bindSeg('[data-room]', () => null, (key, val) => {
      if (!G.room || G.room.hostId !== G.me || !G.link) return;
      G.link.send({ t: 'settings', [key]: Number(val) });
    });

    $('#btn-cpu-start').onclick = () => { Sound.unlock(); startCpu(); };
    $('#btn-create').onclick = () => connectOnline({ t: 'create', name: playerName(), pid: G.pid });
    const join = () => {
      const code = $('#in-code').value.toUpperCase().replace(/[^A-Z]/g, '');
      if (code.length !== 4) { $('#online-err').textContent = 'El código tiene 4 letras.'; return; }
      connectOnline({ t: 'join', code, name: playerName(), pid: G.pid });
    };
    $('#btn-join').onclick = join;
    $('#in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    $('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

    $('#btn-copy').onclick = async () => {
      const url = location.origin + location.pathname + '?sala=' + G.code;
      try {
        await navigator.clipboard.writeText(url);
        toast('¡Enlace copiado!', 'good');
      } catch {
        toast(url);
      }
    };
    $('#btn-lobby-start').onclick = () => { if (G.link) G.link.send({ t: 'start' }); };
    $('#btn-lobby-leave').onclick = () => leaveGame();

    $('#btn-final-again').onclick = () => { if (G.link) G.link.send({ t: 'start' }); };
    $('#btn-final-lobby').onclick = () => { if (G.link) G.link.send({ t: 'lobby' }); };
    $('#btn-final-menu').onclick = () => leaveGame();

    $('#btn-mute').onclick = () => {
      const m = Sound.toggle();
      document.body.classList.toggle('muted', m);
    };
    $('#btn-hurry').onclick = async () => {
      if (!(await confirmBox('¿Dar a todos 30 segundos para terminar de esconderse?', '¡30 segundos!', 'Todavía no'))) return;
      if (G.link && G.room?.hostId === G.me && G.phase === 'hide' && G.phaseEnd == null) G.link.send({ t: 'hurry' });
    };
    const fullscreenButtons = [$('#btn-fullscreen'), $('#btn-fullscreen-menu')];
    const fullscreenRoot = document.documentElement;
    const requestFullscreen = fullscreenRoot.requestFullscreen || fullscreenRoot.webkitRequestFullscreen;
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
    const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    const supported = !!(requestFullscreen && exitFullscreen && (document.fullscreenEnabled || document.webkitFullscreenEnabled));
    const iOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
    const syncFullscreen = () => {
      const active = !!fullscreenElement();
      document.body.classList.toggle('is-full', active);
      for (const button of fullscreenButtons) {
        button.hidden = !(supported || (iOS && !standalone));
        const label = supported ? (active ? 'Salir de pantalla completa' : 'Entrar en pantalla completa') : 'Cómo jugar a pantalla completa en iPhone';
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-label', label);
        button.title = label + (supported ? ' (F)' : '');
      }
      if (G.screen === 'scr-game') requestAnimationFrame(layout);
    };
    for (const button of fullscreenButtons) button.onclick = async () => {
      if (!supported) {
        toast('Para jugar a pantalla completa en iPhone: Compartir → «Añadir a pantalla de inicio» y ábrelo desde allí.');
        return;
      }
      fullscreenButtons.forEach((b) => { b.disabled = true; });
      try {
        if (fullscreenElement()) await exitFullscreen.call(document);
        else await requestFullscreen.call(fullscreenRoot, { navigationUI: 'hide' });
      } catch {
        toast('No se pudo cambiar la pantalla completa. Inténtalo de nuevo.', 'bad');
      } finally {
        fullscreenButtons.forEach((b) => { b.disabled = false; });
        syncFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    syncFullscreen();
    $('#btn-exit').onclick = async () => {
      if (G.mode === 'tutorial') {
        if (await confirmBox('¿Salir del tutorial?')) Tutorial.finish('menu');
        return;
      }
      if (await confirmBox('¿Salir de la partida?')) leaveGame();
    };

    // barra de herramientas
    $('#tb-poses').onclick = () => { if (canEdit()) togglePopover('#pop-poses'); };
    $('#tb-lock').onclick = () => setLocked(!G.fig.locked);
    $('#tb-brush').onclick = () => {
      if (!canEdit()) return;
      if (!G.fig.locked) setLocked(true, true);
      G.tool = 'brush';
      updateControls();
      togglePopover('#pop-brush');
    };
    $('#tb-ready').onclick = () => toggleReady();
    $('#side-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      switch (b.dataset.act) {
        case 'pick': if (canEdit() && !G.fig.locked) setLocked(true, true); setTool(G.tool === 'pick' ? 'brush' : 'pick'); break;
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'zoomin': zoomCenter(1.5); break;
        case 'zoomout': zoomCenter(1 / 1.5); break;
        case 'hand': setTool(G.tool === 'hand' ? 'brush' : 'hand'); break;
        default: break;
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.popover') || e.target.closest('#tb-poses') || e.target.closest('#tb-brush')) return;
      if (e.target === view) return;
      closePopovers();
    });

    $('#btn-peek').onclick = () => { $('#ov-results').hidden = true; $('#btn-unpeek').hidden = false; };
    $('#btn-unpeek').onclick = () => { $('#btn-unpeek').hidden = true; if (G.phase === 'results') $('#ov-results').hidden = false; };

    window.addEventListener('resize', () => { if (G.screen === 'scr-game') layout(); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (G.screen === 'scr-game') layout(); }).observe($('#stage'));

    // enlace de invitación ?sala=ABCD
    const code = new URLSearchParams(location.search).get('sala');
    const invite = code && location.protocol !== 'file:' ? code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : '';
    if (invite) {
      $('#in-code').value = invite;
      $('#btn-online').onclick();
    }

    // la primera vez que se abre el juego, ofrecemos el tutorial
    if (!store.get('tutorialSeen', false)) {
      if (invite) $('#welcome-text').textContent = `Antes de unirte a la sala ${invite}, Pincelín te enseña a jugar en un minuto.`;
      $('#welcome').hidden = false;
    }
    showScreen(G.screen === 'scr-online' ? 'scr-online' : G.screen);
    if (G.screen === 'scr-menu' && BackGuard.armed) BackGuard.release();
    requestAnimationFrame(loop);
  }

  init();
})();
