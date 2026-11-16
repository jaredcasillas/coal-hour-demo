import '@fontsource/anton/400.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import 'lenis/dist/lenis.css';
import './styles.css';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

import { createWorld } from './gl/world.js';
import { initReel, reelRequested } from './reel.js';
import { initCursor } from './fx/cursor.js';
import { initMenuDrum } from './menuDrum.js';
import shots from './data/shots.json';
import { brand, ui, stations, clock, copy, marquee, menu, locations, neonText, videos } from './data/site.js';

gsap.registerPlugin(ScrollTrigger, SplitText);
if (reelRequested().on) ScrollTrigger.clearScrollMemory('manual'); // cada toma arranca arriba
ScrollTrigger.config({ ignoreMobileResize: true });

const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => [...el.querySelectorAll(q)];
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const query = new URLSearchParams(window.location.search);
const reel = reelRequested();
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
// Calidad alta (bloom, post-procesado, fotos vivas) en escritorio y en modo reel; ?q=low|high la fuerza.
const quality = query.get('q') || (finePointer || reel.on ? 'high' : 'low');
root.dataset.quality = quality;
// En modo reel la página queda limpia desde antes del primer cuadro (sin barra, cursor ni scrollbar).
if (reel.on) root.classList.add('rec', 'reel');

/* ───────── Contenido desde los datos ───────── */
const data = { brand, ui, ...copy };
const pick = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), data);

document.title = `${brand.name} — ${copy.hero.label}`;
$$('[data-c]').forEach((el) => { const v = pick(el.dataset.c); if (v != null) el.textContent = v; else el.remove(); });
$$('[data-h]').forEach((el) => {
  const lines = pick(`${el.dataset.h}.headline`) ?? [];
  el.innerHTML = lines.map((l) => (l.startsWith('*') ? `<em>${esc(l.slice(1))}</em>` : esc(l))).join('<br>');
});

$('#marquee').innerHTML = [...marquee, ...marquee, ...marquee].map((c) => `<span>${esc(c)}</span>`).join('');

$('#locs').innerHTML = locations.map((u, i) => `
  <div class="row" data-fade>
    <span class="mono n">${pad(i + 1)}</span>
    <span class="display nm">${esc(u.name)}</span>
    <span class="mono dt"><i>${esc(u.line)}</i><i>${esc(u.hours)}</i></span>
  </div>`).join('');

// Etiquetas colgadas del taco: punto, línea fina y texto.
const calloutSpec = [[0.56, 0.6, 'r'], [0.29, 0.4, 'l'], [0.72, 0.38, 'r']];
const callouts = (copy.taco.callouts ?? []).slice(0, 3).map((txt, i) => {
  const el = document.createElement('p');
  el.className = `callout mono ${calloutSpec[i][2]}`;
  el.innerHTML = `<i></i><span>${esc(txt)}</span>`;
  $('#callouts').append(el);
  return { el, u: calloutSpec[i][0], v: calloutSpec[i][1], side: calloutSpec[i][2], p: { x: 0, y: 0, vis: 0 } };
});

/* ───────── Mundo 3D ───────── */
const menuUrl = (img) => `/img/menu/${img}.webp`;
const canvas = $('#gl');
let world = null;
try {
  world = createWorld(canvas, shots, {
    quality, neonText, videos,
    brandLines: brand.lines,
    previews: menu.flatMap((g) => g.items.map((it) => menuUrl(it.img))),
  });
} catch (err) {
  console.warn('Sin WebGL: se muestra la versión sin 3D.', err);
  root.classList.add('no-gl');
}
if (reel.on) world?.setParallax(0);

/* ───────── Scroll ───────── */
const lenis = new Lenis({ lerp: 0.1, smoothWheel: !reduce, anchors: true });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

const sections = $$('[data-station]');
let centers = [];
const measure = () => {
  const y = window.scrollY;
  centers = sections.map((el) => { const r = el.getBoundingClientRect(); return r.top + y + r.height / 2; });
};
const stationAt = (y) => {
  const c = y + window.innerHeight / 2;
  if (c <= centers[0]) return 0;
  for (let i = 0; i < centers.length - 1; i++) {
    if (c < centers[i + 1]) return i + (c - centers[i]) / (centers[i + 1] - centers[i]);
  }
  return centers.length - 1;
};

const stNum = $('#st-num'), stName = $('#st-name'), stClock = $('#st-clock'), progress = $('#progress');
const tempN = $('#temp-n'), tempEl = tempN?.parentElement;
const fmtClock = (min) => {
  const m = Math.round(min) % (24 * 60);
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(mm)} ${h < 12 ? 'AM' : 'PM'}`;
};
// Del blanco hueso al blanco vivo pasando por brasa y neón.
const HEAT = [[243, 234, 217], [255, 122, 28], [255, 42, 23], [255, 244, 224]];
const heatColor = (k) => {
  const x = clamp(k, 0, 1) * (HEAT.length - 1), i = Math.min(HEAT.length - 2, Math.floor(x)), f = x - i;
  return `rgb(${HEAT[i].map((c, j) => Math.round(c + (HEAT[i + 1][j] - c) * f)).join(',')})`;
};

let lastIdx = -1, lastClock = '', lastTemp = -1;
const onScroll = () => {
  const y = lenis.scroll ?? window.scrollY;
  const s = stationAt(y);
  world?.setStation(s);

  const idx = Math.round(s);
  if (idx !== lastIdx) {
    lastIdx = idx;
    stNum.textContent = pad(idx + 1);
    stName.textContent = stations[idx] ?? '';
  }
  // El reloj de la barra: la noche avanza con el scroll.
  const ck = fmtClock(clock.from + (clock.to - clock.from) * (s / (sections.length - 1)));
  if (ck !== lastClock) { lastClock = ck; stClock.textContent = ck; }

  // Temperatura de la parrilla: sube mientras la cámara baja a las brasas.
  if (tempN) {
    const k = smooth(0.3, 0.97, s);
    const val = Math.round(copy.coal.from + (copy.coal.to - copy.coal.from) * k ** 1.5);
    if (val !== lastTemp) {
      lastTemp = val;
      tempN.textContent = val.toLocaleString('en-US');
      tempEl.style.setProperty('--heat', heatColor(k));
      tempEl.style.setProperty('--glow', String(smooth(0.45, 1, k)));
    }
  }

  const max = root.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;
};
// El scroll aviva el fuego. Con el piloto automático Lenis reporta velocidad 0, así que se usa el avance real.
let lastY = 0;
lenis.on('scroll', (e) => {
  const dy = e.scroll - lastY;
  lastY = e.scroll;
  const v = e.velocity || (Math.abs(dy) < window.innerHeight ? dy * 2.4 : 0);
  world?.stoke(Math.abs(v) / 70);
  onScroll();
});
window.addEventListener('scroll', onScroll, { passive: true });

let drum = null;
let rw = window.innerWidth;
window.addEventListener('resize', () => {
  world?.resize();
  drum?.update();
  measure();
  onScroll();
  if (window.innerWidth !== rw) { rw = window.innerWidth; ScrollTrigger.refresh(); }
});
new ResizeObserver(() => { measure(); onScroll(); }).observe($('#rail'));

// Etiquetas del taco: se colocan con la cámara del cuadro que se acaba de dibujar.
world?.onAfterFrame(() => {
  for (const c of callouts) {
    world.anchor('blackout', c.u, c.v, c.p);
    c.el.style.opacity = c.p.vis.toFixed(3);
    if (c.p.vis > 0.001) {
      c.el.style.transform = `translate3d(${c.p.x.toFixed(1)}px, ${c.p.y.toFixed(1)}px, 0)`;
      c.w ??= c.el.lastElementChild.offsetWidth + 120;
      const left = c.side === 'l' ? c.p.x - c.w > 12 : c.p.x + c.w > window.innerWidth - 12;
      c.el.classList.toggle('l', left);
      c.el.classList.toggle('r', !left);
    }
  }
});

/* ───────── Movimiento del texto ───────── */
function initMotion() {
  gsap.fromTo('#marquee', { xPercent: 0 }, {
    xPercent: -55, ease: 'none',
    scrollTrigger: { trigger: '#grill', start: 'top bottom', end: 'bottom top', scrub: true },
  });

  if (reduce) return;

  $$('[data-split]').forEach((el) => {
    SplitText.create(el, {
      type: 'lines', mask: 'lines', linesClass: 'ln', autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 115, duration: 1.05, ease: 'power4.out', stagger: 0.09,
          scrollTrigger: { trigger: el, start: 'top 92%', toggleActions: 'play none none reverse' },
          // Ya en su sitio, la máscara suelta el recorte para no cortar el resplandor del neón.
          onUpdate() {
            const o = this.progress() === 1 ? 'visible' : 'clip';
            self.masks?.forEach((m) => { m.style.overflow = o; });
          },
        });
      },
    });
  });

  $$('[data-fade]').forEach((el) => {
    gsap.from(el, {
      autoAlpha: 0, y: 16, duration: 0.9, ease: 'power2.out',
      // En la última sección el inicio se acota: si no, cae justo en el fondo de la página y nunca dispara.
      scrollTrigger: { trigger: el, start: el.closest('.s-end') ? 'clamp(top 94%)' : 'top 94%', toggleActions: 'play none none reverse' },
    });
  });
}

/* ───────── Encendido: una brasa, el golpe de calor y las letras al rojo vivo ───────── */
function ignite() {
  if (!world) return;
  const { hero, uniforms } = world;
  if (reduce) { uniforms.ignite.value = 1; hero.heat = 1; hero.cool = 1; return; }
  gsap.to(uniforms.ignite, { value: 1, duration: 1.1, ease: 'expo.out' });
  gsap.fromTo(hero, { burst: 0.55 }, { burst: 0, duration: 0.7, ease: 'power2.out' });
  gsap.to(hero, { heat: 1, duration: 1.55, delay: 0.2, ease: 'power1.inOut' });
  // En el reel las letras terminan de enfriar antes de que la cámara se vaya del hero.
  gsap.to(hero, { cool: 1, duration: reel.on ? 1.2 : 2.0, delay: reel.on ? 1.75 : 2.1, ease: 'power2.inOut' });
}
// Otra toma: se apaga todo y vuelve a encender, para que cada grabación empiece igual.
function relight() {
  if (!world) return;
  gsap.killTweensOf([world.uniforms.ignite, world.hero]);
  world.uniforms.ignite.value = 0;
  Object.assign(world.hero, { heat: 0, cool: 0, burst: 0 });
  ignite();
}

/* ───────── Cierre del reel: el tubo se apaga y queda una brasa, igual que el primer cuadro ───────── */
let outroTl = null;
function outro() {
  const o = { v: 0 };
  outroTl = gsap.timeline()
    .to(o, { v: 1, duration: 0.9, ease: 'power2.in', onUpdate: () => world?.setOutro(o.v) }, 0)
    .to(['#contact .copy', '.bar'], { autoAlpha: 0, duration: 0.6 }, 0)
    .to('#end-dot', { autoAlpha: 1, duration: 0.5 }, 0.75);
}
function undoOutro() {
  outroTl?.kill();
  outroTl = null;
  world?.setOutro(0);
  gsap.set(['#contact .copy', '.bar'], { clearProps: 'opacity,visibility' });
  gsap.set('#end-dot', { autoAlpha: 0 });
}

/* ───────── Arranque ───────── */
const loader = $('#loader');
async function boot() {
  // Las fuentes primero: letras de hierro y letreros se dibujan con Anton en un canvas.
  try {
    await Promise.all([document.fonts.load("400 240px 'Anton'"), document.fonts.ready]);
  } catch { /* sin API de fuentes: se sigue igual */ }
  if (world) await world.load();

  drum = initMenuDrum({
    section: $('#menu'), mount: $('#menu-drum'), menu,
    onActive: (it) => world?.setPreview(it ? menuUrl(it.img) : null),
  });

  if (reel.on) lenis.scrollTo(0, { immediate: true, force: true });
  measure();
  onScroll();
  world?.jump(stationAt(window.scrollY));
  // Dos cuadros para que la GPU compile todo detrás del telón, y se corta en seco.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))));
  loader.classList.add('out');
  ignite();
  initMotion();
  ScrollTrigger.refresh();

  initCursor();
  const autopilot = initReel({
    lenis, sections, duration: reel.seconds ?? 30, lead: 2.5,
    onStart: () => { undoOutro(); world?.setParallax(0); world?.jump(0); if (world && world.hero.cool >= 1) relight(); },
    onEnd: outro,
    onStop: () => { undoOutro(); world?.setParallax(1); },
  });
  if (reel.on) setTimeout(() => autopilot.start(), 250);
}
boot();
