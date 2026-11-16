// Tambor del menú: la sección es alta y su contenido queda fijo; al hacer scroll
// la lista rueda por una ventana fija y el renglón que cruza la línea central se
// enciende. Ese renglón es el que manda la vista previa 3D (onActive).
import './menu-drum.css';

const DEAD = 0.06;    // zona muerta en cada extremo del recorrido (fracción del scroll de la sección)
const OMEGA = 18;     // rigidez del resorte (1/s): más alto = más pegado al scroll
const NEAR = '50%';   // margen alrededor de la pantalla en el que la sección cuenta como "cerca"
const SHIFT = 14;     // lo que se recorre el nombre encendido (px, igual que en el CSS)
const HOLD = 3;       // ventaja del renglón encendido para no parpadear entre dos (px)
const FIT_MIN = 0.5;  // lo más que se encoge la lista si un nombre no cabe
const MAX_DT = 0.05;  // un cuadro nunca avanza más que esto (s)

// Imán: cuando el scroll casi se detiene, el renglón que viene en camino termina de llegar a la
// línea central (y si apenas se pasó de uno, regresa a él). En movimiento no interviene.
// Para apagarlo: STILL = LOOSE = 0.
const STILL = 24;     // la lista va más lenta que esto (px/s) → el imán jala
const LOOSE = 48;     // y la suelta cuando pasa de esto (px/s)
const AVG = 0.08;     // ventana con que se promedia la velocidad del scroll (s)
const AHEAD = 0.55;   // jala al renglón de adelante si le falta menos de esto (en renglones)
const BACK = 0.12;    // y al de atrás si se pasó menos de esto (en renglones)

const NOOP = { update() {}, destroy() {} };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pad = (n) => String(n).padStart(2, '0');
const pick = (q) => (typeof q === 'string' ? document.querySelector(q) : q);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function initMenuDrum({ section, mount, menu, onActive } = {}) {
  const host = pick(section), root = pick(mount);
  const groups = (Array.isArray(menu) ? menu : []).filter((g) => g && Array.isArray(g.items) && g.items.length);
  if (!host || !root || !groups.length) return NOOP;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  /* ───────── Lista ───────── */
  const drum = el('div', 'drum');
  const view = el('div', 'drum-view');
  const list = el('ul', 'drum-list');
  list.setAttribute('role', 'list');
  const rows = [];  // todos los renglones en orden: encabezados y platillos
  const items = []; // solo platillos
  for (const g of groups) {
    const head = el('li', 'drum-head');
    head.appendChild(el('span', 'drum-group', g.note ? `${g.group} — ${g.note}` : g.group));
    rows.push(head);
    g.items.forEach((it, i) => {
      const row = el('li', 'drum-row');
      const num = el('span', 'drum-n', pad(i + 1)); // el número reinicia en cada grupo
      const name = el('span', 'drum-name', it.name);
      name.dataset.glow = it.name; // el CSS pinta el resplandor con una copia del nombre
      row.append(num, name);
      items.push({
        row, num, name,
        k: rows.length, // lugar en la lista completa
        c: 0,           // centro del renglón dentro de la lista (px)
        info: { name: it.name, img: it.img, group: g.group, index: items.length }, // index: corrido, sin reiniciar
      });
      rows.push(row);
    });
  }
  list.append(...rows);
  view.appendChild(list);
  drum.appendChild(view);
  root.appendChild(drum);
  host.classList.add('drum-host');

  /* ───────── Estado ───────── */
  let H = 0, c0 = 0, c1 = 0, pitch = 0; // alto de la ventana; centro del primer y del último platillo; alto de renglón (px)
  let fit = 1;                          // encogimiento cuando el nombre más largo no cabe
  let y = 0, v = 0, drawn = null;       // posición de la lista, velocidad y lo último que se pintó
  let raw = null, speed = 0, dir = 0;   // punto de la lista que pide el scroll, su velocidad promediada (px/s) y su sentido
  let aim = 0, slow = true, latch = -1; // punto que va a la línea central; imán activo; platillo que tiene agarrado
  let active = -1, emitted = -1;        // platillo en la línea central y el último avisado (-1 = ninguno)
  let raf = 0, last = 0;
  let looping = false, stale = false, snap = true, live = false, dead = false;

  /* ───────── Medidas ───────── */
  function measure() {
    stale = false;
    const h = view.clientHeight;

    // Si el nombre más largo no cabe en el renglón, toda la lista se encoge lo justo.
    const a = items[0];
    const gap = parseFloat(getComputedStyle(a.row).columnGap) || 0;
    const room = a.row.clientWidth - a.num.offsetWidth - gap - SHIFT;
    let widest = 0;
    for (const it of items) widest = Math.max(widest, it.name.offsetWidth);
    const natural = widest / fit;
    const next = room > 0 && natural > room ? Math.max(FIT_MIN, room / natural) : 1;
    if (Math.abs(next - fit) > 0.003) {
      fit = next;
      list.style.setProperty('--fit', fit.toFixed(4));
    }

    // offsetTop no cambia con los transform: es la posición real dentro de la lista.
    for (const it of items) it.c = it.row.offsetTop + it.row.offsetHeight / 2;
    const first = items[0].c, end = items[items.length - 1].c, tall = a.row.offsetHeight;
    // Solo si algo cambió de verdad se empieza de nuevo y la lista se coloca sin animar. Si todo mide
    // igual (en el teléfono la barra del navegador se esconde y avisa "resize" a medio scroll),
    // la lista sigue rodando sin brinco.
    if (h !== H || first !== c0 || end !== c1 || tall !== pitch) {
      raw = null;
      snap = true;
    }
    H = h;
    c0 = first;
    c1 = end;
    pitch = tall;
  }

  /* ───────── Renglón encendido ───────── */
  // El platillo cuyo centro queda más cerca de `line` (px dentro de la lista).
  // `keep` lleva una pequeña ventaja para no brincar entre dos que están casi igual.
  function nearest(line, keep) {
    let best = keep < 0 ? 0 : keep;
    let min = Math.abs(items[best].c - line) - (keep < 0 ? 0 : HOLD);
    for (let i = 0; i < items.length; i++) {
      const dist = Math.abs(items[i].c - line);
      if (dist < min) { min = dist; best = i; }
    }
    return best;
  }

  function light(i) {
    if (i === active) return;
    if (active >= 0) {
      const old = items[active].row;
      old.classList.remove('on');
      old.removeAttribute('aria-current');
    }
    active = i;
    const it = items[i];
    it.row.classList.add('on');
    it.row.setAttribute('aria-current', 'true');
    // --d: a cuántos renglones queda cada uno del que está en el centro.
    for (let r = 0; r < rows.length; r++) rows[r].style.setProperty('--d', String(Math.abs(r - it.k)));
  }

  function tell(i) {
    if (!live || i === emitted) return;
    // .seen: la sección está en pantalla (el CSS solo anima el halo entonces).
    if ((i < 0) !== (emitted < 0)) drum.classList.toggle('seen', i >= 0);
    emitted = i;
    if (typeof onActive === 'function') onActive(i < 0 ? null : items[i].info);
  }

  /* ───────── Imán ───────── */
  // Con el scroll casi quieto, devuelve el punto que debe quedar en la línea central:
  // el centro de un platillo si hay uno a tiro, o el mismo `line` si no.
  function settle(line) {
    const sign = dir < 0 ? -1 : 1; // con el signo, g > 0 quiere decir "viene adelante"
    const ahead = pitch * AHEAD;
    const back = dir ? pitch * BACK : ahead; // sin sentido conocido (recién colocado): el que esté más cerca
    // El que ya tiene agarrado se queda mientras siga a tiro (con un poco de holgura).
    if (latch >= 0) {
      const g = (items[latch].c - line) * sign;
      if (g >= 0 ? g <= ahead + HOLD : -g <= back + HOLD) return items[latch].c;
    }
    latch = -1;
    let min = Infinity;
    for (let i = 0; i < items.length; i++) {
      const g = (items[i].c - line) * sign;
      const far = g < 0 ? -g : g;
      if (far < min && far <= (g < 0 ? back : ahead)) { min = far; latch = i; }
    }
    return latch < 0 ? line : items[latch].c;
  }

  /* ───────── Un paso: scroll → posición → renglón central ───────── */
  function step(dt) {
    const rect = host.getBoundingClientRect();
    // Sección oculta (display: none): no hay nada que colocar ni que avisar.
    if (!rect.height || !H) { tell(-1); return; }
    const vh = window.innerHeight;
    const span = rect.height - vh;
    const p = span > 0 ? clamp(-rect.top / span, 0, 1) : 0;
    const q = clamp((p - DEAD) / (1 - 2 * DEAD), 0, 1);
    // Punto de la lista que el scroll pone en la línea central:
    // el primer platillo al inicio de la sección, el último al final.
    const line = c0 + (c1 - c0) * q;
    const plain = reduce.matches; // movimiento reducido: sin resorte ni imán

    if (raw === null) {
      aim = line;
    } else if (dt > 0) {
      const moved = line - raw;
      if (moved) dir = moved > 0 ? 1 : -1;
      // Velocidad promediada: el scroll avanza en pixeles enteros y cuadro a cuadro brinca.
      speed += (Math.abs(moved) / dt - speed) * (1 - Math.exp(-dt / AVG));
    }
    raw = line;

    slow = !plain && speed < (slow ? LOOSE : STILL);
    if (slow) {
      aim = settle(line);
    } else {
      latch = -1;
      // Al soltarse no retrocede: si el imán la dejó adelantada, espera a que el scroll la alcance.
      aim = plain || !dir ? line : dir > 0 ? Math.max(line, aim) : Math.min(line, aim);
    }
    const target = H / 2 - aim;

    if (snap || plain) {
      snap = false;
      y = target;
      v = 0;
    } else {
      // Resorte con amortiguamiento crítico (solución exacta): alcanza sin rebotar,
      // igual a cualquier tasa de cuadros.
      const d = y - target, c = v + OMEGA * d, e = Math.exp(-OMEGA * dt);
      y = target + (d + c * dt) * e;
      v = (c - OMEGA * (d + c * dt)) * e;
      if (Math.abs(y - target) < 0.02 && Math.abs(v) < 0.5) { y = target; v = 0; } // ya llegó
    }

    // En reposo cae en un pixel entero de la pantalla (texto nítido); en movimiento va sin redondear.
    const dpr = window.devicePixelRatio || 1;
    const out = v === 0 ? Math.round(y * dpr) / dpr : y;
    if (out !== drawn) {
      drawn = out;
      list.style.transform = `translate3d(0, ${out.toFixed(3)}px, 0)`;
    }

    // Se enciende el platillo que de verdad está en la línea central (posición ya suavizada).
    light(nearest(H / 2 - y, active));

    // Solo se avisa mientras la sección se ve; al salir de la pantalla, null.
    tell(rect.bottom > 0 && rect.top < vh ? active : -1);
  }

  /* ───────── Bucle: solo corre con la sección cerca de la pantalla ───────── */
  function frame(now) {
    raf = looping ? requestAnimationFrame(frame) : 0;
    const dt = clamp((now - last) / 1000, 0, MAX_DT);
    last = now;
    if (stale) measure();
    step(dt);
  }
  // Pide un cuadro; si el bucle está apagado, corre ese y se detiene.
  function kick() {
    if (raf || dead) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const io = new IntersectionObserver((entries) => {
    looping = entries[entries.length - 1].isIntersecting;
    if (looping) {
      // Al volver se coloca donde va, sin recorrer lo que pasó mientras dormía,
      // y se olvida la velocidad y el sentido con que se fue.
      raw = null;
      snap = true;
      speed = 0;
      dir = 0;
      kick();
    } else {
      tell(-1);
    }
  }, { rootMargin: `${NEAR} 0px` });
  io.observe(host);

  // Cambios de tamaño de la ventana o de la lista (p. ej. cuando termina de cargar la fuente).
  const ro = new ResizeObserver(() => { stale = true; kick(); });
  ro.observe(view);
  ro.observe(list);

  // Primera colocación sin avisar: onActive nunca se llama antes de que initMenuDrum regrese.
  measure();
  step(0);
  live = true;

  return {
    // Vuelve a medir y coloca la lista (la página lo llama al cambiar de tamaño).
    update() {
      if (dead) return;
      measure();
      step(0);
    },
    destroy() {
      if (dead) return;
      looping = false;
      cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      tell(-1);
      dead = true;
      drum.remove();
      host.classList.remove('drum-host');
    },
  };
}
