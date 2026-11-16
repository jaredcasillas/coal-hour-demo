// Modo reel: piloto automático de cine. Recorre toda la página con un scroll
// suave para grabar la pantalla sin tocar nada.
//   ?reel      → lo pide la URL (main.js decide cuándo arrancar con reelRequested())
//   ?reel=28   → igual, y el recorrido dura 28 s
//   R alterna · Espacio pausa · Esc, rueda, toque o clic lo detienen
import './fx/fx.css';

const LEAD = 1.5;   // espera arriba antes de moverse (s)
const HOLD = 2;     // espera al llegar al final (s)
const DWELL = 0.6;  // pausa en el centro de cada sección (s)
const RAMP = 1.4;   // lo que tarda cada tramo en acelerar y en frenar (s)
const MAX_DT = 0.1; // un cuadro nunca avanza más que esto (tirones, pestaña oculta)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Entrada y salida en seno con crucero recto en medio: la velocidad y la
// aceleración nunca saltan. r = fracción del tramo que dura cada rampa (0.5 = todo curva).
function glide(p, r) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (p > 0.5) return 1 - glide(1 - p, r);
  if (p >= r) return (p - r * 0.5) / (1 - r);
  const u = p / r;
  return (r / (1 - r)) * (u * 0.5 - Math.sin(Math.PI * u) / (2 * Math.PI));
}

/* ───────── ¿La URL pide el reel? ───────── */
export function reelRequested() {
  const q = new URLSearchParams(window.location.search);
  if (!q.has('reel')) return { on: false, seconds: null };
  const raw = (q.get('reel') ?? '').trim();
  if (/^(0|off|no|false)$/i.test(raw)) return { on: false, seconds: null };
  const n = Number.parseFloat(raw);
  return { on: true, seconds: Number.isFinite(n) && n > 0 ? n : null };
}

/* ───────── Piloto automático ───────── */
export function initReel({ lenis, sections, duration = 34, lead = LEAD, onStart, onEnd, onStop } = {}) {
  const root = document.documentElement;
  const els = Array.from(sections ?? []);
  const travel = Math.max(4, Number(duration) || 34); // del primer movimiento a la llegada, pausas incluidas

  let running = false, paused = false, dirty = false, ended = false;
  let raf = 0, last = null, t = 0, tl = null, ac = null, ro = null;

  // Inmediato y forzado: sin suavizado de Lenis encima y aunque esté detenido.
  const scrollTo = (y) => {
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo({ top: y, behavior: 'instant' });
  };

  // Línea de tiempo: espera → tramo → pausa → tramo → … → espera final.
  function build() {
    lenis?.resize?.(); // que el límite de Lenis sea el de este mismo cuadro
    const vh = window.innerHeight;
    const max = Math.max(0, root.scrollHeight - vh);
    const sy = window.scrollY;

    // Cada parada: el centro de la sección en el centro de la pantalla.
    const ys = els.map((el) => {
      const r = el.getBoundingClientRect();
      return clamp(r.top + sy + r.height / 2 - vh / 2, 0, max);
    });
    if (ys.length < 2) ys.splice(0, ys.length, 0, max);
    ys[0] = 0;
    ys[ys.length - 1] = max;

    // En orden y sin paradas repetidas (secciones que caen en el mismo punto).
    const keys = [0];
    for (let i = 1; i < ys.length; i++) {
      const y = Math.max(ys[i], keys[keys.length - 1]);
      if (y - keys[keys.length - 1] > 2) keys.push(y);
    }
    if (keys.length > 1) keys[keys.length - 1] = max;

    const n = keys.length - 1; // tramos
    const segs = [];
    let at = 0;
    const add = (d, y0, y1, r = 0.5) => { segs.push({ t0: at, d, y0, y1, r }); at += d; };

    add(Math.max(0, Number(lead) || LEAD), 0, 0); // espera arriba: que el encendido termine antes de moverse
    if (n > 0) {
      const dwell = n > 1 ? Math.min(DWELL, (travel * 0.25) / (n - 1)) : 0;
      const moving = travel - dwell * (n - 1);
      // Cada tramo recibe un mínimo fijo (sus rampas) y el resto del tiempo se
      // reparte por distancia: así todos cruzan a la misma velocidad.
      const ramp = Math.min(RAMP, (0.45 * moving) / n);
      const pace = (moving - ramp * n) / (keys[n] - keys[0]); // s por pixel en crucero
      for (let i = 0; i < n; i++) {
        const d = ramp + (keys[i + 1] - keys[i]) * pace;
        add(d, keys[i], keys[i + 1], Math.min(0.5, ramp / d));
        if (i < n - 1) add(dwell, keys[i + 1], keys[i + 1]);
      }
    }
    add(HOLD, keys[n], keys[n]);
    return { segs, total: at };
  }

  function segAt(line, time) {
    const { segs } = line;
    let i = 0;
    while (i < segs.length - 1 && time >= segs[i].t0 + segs[i].d) i++;
    return i;
  }

  function yAt(time) {
    const s = tl.segs[segAt(tl, time)];
    return s.y0 + (s.y1 - s.y0) * glide((time - s.t0) / s.d, s.r);
  }

  // Al cambiar el tamaño se rehace la línea y se sigue en el mismo punto del mismo tramo.
  function rebuild() {
    dirty = false;
    const old = tl;
    const i = segAt(old, t);
    const a = old.segs[i];
    let p = clamp((t - a.t0) / a.d, 0, 1);
    tl = build();
    if (tl.segs.length !== old.segs.length) { t = Math.min(t, tl.total); return; }
    const b = tl.segs[i];
    if (b.y1 !== b.y0) {
      // En pleno tramo se conserva la parte del camino ya recorrida (no la del tiempo).
      const done = glide(p, a.r);
      let lo = 0, hi = 1;
      for (let k = 0; k < 24; k++) {
        p = (lo + hi) / 2;
        if (glide(p, b.r) < done) lo = p; else hi = p;
      }
    }
    t = b.t0 + p * b.d;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    // Reloj propio: el tiempo del cuadro (misma base que performance.now()).
    const dt = last === null ? 0 : clamp((now - last) / 1000, 0, MAX_DT);
    last = now;
    if (dirty) rebuild();
    if (!paused) t += dt;
    scrollTo(yAt(t));
    if (t >= tl.total) finish(); // se queda abajo, todavía en modo reel
  }

  const markDirty = () => { dirty = true; };

  function start() {
    if (running) return;
    running = true;
    paused = false;
    dirty = false;
    t = 0;
    last = null;
    ended = false;
    root.classList.add('reel');
    onStart?.();
    scrollTo(0);
    tl = build();

    ac = new AbortController();
    const quit = { signal: ac.signal, passive: true, capture: true };
    window.addEventListener('wheel', stop, quit);
    window.addEventListener('touchstart', stop, quit);
    window.addEventListener('pointerdown', stop, quit);
    window.addEventListener('resize', markDirty, { signal: ac.signal, passive: true });
    // Si la pestaña se ocultó, al volver se sigue donde iba: sin salto.
    document.addEventListener('visibilitychange', () => { last = null; }, { signal: ac.signal });
    ro = new ResizeObserver(markDirty);
    ro.observe(root);
    ro.observe(document.body);

    raf = requestAnimationFrame(frame);
  }

  // Fin natural: el recorrido terminó. La página sigue limpia (sin cursor ni barra) para que
  // el último cuadro de la grabación no cambie; cualquier gesto del usuario la restaura.
  function finish() {
    if (!running) return;
    running = false;
    ended = true;
    cancelAnimationFrame(raf);
    raf = 0;
    onEnd?.();
  }

  function stop() {
    if (!running && !ended) return;
    running = false;
    ended = false;
    paused = false;
    cancelAnimationFrame(raf);
    raf = 0;
    ac?.abort();
    ac = null;
    ro?.disconnect();
    ro = null;
    root.classList.remove('reel');
    onStop?.();
  }

  const toggle = () => (running || ended ? stop() : start());

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+R sigue recargando
    const el = e.target;
    if (el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (e.key === 'r' || e.key === 'R') {
      if (!e.repeat) toggle();
    } else if (ended) {
      if (e.key === 'Escape') stop();
    } else if (!running) {
      return;
    } else if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault(); // que la barra no baje la página
      if (!e.repeat) paused = !paused;
    } else if (e.key === 'Escape') {
      stop();
    }
  });

  return {
    start,
    stop,
    toggle,
    get running() { return running; },
  };
}
