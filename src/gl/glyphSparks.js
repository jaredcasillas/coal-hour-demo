// Chispas que escriben: miles de pavesas flotan como las de fire.js, se doblan hacia un punto
// y arman una palabra, letra por letra. Los destinos salen del mismo acomodo de canvas que usa
// neon.js: las chispas llenan cada letra y el tubo de neón prende justo en su contorno.
// Sin luces: el fragmento escribe color de pantalla; lo que pasa de 1.0 lo recoge el bloom.
import * as THREE from 'three';

const PAD = 120;    // margen del canvas, igual que en neon.js
const EM = 200;     // px del canvas que equivalen a `height` en el mundo (igual que neon.js)
const PX_K = 0.017; // U.px = alto del buffer × este factor (ver resize() en world.js)
const FILL = 2.2;   // diámetro del punto ya armado, medido en separaciones entre vecinas

let made = 0;       // letreros creados: cada uno arranca su azar en otro punto de la secuencia

// Azar con semilla: la palabra se arma idéntica en cada carga (sirve para grabar tomas iguales).
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Dibuja el texto con el mismo acomodo que neon.js y reparte `count` puntos parejos dentro
// de las letras. Devuelve los destinos en coordenadas locales del plano del letrero.
function sampleText(text, font, height, count, rnd) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const tw = Math.ceil(probe.measureText(text).width);
  const cw = tw + PAD * 2, ch = EM + PAD * 2;

  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.fillText(text, cw / 2, ch / 2 + 8);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  const inside = (x, y) => data[(y * cw + x) * 4 + 3] > 127;

  // Lista de pixeles con tinta y la caja que los contiene.
  const ink = new Uint32Array(cw * ch);
  let area = 0, x0 = cw, x1 = 0, y0 = ch, y1 = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!inside(x, y)) continue;
      ink[area++] = y * cw + x;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  // Sin tinta (texto vacío o fuente sin glifos): todo cae al centro en vez de romperse.
  if (!area) {
    x0 = x1 = cw >> 1; y0 = y1 = ch >> 1;
    ink[area++] = y0 * cw + x0;
  }

  // Rejilla con temblor: un punto por celda, así las letras se llenan parejo y sin grumos.
  const cell = Math.sqrt(area / count);
  const ox = x0 - rnd() * cell, oy = y0 - rnd() * cell;
  const pts = [];
  for (let gy = 0; oy + gy * cell <= y1 + 1; gy++) {
    for (let gx = 0; ox + gx * cell <= x1 + 1; gx++) {
      const x = ox + (gx + 0.5 + (rnd() - 0.5) * 0.9) * cell;
      const y = oy + (gy + 0.5 + (rnd() - 0.5) * 0.9) * cell;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix >= x0 && ix <= x1 && iy >= y0 && iy <= y1 && inside(ix, iy)) pts.push(x, y);
    }
  }
  let n = pts.length / 2;
  while (n > count) { // sobran: se quitan al azar
    const i = Math.floor(rnd() * n);
    n--;
    pts[i * 2] = pts[n * 2];
    pts[i * 2 + 1] = pts[n * 2 + 1];
  }
  while (n < count) { // faltan: se completan al azar sobre la tinta
    const i = ink[Math.floor(rnd() * area)];
    pts[n * 2] = (i % cw) + rnd();
    pts[n * 2 + 1] = Math.floor(i / cw) + rnd();
    n++;
  }

  // Pixel → plano del letrero: ancho = height·cw/200, alto = height·ch/200, centrado, z = 0.
  const u = height / EM;
  const target = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    target[i * 3] = (pts[i * 2] - cw / 2) * u;
    target[i * 3 + 1] = (ch / 2 - pts[i * 2 + 1]) * u;
  }
  return { target, minX: (x0 - cw / 2) * u, maxX: (x1 + 1 - cw / 2) * u, spacing: cell * u };
}

export function makeGlyphSparks(U, { text, font = "400 200px 'Anton', 'Arial Narrow', sans-serif", height = 0.62, count = 12000 }) {
  count = Math.max(1, Math.floor(count) || 0);
  // Semilla propia por letrero. Con una sola semilla para todos, dos renglones sacaban la misma
  // secuencia y sus pavesas podían flotar encimadas (con el mismo texto, todas).
  const rnd = mulberry32(0xc0a1 + Math.imul(made++, 0x9e3779b9));
  const { target, minX, maxX, spacing } = sampleText(text, font, height, count, rnd);

  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = rnd();

  const geo = new THREE.BufferGeometry();
  const aTarget = new THREE.BufferAttribute(target, 3);
  // three saca de `position` cuántos puntos dibujar; es el mismo buffer que aTarget.
  geo.setAttribute('position', aTarget);
  geo.setAttribute('aTarget', aTarget);
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: U.time, uCam: U.cam, uPx: U.px,
      uForm: { value: 0 },
      uAmount: { value: 0 },
      // x = borde izquierdo de la palabra, y = 1 / ancho: normaliza la x del destino a 0..1.
      uSpan: { value: new THREE.Vector2(minX, 1 / Math.max(maxX - minX, 1e-6)) },
      // Tamaño del punto armado: su diámetro en el mundo es FILL × la separación entre vecinas.
      uDot: { value: (FILL * spacing) / (2 * PX_K) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aTarget; attribute vec4 aSeed;
      uniform float uTime; uniform float uPx; uniform float uForm; uniform float uDot;
      uniform vec3 uCam; uniform vec2 uSpan;
      varying float vK; varying float vA;
      void main(){
        // Libre: la misma deriva que las pavesas de fire.js (caja que envuelve a la cámara), en mundo.
        vec3 box = vec3(14.0, 10.0, 14.0);
        vec3 p = aSeed.xyz * box;
        p.y += uTime * (0.22 + aSeed.x * 0.35);
        p.x += sin(uTime * 0.3 + aSeed.y * 20.0) * 0.45;
        p.z += cos(uTime * 0.23 + aSeed.z * 20.0) * 0.45;
        vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
        vec3 drift = rel + uCam;

        // Armada: su lugar en el letrero. El retraso crece con la x: se escribe de izquierda a derecha.
        vec3 tgt = (modelMatrix * vec4(aTarget, 1.0)).xyz;
        float delay = 0.55 * clamp((aTarget.x - uSpan.x) * uSpan.y, 0.0, 1.0) + 0.15 * aSeed.w;
        float k = smoothstep(delay, delay + 0.3, uForm);
        float j = 1.0 - k;
        k = k < 0.5 ? 4.0 * k * k * k : 1.0 - 4.0 * j * j * j;

        // Remolino: desvío perpendicular al viaje, casi todas girando hacia el mismo lado
        // (alrededor de la normal del letrero). Vale 0 al salir y al llegar.
        vec3 d = tgt - drift;
        float len = length(d);
        vec3 dn = d / max(len, 0.0001);
        vec3 nz = modelMatrix[2].xyz;
        vec3 side = cross(dn, nz / max(length(nz), 0.0001)) + cross(dn, aSeed.yzx - 0.5) * 0.6;
        side /= max(length(side), 0.0001);
        vec3 lift = cross(dn, side);
        vec2 r = fract(aSeed.wz * vec2(17.3, 29.7) + aSeed.xy * vec2(7.1, 3.3));
        float bow = sin(k * 3.14159265);
        float ang = (k - 0.5) * (1.5 + 2.5 * r.x);
        float arc = min(len, 7.0) * (0.12 + 0.2 * r.y) * bow;
        vec3 pos = mix(drift, tgt, k) + (side * cos(ang) + lift * sin(ang)) * arc;

        vec4 mv = viewMatrix * vec4(pos, 1.0);
        float dist = -mv.z;
        float inv = 1.0 / max(dist, 0.2);
        float tw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed.z * 3.0) + aSeed.x * 50.0);

        // Tamaño: pavesa mientras flota; ya en su sitio, un punto chico cuyo diámetro sigue la
        // separación entre vecinas (la letra se llena igual con cualquier escala o cantidad).
        float sEmber = uPx * (0.45 + aSeed.y * 0.9) * (0.5 + 0.5 * tw) * inv;
        float want = uPx * uDot * length(modelMatrix[0].xyz) * projectionMatrix[1][1] * inv;
        float sDot = max(want, 1.6);
        float gain = want / sDot; // si ya no puede achicarse, baja el brillo en su lugar
        gl_PointSize = mix(sEmber, sDot, k);

        // Brillo: libre = pavesa (titila y se pierde a lo lejos); al viajar se enciende aunque
        // esté lejos; armada = fija, con un parpadeo corto propio.
        float fadeNear = smoothstep(0.4, 1.2, dist);
        float fadeFar = 1.0 - smoothstep(4.0, 7.0, dist);
        float lit = smoothstep(0.0, 0.4, k);
        float flick = 0.82 + 0.18 * sin(uTime * (8.0 + r.x * 10.0) + r.y * 60.0);
        float a = mix(mix(tw * fadeFar, 1.0, lit) * 0.85, flick * gain * gain, k);
        a *= 1.0 + 0.6 * bow; // en pleno vuelo arde más
        // En el borde de la caja la pavesa libre salta al lado opuesto: ahí se apaga,
        // salvo que ya haya aterrizado (entonces su posición ya no depende de la caja).
        vec3 e = smoothstep(vec3(0.0), vec3(0.25), box * 0.5 - abs(rel));
        a *= mix(e.x * e.y * e.z, 1.0, smoothstep(0.998, 1.0, k));

        vA = a * fadeNear;
        vK = k;
        // Las que no se ven se mandan fuera de cuadro: no cuestan relleno.
        gl_Position = vA > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uAmount;
      varying float vK; varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.0, 0.5, d);
        a = mix(a * a, a, vK); // libre: halo suave como las pavesas; armada: núcleo más lleno
        // Naranja de brasa → blanco rojizo HDR; el salto de calor se guarda para la llegada.
        vec3 c = mix(vec3(1.0, 0.42, 0.08), vec3(2.6, 1.0, 0.7), vK * vK * vK);
        // El alfa va ya multiplicado en el color (y sale 1.0, como en neon.js). En el buffer HDR
        // suma lo mismo; sin postproceso el canvas recorta cada color a 1.0 ANTES de mezclar, y
        // el blanco rojizo (2.6, 1.0, 0.7) se quedaba en amarillo (1.0, 1.0, 0.7) por tenue que fuera.
        gl_FragColor = vec4(c * (a * vA * uAmount), 1.0);
      }`,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.visible = false;

  return {
    points,
    // 0 = pavesas sueltas, 1 = palabra armada.
    setForm(f) {
      mat.uniforms.uForm.value = Math.min(1, Math.max(0, f));
    },
    // Visibilidad general 0..1.
    setAmount(a) {
      mat.uniforms.uAmount.value = a;
      points.visible = a >= 0.003;
    },
  };
}
