/*
 * La figura del jugador: un muñeco de bloques (cabeza, torso, brazos y piernas) con varias poses.
 * Se dibuja dentro de una caja de BOX x BOX píxeles (coordenadas del cuadro de 800 x 800).
 */
(function (root) {
  'use strict';

  const U = 22; // tamaño de un "bloque" en píxeles del cuadro
  const BOX = 200;
  const WHITE = '#f3f3f6';

  // Ángulos en grados: 0 = hacia abajo, 90 = hacia la derecha, -90 = izquierda, 180 = arriba.
  const POSES = [
    { name: 'En T', arms: [-90, 90], legs: [0, 0] },
    { name: 'Firmes', arms: [0, 0], legs: [0, 0] },
    { name: 'Saludo', arms: [0, 180], legs: [0, 0] },
    { name: 'Brazos arriba', arms: [180, 180], legs: [0, 0] },
    { name: 'Estrella', arms: [-130, 130], legs: [-28, 28] },
    { name: 'Baile', arms: [-140, 40], legs: [0, 25] },
    { name: 'Agachado', arms: [0, 0], legs: [0, 0], armLen: 1.6, legLen: 1.1 },
    { name: 'Acostado', arms: [0, 0], legs: [0, 0], rot: 90 },
    { name: 'De cabeza', arms: [0, 0], legs: [0, 0], rot: 180 },
    { name: 'Inclinado', arms: [-90, 90], legs: [0, 0], rot: 40 },
  ];

  function rectPoly(cx, cy, w, h) {
    return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  }

  /** Extremidad de grosor 1 que gira alrededor de la articulación (px, py). */
  function limbPoly(px, py, deg, len) {
    const a = (deg * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = Math.cos(a);
    const nx = dy * 0.5;
    const ny = -dx * 0.5;
    const x0 = px - dx * 0.5;
    const y0 = py - dy * 0.5;
    const x1 = px + dx * (len - 0.5);
    const y1 = py + dy * (len - 0.5);
    return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
  }

  const cache = new Map();

  /** Polígonos de la pose ya colocados en la caja, más su rectángulo envolvente. */
  function shape(poseIndex) {
    if (cache.has(poseIndex)) return cache.get(poseIndex);
    const p = POSES[poseIndex] || POSES[0];
    const armLen = p.armLen || 2;
    const legLen = p.legLen || 2;
    const headW = 30 / U;
    const headH = 26 / U;
    const polys = [
      rectPoly(0, 0, 2, 2),
      rectPoly(0, -1 - headH / 2, headW, headH),
      limbPoly(-1.5, -0.5, p.arms[0], armLen),
      limbPoly(1.5, -0.5, p.arms[1], armLen),
      limbPoly(-0.5, 1.5, p.legs[0], legLen),
      limbPoly(0.5, 1.5, p.legs[1], legLen),
    ];
    if (p.rot) {
      const a = (p.rot * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (const poly of polys) {
        for (const pt of poly) {
          const x = pt[0];
          const y = pt[1];
          pt[0] = x * c - y * s;
          pt[1] = x * s + y * c;
        }
      }
    }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const poly of polys) {
      for (const [x, y] of poly) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const offX = Math.round(BOX / 2 - ((minX + maxX) / 2) * U);
    const offY = Math.round(BOX / 2 - ((minY + maxY) / 2) * U);
    const out = polys.map((poly) => poly.map(([x, y]) => [offX + x * U, offY + y * U]));
    const bbox = {
      x0: Math.floor(offX + minX * U), y0: Math.floor(offY + minY * U),
      x1: Math.ceil(offX + maxX * U), y1: Math.ceil(offY + maxY * U),
    };
    const result = { polys: out, bbox };
    cache.set(poseIndex, result);
    return result;
  }

  /** Dibuja la silueta (en un único trazado para que no haya costuras entre piezas). */
  function drawMask(ctx, poseIndex, color, scale = 1, ox = 0, oy = 0) {
    const { polys } = shape(poseIndex);
    ctx.beginPath();
    for (const poly of polys) {
      ctx.moveTo(ox + poly[0][0] * scale, oy + poly[0][1] * scale);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(ox + poly[i][0] * scale, oy + poly[i][1] * scale);
      ctx.closePath();
    }
    ctx.fillStyle = color || WHITE;
    ctx.fill('nonzero');
  }

  /** Limita la posición (esquina de la caja) para que la figura quede entera dentro del cuadro. */
  function clampPos(poseIndex, x, y, W, H) {
    const { bbox } = shape(poseIndex);
    return {
      x: Math.round(Math.min(W - bbox.x1, Math.max(-bbox.x0, x))),
      y: Math.round(Math.min(H - bbox.y1, Math.max(-bbox.y0, y))),
    };
  }

  root.Figure = { U, BOX, WHITE, POSES, shape, drawMask, clampPos };
})(typeof globalThis !== 'undefined' ? globalThis : this);
