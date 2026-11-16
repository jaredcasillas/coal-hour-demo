// Brasas: carbón de leña ardiendo, hecho para verse bien a 70 cm y a 8 m.
// Trozos partidos con normales suaves, costra carbonizada, ceniza pálida donde ya ardió
// y una red de fisuras encendidas. Sin luces: cada fragmento escribe su color final (sRGB
// de pantalla). Lo que pasa de 1.0 es lo que recoge el bloom; sin bloom simplemente se recorta.
//
//   scene.add(makeCoals(U, 520, { quality }));   // 'high' | 'low'
//
// Costo por fragmento: un fbm3 (calor) + dos ruidos (fisuras, veta) + un Voronoi (cuarteado).
// En 'low' se quitan la veta y el relieve, y el Voronoi busca en 8 celdas en vez de 27.
import * as THREE from 'three';
import { NOISE } from './glsl.js';

/* ───────────── Utilidades (JS) ───────────── */
// Azar con semilla: la pila sale idéntica en cada carga (sirve para grabar tomas iguales).
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fract = (x) => x - Math.floor(x);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash3 = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);

// Ruido de valor 3D (solo para deformar la malla al construirla).
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = lerp(lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy);
  const b = lerp(lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy);
  return lerp(a, b, fz);
}
function fbm3(x, y, z) {
  let amp = 0.5, s = 0;
  for (let i = 0; i < 3; i++) {
    s += amp * noise3(x, y, z);
    x = x * 2.02 + 11.7; y = y * 2.02 + 11.7; z = z * 2.02 + 11.7;
    amp *= 0.5;
  }
  return s; // 0..0.875, media ≈ 0.44
}

/* ───────────── Huella (idéntica a la original: reemplazo directo) ───────────── */
const X0 = -2.65, X1 = 2.65, Z0 = -2.05, Z1 = 1.45;
const BED_W = 6.2, BED_D = 4.4, BED_Z = -0.3;
const TOP_MAX = 0.72; // nada sube más que esto: la rejilla está en y = 0.95
const WALL_X = 2.82, WALL_Z = -2.22; // caras interiores de la caja de la parrilla
const mound = (x, z) => 0.16 * Math.exp(-(x * x) / 5) + 0.05 * Math.sin(x * 2.1 + z * 1.7);

// Carril de la cámara. El riel de world.js entra por el frente a x ≈ 0.2 y sube hacia la rejilla
// (estaciones 1 → 1.5). Con el paralaje del cursor al tope barre x ∈ [0, 0.41] y baja hasta
// y ≈ 0.50 en el frente, 0.61 en z = 1.25 y 0.73 en z = 1.0. Dentro del carril ningún vértice
// sube a menos de ~9 cm de ese barrido: más cerca, el plano cercano de la cámara corta la brasa.
const LANE_X0 = -0.1, LANE_X1 = 0.5;
const LANE_FLOOR = 0.4; // el techo más bajo del carril (de z = 1.5 hacia el frente)
const ceilAt = (x, z) => (x > LANE_X0 && x < LANE_X1
  ? Math.min(TOP_MAX, LANE_FLOOR + 0.47 * Math.max(0, 1.5 - z))
  : TOP_MAX);

/* ───────────── Geometría: trozos de carbón ───────────── */
// aspect = proporciones · box = qué tan cúbico · lump / fine / chip = relieve (grande → fino)
// cuts = caras de fractura · bites = mordidas (huecos donde se desprendió un pedazo)
const SHAPES = [
  { seed: 3.1,  aspect: [1.50, 0.80, 0.92], box: 0.50, lump: 0.24, fine: 0.09, chip: 0.030, cuts: 7, bites: 2 }, // leño partido
  { seed: 17.4, aspect: [1.15, 0.88, 1.00], box: 0.30, lump: 0.32, fine: 0.10, chip: 0.035, cuts: 8, bites: 3 }, // cuña
  { seed: 41.9, aspect: [1.00, 0.92, 1.06], box: 0.20, lump: 0.30, fine: 0.12, chip: 0.040, cuts: 6, bites: 2 }, // pepita
  { seed: 73.6, aspect: [1.32, 0.60, 1.12], box: 0.50, lump: 0.22, fine: 0.08, chip: 0.030, cuts: 7, bites: 2 }, // laja
];

// Suelda los vértices repetidos del icosaedro → malla indexada. Con vértices compartidos,
// computeVertexNormals() promedia las caras vecinas y el sombreado deja de verse facetado.
function weld(src) {
  const p = src.attributes.position.array;
  const out = [], index = [];
  for (let i = 0; i < p.length; i += 3) {
    let k = -1;
    for (let j = 0; j < out.length; j += 3) {
      const dx = out[j] - p[i], dy = out[j + 1] - p[i + 1], dz = out[j + 2] - p[i + 2];
      if (dx * dx + dy * dy + dz * dz < 1e-8) { k = j / 3; break; }
    }
    if (k < 0) { k = out.length / 3; out.push(p[i], p[i + 1], p[i + 2]); }
    index.push(k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  geo.setIndex(index);
  return geo;
}

function makeLump(shape, detail) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const geo = weld(ico);
  ico.dispose();

  const pos = geo.attributes.position;
  const n = pos.count;
  const rng = mulberry32(Math.round(shape.seed * 1000));
  const o = shape.seed;
  const [ax, ay, az] = shape.aspect;
  // El relieve fino solo cabe si la malla lo alcanza a muestrear.
  const fineK = detail >= 5 ? 1 : 0.55;
  const chipK = detail >= 5 ? 1 : 0;

  // Planos de fractura: caras casi planas, como las de un trozo que se partió.
  const cuts = [];
  for (let i = 0; i < shape.cuts; i++) {
    cuts.push({
      n: new THREE.Vector3(rng() * 2 - 1, (rng() * 2 - 1) * 0.8, rng() * 2 - 1).normalize(),
      d: 0.42 + rng() * 0.3,
    });
  }
  // Mordidas: un hueco redondeado donde saltó una astilla (ahí la brasa arde más).
  const bites = [];
  for (let i = 0; i < shape.bites; i++) {
    const dir = new THREE.Vector3(rng() * 2 - 1, (rng() * 2 - 1) * 0.7, rng() * 2 - 1).normalize();
    bites.push({ dir, c: dir.clone().multiplyScalar(0.62 + rng() * 0.2), rad: 0.34 + rng() * 0.2, depth: 0.1 + rng() * 0.1 });
  }

  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i); // dirección unitaria
    const m = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    let r = lerp(1, 0.8 / m, shape.box); // esfera ↔ cubo redondeado
    r *= 1 + shape.lump * 3.2 * (fbm3(v.x * 1.25 + o, v.y * 1.25 - o, v.z * 1.25 + o * 0.5) - 0.4375);
    r *= 1 + shape.fine * fineK * 2.0 * (noise3(v.x * 2.6 - o, v.y * 2.6 + o * 0.3, v.z * 2.6 + o) - 0.5);
    r *= 1 + shape.chip * chipK * 2.0 * (noise3(v.x * 6.1 + o, v.y * 6.1 - o * 0.7, v.z * 6.1 + o * 0.2) - 0.5);
    v.multiplyScalar(Math.max(r, 0.35));
    v.set(v.x * ax, v.y * ay, v.z * az);
    for (const c of cuts) {
      const t = v.dot(c.n) - c.d;
      if (t > 0) v.addScaledVector(c.n, -t * 0.9);
    }
    for (const b of bites) {
      const k = 1 - v.distanceTo(b.c) / b.rad;
      if (k > 0) v.addScaledVector(b.dir, -b.depth * k * k * (3 - 2 * k));
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  // Centrar y normalizar el tamaño (radio medio 0.9) para que todas las variantes pesen igual.
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i++) c.add(v.fromBufferAttribute(pos, i));
  c.multiplyScalar(1 / n);
  let rMean = 0;
  for (let i = 0; i < n; i++) rMean += v.fromBufferAttribute(pos, i).sub(c).length();
  rMean /= n;
  const k = 0.9 / rMean;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals(); // suaves: la malla ya está indexada

  // Curvatura firmada por vértice (+ hueco, − arista). Los huecos arden más y las aristas juntan ceniza.
  const nor = geo.attributes.normal, idx = geo.index;
  const sum = new Float32Array(n * 3), cnt = new Uint16Array(n);
  const link = (a, b) => { sum[a * 3] += pos.getX(b); sum[a * 3 + 1] += pos.getY(b); sum[a * 3 + 2] += pos.getZ(b); cnt[a]++; };
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), d = idx.getX(i + 2);
    link(a, b); link(b, d); link(d, a);
  }
  let curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const q = Math.max(cnt[i], 1);
    curv[i] = (sum[i * 3] / q - pos.getX(i)) * nor.getX(i)
            + (sum[i * 3 + 1] / q - pos.getY(i)) * nor.getY(i)
            + (sum[i * 3 + 2] / q - pos.getZ(i)) * nor.getZ(i);
  }
  // En mallas finas la curvatura queda en líneas de un triángulo de ancho: se difunde
  // a los vecinos para que el "hueco" y la "arista" tengan cuerpo.
  for (let pass = 0; pass < Math.max(0, detail - 3); pass++) {
    const acc = new Float32Array(n), w = new Uint16Array(n);
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), d = idx.getX(i + 2);
      acc[a] += curv[b]; w[a]++; acc[b] += curv[d]; w[b]++; acc[d] += curv[a]; w[d]++;
    }
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) next[i] = lerp(curv[i], acc[i] / Math.max(w[i], 1), 0.6);
    curv = next;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += curv[i];
  mean /= n;
  let dev = 0;
  for (let i = 0; i < n; i++) dev += Math.abs(curv[i] - mean);
  dev = Math.max(dev / n, 1e-6);
  for (let i = 0; i < n; i++) curv[i] = clamp((curv[i] - mean) / (dev * 2.4), -1, 1);
  geo.setAttribute('aCurv', new THREE.BufferAttribute(curv, 1));

  let reach = 0;
  for (let i = 0; i < n; i++) reach = Math.max(reach, v.fromBufferAttribute(pos, i).length());
  return { geo, reach };
}

/* ───────────── Acomodo: base apretada + segunda capa + migajas al frente ───────────── */
function layout(count, rng, reach) {
  const W = X1 - X0, D = Z1 - Z0;
  const nBase = Math.round(count * 0.52);
  const nTop = Math.round(count * 0.38);
  const nCrumb = Math.max(0, count - nBase - nTop);

  // Rejilla con jitter y barajada: cubre parejo, sin huecos ni montones.
  const scatter = (nPts) => {
    if (nPts <= 0) return [];
    const rows = Math.max(1, Math.round(Math.sqrt((nPts * D) / W)));
    const cols = Math.ceil(nPts / rows);
    const cells = [];
    for (let i = 0; i < rows * cols; i++) cells.push(i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }
    return cells.slice(0, nPts).map((c) => [
      X0 + (((c % cols) + rng()) / cols) * W,
      Z0 + ((Math.floor(c / cols) + rng()) / rows) * D,
    ]);
  };

  const items = [];
  const TAU = Math.PI * 2;
  const push = (x, z, y, s, sx, sy, sz, rx, ry, rz) => {
    const shape = Math.floor(rng() * SHAPES.length) % SHAPES.length;
    // Radio máximo del trozo ya escalado: que no atraviese las paredes de la parrilla.
    const r = reach[shape] * s * Math.max(sx, sy, sz);
    items.push({
      x: clamp(x, -WALL_X + r, WALL_X - r), y, z: Math.max(z, WALL_Z + r),
      sx: s * sx, sy: s * sy, sz: s * sz, rx, ry, rz, seed: rng(), shape,
    });
  };

  // Capa base: trozos grandes, casi acostados, apoyados en el lecho.
  for (const [x, z] of scatter(nBase)) {
    const s = 0.16 + rng() * rng() * 0.14;
    const sy = lerp(0.62, 0.95, rng());
    const half = s * 0.58 * sy; // media altura aproximada
    const y = half * 1.25 + Math.max(0, mound(x, z)) * 0.45 + rng() * 0.04;
    push(x, z, y, s, lerp(0.9, 1.25, rng()), sy, lerp(0.82, 1.15, rng()), (rng() - 0.5) * 0.9, rng() * TAU, (rng() - 0.5) * 0.9);
  }
  // Segunda capa: más chicos, girados al azar, siguiendo el montículo; baja hacia el frente.
  for (const [x, z] of scatter(nTop)) {
    const s = 0.12 + rng() * rng() * 0.14;
    const front = smooth(0.75, Z1, z);
    let y = 0.24 + mound(x, z) * 0.9 + rng() * 0.12 - front * 0.1;
    y = Math.min(y, TOP_MAX - s * 0.85);
    push(x, z, y, s, lerp(0.9, 1.25, rng()), lerp(0.7, 1.05, rng()), lerp(0.82, 1.15, rng()), rng() * TAU, rng() * TAU, rng() * TAU);
  }
  // Migajas: pedacitos sobre el lecho, cargados hacia el frente (donde pasa la cámara).
  for (let i = 0; i < nCrumb; i++) {
    const x = lerp(X0, X1, rng());
    const z = Z1 - rng() * rng() * D * 0.7;
    const s = 0.045 + rng() * 0.055;
    const y = s * 0.55 + Math.max(0, mound(x, z)) * 0.25 + rng() * 0.03;
    push(x, z, y, s, lerp(0.9, 1.3, rng()), lerp(0.7, 1.05, rng()), lerp(0.8, 1.2, rng()), rng() * TAU, rng() * TAU, rng() * TAU);
  }
  return items;
}

/* ───────────── GLSL compartido ───────────── */
// Rampa de brasa: x = 0 apagado … 1 blanco amarillento. El color sale de la intensidad,
// así lo tenue siempre es rojo profundo (nunca un amarillo oscuro) y el pico llega a ~2.5.
const EMBER = /* glsl */ `
  vec3 ember(float x){
    x = clamp(x, 0.0, 1.04);
    vec3 c = mix(vec3(0.62, 0.035, 0.0), vec3(1.0, 0.30, 0.035), smoothstep(0.12, 0.55, x));
    c = mix(c, vec3(1.0, 0.70, 0.30), smoothstep(0.55, 1.04, x));
    return c * (2.4 * x * sqrt(x));
  }`;

/* ───────────── Shaders de la brasa ───────────── */
const COAL_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aCurv;
  varying vec3 vW;      // posición en mundo
  varying vec3 vN;      // normal en mundo
  varying vec3 vL;      // posición local, en unidades de mundo (sigue la veta del trozo)
  varying vec3 vNl;     // normal en ese mismo espacio local (sin normalizar)
  varying vec3 vV;      // hacia la cámara, sin normalizar
  varying float vSeed;
  varying float vCurv;
  void main(){
    #ifdef USE_INSTANCING
      mat4 inst = instanceMatrix;
    #else
      mat4 inst = mat4(1.0);
    #endif
    mat3 im = mat3(inst);
    vec3 sc2 = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
    vec4 wp = modelMatrix * inst * vec4(position, 1.0);
    vW = wp.xyz;
    // normal correcta con escala no uniforme (inversa traspuesta de la matriz de instancia)
    vN = normalize(mat3(modelMatrix) * (im * (normal / sc2)));
    vL = position * sqrt(sc2);
    vNl = normal / sqrt(sc2);
    vV = cameraPosition - wp.xyz;
    vSeed = aSeed;
    vCurv = aCurv;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const COAL_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime; uniform float uIgnite;
  varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec3 vNl; varying vec3 vV;
  varying float vSeed; varying float vCurv;
  ${NOISE}
  ${EMBER}
  // Ruido de valor con su gradiente analítico (las mismas 8 muestras que vnoise3).
  // x = valor · yzw = gradiente en el espacio del ruido
  vec4 vnoise3d(vec3 p){
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    vec3 du = 6.0 * f * (1.0 - f);
    float a = hash31(i);
    float b = hash31(i + vec3(1.0, 0.0, 0.0));
    float c = hash31(i + vec3(0.0, 1.0, 0.0));
    float d = hash31(i + vec3(1.0, 1.0, 0.0));
    float e = hash31(i + vec3(0.0, 0.0, 1.0));
    float g = hash31(i + vec3(1.0, 0.0, 1.0));
    float h = hash31(i + vec3(0.0, 1.0, 1.0));
    float k = hash31(i + vec3(1.0, 1.0, 1.0));
    float k1 = b - a;
    float k2 = c - a;
    float k3 = e - a;
    float k4 = a - b - c + d;
    float k5 = a - c - e + h;
    float k6 = a - b - e + g;
    float k7 = -a + b + c - d + e - g - h + k;
    float val = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
    vec3 grad = du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,
                          k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,
                          k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
    return vec4(val, grad);
  }
  vec3 hash33(vec3 p){
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  // Plaquitas de costra: Voronoi 3D. En 'high' busca en 3×3×3 celdas (exacto, sin costuras entre
  // celdas: el relieve las delataría); en 'low' en las 2×2×2 más cercanas (8 hashes ≈ una llamada de ruido).
  // x = distancia al borde de la plaquita (en celdas) · y = azar de la plaquita · z = distancia a su centro
  #ifdef COALS_LOW
    #define PL_FROM 0
    #define PL_JITTER 0.5
    #define HAIRLINE 0.16
  #else
    #define PL_FROM -1
    #define PL_JITTER 0.8
    #define HAIRLINE 0.30
  #endif
  vec3 plates(vec3 p){
    #ifdef COALS_LOW
      vec3 b = floor(p - 0.5);
    #else
      vec3 b = floor(p);
    #endif
    vec3 f = p - b;
    float d1 = 9.0;
    float d2 = 9.0;
    vec3 r1 = vec3(0.0);
    vec3 r2 = vec3(1.0);
    float id = 0.0;
    for (int k = PL_FROM; k <= 1; k++) {
      for (int j = PL_FROM; j <= 1; j++) {
        for (int i = PL_FROM; i <= 1; i++) {
          vec3 g = vec3(float(i), float(j), float(k));
          vec3 h = hash33(b + g);
          vec3 r = g + 0.5 + (h - 0.5) * PL_JITTER - f;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; id = fract(dot(h, vec3(13.7, 5.1, 9.3))); }
          else if (d < d2) { d2 = d; r2 = r; }
        }
      }
    }
    // distancia a la mediatriz entre los dos centros más cercanos = borde de la plaquita
    return vec3((d2 - d1) / (2.0 * max(length(r2 - r1), 0.001)), id, sqrt(d1));
  }
  void main(){
    vec3 n0 = normalize(vN);
    float dist = length(vV);
    vec3 v = vV / max(dist, 0.001);
    float sA = fract(vSeed * 7.13 + 0.37);
    float sB = fract(vSeed * 19.71 + 0.11);
    vec3 so = vec3(vSeed, sA, sB) * 29.0;
    float pxW = max(max(length(dFdx(vW)), length(dFdy(vW))), 0.00001);   // lo que mide un pixel, en mundo

    // Encendido: del centro hacia afuera, igual que el original.
    float rr = length(vW.xz - vec2(0.0, -0.3));
    float R = uIgnite * 5.2;
    float ignite = 1.0 - smoothstep(R - 1.3, R, rr);

    // Campo de calor lento, en mundo: las manchas de calor cruzan de una brasa a otra.
    // Encima, el pulso propio de cada trozo y una ola de aire que recorre todo el lecho.
    float hN = fbm3(vW * 2.1 + vec3(uTime * 0.017, uTime * 0.055, -uTime * 0.012) + vSeed * 0.7) * 1.143;
    float pulse = 0.5 + 0.5 * sin(uTime * (0.55 + sA * 0.9) + vSeed * 40.0);
    float gust = 0.5 + 0.5 * sin(vW.x * 0.85 + vW.z * 0.6 - uTime * 0.42);

    // Cuarteado ("piel de cocodrilo"): plaquitas en el espacio del trozo, estiradas por la veta.
    vec3 qs = vL * vec3(0.5, 1.0, 1.0) * 38.0 + so;
    qs += 0.25 * sin(qs.yzx * 1.7 + so.x);
    vec3 ps = plates(qs);
    float fws = 0.75 * max(length(dFdx(qs)), length(dFdy(qs)));   // tamaño del pixel, en celdas
    // Cuando un pixel ya abarca casi una plaquita entera (lejos o en caras rasantes), el
    // detalle por plaquita se funde a su promedio: nada de centelleo.
    float resS = 1.0 - smoothstep(0.3, 0.9, fws);
    float edgeS = ps.x;
    float inS = smoothstep(0.0, 0.05 + fws, edgeS);     // 0 en el borde de la plaquita → 1 adentro
    float pidS = mix(0.5, ps.y, resS * inS);            // el azar de cada plaquita se apaga en su borde (sin dientes)

    // Fisuras principales: curvas de nivel de un ruido medio estirado por la veta. Sumarle
    // la distancia al borde de la plaquita las vuelve quebradas, como una grieta de verdad.
    // Se miden en unidades de mundo (valor / pendiente sobre la superficie): el ancho no
    // depende del ruido, y donde el ruido es casi plano la fisura se abre en una poza.
    vec4 nd = vnoise3d(vL * vec3(3.2, 7.0, 7.0) + so.zxy);
    float n2 = nd.x;
    vec3 gL = nd.yzw * vec3(3.2, 7.0, 7.0);
    vec3 nL = normalize(vNl);
    float gv = length(gL - dot(gL, nL) * nL);
    float dW = abs(n2 + 0.10 * (min(edgeS, 0.3) - 0.15) * resS - 0.5) / max(gv, 3.5);

    // Veta de la madera: fibras de ancho desigual que ondulan. Se funde a gris medio cuando
    // un pixel ya no la resuelve (de lejos o en caras rasantes).
    #ifndef COALS_LOW
      float facing = smoothstep(0.15, 0.55, dot(n0, v));
      vec3 pg = vL * vec3(18.0, 150.0, 150.0);
      float fine = (1.0 - smoothstep(0.3, 0.9, max(length(dFdx(pg)), length(dFdy(pg))))) * facing;
      pg.yz += 1.3 * sin(pg.yz * 0.37 + so.xy) + 0.9 * sin(pg.zy * 0.113 + so.yz)
             + 1.4 * vec2(sin(vL.x * 31.0 + so.x), cos(vL.x * 27.0 + so.y));
      pg.x += 0.8 * sin(vL.y * 83.0 + vL.z * 71.0 + so.z);
      float n3 = mix(0.5, vnoise3(pg + so.yzx), fine);
    #else
      float n3 = 0.5;
    #endif
    float fib = smoothstep(0.72, 0.92, n3);             // fibras sueltas: polvo de ceniza en frío, hilos encendidos en caliente

    // Geometría grande (normal sin relieve): decide dónde hay calor y dónde ceniza.
    float up0 = clamp(n0.y, 0.0, 1.0);
    float under = clamp(0.55 - n0.y * 0.75, 0.0, 1.0);   // caras de abajo
    float deep = 1.0 - smoothstep(0.05, 0.6, vW.y);      // hondo en la pila
    float cav = clamp(vCurv, 0.0, 1.0);                  // huecos del trozo
    float ridge = clamp(-vCurv, 0.0, 1.0);               // aristas
    float crev = clamp(under * deep + 0.4 * cav, 0.0, 1.0);   // lo más escondido es lo más caliente

    // Temperatura: calor + pulso + ola; más en huecos, por debajo y al fondo; a cada lado
    // de una fisura el bloque va a la suya.
    float T = hN + 0.20 * (pulse - 0.5) + 0.10 * (gust - 0.5) + 0.30 * under + 0.28 * deep + 0.30 * cav - 0.16 * ridge
            + 0.26 * (sB - 0.5) + 0.34 * (n2 - 0.5);
    T *= ignite;
    float gC = smoothstep(0.30, 0.74, T);                                // cuánto arden las fisuras
    float gF = smoothstep(0.52, 1.00, T + 0.16 * (pidS - 0.5) * ignite); // cuánto arde la superficie

    // Fisura: núcleo fino (suavizado a su tamaño en pantalla; se abre con el calor) y su zona
    // de influencia, donde el cuarteado también arde y la costra se tiñe de naranja.
    float wV = 0.0012 + 0.0030 * gC;
    float aaV = 0.75 * pxW;
    float coreV = (1.0 - smoothstep(wV * 0.35, wV + aaV, dW)) * (wV / (wV + aaV));
    float bandV = 1.0 - smoothstep(0.002, 0.024, dW);
    // Cuarteado: líneas de ancho desigual, y cada plaquita con su propio brillo de borde.
    float wS = 0.014 + 0.024 * n2;
    float coreS = (1.0 - smoothstep(wS * 0.35, wS + fws, edgeS)) * (wS / (wS + fws)) * resS * (0.55 + 0.9 * ps.y);
    float haloS = mix(0.3, 1.0 - smoothstep(0.0, 0.26, edgeS), resS);

    // Ceniza: polvo pálido arriba y en las aristas, más donde ya ardió y del lado frío de la
    // fisura; cada plaquita junta un poco distinto. Por debajo se cae, y las fisuras la cortan.
    float ashN = 0.40 * up0 + 0.28 * ridge + 0.44 * smoothstep(0.25, 0.85, T)
               + 0.22 * (pidS - 0.5) + 0.50 * (0.5 - n2) + 0.30 * (n3 - 0.5) + 0.30 * (hN - 0.5);
    float ashM = smoothstep(0.42, 0.78, ashN) * (0.25 + 0.75 * ignite) * (1.0 - under);
    ashM *= (1.0 - coreV) * mix(1.0, 0.7 + 0.3 * smoothstep(0.0, 0.10, edgeS), resS);

    // Relieve: surco hondo en las fisuras, surco fino en el cuarteado (la ceniza lo rellena),
    // cada plaquita un domo suave y la veta encima. La normal se inclina con las derivadas
    // de lo ya calculado (sin llamadas extra).
    vec3 n = n0;
    #ifndef COALS_LOW
      float grV = 1.0 - smoothstep(0.0, 0.010, dW);
      float grS = 1.0 - smoothstep(0.0, 0.22, edgeS);
      float hgt = (n3 * 0.0020 - grV * grV * 0.009
                - (grS * 0.0026 + ps.z * 0.0030) * resS * (1.0 - 0.7 * ashM)) * facing;
      vec3 dpx = dFdx(vW);
      vec3 dpy = dFdy(vW);
      vec3 t1 = cross(dpy, n0);
      vec3 t2 = cross(n0, dpx);
      float det = dot(dpx, t1);
      vec2 dh = clamp(vec2(dFdx(hgt), dFdy(hgt)), -1.5 * pxW, 1.5 * pxW);   // pendiente acotada: sin chispazos
      vec3 nb = abs(det) * n0 - sign(det) * (dh.x * t1 + dh.y * t2);
      float nl = length(nb);
      if (nl > 0.0) n = nb / nl;
    #endif

    // Materia: costra casi negra con veta y motas de ceniza / ceniza pálida y polvosa.
    float grain = 0.62 + 0.76 * n3;
    vec3 crust = vec3(0.030, 0.028, 0.027) * grain * (0.8 + 0.4 * pidS) + vec3(0.046, 0.045, 0.044) * fib;
    vec3 ashC = vec3(0.66, 0.645, 0.63) * (0.70 + 0.60 * n3) * (0.78 + 0.44 * hN) * (0.9 + 0.2 * pidS);
    vec3 alb = mix(crust, ashC, ashM);
    alb *= 1.0 - max(0.85 * coreV, HAIRLINE * coreS * (1.0 - 0.6 * ashM));   // grieta fría: línea oscura (sin relieve, más tenue)

    // "Luz" falsa (con la normal de relieve): brasas vecinas desde abajo, su rebote ya
    // desaturado, y un cielo de noche frío desde arriba.
    float up = clamp(n.y, 0.0, 1.0);
    float dn = clamp(0.5 - 0.5 * n.y, 0.0, 1.0);
    float heatAmb = ignite * (0.30 + 0.70 * smoothstep(0.3, 0.8, hN)) * (0.45 + 0.55 * deep);
    vec3 E = vec3(1.0, 0.30, 0.055) * heatAmb * (0.10 + 1.5 * dn * dn)
           + vec3(0.62, 0.50, 0.42) * heatAmb * 0.42 * (0.35 + 0.65 * up)
           + vec3(0.050, 0.062, 0.090) * (0.3 + 0.7 * up);
    vec3 col = alb * (E + 0.30);

    // Contraluz cálido y el brillo frío, casi metálico, del carbón.
    float rim = 1.0 - clamp(dot(n, v), 0.0, 1.0);
    rim = rim * rim * rim;
    col += vec3(0.85, 0.24, 0.035) * rim * heatAmb * (0.35 + 0.65 * under) * 0.8;
    vec3 hv = normalize(vec3(-0.25, 0.80, -0.55) + v);
    float spec = pow(clamp(dot(n, hv), 0.0, 1.0), 26.0);
    col += vec3(0.42, 0.52, 0.70) * (0.16 * spec + 0.012 * up) * (1.0 - 0.8 * ashM) * (0.6 + 0.8 * n3);

    // Emisión: una sola temperatura por fragmento → rampa de brasa (rojo → naranja → blanco, pico HDR ~2.5).
    float xFace = gF * (0.36 + 0.16 * crev) * (0.88 + 0.24 * (pidS - 0.5)) * (0.85 + 0.30 * n3) * (1.0 - 0.70 * ashM);
    float xHalo = gC * (0.16 * bandV * bandV + 0.14 * fib * (0.3 + 0.7 * bandV) * (1.0 - ashM)) + gF * 0.03 * haloS;
    float xCore = gC * (0.44 + 0.30 * gF + 0.14 * crev) * coreV + (gC * 0.22 * bandV + gF * 0.12) * coreS;
    col += ember(xFace + xHalo + xCore);

    gl_FragColor = vec4(col, 1.0);
  }`;

/* ───────────── Shaders del lecho ───────────── */
const BED_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BED_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime; uniform float uIgnite; uniform vec2 uSize;
  varying vec2 vUv;
  ${NOISE}
  ${EMBER}
  vec2 hash22(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  void main(){
    vec2 p = (vUv - 0.5) * uSize;   // unidades de mundo desde el centro del lecho (y negativa = frente)
    float t = uTime;

    // Convección lenta: un ruido arrastra al otro y las manchas calientes migran.
    vec2 wv = vec2(fbm(p * 0.8 + vec2(3.1, t * 0.04)), fbm(p * 0.8 + vec2(t * 0.035, 7.7)));
    vec2 pw = p + (wv - 0.47) * 1.3;
    float n = fbm(pw * 2.3 + vec2(0.0, t * 0.06));

    // Brasa menuda: granos (celdas) con temperatura propia que titilan cada uno a su ritmo.
    vec2 g = p * 21.0;
    vec2 gi = floor(g);
    vec2 gf = g - gi;
    float d1 = 9.0;
    float id = 0.5;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 h = hash22(gi + o);
        vec2 r = o + h - gf;
        float d = dot(r, r);
        if (d < d1) { d1 = d; id = h.x; }
      }
    }
    float res = 1.0 - smoothstep(0.35, 1.0, max(length(dFdx(g)), length(dFdy(g))));   // de lejos el grano se funde
    float body = mix(0.55, 1.0 - smoothstep(0.10, 0.50, sqrt(d1)), res);
    float gid = mix(0.5, id, res);
    float tw = 0.5 + 0.5 * sin(t * (0.5 + gid * 1.3) + gid * 51.0);

    // Borde irregular que cabe dentro de la caja de la parrilla; al frente se deshace en granos sueltos.
    float wob = (n - 0.47) * 0.22;
    float ex = 1.0 - smoothstep(0.60, 0.915, abs(vUv.x - 0.5) * 2.0 + wob);
    float ey = vUv.y > 0.5
      ? 1.0 - smoothstep(0.62, 0.90, (vUv.y - 0.5) * 2.0 + wob)
      : 1.0 - smoothstep(0.52, 0.97, (0.5 - vUv.y) * 2.0 + wob);
    float edge = ex * ey;

    // Encendido radial, igual que las brasas.
    float R = uIgnite * 5.2;
    float ignite = 1.0 - smoothstep(R - 1.3, R, length(p));

    // Temperatura: hacia el borde baja la temperatura (no el brillo), así lo tenue es rojo.
    float T = n * 1.25 + (0.6 * (gid - 0.5) + 0.14 * (tw - 0.5)) * body - (1.0 - edge) * 1.25;
    float x = smoothstep(0.26, 0.98, T) * (0.60 + 0.40 * body);
    x = (0.14 * edge + 0.86 * x) * ignite;
    gl_FragColor = vec4(ember(x * 0.92), 1.0);
  }`;

/* ───────────── Brasas ───────────── */
// U: uniforms compartidos ({ time, ignite, ... }); se usan por referencia.
// count: cuántos trozos (≈500 en escritorio).
// quality: 'high' | 'low' ('low' = malla más ligera y shader sin veta ni relieve, para pantallas chicas;
//   cualquier valor que no sea 'high' cuenta como 'low').
// detail (opcional): subdivisión del icosaedro de cada trozo; por defecto 7 en 'high' y 3 en 'low'.
// Devuelve un THREE.Group con el lecho (plano en y = 0, centrado en z = −0.3) y las brasas encima.
export function makeCoals(U, count, { quality = 'high', detail } = {}) {
  const low = quality !== 'high'; // igual que world.js y post.js: todo lo que no es 'high' va ligero
  const subdiv = Number.isFinite(detail) ? clamp(Math.round(detail), 1, 10) : (low ? 3 : 7);
  const total = Math.max(0, Math.floor(count) || 0);
  const g = new THREE.Group();
  g.name = 'coals';

  // Lecho encendido debajo: lo que se ve por los huecos entre brasas.
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(BED_W, BED_D),
    new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uIgnite: U.ignite, uSize: { value: new THREE.Vector2(BED_W, BED_D) } },
      vertexShader: BED_VERT,
      fragmentShader: BED_FRAG,
    }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(0, 0, BED_Z);
  bed.renderOrder = 1; // después de las brasas: el z-buffer descarta casi todo el lecho tapado
  g.add(bed);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uIgnite: U.ignite },
    defines: low ? { COALS_LOW: 1 } : {},
    vertexShader: COAL_VERT,
    fragmentShader: COAL_FRAG,
  });

  // Reparto por variante de forma; dentro de cada una, de adelante hacia atrás
  // (la cámara mira hacia −z) para que el z-buffer ahorre sombreado.
  const lumps = SHAPES.map((shape) => makeLump(shape, subdiv));
  const groups = SHAPES.map(() => []);
  for (const it of layout(total, mulberry32(20261111), lumps.map((l) => l.reach))) groups[it.shape].push(it);

  const d = new THREE.Object3D();
  const p = new THREE.Vector3();
  lumps.forEach(({ geo, reach }, si) => {
    const list = groups[si].sort((a, b) => b.z - a.z);
    if (!list.length) { geo.dispose(); return; }
    const pos = geo.attributes.position;
    const seeds = new Float32Array(list.length);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      d.position.set(it.x, it.y, it.z);
      d.rotation.set(it.rx, it.ry, it.rz);
      d.scale.set(it.sx, it.sy, it.sz);
      d.updateMatrix();
      // Techo (tope general y carril de la cámara): se mide con los vértices ya colocados y el
      // trozo se hunde justo lo que le sobre. Solo se revisan los que podrían alcanzarlo.
      if (it.y + reach * Math.max(it.sx, it.sy, it.sz) > LANE_FLOOR) {
        let over = 0;
        for (let k = 0; k < pos.count; k++) {
          p.fromBufferAttribute(pos, k).applyMatrix4(d.matrix);
          over = Math.max(over, p.y - ceilAt(p.x, p.z));
        }
        if (over > 0) { d.position.y -= over; d.updateMatrix(); }
      }
      mesh.setMatrixAt(i, d.matrix);
      seeds[i] = it.seed;
    });
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    g.add(mesh);
  });

  return g;
}
