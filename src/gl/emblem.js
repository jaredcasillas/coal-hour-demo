// Emblema: cráneo de toro longhorn (GLB) con un aro de neón detrás.
// Aquí no hay luces de three: la luz se finge en el shader con la normal y la mirada
// (brasa desde abajo y al frente, neón rojo desde atrás, un frío tenue desde arriba)
// y lo que se escribe es color de pantalla, igual que en el resto de la escena.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { NOISE } from './glsl.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// De dónde viene cada luz, en el marco del grupo (el cráneo mira a +z).
const KEY_DIR = new THREE.Vector3(0.18, -0.62, 0.76).normalize();   // brasa: abajo y al frente
const FILL_DIR = new THREE.Vector3(-0.25, 0.9, 0.35).normalize();   // frío: arriba
const BACK_DIR = new THREE.Vector3(0.0, 0.1, -1.0).normalize();     // neón: atrás

// Cuánto se mueve el cráneo (radianes). El aro se coloca contando con este giro.
const YAW = 0.22, YAW_IDLE = 0.03, PITCH = 0.09, PITCH_IDLE = 0.012;

// Parpadeo del neón. Lo comparten el aro, el halo y el contraluz del cráneo, para que
// cuando el tubo falla también falle la luz que le pega al hueso.
const NEON = /* glsl */ `
float neonFlick(float t, float amt, float steady){
  float slow = 0.94 + 0.06 * sin(t * 1.1) * sin(t * 0.63 + 1.7);
  float hum = 0.985 + 0.015 * sin(t * 53.0);
  // Mal contacto: una ráfaga corta, en algunas ventanas de 9 s.
  float k = floor(t / 9.0);
  float ph = t - k * 9.0;
  float start = 1.5 + 5.5 * hash21(vec2(k, 3.7));
  float win = step(start, ph) * (1.0 - step(start + 0.45, ph));
  float rare = step(0.4, hash21(vec2(k, 91.3)));
  float chop = step(0.45, hash21(vec2(floor(t * 22.0), 5.1)));
  // Mientras se enciende o se apaga (steady = 0) el tubo tartamudea; quieto, se queda fijo.
  float strike = mix(0.35 + 0.65 * step(0.45, hash21(vec2(floor(t * 22.0), 9.3))), 1.0, max(smoothstep(0.5, 0.92, amt), steady));
  return slow * hum * strike * (1.0 - 0.88 * win * rare * chop);
}
vec3 safeN(vec3 v){ float l = dot(v, v); return l > 1e-16 ? v / sqrt(l) : vec3(0.0, 0.0, 1.0); }
`;

/* ───────────── Cráneo: luz fingida ───────────── */
// Los #define propios llevan prefijo EMB_ para no chocar con los de three: three ya define
// HAS_NORMAL (cuando la malla trae normales) y USE_COLOR, y no siempre en los dos shaders.
const SKIN_VERT = /* glsl */ `
  uniform mat3 uUvMat;
  varying vec3 vW; varying vec3 vN; varying vec2 vUv;
  #ifdef EMB_VCOLOR
    varying vec3 vCol;
  #endif
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    // Normal a espacio de mundo (aguanta escalas no uniformes del GLB).
    vN = (vec4(normalMatrix * normal, 0.0) * viewMatrix).xyz;
    vUv = (uUvMat * vec3(uv, 1.0)).xy;
    #ifdef EMB_VCOLOR
      vCol = color.rgb;
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const SKIN_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime; uniform float uAmt; uniform float uSteady; uniform float uSize;
  uniform vec3 uKeyDir; uniform vec3 uFillDir; uniform vec3 uBackDir; uniform vec3 uUp; uniform vec3 uOrigin;
  #ifdef EMB_MAP
    uniform sampler2D uMap; uniform vec3 uTint;
  #endif
  #ifdef EMB_NORMALMAP
    uniform sampler2D uNormalMap; uniform vec2 uNormalScale;
  #endif
  #ifdef EMB_AOMAP
    uniform sampler2D uAoMap; uniform float uAoAmt;
  #endif
  varying vec3 vW; varying vec3 vN; varying vec2 vUv;
  #ifdef EMB_VCOLOR
    varying vec3 vCol;
  #endif
  ${NOISE}
  ${NEON}
  void main(){
    float face = 1.0;
    #ifdef DOUBLE_SIDED
      face = gl_FrontFacing ? 1.0 : -1.0;
    #endif
    vec3 ng = safeN(vN) * face;
    vec3 n = ng;
    #ifdef EMB_NORMALMAP
      // Relieve del mapa de normales, con el marco tangente sacado por derivadas.
      vec3 q0 = dFdx(vW);
      vec3 q1 = dFdy(vW);
      vec2 s0 = dFdx(vUv);
      vec2 s1 = dFdy(vUv);
      vec3 q1p = cross(q1, ng);
      vec3 q0p = cross(ng, q0);
      vec3 T = q1p * s0.x + q0p * s1.x;
      vec3 B = q1p * s0.y + q0p * s1.y;
      float det = max(dot(T, T), dot(B, B));
      float sc = det > 0.0 ? face / sqrt(det) : 0.0;
      vec3 mN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
      mN.xy *= uNormalScale;
      n = safeN(T * (mN.x * sc) + B * (mN.y * sc) + ng * mN.z);
    #endif
    vec3 v = safeN(cameraPosition - vW);
    float ndv = clamp(dot(n, v), 0.0, 1.0);

    // Color base: la textura del modelo (leída cruda) o color hueso.
    #ifdef EMB_MAP
      vec3 base = texture2D(uMap, vUv).rgb * uTint;
    #else
      #ifdef EMB_VCOLOR
        vec3 base = vec3(1.0);
      #else
        vec3 base = vec3(0.86, 0.80, 0.68);
      #endif
    #endif
    #ifdef EMB_VCOLOR
      base *= pow(max(vCol, 0.0), vec3(0.4545));
    #endif

    // Cavidad: lo que se ve de canto, y lo que el relieve hunde, se oscurece un poco.
    float cav = 0.66 + 0.34 * smoothstep(0.0, 0.6, ndv);
    #ifdef EMB_NORMALMAP
      cav *= 0.72 + 0.28 * smoothstep(0.3, 1.0, dot(n, ng));
    #endif
    #ifdef EMB_AOMAP
      cav *= mix(1.0, texture2D(uAoMap, vUv).r, uAoAmt);
    #endif

    // Altura dentro del emblema: abajo está más cerca de la brasa.
    float hgt = clamp(dot(vW - uOrigin, uUp) / max(uSize, 0.0001) + 0.5, 0.0, 1.0);
    float low = 1.0 - smoothstep(0.2, 0.8, hgt);

    // Luz principal: brasa desde abajo y al frente, con parpadeo lento.
    float flick = 0.8 + 0.3 * vnoise(vec2(uTime * 1.3, 3.7)) + 0.1 * vnoise3(vec3(vW.xy * 1.3, uTime * 0.7));
    float kd = dot(n, uKeyDir);
    float key = clamp((kd + 0.24) / 1.24, 0.0, 1.0);
    key = mix(key, key * key, 0.7) * mix(0.78, 1.18, low) * flick;
    // Brillo suave de hueso pulido (no metal): ancho y discreto.
    float spec = pow(clamp(dot(n, safeN(uKeyDir + v)), 0.0, 1.0), 20.0) * smoothstep(-0.1, 0.25, kd) * flick;

    // Relleno frío, tenue, desde arriba.
    float fill = clamp(dot(n, uFillDir) * 0.5 + 0.5, 0.0, 1.0);
    fill *= fill;

    // Neón rojo desde atrás: tiñe lo que le da la espalda a la cámara y enciende el borde.
    float neon = neonFlick(uTime, uAmt, uSteady);
    // El borde sigue sobre todo la silueta; del relieve fino solo toma un poco.
    vec3 nr = safeN(ng * 0.78 + n * 0.22);
    float fres = pow(1.0 - clamp(dot(nr, v), 0.0, 1.0), 3.0);
    float bk = clamp(dot(nr, uBackDir), -1.0, 1.0);
    float rim = fres * (0.72 + 0.28 * bk);

    vec3 KEY = vec3(1.0, 0.45, 0.12);
    vec3 RIM = vec3(1.0, 0.12, 0.06);
    vec3 light = (KEY * 1.05 + vec3(0.14, 0.11, 0.08)) * key
               + vec3(0.10, 0.15, 0.25) * fill
               + RIM * clamp(bk, 0.0, 1.0) * 0.8 * neon
               + vec3(0.03, 0.026, 0.028);
    vec3 col = base * light * cav;
    col += vec3(1.0, 0.62, 0.3) * spec * 0.24 * cav;
    // El borde puede pasar de 1.0: es lo que recoge el bloom.
    col += (RIM * 2.4 + vec3(0.7, 0.3, 0.22) * fres * fres) * rim * neon;

    gl_FragColor = vec4(col * uAmt, 1.0);
  }`;

// `yaw` (opcional, radianes): giro fijo del modelo sobre y antes de centrarlo. Sin él, el
// módulo decide solo: 0 si el GLB ya mira a +z, un cuarto de vuelta si llega de perfil.
// `url` vacía (null, '' o false): no se descarga el modelo; quedan solo el aro y el halo.
export function makeEmblem(U, { url = '/models/emblem.glb', size = 3.2, yaw } = {}) {
  const group = new THREE.Group();
  const pivot = new THREE.Group(); // lo único que se mueve: el cráneo
  pivot.rotation.order = 'YXZ';
  group.add(pivot);

  const k = size / 3.2;            // todo lo que va en unidades se escala con el tamaño
  const ringR = size * 0.42;
  const tube = 0.022 * k;
  const haloR = ringR * 2.2;       // medio lado del plano del halo

  // Uniforms propios, compartidos entre cráneo, aro y halo.
  const amt = { value: 1 };
  const steady = { value: 1 };     // 0 mientras la intensidad cambia, 1 cuando lleva un rato quieta
  const uSize = { value: size };
  const L = {
    key: { value: KEY_DIR.clone() },
    fill: { value: FILL_DIR.clone() },
    back: { value: BACK_DIR.clone() },
    up: { value: new THREE.Vector3(0, 1, 0) },
    origin: { value: new THREE.Vector3() },
  };

  /* ───────────── Aro de neón ───────────── */
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(ringR, tube, 16, 240),
    new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uAmt: amt, uSteady: steady },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec3 vN; varying vec2 vUv;
        void main(){
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vN = (vec4(normalMatrix * normal, 0.0) * viewMatrix).xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime; uniform float uAmt; uniform float uSteady;
        varying vec3 vW; varying vec3 vN; varying vec2 vUv;
        ${NOISE}
        ${NEON}
        void main(){
          float f = clamp(dot(safeN(vN), safeN(cameraPosition - vW)), 0.0, 1.0);
          // El gas no brilla parejo a lo largo del tubo (periódico, sin costura).
          float a = vUv.x * 6.2831853;
          float gas = 0.94 + 0.06 * sin(a * 7.0 + uTime * 0.8) * sin(a * 3.0 - uTime * 0.5);
          vec3 col = mix(vec3(1.7, 0.1, 0.06), vec3(3.2, 0.5, 0.3), smoothstep(0.1, 0.8, f));
          col += vec3(0.5, 0.45, 0.4) * pow(f, 8.0);
          gl_FragColor = vec4(col * gas * neonFlick(uTime, uAmt, uSteady) * uAmt, 1.0);
        }`,
    }),
  );

  /* ───────────── Halo: el aro sigue brillando aunque no haya bloom ───────────── */
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(haloR * 2, haloR * 2),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: U.time, uAmt: amt, uSteady: steady, uRing: { value: ringR / haloR } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime; uniform float uAmt; uniform float uSteady; uniform float uRing;
        varying vec2 vUv;
        ${NOISE}
        ${NEON}
        void main(){
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          float d = abs(r - uRing) / uRing;                 // distancia al tubo, en radios del aro
          float tight = exp(-d * d * 600.0);                // pegado al tubo (le suaviza el filo)
          float haze = 0.8 + 0.4 * fbm(p * 2.6 + vec2(3.1, -uTime * 0.04));
          float glow = tight * 0.6
                     + (exp(-d * 9.0) * 0.3 + exp(-d * 2.6) * 0.14) * haze
                     + 0.05 * (1.0 - smoothstep(0.0, uRing, r));
          glow *= 1.0 - smoothstep(0.55, 1.0, r);            // muere antes del borde del plano
          vec3 col = mix(vec3(1.0, 0.06, 0.03), vec3(1.0, 0.36, 0.24), tight);
          float a = glow * neonFlick(uTime, uAmt, uSteady) * uAmt;
          // Tramado: evita bandas en el degradado oscuro (se nota al grabar pantalla).
          a += (hash21(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * 0.006 * smoothstep(0.0, 0.02, a);
          gl_FragColor = vec4(col, max(a, 0.0));
        }`,
    }),
  );
  halo.renderOrder = 5; // después del humo, antes de las chispas

  const placeRing = (z) => {
    ring.position.z = z;
    halo.position.z = z - tube * 2;
  };
  placeRing(-size * 0.12);
  group.add(halo, ring);

  /* ───────────── Material del cráneo ───────────── */
  const skins = new Map();
  function makeSkin(src, hasUv, hasCol, hasTan) {
    // Solo texturas que usan el primer juego de UV.
    const pick = (t) => (t && t.isTexture && hasUv && t.channel === 0 ? t : null);
    const map = pick(src?.map), nrm = pick(src?.normalMap), ao = pick(src?.aoMap);
    const defines = {};
    if (hasCol) defines.EMB_VCOLOR = '';
    const uniforms = {
      uTime: U.time, uAmt: amt, uSteady: steady, uSize,
      uKeyDir: L.key, uFillDir: L.fill, uBackDir: L.back, uUp: L.up, uOrigin: L.origin,
      uUvMat: { value: new THREE.Matrix3() },
    };
    // gltfpack/meshopt cuantiza las UV y las corrige con una transformación de textura.
    const first = map || nrm || ao;
    if (first) {
      if (first.matrixAutoUpdate) first.updateMatrix();
      uniforms.uUvMat.value.copy(first.matrix);
    }
    if (map) {
      map.colorSpace = THREE.NoColorSpace; // cruda: ya viene en color de pantalla
      map.anisotropy = Math.max(map.anisotropy, 8);
      map.needsUpdate = true;
      const c = src.color?.isColor ? src.color.clone().convertLinearToSRGB() : new THREE.Color(1, 1, 1);
      defines.EMB_MAP = '';
      uniforms.uMap = { value: map };
      uniforms.uTint = { value: new THREE.Vector3(c.r, c.g, c.b) };
    }
    if (nrm) {
      nrm.anisotropy = Math.max(nrm.anisotropy, 8);
      nrm.needsUpdate = true;
      // GLTFLoader ya voltea la y cuando la malla no trae tangentes; aquí nunca se usan.
      const ns = src.normalScale?.isVector2 ? src.normalScale.clone() : new THREE.Vector2(1, -1);
      if (hasTan) ns.y *= -1;
      defines.EMB_NORMALMAP = '';
      uniforms.uNormalMap = { value: nrm };
      uniforms.uNormalScale = { value: ns };
    }
    if (ao) {
      defines.EMB_AOMAP = '';
      uniforms.uAoMap = { value: ao };
      uniforms.uAoAmt = { value: clamp(num(src.aoMapIntensity, 1), 0, 1) };
    }
    return new THREE.ShaderMaterial({
      uniforms, defines,
      vertexColors: hasCol,
      side: src?.side ?? THREE.FrontSide,
      vertexShader: SKIN_VERT,
      fragmentShader: SKIN_FRAG,
    });
  }
  function skinFor(src, geo) {
    const hasUv = !!geo.attributes.uv, hasCol = !!geo.attributes.color, hasTan = !!geo.attributes.tangent;
    const id = `${src?.uuid ?? 'x'}|${hasUv}|${hasCol}|${hasTan}`;
    let m = skins.get(id);
    if (!m) { m = makeSkin(src, hasUv, hasCol, hasTan); skins.set(id, m); }
    return m;
  }

  /* ───────────── Montaje del GLB: centrar, escalar, cambiar materiales ───────────── */
  function mount(root) {
    const meshes = [];
    root.traverse((o) => {
      if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
      else if (o.isPoints || o.isLine) o.visible = false;
    });
    if (!meshes.length) throw new Error('el GLB no trae mallas');

    // Recorre vértices en el marco del modelo (salteados cuando se pide una pasada gruesa).
    const turn = new THREE.Group(); // aquí se endereza el modelo si viene de perfil
    turn.add(root);
    const p = new THREE.Vector3();
    const each = (fn, budget = Infinity) => {
      for (const m of meshes) {
        const pos = m.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / budget));
        for (let i = 0; i < pos.count; i += step) fn(p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
      }
    };
    const box = new THREE.Box3();
    const dim = new THREE.Vector3();
    const measure = () => {
      turn.updateMatrixWorld(true);
      box.makeEmpty();
      each((q) => box.expandByPoint(q));
      box.getSize(dim);
    };
    measure();
    // Un longhorn de frente es más ancho (x, de cuerno a cuerno) que hondo (z). Si llega
    // al revés es que el archivo mira a +x: se gira un cuarto de vuelta para que mire a +z.
    const turnY = Number.isFinite(yaw) ? yaw : (dim.z > dim.x * 1.2 ? -Math.PI / 2 : 0);
    if (turnY !== 0) {
      turn.rotation.y = turnY;
      measure();
    }
    const c = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(dim.x, dim.y, dim.z);
    if (!(maxDim > 1e-9) || !Number.isFinite(maxDim)) throw new Error('el GLB no tiene tamaño');
    const s = size / maxDim;

    // El aro va detrás del cráneo, y lo bastante atrás para que los cuernos no lo
    // atraviesen cuando el cráneo gira con el puntero.
    const sy = Math.sin(YAW + YAW_IDLE + 0.04), cy = Math.cos(YAW + YAW_IDLE + 0.04), sp = Math.sin(PITCH + PITCH_IDLE + 0.02);
    const band = ringR * 0.16;
    let zBand = Infinity, zCore = Infinity;
    each((q) => {
      const x = (q.x - c.x) * s, y = (q.y - c.y) * s, z = (q.z - c.z) * s;
      const r = Math.hypot(x, y);
      if (r > ringR + band) return;                       // por fuera del aro: no estorba
      if (r < ringR - band) zCore = Math.min(zCore, z);    // el cuerpo del cráneo
      else zBand = Math.min(zBand, (z > 0 ? z * cy : z) - Math.abs(x) * sy - Math.abs(y) * sp);
    }, 60000);
    const zRing = Math.min(-size * 0.06, zBand - tube - 0.03 * k, zCore - 0.04 * k);

    const old = new Set();
    for (const m of meshes) {
      if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
      const src = m.material;
      if (Array.isArray(src)) {
        src.forEach((x) => old.add(x));
        m.material = src.map((x) => skinFor(x, m.geometry));
      } else {
        old.add(src);
        m.material = skinFor(src, m.geometry);
      }
    }
    old.forEach((x) => x?.dispose?.());

    // Lo que toca al grupo va al final: si algo de arriba falla, queda intacto (aro y halo).
    const holder = new THREE.Group();
    holder.scale.setScalar(s);
    holder.position.copy(c).multiplyScalar(-s);
    holder.add(turn);
    pivot.add(holder);
    placeRing(Math.max(zRing, -size * 0.5));
  }

  /* ───────────── Carga (nunca rechaza) ───────────── */
  const ready = new Promise((resolve) => {
    // Sin url (null, '' o false) no se descarga nada: quedan el aro y el halo, sin aviso.
    if (!url) { resolve(false); return; }
    // Se resuelve una sola vez: un error tardío de three no avisa dos veces ni desmiente una carga buena.
    let settled = false;
    const done = (ok, err) => {
      if (settled) return;
      settled = true;
      if (!ok) console.warn(`emblem: no cargó ${url}; queda solo el aro.`, err);
      resolve(ok);
    };
    try {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.load(url, (gltf) => {
        try {
          const root = gltf?.scene || gltf?.scenes?.[0];
          if (!root) throw new Error('el GLB no trae escena');
          mount(root);
          done(true);
        } catch (err) { done(false, err); }
      }, undefined, (err) => done(false, err));
    } catch (err) { done(false, err); }
  });

  /* ───────────── API ───────────── */
  function setAmount(a) {
    const v = clamp(num(a, 0), 0, 1);
    amt.value = v;
    group.visible = v >= 0.003;
  }

  let px = 0, py = 0, lastAmt = amt.value;
  function update(dt, t, pointer) {
    const d = clamp(num(dt, 0.016), 0, 0.1);
    const tt = num(t, 0);
    const e = 1 - Math.exp(-4 * d);

    // ¿La intensidad se está moviendo? Entonces el neón tartamudea; al parar, se asienta.
    const moving = d > 0 && Math.abs(amt.value - lastAmt) / d > 0.02;
    lastAmt = amt.value;
    steady.value = moving ? 0 : Math.min(1, steady.value + d / 0.25);

    px += (clamp(num(pointer?.x, 0), -1, 1) - px) * e;
    py += (clamp(num(pointer?.y, 0), -1, 1) - py) * e;

    // El cráneo sigue al puntero y respira; el aro no se mueve.
    pivot.rotation.y = px * YAW + Math.sin(tt * 0.37 + 0.8) * YAW_IDLE;
    pivot.rotation.x = -py * PITCH + Math.sin(tt * 0.53) * PITCH_IDLE;
    pivot.rotation.z = Math.sin(tt * 0.61 + 2.1) * 0.008;
    pivot.position.y = Math.sin(tt * 0.9) * 0.035 * k;

    // Las luces viven en el marco del grupo: si quien lo coloca lo gira, giran con él.
    group.updateWorldMatrix(true, false);
    const m = group.matrixWorld, el = m.elements;
    L.key.value.copy(KEY_DIR).transformDirection(m);
    L.fill.value.copy(FILL_DIR).transformDirection(m);
    L.back.value.copy(BACK_DIR).transformDirection(m);
    L.up.value.set(0, 1, 0).transformDirection(m);
    L.origin.value.setFromMatrixPosition(m);
    uSize.value = size * Math.hypot(el[4], el[5], el[6]);
  }

  return { group, ready, setAmount, update };
}
