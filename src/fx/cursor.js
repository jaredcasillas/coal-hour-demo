// Cursor de brasa: un punto al rojo blanco con resplandor naranja que sigue al
// puntero con un poco de retraso y suelta chispas según la velocidad.
// Solo en escritorio con mouse; en táctil o con movimiento reducido no hace nada.
import './fx.css';

const MAX = 160;    // tope de chispas vivas
const DPR_MAX = 2;
const STEPS = 12;   // tonos entre amarillo y rojo
const RATE = 0.085; // chispas por pixel recorrido
const HOT = 'a, button, [data-hover]';
const TAU = Math.PI * 2;
const NOOP = { destroy() {} };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Enfriamiento: amarillo casi blanco → naranja → rojo
const COOL = [[255, 246, 210], [255, 208, 104], [255, 146, 42], [255, 74, 22], [188, 22, 8]];
const coolAt = (k) => {
  const f = clamp(k, 0, 0.9999) * (COOL.length - 1), i = Math.floor(f), u = f - i;
  return COOL[i].map((c, j) => Math.round(c + (COOL[i + 1][j] - c) * u));
};

// Un resplandor redondo dibujado una sola vez; después solo se estampa.
function sprite(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  stops.forEach(([at, color]) => grad.addColorStop(at, color));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export function initCursor() {
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduce) return NOOP;

  const root = document.documentElement;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return NOOP;
  canvas.className = 'ember-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  root.classList.add('ember-cursor');

  /* ───────── Estampas ───────── */
  const ember = sprite(128, [
    [0, 'rgba(255,250,236,1)'], [0.09, 'rgba(255,228,164,0.95)'], [0.22, 'rgba(255,150,52,0.5)'],
    [0.5, 'rgba(255,76,20,0.14)'], [1, 'rgba(255,42,23,0)'],
  ]);
  const tones = [], inks = [];
  for (let i = 0; i < STEPS; i++) {
    const k = i / (STEPS - 1), [r, g, b] = coolAt(k), w = 1 - k; // w: qué tan blanco va el centro
    const core = `rgba(${Math.round(r + (255 - r) * w)},${Math.round(g + (255 - g) * w)},${Math.round(b + (255 - b) * w)},1)`;
    tones.push(sprite(48, [[0, core], [0.2, `rgba(${r},${g},${b},0.9)`], [0.48, `rgba(${r},${g},${b},0.26)`], [1, `rgba(${r},${g},${b},0)`]]));
    inks.push(`rgb(${r},${g},${b})`);
  }

  /* ───────── Chispas: anillo fijo, la nueva pisa a la más vieja ───────── */
  const X = new Float32Array(MAX), Y = new Float32Array(MAX), VX = new Float32Array(MAX), VY = new Float32Array(MAX);
  const AGE = new Float32Array(MAX), LIFE = new Float32Array(MAX), SIZE = new Float32Array(MAX), PH = new Float32Array(MAX);
  let head = 0, carry = 0;

  function spawn(sx, sy, vx, vy, kick = 1) {
    const i = head;
    head = (head + 1) % MAX;
    const a = Math.random() * TAU, s = (14 + Math.random() * 62) * kick;
    X[i] = sx + (Math.random() - 0.5) * 5;
    Y[i] = sy + (Math.random() - 0.5) * 5;
    // Heredan poco del puntero: se quedan atrás, como al sacudir una brasa.
    VX[i] = clamp(vx * 0.1, -200, 200) + Math.cos(a) * s;
    VY[i] = clamp(vy * 0.1, -200, 200) + Math.sin(a) * s - 26 - Math.random() * 44;
    AGE[i] = 0;
    LIFE[i] = 0.46 + Math.random() * 0.5; // ~0.7 s
    SIZE[i] = 0.8 + Math.random() ** 2 * 1.8;
    PH[i] = Math.random() * TAU;
  }

  /* ───────── Estado ───────── */
  let w = 0, h = 0, raf = 0, last = 0, blank = true;
  let tx = 0, ty = 0, x = 0, y = 0;
  let seen = false, inside = false, hot = false, down = false;
  let vis = 0, ring = 0, press = 0, rush = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // se dibuja en pixeles CSS
    blank = true;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;

    // En modo reel no se dibuja nada.
    if (root.classList.contains('reel')) {
      if (!blank) { ctx.clearRect(0, 0, w, h); blank = true; }
      LIFE.fill(0);
      carry = 0;
      return;
    }

    // El punto persigue al puntero con un poco de retraso.
    const ox = x, oy = y, k = 1 - Math.exp(-dt * 28);
    x += (tx - x) * k;
    y += (ty - y) * k;
    const dx = x - ox, dy = y - oy, dist = Math.hypot(dx, dy);
    const show = seen && inside;
    vis += ((show ? 1 : 0) - vis) * (1 - Math.exp(-dt * 12));
    ring += ((hot ? 1 : 0) - ring) * (1 - Math.exp(-dt * 14));
    press += ((down ? 1 : 0) - press) * (1 - Math.exp(-dt * 20));
    rush += ((dt > 0 ? Math.min(dist / dt / 1600, 1) : 0) - rush) * (1 - Math.exp(-dt * 10));

    // Chispas a lo largo del camino, en proporción a lo recorrido.
    if (show && dt > 0) {
      carry = Math.min(carry + dist * RATE, 18);
      while (carry >= 1) {
        carry -= 1;
        const f = Math.random();
        spawn(ox + dx * f, oy + dy * f, dx / dt, dy / dt);
      }
    }

    if (!blank) ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    let drawn = 0;

    // Suben, derivan, se enfrían de amarillo a rojo y se apagan.
    const drag = Math.exp(-dt * 2.4);
    for (let i = 0; i < MAX; i++) {
      if (AGE[i] >= LIFE[i]) continue;
      AGE[i] += dt;
      const u = AGE[i] / LIFE[i];
      if (u >= 1) continue;
      VX[i] = VX[i] * drag + Math.sin(PH[i] + AGE[i] * 7) * 120 * dt;
      VY[i] = VY[i] * drag - 300 * dt;
      X[i] += VX[i] * dt;
      Y[i] += VY[i] * dt;
      const tone = Math.min(STEPS - 1, Math.floor(u * STEPS));
      const a = (1 - u) ** 1.3 * (0.72 + 0.28 * Math.sin(AGE[i] * 46 + PH[i]));
      const r = SIZE[i] * (1 - 0.45 * u) * 5.5;
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = inks[tone];
      ctx.lineWidth = SIZE[i] * 0.9;
      ctx.beginPath();
      ctx.moveTo(X[i], Y[i]);
      ctx.lineTo(X[i] - VX[i] * 0.03, Y[i] - VY[i] * 0.03); // estela corta
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.drawImage(tones[tone], X[i] - r, Y[i] - r, r * 2, r * 2);
      drawn++;
    }

    // La brasa
    if (vis > 0.004) {
      const s = now / 1000;
      const flick = 1 + 0.06 * Math.sin(s * 9.3) + 0.04 * Math.sin(s * 23.1 + 1.7);
      const R = (20 + 12 * rush) * flick * (1 - 0.3 * ring) * (1 + 0.25 * press);
      ctx.globalAlpha = vis * (1 - 0.45 * ring);
      ctx.drawImage(ember, x - R, y - R, R * 2, R * 2);
      // Núcleo al rojo blanco
      ctx.globalAlpha = vis * (1 - ring);
      ctx.fillStyle = '#fff5e0';
      ctx.beginPath();
      ctx.arc(x, y, 3 + 0.8 * rush, 0, TAU);
      ctx.fill();
      // Sobre enlaces y botones el punto se abre en un anillo fino.
      if (ring > 0.01) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, 3 + 21 * ring - 5 * press), 0, TAU);
        ctx.globalAlpha = vis * ring * 0.2;
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#ff7a1c';
        ctx.stroke();
        ctx.globalAlpha = vis * ring;
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = '#ffd2a0';
        ctx.stroke();
      }
      drawn++;
    }
    ctx.globalAlpha = 1;
    blank = drawn === 0;
  }

  /* ───────── Puntero ───────── */
  const ac = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { passive: true, signal: ac.signal });

  const probe = (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target instanceof Element ? e.target : null;
    tx = e.clientX;
    ty = e.clientY;
    // Primera vez, o de vuelta a la ventana: aparece ahí mismo, sin cruzar la pantalla.
    if (!seen || (!inside && vis < 0.3)) { x = tx; y = ty; seen = true; }
    inside = !(el && el.tagName === 'IFRAME'); // dentro de un iframe manda su propio cursor
    hot = !!el && !!el.closest(HOT);
  };
  on(window, 'pointermove', probe);
  on(window, 'pointerover', probe);
  on(window, 'pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    probe(e);
    down = true;
    if (!root.classList.contains('reel')) for (let j = 0; j < 12; j++) spawn(x, y, 0, 0, 2.6); // chispazo
  });
  on(window, 'pointerup', () => { down = false; });
  on(window, 'pointercancel', () => { down = false; });
  on(window, 'blur', () => { down = false; });
  on(root, 'pointerleave', () => { inside = false; });
  on(root, 'mouseleave', () => { inside = false; });
  on(window, 'resize', resize);

  // Con la pestaña oculta no corre nada.
  const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const sleep = () => { cancelAnimationFrame(raf); raf = 0; };
  on(document, 'visibilitychange', () => (document.hidden ? sleep() : wake()));

  resize();
  if (!document.hidden) wake();

  return {
    destroy() {
      sleep();
      ac.abort();
      canvas.remove();
      root.classList.remove('ember-cursor');
    },
  };
}
