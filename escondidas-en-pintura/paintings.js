/*
 * Cuadros generados por código, con colores planos.
 * Son deterministas: con el mismo índice y semilla todos los jugadores ven exactamente el mismo cuadro.
 */
(function (root) {
  'use strict';

  const W = 800;
  const H = 800;
  const TAU = Math.PI * 2;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mkRand(seed) {
    const r = mulberry32(seed >>> 0);
    r.range = (a, b) => a + r() * (b - a);
    r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    r.shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    return r;
  }

  // ---------- ayudas de dibujo ----------
  function poly(ctx, pts, color) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function circle(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  /** Rellena todo lo que queda por debajo de la curva y = f(x). */
  function fillBelow(ctx, f, color, step = 8) {
    ctx.beginPath();
    ctx.moveTo(-20, H + 20);
    for (let x = -20; x <= W + 20; x += step) ctx.lineTo(x, f(x));
    ctx.lineTo(W + 20, H + 20);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function stroke(ctx, color, width, draw) {
    ctx.beginPath();
    draw();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ---------- 1. Ondas ----------
  const WAVE_PALETTES = [
    ['#0b1667', '#f24d6b', '#7fdcbc', '#f2c9a0', '#14d0dc'],
    ['#22223b', '#f2a541', '#f3ca40', '#577590', '#e56b6f'],
    ['#3d1a6e', '#ff5d8f', '#ffd23f', '#3bceac', '#0ead69'],
    ['#003049', '#d62828', '#f77f00', '#fcbf49', '#eae2b7'],
    ['#1b4332', '#95d5b2', '#ffd6a5', '#ff7b54', '#2d6a4f'],
  ];

  function ondas(ctx, r) {
    const pal = r.shuffle(r.pick(WAVE_PALETTES));
    const n = r.int(9, 12);
    const step = (H + 160) / n;
    const A = r.range(22, 46);
    const lam = r.range(380, 620);
    const A2 = r.range(4, 16);
    const lam2 = r.range(150, 260);
    const ph = r.range(0, TAU);
    const ph2 = r.range(0, TAU);
    const drift = r.range(0.25, 0.7);
    const tilt = r.range(-0.22, 0.22);
    rect(ctx, 0, 0, W, H, pal[0]);
    for (let i = 0; i < n; i++) {
      const base = -80 + i * step + r.range(-step * 0.18, step * 0.18);
      fillBelow(ctx, (x) => base
        + A * Math.sin((x / lam) * TAU + ph + i * drift)
        + A2 * Math.sin((x / lam2) * TAU + ph2 + i * 0.9)
        + tilt * (x - W / 2), pal[(i + 1) % pal.length]);
    }
  }

  // ---------- 2. Campamento ----------
  function pine(ctx, cx, top, base, halfW, layers, color) {
    const right = [];
    for (let k = 1; k <= layers; k++) {
      const y = top + ((base - top) * k) / layers;
      const w = (halfW * k) / layers;
      right.push([cx + w, y]);
      if (k < layers) right.push([cx + w * 0.42, y - ((base - top) / layers) * 0.08]);
    }
    const left = right.map(([x, y]) => [2 * cx - x, y]).reverse();
    poly(ctx, [[cx, top], ...right, [cx, base], ...left], color);
  }

  function flame(ctx, cx, by, w, h, color) {
    ctx.beginPath();
    ctx.moveTo(cx, by);
    ctx.bezierCurveTo(cx - w * 0.62, by, cx - w * 0.6, by - h * 0.42, cx - w * 0.3, by - h * 0.68);
    ctx.quadraticCurveTo(cx - w * 0.3, by - h * 0.42, cx - w * 0.12, by - h * 0.4);
    ctx.quadraticCurveTo(cx - w * 0.12, by - h * 0.8, cx + w * 0.06, by - h);
    ctx.quadraticCurveTo(cx + w * 0.16, by - h * 0.62, cx + w * 0.26, by - h * 0.56);
    ctx.quadraticCurveTo(cx + w * 0.36, by - h * 0.68, cx + w * 0.34, by - h * 0.84);
    ctx.bezierCurveTo(cx + w * 0.7, by - h * 0.5, cx + w * 0.62, by, cx, by);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function campamento(ctx, r) {
    const flip = r.chance(0.5);
    if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    rect(ctx, 0, 0, W, H, '#0a1a5c');
    // remolinos del cielo
    const sw = ['#1559c9', '#2a7de1', '#1d4fb0'];
    for (let i = 0; i < 3; i++) {
      const y = r.range(120, 380);
      stroke(ctx, sw[i], r.range(55, 95), () => {
        ctx.moveTo(-60, y + r.range(-60, 60));
        ctx.bezierCurveTo(W * 0.3, y - r.range(80, 160), W * 0.6, y + r.range(40, 160), W + 60, y - r.range(-60, 80));
      });
    }
    // esquinas naranjas
    poly(ctx, [[0, 0], [r.range(120, 190), 0], [0, r.range(200, 280)]], '#ff5a1f');
    poly(ctx, [[W, H], [W, H - r.range(180, 260)], [W - r.range(120, 170), H]], '#ff5a1f');
    // árboles
    pine(ctx, r.range(90, 150), -70, r.range(500, 560), r.range(230, 280), 5, '#0e5a2a');
    pine(ctx, r.range(610, 690), r.range(10, 70), r.range(540, 600), r.range(200, 240), 5, '#18b934');
    // colinas
    const ph = r.range(0, TAU);
    fillBelow(ctx, (x) => 560 - 40 * Math.sin(x / 260 + ph) - x * 0.05, '#0b4a22');
    fillBelow(ctx, (x) => 690 - 60 * Math.sin(x / 300 + ph + 1.2) - x * 0.07, '#13b52d');
    poly(ctx, [[W, H], [W, H - 170], [W - 110, H]], '#f5b23a');
    // tienda de campaña
    const tx = r.range(170, 280);
    const ty = r.range(300, 360);
    const base = ty + 240;
    poly(ctx, [[tx, ty], [tx - 170, base], [tx + 165, base]], '#f5c400');
    poly(ctx, [[tx, ty], [tx + 165, base], [tx + 70, base]], '#e09d00');
    poly(ctx, [[tx - 4, ty + 80], [tx - 48, base], [tx + 38, base]], '#0a1a5c');
    // fogata
    const fx = tx + r.range(250, 310);
    const fy = base + r.range(10, 40);
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(0.18);
    rect(ctx, -70, -14, 140, 26, '#7b3f1d');
    ctx.rotate(-0.36);
    rect(ctx, -70, -14, 140, 26, '#5e2d12');
    ctx.restore();
    flame(ctx, fx, fy, 190, 250, '#ff4b16');
    flame(ctx, fx + 6, fy, 130, 175, '#ff9b2a');
    flame(ctx, fx + 10, fy, 70, 100, '#ffd84a');
  }

  // ---------- 3. Atardecer ----------
  function atardecer(ctx, r) {
    const sets = [
      ['#2b124c', '#522b5b', '#854f6c', '#dfb6b2', '#fbe4d8'],
      ['#3b1c6e', '#6a2c91', '#b23a8a', '#ec5f74', '#f89a5b'],
      ['#1d1a4a', '#3b2f7c', '#7b4fa3', '#e0679a', '#ffb37a'],
    ];
    const halo = r.pick(sets);
    const sx = r.range(260, 540);
    const sy = r.range(380, 460);
    rect(ctx, 0, 0, W, H, halo[0]);
    const radii = [760, 590, 450, 330];
    for (let i = 0; i < radii.length; i++) circle(ctx, sx, sy, radii[i] + r.range(-20, 20), halo[i + 1]);
    // sol retro con franjas
    const sunR = r.range(130, 165);
    circle(ctx, sx, sy, sunR, '#ffe066');
    for (let k = 0; k < 5; k++) {
      const y = sy + 18 + k * 26;
      rect(ctx, sx - sunR - 2, y, sunR * 2 + 4, 6 + k * 2.5, halo[4]);
    }
    // montañas
    const ranges = [['#5b2a86', 440], ['#3a1d6e', 500], ['#22114a', 560]];
    for (const [col, baseY] of ranges) {
      const pts = [[-20, H]];
      let x = -20;
      while (x < W + 40) {
        pts.push([x, baseY + r.range(-30, 40)]);
        x += r.range(60, 120);
        pts.push([x, baseY - r.range(60, 190)]);
        x += r.range(60, 120);
      }
      pts.push([W + 40, H]);
      poly(ctx, pts, col);
    }
    // agua con reflejos
    const sea = r.range(610, 650);
    rect(ctx, 0, sea, W, H - sea, '#161a4d');
    for (let k = 0; k < 7; k++) {
      const y = sea + 18 + k * 24;
      const w = 220 - k * 22 + r.range(-20, 20);
      rect(ctx, sx - w / 2 + r.range(-25, 25), y, w, 8, k % 2 ? '#f2797b' : '#ffcf6b');
    }
    // pájaros
    for (let i = 0; i < r.int(3, 6); i++) {
      const bx = r.range(80, 720);
      const by = r.range(80, 260);
      const s = r.range(10, 18);
      stroke(ctx, '#1d0f33', 5, () => {
        ctx.moveTo(bx - s, by - s * 0.4);
        ctx.quadraticCurveTo(bx - s * 0.4, by - s * 0.7, bx, by);
        ctx.quadraticCurveTo(bx + s * 0.4, by - s * 0.7, bx + s, by - s * 0.4);
      });
    }
  }

  // ---------- 4. Bauhaus ----------
  function bauhaus(ctx, r) {
    const pal = ['#f1e4c9', '#e2402a', '#f4b41a', '#1f4e8c', '#151515', '#2a9d8f'];
    const n = r.pick([3, 4, 4, 5]);
    const c = W / n;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const x = gx * c;
        const y = gy * c;
        const bg = r.pick(pal);
        let fg = r.pick(pal);
        while (fg === bg) fg = r.pick(pal);
        let fg2 = r.pick(pal);
        while (fg2 === fg) fg2 = r.pick(pal);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, c, c);
        ctx.clip();
        rect(ctx, x, y, c, c, bg);
        const type = r.int(0, 6);
        if (type === 0) {
          const cx = x + (r.chance(0.5) ? 0 : c);
          const cy = y + (r.chance(0.5) ? 0 : c);
          circle(ctx, cx, cy, c, fg);
        } else if (type === 1) {
          const side = r.int(0, 3);
          const pts = [[x + c / 2, y], [x + c, y + c / 2], [x + c / 2, y + c], [x, y + c / 2]];
          circle(ctx, pts[side][0], pts[side][1], c / 2, fg);
        } else if (type === 2) {
          circle(ctx, x + c / 2, y + c / 2, c * 0.38, fg);
        } else if (type === 3) {
          const corners = [[x, y], [x + c, y], [x + c, y + c], [x, y + c]];
          const k = r.int(0, 3);
          poly(ctx, [corners[k], corners[(k + 1) % 4], corners[(k + 2) % 4]], fg);
        } else if (type === 4) {
          const vertical = r.chance(0.5);
          for (let s = 0; s < 3; s++) {
            if (vertical) rect(ctx, x + (s * 2 + 0.5) * (c / 6), y, c / 6, c, fg);
            else rect(ctx, x, y + (s * 2 + 0.5) * (c / 6), c, c / 6, fg);
          }
        } else if (type === 5) {
          circle(ctx, x + c / 2, y + c / 2, c * 0.45, fg);
          circle(ctx, x + c / 2, y + c / 2, c * 0.29, fg2 === bg ? bg : fg2);
          circle(ctx, x + c / 2, y + c / 2, c * 0.13, fg);
        } else {
          if (r.chance(0.5)) rect(ctx, x, y, c / 2, c, fg);
          else rect(ctx, x, y + c / 2, c, c / 2, fg);
          circle(ctx, x + c / 2, y + c / 2, c * 0.22, fg2);
        }
        ctx.restore();
      }
    }
  }

  // ---------- 5. Ciudad de noche ----------
  function ciudad(ctx, r) {
    const sky = ['#0d0b2e', '#1c1453', '#2c1c6b', '#45237f'];
    for (let i = 0; i < sky.length; i++) rect(ctx, 0, i * 130, W, 140, sky[i]);
    rect(ctx, 0, 520, W, 280, sky[3]);
    // luna
    const mx = r.range(120, 680);
    const my = r.range(90, 200);
    circle(ctx, mx, my, 58, '#fff3c4');
    circle(ctx, mx - 18, my - 12, 12, '#efdca0');
    circle(ctx, mx + 20, my + 14, 9, '#efdca0');
    circle(ctx, mx + 8, my - 26, 6, '#efdca0');
    // estrellas
    for (let i = 0; i < 46; i++) {
      const x = r.range(10, W - 10);
      const y = r.range(10, 420);
      if (Math.hypot(x - mx, y - my) < 80) continue;
      const s = r.range(2, 5);
      poly(ctx, [[x, y - s * 1.8], [x + s * 0.5, y], [x, y + s * 1.8], [x - s * 0.5, y]], '#fff6d6');
      poly(ctx, [[x - s * 1.8, y], [x, y + s * 0.5], [x + s * 1.8, y], [x, y - s * 0.5]], '#fff6d6');
    }
    const ground = 650;
    // edificios lejanos
    let x = -10;
    while (x < W) {
      const w = r.range(50, 110);
      const h = r.range(200, 420);
      rect(ctx, x, ground - h, w, h, '#2b1d5c');
      if (r.chance(0.3)) rect(ctx, x + w / 2 - 3, ground - h - 40, 6, 40, '#2b1d5c');
      x += w - 2;
    }
    // edificios cercanos con ventanas
    x = -20;
    const cols = ['#3f2b7a', '#4b2f86', '#26265e', '#5b3a8f', '#6a2f7a'];
    while (x < W) {
      const w = r.range(80, 150);
      const h = r.range(130, 330);
      const col = r.pick(cols);
      const top = ground - h;
      rect(ctx, x, top, w, h, col);
      if (r.chance(0.35)) poly(ctx, [[x, top], [x + w / 2, top - r.range(30, 60)], [x + w, top]], col);
      const ww = 12;
      const wh = 16;
      const nc = Math.max(1, Math.floor((w - 16) / 26));
      const nr = Math.floor((h - 30) / 30);
      const ox = x + (w - nc * 26 + 14) / 2;
      for (let j = 0; j < nr; j++) {
        for (let i = 0; i < nc; i++) {
          rect(ctx, ox + i * 26, top + 18 + j * 30, ww, wh, r.chance(0.45) ? '#ffd45c' : '#1a1640');
        }
      }
      x += w + r.range(-4, 10);
    }
    // calle
    rect(ctx, 0, ground, W, 32, '#2e2e4f');
    rect(ctx, 0, ground + 32, W, H - ground - 32, '#14142b');
    for (let dx = r.range(-40, 0); dx < W; dx += 90) rect(ctx, dx, ground + 82, 50, 10, '#f5d76e');
  }

  // ---------- 6. Selva ----------
  function leaf(ctx, x, y, len, wid, ang, color, rib) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(wid, len * 0.42, 0, len);
    ctx.quadraticCurveTo(-wid, len * 0.42, 0, 0);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, len * 0.9);
    ctx.strokeStyle = rib;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function selva(ctx, r) {
    rect(ctx, 0, 0, W, H, '#06402b');
    const greens = ['#0b6e3a', '#18a558', '#2dc96a', '#0f8a4a', '#7ad35b', '#0a5c33', '#3fb950'];
    for (let i = 0; i < 30; i++) {
      const col = r.pick(greens);
      leaf(ctx, r.range(-60, W + 60), r.range(-60, H + 60), r.range(170, 330), r.range(60, 120),
        r.range(0, TAU), col, r.chance(0.5) ? '#9be37a' : '#064027');
    }
    const petals = ['#ff4f81', '#ff9f1c', '#ffd23f', '#c86bfa'];
    for (let i = 0; i < 6; i++) {
      const fx = r.range(60, W - 60);
      const fy = r.range(60, H - 60);
      const pc = r.pick(petals);
      const pr = r.range(28, 42);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + r.range(0, 0.3);
        ctx.save();
        ctx.translate(fx + Math.cos(a) * pr * 0.8, fy + Math.sin(a) * pr * 0.8);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, pr, pr * 0.62, 0, 0, TAU);
        ctx.fillStyle = pc;
        ctx.fill();
        ctx.restore();
      }
      circle(ctx, fx, fy, pr * 0.42, '#fff1a8');
    }
    for (let i = 0; i < 6; i++) {
      leaf(ctx, r.range(-40, W + 40), r.range(-40, H + 40), r.range(200, 300), r.range(70, 110),
        r.range(0, TAU), r.pick(greens), '#9be37a');
    }
  }

  // ---------- 7. Mar ----------
  function scallopBand(ctx, y, amp, wl, color, phase) {
    ctx.beginPath();
    ctx.moveTo(-20, H + 20);
    ctx.lineTo(-20, y);
    for (let x = -20 + phase; x < W + wl; x += wl) {
      ctx.quadraticCurveTo(x + wl / 2, y - amp, x + wl, y);
    }
    ctx.lineTo(W + 40, H + 20);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function mar(ctx, r) {
    rect(ctx, 0, 0, W, 260, '#6cc6ff');
    rect(ctx, 0, 260, W, 200, '#a9e2ff');
    const sunX = r.range(100, 700);
    circle(ctx, sunX, r.range(110, 170), 70, '#ffd84a');
    for (let i = 0; i < r.int(3, 4); i++) {
      const cx = r.range(60, 740);
      const cy = r.range(60, 330);
      const s = r.range(0.7, 1.2);
      ctx.fillStyle = '#ffffff';
      [[0, 0, 40], [38, -14, 46], [80, 0, 38], [40, 10, 40]].forEach(([dx, dy, rr]) => {
        circle(ctx, cx + dx * s, cy + dy * s, rr * s, '#ffffff');
      });
      rect(ctx, cx, cy, 80 * s, 38 * s, '#ffffff');
    }
    const blues = ['#2c86e0', '#1f6fd0', '#1a5fc0', '#154fa8', '#113f8f', '#0e3075'];
    const top = r.range(440, 470);
    const boatLayer = r.int(1, 2);
    for (let i = 0; i < blues.length; i++) {
      const y = top + i * 62;
      scallopBand(ctx, y, r.range(18, 34), r.range(70, 120), blues[i], r.range(-60, 0));
      if (i === boatLayer) {
        const bx = r.range(140, 640);
        const by = y + 6;
        poly(ctx, [[bx - 85, by - 30], [bx + 95, by - 30], [bx + 60, by + 12], [bx - 55, by + 12]], '#7a3b1e');
        rect(ctx, bx - 3, by - 210, 8, 182, '#5e2d12');
        poly(ctx, [[bx + 9, by - 205], [bx + 9, by - 45], [bx + 110, by - 45]], '#ffffff');
        poly(ctx, [[bx - 6, by - 180], [bx - 6, by - 45], [bx - 95, by - 45]], '#ff5a5f');
      }
    }
    for (let i = 0; i < r.int(3, 5); i++) {
      const gx = r.range(60, 740);
      const gy = r.range(220, 380);
      stroke(ctx, '#2b2b44', 5, () => {
        ctx.moveTo(gx - 16, gy - 6);
        ctx.quadraticCurveTo(gx - 7, gy - 12, gx, gy);
        ctx.quadraticCurveTo(gx + 7, gy - 12, gx + 16, gy - 6);
      });
    }
  }

  // ---------- 8. Desierto ----------
  function cactus(ctx, x, base, h, col, dark) {
    const tw = h * 0.18;
    const rr = tw / 2;
    const roundRect = (rx, ry, rw, rh) => {
      ctx.beginPath();
      ctx.moveTo(rx + rr, ry);
      ctx.lineTo(rx + rw - rr, ry);
      ctx.arc(rx + rw - rr, ry + rr, rr, -Math.PI / 2, 0);
      ctx.lineTo(rx + rw, ry + rh);
      ctx.lineTo(rx, ry + rh);
      ctx.lineTo(rx, ry + rr);
      ctx.arc(rx + rr, ry + rr, rr, Math.PI, -Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    };
    roundRect(x - tw / 2, base - h, tw, h);
    roundRect(x - tw * 1.9, base - h * 0.75, tw * 0.8, h * 0.32);
    rect(ctx, x - tw * 1.9, base - h * 0.5, tw * 1.5, tw * 0.75, col);
    roundRect(x + tw * 1.1, base - h * 0.85, tw * 0.8, h * 0.36);
    rect(ctx, x + tw * 0.4, base - h * 0.55, tw * 1.5, tw * 0.75, col);
    rect(ctx, x - 2, base - h + tw * 0.6, 4, h - tw * 0.8, dark);
  }

  function desierto(ctx, r) {
    const sky = ['#ffe3b3', '#ffd29a', '#ffbf80', '#ffa96b'];
    for (let i = 0; i < sky.length; i++) rect(ctx, 0, i * 110, W, 120, sky[i]);
    rect(ctx, 0, 440, W, 360, sky[3]);
    circle(ctx, r.range(200, 600), r.range(180, 260), r.range(90, 120), '#fff2a8');
    // mesetas
    for (let i = 0; i < 2; i++) {
      const mx = r.range(0, 600);
      const mw = r.range(160, 260);
      const mt = r.range(330, 390);
      poly(ctx, [[mx, 480], [mx + 30, mt], [mx + mw - 30, mt], [mx + mw, 480]], '#d9774b');
    }
    const dunes = ['#f4a259', '#e8873b', '#d96c2c', '#c4561d'];
    for (let i = 0; i < dunes.length; i++) {
      const b = 470 + i * 85;
      const a = r.range(25, 60);
      const ph = r.range(0, TAU);
      const wl = r.range(260, 420);
      fillBelow(ctx, (x) => b - a * Math.sin((x / wl) * TAU + ph), dunes[i]);
      if (i === 1 || i === 2) {
        for (let k = 0; k < r.int(1, 2); k++) {
          const cx = r.range(80, 720);
          cactus(ctx, cx, b - a * Math.sin((cx / wl) * TAU + ph) + 30, r.range(150, 230), '#2f9e44', '#237a34');
        }
      }
    }
  }

  // ---------- 9. Espacio ----------
  function planet(ctx, x, y, rad, bands, ring) {
    if (ring) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ring.tilt);
      ctx.beginPath();
      ctx.ellipse(0, 0, rad * 1.75, rad * 0.45, 0, Math.PI, TAU);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = rad * 0.16;
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.clip();
    const n = bands.length;
    for (let i = 0; i < n; i++) rect(ctx, x - rad, y - rad + (i * 2 * rad) / n, rad * 2, (2 * rad) / n + 1, bands[i]);
    ctx.restore();
    if (ring) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ring.tilt);
      ctx.beginPath();
      ctx.ellipse(0, 0, rad * 1.75, rad * 0.45, 0, 0, Math.PI);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = rad * 0.16;
      ctx.stroke();
      ctx.restore();
    }
  }

  function espacio(ctx, r) {
    rect(ctx, 0, 0, W, H, '#0b0630');
    for (let i = 0; i < 7; i++) circle(ctx, r.range(0, W), r.range(0, H), r.range(90, 200), r.pick(['#1a0f4e', '#24125e', '#160b42']));
    for (let i = 0; i < 90; i++) {
      circle(ctx, r.range(0, W), r.range(0, H), r.range(1.5, 4), r.pick(['#ffffff', '#ffe9a3', '#9fd8ff']));
    }
    for (let i = 0; i < 6; i++) {
      const x = r.range(40, 760);
      const y = r.range(40, 760);
      const s = r.range(8, 14);
      poly(ctx, [[x, y - s * 2], [x + s * 0.45, y], [x, y + s * 2], [x - s * 0.45, y]], '#fff6d6');
      poly(ctx, [[x - s * 2, y], [x, y + s * 0.45], [x + s * 2, y], [x, y - s * 0.45]], '#fff6d6');
    }
    const warm = r.shuffle(['#ff7b54', '#ffb26b', '#ffd56b', '#e85d75', '#c94b8b', '#ff9f6b']);
    planet(ctx, r.range(220, 580), r.range(260, 540), r.range(140, 180), warm.slice(0, 6), { tilt: r.range(-0.5, 0.5), color: '#f9e2ae' });
    const cool = r.shuffle(['#4cc9f0', '#4895ef', '#3a0ca3', '#7209b7', '#56cfe1']);
    const px = r.chance(0.5) ? r.range(80, 170) : r.range(630, 720);
    const py = r.range(90, 700);
    planet(ctx, px, py, r.range(60, 90), cool.slice(0, 4), null);
    const mx = W - px + r.range(-60, 60);
    const my = r.range(80, 720);
    const mr = r.range(40, 60);
    circle(ctx, mx, my, mr, '#c9c6d6');
    circle(ctx, mx - mr * 0.3, my - mr * 0.2, mr * 0.25, '#a8a4bb');
    circle(ctx, mx + mr * 0.35, my + mr * 0.3, mr * 0.18, '#a8a4bb');
    // cometa
    const cx = r.range(100, 700);
    const cy = r.range(60, 200);
    stroke(ctx, '#7fe0ff', 10, () => { ctx.moveTo(cx, cy); ctx.lineTo(cx - 150, cy - 70); });
    circle(ctx, cx, cy, 13, '#e8fbff');
  }

  // ---------- 10. Rayos de sol ----------
  function rayos(ctx, r) {
    const sets = [
      ['#ffcb05', '#ff6b35', '#ffe066'],
      ['#2ec4b6', '#cbf3f0', '#ff9f1c'],
      ['#ef476f', '#ffd166', '#06d6a0'],
      ['#3a86ff', '#8ecae6', '#ffbe0b'],
    ];
    const pal = r.pick(sets);
    const cx = r.range(240, 560);
    const cy = r.range(240, 560);
    const n = r.pick([16, 18, 20, 24]);
    const off = r.range(0, TAU);
    for (let i = 0; i < n; i++) {
      const a0 = off + (i / n) * TAU;
      const a1 = off + ((i + 1) / n) * TAU;
      poly(ctx, [[cx, cy], [cx + Math.cos(a0) * 1400, cy + Math.sin(a0) * 1400], [cx + Math.cos(a1) * 1400, cy + Math.sin(a1) * 1400]],
        i % 2 ? pal[0] : pal[1]);
    }
    const rings = [150, 115, 80, 45];
    rings.forEach((rr, i) => circle(ctx, cx, cy, rr, i % 2 ? pal[2] : '#ffffff'));
    const ph = r.range(0, TAU);
    fillBelow(ctx, (x) => 690 + 30 * Math.sin(x / 120 + ph), '#5a2ea6');
    fillBelow(ctx, (x) => 740 + 25 * Math.sin(x / 90 + ph + 2), '#8338ec');
  }

  const LIST = [
    ['Ondas', ondas],
    ['Campamento', campamento],
    ['Atardecer', atardecer],
    ['Bauhaus', bauhaus],
    ['Ciudad de noche', ciudad],
    ['Selva', selva],
    ['Mar', mar],
    ['Desierto', desierto],
    ['Espacio', espacio],
    ['Rayos de sol', rayos],
  ];

  // Tramas que atraviesan incluso los fondos planos. La separación es menor que
  // el cuerpo del muñeco: un relleno de un solo color deja de bastar.
  function addDetail(ctx, difficulty, seed) {
    if (!difficulty) return;
    const image = ctx.getImageData(0, 0, W, H);
    const data = image.data;
    const spacing = difficulty === 2 ? 27 : 48;
    const shift = (seed >>> 0) % 113;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const wave = 5 * Math.sin((x + shift) / 43) + 4 * Math.sin(y / 61);
        const band = ((x + y * 0.7 + wave + shift) % spacing) / spacing;
        if (band > 0.38) continue;
        const k = (y * W + x) * 4;
        const light = data[k] * 0.2126 + data[k + 1] * 0.7152 + data[k + 2] * 0.0722;
        const amount = (difficulty === 2 ? 95 : 72) * (light > 128 ? -1 : 1);
        for (let c = 0; c < 3; c++) data[k + c] = Math.max(0, Math.min(255, data[k + c] + amount));
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  function render(idx, seed, canvas, difficulty = 0) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const i = ((idx % LIST.length) + LIST.length) % LIST.length;
    const r = mkRand((seed * 7919 + i * 104729) >>> 0);
    ctx.save();
    LIST[i][1](ctx, r);
    ctx.restore();
    addDetail(ctx, difficulty === 2 ? 2 : difficulty === 1 ? 1 : 0, seed);
    return canvas;
  }

  root.Paintings = { W, H, count: LIST.length, names: LIST.map((x) => x[0]), render, mkRand };
})(typeof globalThis !== 'undefined' ? globalThis : this);
