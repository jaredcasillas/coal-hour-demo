// El mundo: una sola escena continua. El scroll mueve la cámara por un riel que sube con el humo:
// brasa → carbón → (cruza la parrilla) → cortes → taco → menú → ubicaciones → eventos → letrero final.
import * as THREE from 'three';
import { makeGrill, makeFlame, makeSparks, makeEmbers, makeSmoke } from './fire.js';
import { makeCoals } from './coals.js';
import { makePhoto } from './photo.js';
import { makeEmblem } from './emblem.js';
import { makeNeon } from './neon.js';
import { makeIronType } from './type.js';
import { makeGlyphSparks } from './glyphSparks.js';
import { createPost } from './post.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Riel: s = estación (puede ser fraccionaria); [posición de cámara, punto al que mira].
// d = horizontal, m = vertical. En s = 1.5 la cámara cruza la rejilla entre dos barras.
const RAIL = [
  { s: 0,   d: [V(0, 2.7, 9.6), V(0, 3.0, -1.5)],            m: [V(0, 3.9, 6.6), V(0, 4.0, -2.0)] },
  { s: 1,   d: [V(0.2, 0.62, 1.85), V(0.15, 0.08, -1.2)],    m: [V(0.2, 0.66, 1.9), V(0.2, 0.0, -0.9)] },
  { s: 1.5, d: [V(0.2, 1.0, 0.75), V(0.0, 2.3, -2.4)],       m: [V(0.2, 1.0, 0.75), V(-0.8, 2.2, -2.6)] },
  { s: 2,   d: [V(0.3, 2.55, 2.0), V(0.3, 2.6, -3.4)],       m: [V(-1.6, 2.4, 1.3), V(-1.6, 1.75, -3.2)] },
  { s: 3,   d: [V(0.4, 3.6, -1.4), V(0.4, 3.7, -6.6)],       m: [V(2.4, 3.8, -2.1), V(2.4, 3.15, -6.6)] },
  { s: 4,   d: [V(0.4, 6.7, -5.2), V(0.5, 7.3, -10.6)],      m: [V(0, 6.9, -6.0), V(0, 7.3, -10.6)] },
  { s: 5,   d: [V(-2.2, 10.1, -9.8), V(-2.2, 10.2, -16)],    m: [V(0, 10.1, -11.5), V(0, 9.45, -16)] },
  { s: 6,   d: [V(0.7, 15.2, -17.2), V(0.7, 15.3, -22.6)],   m: [V(-1.3, 15.1, -18.1), V(-1.3, 14.45, -22.6)] },
  { s: 7,   d: [V(0, 17.4, -13.0), V(0, 19.5, -24)],         m: [V(0, 17.6, -12.0), V(0, 19.9, -24)] },
];

// Fotos con profundidad a lo largo del riel: archivo <id>-l (horizontal) / <id>-p (vertical).
const PHOTOS = [
  { id: 'steaks',     st: 2,   near: 0.42, far: 0.97, strength: 0.85,
    d: { width: 3.8, pos: [-1.9, 2.6, -3.4], rotY: 0.14 },   m: { width: 3.0, pos: [-1.6, 2.9, -3.2], rotY: 0 } },
  { id: 'chorizo',    st: 2.5, near: 0.12, far: 0.44, strength: 0.7,
    d: { width: 2.8, pos: [0.5, 3.35, -5.8], rotY: 0 },      m: { width: 2.3, pos: [0.4, 3.9, -5.8], rotY: 0 } },
  { id: 'blackout',   st: 3,   near: 0.42, far: 0.97, strength: 0.8,
    d: { width: 3.8, pos: [2.6, 3.7, -6.6], rotY: -0.14 },   m: { width: 3.0, pos: [2.4, 4.3, -6.6], rotY: 0 } },
  { id: 'truck',      st: 5,   near: 0.5,  far: 1.0,  strength: 1.0,
    d: { width: 4.4, pos: [0.2, 10.2, -16], rotY: -0.06 },   m: { width: 3.0, pos: [0, 10.6, -16], rotY: 0 } },
  { id: 'field-fire', st: 6,   near: 0.4,  far: 0.9,  strength: 0.9,
    d: { width: 4.0, pos: [-1.6, 15.3, -22.6], rotY: 0.1 },  m: { width: 3.0, pos: [-1.3, 15.6, -22.6], rotY: 0 } },
];
// Vista previa del menú (estación 4): un solo panel cuyas texturas se funden.
const PREVIEW = { st: 4, near: 0.5, far: 0.95, aspect: 0.8,
  d: { width: 2.5, pos: [2.5, 7.35, -10.6], rotY: -0.12 }, m: { width: 2.3, pos: [0, 8.3, -10.6], rotY: 0 } };

const WARM = [0.5, 0.11, 0.05], GREY = [0.17, 0.16, 0.17], RED = [0.62, 0.05, 0.04], BLUE = [0.1, 0.15, 0.28];
const SMOKE = [
  { pos: [-2.6, 2.4, -4.2], scale: 4.6, tint: WARM, alpha: 0.3 },
  { pos: [2.8, 3.0, -4.4], scale: 4.8, tint: WARM, alpha: 0.28 },
  { pos: [0, 5.6, -4.6], scale: 6.2, tint: GREY, alpha: 0.32 },
  { pos: [0.5, 1.3, 0.2], scale: 2.4, tint: WARM, alpha: 0.2 },
  { pos: [-3.6, 3.4, -5.2], scale: 4.8, tint: GREY, alpha: 0.42 },
  { pos: [0.2, 2.2, -7.4], scale: 5, tint: WARM, alpha: 0.3 },
  { pos: [4.6, 4.6, -8.6], scale: 5, tint: GREY, alpha: 0.42 },
  { pos: [-2.8, 7.4, -12.4], scale: 6.5, tint: GREY, alpha: 0.44 },
  { pos: [3.4, 8.6, -13], scale: 6.5, tint: WARM, alpha: 0.26 },
  { pos: [-3.8, 10.7, -17.6], scale: 6, tint: RED, alpha: 0.44 },
  { pos: [3.8, 11.3, -17.8], scale: 6, tint: RED, alpha: 0.4 },
  { pos: [0, 12.8, -18.4], scale: 7, tint: BLUE, alpha: 0.3 },
  { pos: [-4.2, 16.0, -24.4], scale: 6, tint: BLUE, alpha: 0.42 },
  { pos: [1, 17.0, -26.6], scale: 7, tint: BLUE, alpha: 0.36 },
  { pos: [5.4, 14.4, -26.2], scale: 5.5, tint: GREY, alpha: 0.38 },
];

export function createWorld(canvas, shots, { quality = 'high', neonText = '', brandLines = [], videos = {}, previews = [] } = {}) {
  const hi = quality === 'high';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 1);
  // Los materiales ya escriben color de pantalla: ninguna conversión, con o sin postproceso.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 90);

  const U = {
    time: { value: 0 },
    ignite: { value: 0 },
    px: { value: 20 },
    cam: { value: new THREE.Vector3() },
  };
  const amb = { value: 0 };        // humo y pavesas: se apagan al llegar al final
  const sparkTime = { value: 0 };  // reloj propio de las chispas: el scroll las aviva

  scene.add(makeCoals(U, hi ? 520 : 300, { quality }));
  scene.add(makeGrill(U));
  const flame = makeFlame(U);
  scene.add(flame);
  scene.add(makeSparks({ ...U, time: sparkTime }, hi ? 1500 : 520));
  scene.add(makeEmbers({ ...U, ignite: amb }, hi ? 800 : 280));
  scene.add(makeSmoke({ ...U, ignite: amb }, SMOKE));

  const emblem = makeEmblem(U, { url: '/models/emblem.glb', size: 3.3 });
  scene.add(emblem.group);

  const post = createPost(renderer, scene, camera, { quality });
  const bloomBase = post.params.bloomStrength;
  const aberBase = post.params.aberration;

  let portrait = false;
  let iron = null, neon = null, preview = null;
  const photos = [];
  const finale = [];           // por línea: { neon, glyph }
  const previewTex = new Map();
  const hero = { heat: 0, cool: 0, burst: 0 };
  let outro = 0, parallax = 1, stoke = 0, stokeIn = 0;
  let warm = 0;

  function load(onProgress) {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_u, done, total) => onProgress?.(done / total);
    const loader = new THREE.TextureLoader(manager);
    const tex = (url, mip = true, onLoad) => {
      const t = loader.load(url, onLoad);
      t.generateMipmaps = mip;
      t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.anisotropy = hi ? 8 : 4;
      return t;
    };

    const k = portrait ? 'm' : 'd';
    const suf = portrait ? 'p' : 'l';

    return new Promise((resolve) => {
      let pending = 2;
      const done = () => { if (--pending === 0) { warm = 4; resolve(); } };
      manager.onLoad = done;
      manager.onError = (u) => console.warn('no cargó', u);
      emblem.ready.then(done);

      for (const p of PHOTOS) {
        const name = `${p.id}-${suf}`;
        const meta = shots[name];
        if (!meta) continue;
        const o = p[k];
        const mesh = makePhoto(U, {
          map: tex(`/img/${name}.webp`),
          depth: tex(`/img/${name}-depth.webp`, false),
          aspect: meta.aspect, width: o.width, pos: o.pos, rotY: o.rotY, strength: p.strength,
        });
        scene.add(mesh);
        const entry = { ...p, mesh, width: o.width, height: o.width / meta.aspect, video: null, f: 0 };
        const clip = hi ? videos[name] : null;
        if (clip) entry.video = attachVideo(mesh, clip);
        photos.push(entry);
      }

      // Vista previa del menú: plano sin relieve cuyas texturas se funden entre platillos.
      if (previews.length) {
        const flat = new THREE.DataTexture(new Uint8Array([115, 115, 115, 255]), 1, 1);
        flat.needsUpdate = true;
        // Se suben a la GPU al cargar: si no, cada platillo daría un tirón la primera vez que aparece.
        for (const url of previews) previewTex.set(url, tex(url, true, (t) => renderer.initTexture(t)));
        const o = PREVIEW[k];
        const first = previewTex.get(previews[0]);
        const mesh = makePhoto(U, { map: first, depth: flat, aspect: PREVIEW.aspect, width: o.width, pos: o.pos, rotY: o.rotY, strength: 0 });
        scene.add(mesh);
        preview = { mesh, cur: previews[0], next: null, mix: 0, on: false };
      }

      // Letras de hierro del arranque.
      if (brandLines.length) {
        iron = makeIronType(U, portrait ? { lines: brandLines, em: 2.35 } : { lines: [brandLines.join(' ')], em: 2.1 });
        iron.group.position.set(0, 1.15, -2.6);
        scene.add(iron.group);
      }

      // Letrero sobre el camión.
      if (neonText) {
        neon = makeNeon(U, { text: neonText });
        neon.mesh.position.set(...(portrait ? [0, 11.3, -15.6] : [0.2, 12.3, -16.2]));
        neon.mesh.scale.setScalar(portrait ? 0.62 : 1);
        scene.add(neon.mesh);
      }

      // Final: las pavesas arman el nombre y el neón prende donde cayeron.
      if (brandLines.length) {
        const rows = portrait
          ? brandLines.map((text, i) => ({ text, height: 2.9, pos: [0, 22.3 - i * 2.7, -24] }))
          : [{ text: brandLines.join(' '), height: 2.3, pos: [0, 20.6, -24] }];
        const per = Math.round((hi ? 16000 : 5000) / rows.length);
        for (const r of rows) {
          const sign = makeNeon(U, { text: r.text, height: r.height });
          sign.mesh.position.set(...r.pos);
          const glyph = makeGlyphSparks(U, { text: r.text, height: r.height, count: per });
          glyph.points.position.set(...r.pos);
          scene.add(sign.mesh, glyph.points);
          finale.push({ sign, glyph });
        }
      }
    });
  }

  // Dos <video> del mismo clip, desfasados medio ciclo: el shader los funde para que el bucle no salte.
  function attachVideo(mesh, src) {
    const make = () => {
      const v = document.createElement('video');
      v.src = src; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      return v;
    };
    const a = make(), b = make();
    const state = { a, b, ready: false, on: false, live: false, swap: null };
    const texOf = (v) => { const t = new THREE.VideoTexture(v); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
    let n = 0;
    const ok = () => {
      if (++n < 2) return;
      b.currentTime = a.duration / 2;
      const ta = texOf(a), tb = texOf(b);
      // La foto fija sigue puesta hasta que los dos videos ya corren (ver frame()).
      state.swap = () => { mesh.material.uniforms.uMap.value = ta; mesh.userData.setMapB(tb); };
      state.ready = true;
    };
    a.addEventListener('loadeddata', ok, { once: true });
    b.addEventListener('loadeddata', ok, { once: true });
    return state;
  }

  let posCurve, tgtCurve;
  function buildCurves() {
    const k = portrait ? 'm' : 'd';
    posCurve = new THREE.CatmullRomCurve3(RAIL.map((r) => r[k][0]), false, 'centripetal');
    tgtCurve = new THREE.CatmullRomCurve3(RAIL.map((r) => r[k][1]), false, 'centripetal');
  }
  // Estación → parámetro de la curva (las llaves no están espaciadas parejo).
  function railU(s) {
    const n = RAIL.length - 1;
    if (s <= RAIL[0].s) return 0;
    for (let i = 0; i < n; i++) {
      if (s < RAIL[i + 1].s) return (i + (s - RAIL[i].s) / (RAIL[i + 1].s - RAIL[i].s)) / n;
    }
    return 1;
  }

  let firstFit = true;
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    const wasPortrait = portrait;
    portrait = aspect < 0.85;
    // Fotos, letras y letrero se arman por orientación al cargar: si cambia, se recarga.
    if (!firstFit && wasPortrait !== portrait) { window.location.reload(); return; }
    firstFit = false;
    const vfov = (2 * Math.atan(Math.tan(20 * DEG) / aspect)) / DEG;
    camera.fov = clamp(vfov, 50, 78);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const pr = Math.min(window.devicePixelRatio || 1, hi ? 2 : 1.6);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(w, h, pr);
    U.px.value = renderer.domElement.height * 0.017;
    if (portrait) {
      emblem.group.position.set(0, 6.6, -2.4); emblem.group.scale.setScalar(0.84);
      flame.position.set(0, 4.4, -3.2); flame.scale.set(1.7, 2.2, 1);
    } else {
      emblem.group.position.set(0, 4.55, -2.3); emblem.group.scale.setScalar(1);
      flame.position.set(0, 3.3, -3.2); flame.scale.set(2.5, 1.5, 1);
    }
    buildCurves();
  }
  resize();

  let sTarget = 0, s = 0, t = 0;
  const pointer = new THREE.Vector2(), pSmooth = new THREE.Vector2();
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
  }, { passive: true });

  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3(), tmp = new THREE.Vector3();
  const ZERO = new THREE.Vector2();
  let afterFrame = null;
  const timer = new THREE.Timer();

  function frame(now) {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    t += dt;
    U.time.value = t;
    s += (sTarget - s) * (1 - Math.exp(-5.5 * dt));
    const W = warm > 0 ? 0.012 : 0; // primeros cuadros: todo se dibuja apenas, para compilar sin tirones después
    if (warm > 0) warm--;

    posCurve.getPoint(railU(s), camPos);
    tgtCurve.getPoint(railU(s), camTgt);

    // El scroll aviva el fuego: sube de golpe y decae solo.
    stoke = Math.max(stoke * Math.exp(-2.2 * dt), stokeIn);
    stokeIn = 0;
    sparkTime.value += dt * (1 + 2.6 * stoke);

    // Balanceo y paralaje del cursor; se apagan al cruzar la rejilla para no rozar las barras.
    // La ventana entra y sale de a poco (sin saltos al cruzar s = 0.7 ni s = 2.2).
    const cross = smooth(0.7, 1.0, s) * (1 - smooth(1.9, 2.2, s));
    const gate = 1 - cross * (1 - smooth(0.05, 0.5, Math.abs(camPos.y - 0.95)));
    // Sin paralaje (modo reel) el cursor deja de contar y cámara y cráneo vuelven solos al centro.
    pSmooth.lerp(parallax ? pointer : ZERO, 1 - Math.exp(-3 * dt));
    camPos.x += (pSmooth.x * 0.24 + Math.sin(t * 0.33) * 0.07) * gate;
    camPos.y += (pSmooth.y * 0.13 + Math.sin(t * 0.27 + 1.3) * 0.045) * gate;
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    U.cam.value.copy(camPos);

    const ig = U.ignite.value;
    const heroAmt = ig * (1 - smooth(0.35, 0.9, s));
    flame.material.uniforms.uAmt.value = Math.max(heroAmt * (1 + 0.6 * stoke), W);
    flame.visible = flame.material.uniforms.uAmt.value > 0.003;
    emblem.setAmount(Math.max(heroAmt, W));
    emblem.update(dt, t, pSmooth);
    if (iron) {
      iron.setHeat(hero.heat);
      iron.setCool(hero.cool);
      iron.setAmount(Math.max(1 - smooth(0.35, 0.9, s), W) * (hero.heat > 0 || W ? 1 : 0));
    }

    for (const p of photos) {
      p.f = (1 - smooth(p.near, p.far, Math.abs(s - p.st))) * ig;
      p.mesh.userData.setReveal(Math.max(p.f, W * 3));
      const v = p.video;
      if (v && v.ready) {
        const want = p.f > 0.02;
        if (want !== v.on) {
          v.on = want;
          // Si el navegador no deja reproducir sin gesto, se queda la foto fija.
          const blocked = (e) => { if (e && e.name === 'NotAllowedError') v.ready = false; };
          if (want) { v.a.play().catch(blocked); v.b.play().catch(blocked); } else { v.a.pause(); v.b.pause(); }
        }
        if (want && !v.live && !v.a.paused && !v.b.paused && v.a.currentTime > 0.08 && v.b.readyState >= 2) { v.swap(); v.live = true; }
        if (want && v.live && v.a.duration) {
          // uMap = video a, uMapB = video b (medio ciclo después): cuando a salta (ph = 0) manda b, y al revés.
          const ph = v.a.currentTime / v.a.duration;
          p.mesh.userData.setMix(Math.abs(ph * 2 - 1));
        }
      }
    }

    if (preview) {
      const f = (1 - smooth(PREVIEW.near, PREVIEW.far, Math.abs(s - PREVIEW.st))) * ig * (preview.on ? 1 : 0);
      preview.mesh.userData.setReveal(Math.max(f, W * 3));
      if (preview.next) {
        preview.mix = Math.min(1, preview.mix + dt / 0.28);
        preview.mesh.userData.setMix(preview.mix);
        if (preview.mix >= 1) {
          preview.mesh.material.uniforms.uMap.value = previewTex.get(preview.next);
          preview.mesh.userData.setMix(0);
          preview.cur = preview.next; preview.next = null; preview.mix = 0;
          const q = preview.queued; preview.queued = null;
          if (q && q !== preview.cur) setPreview(q);
        }
      }
    }

    if (neon) neon.setAmount(Math.max((1 - smooth(0.35, 0.9, Math.abs(s - 5))) * ig, W));

    // Final: las pavesas se juntan, arman el nombre y el tubo de neón prende encima.
    const gather = smooth(6.02, 6.3, s), form = smooth(6.22, 6.8, s), lit = smooth(6.8, 6.95, s) * (1 - outro);
    for (const f of finale) {
      f.glyph.setForm(form);
      f.glyph.setAmount(Math.max(gather * ig * (1 - 0.62 * form) * (1 - lit) * (1 - outro), W));
      f.sign.setAmount(Math.max(lit * ig, W));
    }
    amb.value = ig * (1 - 0.86 * smooth(6.2, 6.85, s)) * (1 - outro);

    // Calor sobre las brasas, más brillo y aberración cuando el scroll aviva el fuego.
    post.params.heat = (1 - smooth(0.25, 1.1, Math.abs(s - 1))) * 0.9 + (1 - smooth(0.0, 0.8, s)) * 0.25;
    post.params.bloomStrength = bloomBase + 0.45 * stoke + hero.burst;
    post.params.aberration = aberBase + 0.0035 * stoke;
    post.render();
    afterFrame?.();
  }
  renderer.setAnimationLoop(frame);

  function setPreview(url) {
    if (!preview) return;
    if (!url) { preview.on = false; preview.queued = null; return; }
    if (!previewTex.has(url)) return;
    preview.on = true;
    if (preview.next) { preview.queued = url; return; }
    if (url === preview.cur) return;
    preview.next = url; preview.mix = 0;
    preview.mesh.userData.setMapB(previewTex.get(url));
  }

  // Punto (u, v) de una foto → pixeles de pantalla. Sirve para colgar etiquetas de la imagen.
  function anchor(id, u, v, out) {
    const p = photos.find((x) => x.id === id);
    if (!p) { out.vis = 0; return out; }
    tmp.set((u - 0.5) * p.width, (0.5 - v) * p.height, 0.12);
    p.mesh.localToWorld(tmp).project(camera);
    out.x = (tmp.x * 0.5 + 0.5) * (canvas.clientWidth || window.innerWidth);
    out.y = (-tmp.y * 0.5 + 0.5) * (canvas.clientHeight || window.innerHeight);
    out.vis = tmp.z < 1 ? smooth(0.85, 1, p.f) : 0;
    return out;
  }

  return {
    load,
    resize,
    uniforms: U,
    hero,
    post,
    setPreview,
    anchor,
    get portrait() { return portrait; },
    setStation(v) { sTarget = v; },
    jump(v) { sTarget = v; s = v; },
    get station() { return s; },
    stoke(v) { stokeIn = Math.max(stokeIn, clamp(v, 0, 1)); },
    setOutro(v) { outro = clamp(v, 0, 1); },
    setParallax(v) { parallax = v; },
    onAfterFrame(fn) { afterFrame = fn; },
  };
}
