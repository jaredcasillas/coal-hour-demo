// Foto con profundidad que se enciende: un plano subdividido que se deforma con su
// mapa de profundidad (la cámara se mueve de verdad dentro de la foto) y que aparece
// "quemándose al revés", como papel ardiendo en reversa.
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const SEG_W = 140;        // subdivisiones a lo ancho
const VISIBLE_MIN = 0.02; // por debajo de esto el frente todavía no toca la foto

// Calentamiento. La primera vez que three dibuja un material compila su programa y sube sus
// texturas a la GPU: medido, ~200 ms de pantalla congelada justo cuando la primera foto se
// enciende en pleno scroll. Para que ese tirón caiga durante la carga, junto a cada foto se
// dibuja un plano sin área (cero pixeles) con su mismo material hasta que sus texturas ya
// están arriba, y luego se quita solo. Tiene que ser un dibujo de verdad: renderer.compile()
// prepara otro programa cuando hay postproceso (el del canvas, no el del buffer HDR).
let warmGeo = null; // compartida; mismos atributos que la foto (position, normal, uv) => mismo programa
const texReady = (t) => !t || t.version > 0;

function makeWarmup(mesh, mat) {
  warmGeo ??= new THREE.PlaneGeometry(0, 0);
  const warm = new THREE.Mesh(warmGeo, mat);
  warm.name = 'photo-warmup';
  warm.frustumCulled = false;
  warm.raycast = () => {}; // no existe para los rayos
  let pending = true;
  warm.onAfterRender = (_r, _s, _c, _g, drawn) => {
    if (drawn !== mat) return; // se dibujó con otro material (override): este programa sigue frío
    const u = mat.uniforms;
    if (!texReady(u.uMap.value) || !texReady(u.uMapB.value) || !texReady(u.uDepth.value)) return;
    pending = false;
    warm.visible = false; // se saca del grafo después, fuera del render (ver release)
  };
  mesh.addEventListener('added', () => { if (pending && mesh.parent) mesh.parent.add(warm); });
  mesh.addEventListener('removed', () => warm.removeFromParent());
  return { release() { if (!pending && warm.parent) warm.removeFromParent(); } };
}

export function makePhoto(U, { map, depth, aspect, width, pos, rotY = 0, strength = 0.6, mapB = null }) {
  const height = width / aspect;
  const segH = Math.min(240, Math.max(24, Math.round(SEG_W / aspect)));
  const geo = new THREE.PlaneGeometry(width, height, SEG_W, segH);
  // El relieve saca vértices del plano: se agranda la esfera para que no se recorte de más.
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += Math.abs(strength) * 0.6;

  const reveal = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: U.time,
      uMap: { value: map },
      uMapB: { value: mapB ?? map },
      uMix: { value: 0 },
      uDepth: { value: depth },
      uStrength: { value: strength },
      uReveal: reveal,
      uSeed: { value: Math.random() },
      uSize: { value: new THREE.Vector2(width, height) },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D uDepth; uniform float uStrength;
      varying vec2 vUv; varying vec2 vP;
      void main(){
        vUv = uv;
        vP = position.xy;
        float d = texture2D(uDepth, uv).r;
        vec3 p = position;
        p.z += (d - 0.45) * uStrength;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap; uniform sampler2D uMapB;
      uniform float uTime; uniform float uMix; uniform float uReveal; uniform float uSeed;
      uniform vec2 uSize;
      varying vec2 vUv; varying vec2 vP;
      ${NOISE}

      // Forma grande del frente: distancia al punto donde prende (abajo, al centro), medida
      // sobre el plano deformado con ruido. 0 = arde primero ... 1 = esquinas de arriba.
      // Deformar el espacio (y no sumar ruido) da un solo frente continuo, sin manchas sueltas.
      float burnShape(vec2 p){
        vec2 s = p * 1.1 + uSeed * 31.0;
        vec2 w = 0.58 * (vec2(vnoise(s), vnoise(s + 19.3)) - 0.5)
               + 0.2 * (vec2(vnoise(s * 2.4 + 7.1), vnoise(s * 2.4 + 41.7)) - 0.5);
        vec2 uv = (p + w) / uSize + 0.5;
        return length(vec2((uv.x - 0.5) * 1.15, (uv.y - 0.08) * 0.95)) / 1.05;
      }
      // Detalle fino, en unidades del plano: deshilacha el borde como papel sin cambiar la forma grande.
      float burnDetail(vec2 p){
        vec2 s = p + uSeed * 57.0;
        return 0.065 * (vnoise(s * 4.5) - 0.5) + 0.035 * (vnoise(s * 9.7) - 0.5)
             + 0.018 * (vnoise(s * 21.0) - 0.5) + 0.009 * (vnoise(s * 45.0) - 0.5);
      }

      void main(){
        // Borde del plano comido por ruido: nunca se ve el marco recto.
        vec2 e = min(vUv, 1.0 - vUv);
        float nb = fbm(vUv * 5.0 + uSeed * 9.0 + vec2(0.0, uTime * 0.03));
        float a = smoothstep(0.0, 0.12, min(e.x, e.y) + (nb - 0.5) * 0.09);

        // Lo que mide un pixel en unidades del plano (para suavizar el corte del frente).
        float pxw = max(max(length(dFdx(vP)), length(dFdy(vP))), 0.00001);

        vec2 uv = vUv;
        float k = 1.0;            // 1 = foto limpia, 0 = banda de fuego
        float toast = 0.0;        // papel tostado junto al frente
        float spill = 0.0;        // luz del fuego sobre el papel
        vec3 band = vec3(0.0);    // color de la banda incandescente
        vec3 sparks = vec3(0.0);  // brasitas que deja el frente

        if (uReveal < 0.999) {
          // Umbral: en 0 queda por debajo de todo el campo, en 1 por encima de todo.
          float th = mix(-0.04, 1.06, uReveal)
                   - 0.3 * (1.0 - smoothstep(0.0, 0.05, uReveal))
                   + 0.5 * smoothstep(0.9, 1.0, uReveal);

          // Distancia al frente en unidades del plano (campo / gradiente de la forma grande):
          // la banda mide parecido en todos lados en vez de engordar donde el ruido es plano.
          float s0 = burnShape(vP);
          vec2 grad = vec2(burnShape(vP + vec2(0.03, 0.0)) - s0, burnShape(vP + vec2(0.0, 0.03)) - s0) / 0.03;
          float big = max(uSize.x, uSize.y);
          float wob = 0.025 * (vnoise3(vec3(vP * 6.0, uTime * 0.9 + uSeed * 13.0)) - 0.5);
          float dist = (th - s0) / max(length(grad), 0.5 / big) - burnDetail(vP) - wob;
          // x = distancia medida en anchos de banda (la banda mide cerca del 6% del lado largo de la foto).
          float x = dist / (0.058 * big * (0.8 + 0.5 * vnoise(vP * 3.0 + uSeed * 5.0)));
          float live = 1.0 - smoothstep(0.88, 1.0, uReveal);   // al final el borde se apaga

          // Delante del frente no hay papel.
          a *= smoothstep(0.0, pxw * 2.0, dist);

          // Parpadeo a lo largo del borde: cambia el brillo y el grosor de la parte blanca.
          float fl = vnoise3(vec3(vP * 12.0 + uSeed * 3.0, uTime * 2.8));
          float flick = (0.7 + 0.6 * fl) * (0.93 + 0.07 * sin(uTime * 19.0 + vP.x * 4.0 + uSeed * 50.0));
          float xf = x * (1.4 - 0.8 * fl);

          // Del frente hacia adentro: blanco candente, naranja, rojo profundo, tizne, foto.
          vec3 fire = mix(vec3(2.5, 2.15, 1.5), vec3(1.75, 0.62, 0.07), smoothstep(0.02, 0.17, xf));
          fire = mix(fire, vec3(0.6, 0.05, 0.012), smoothstep(0.17, 0.4, xf));
          vec3 soot = vec3(0.024, 0.015, 0.012) * (0.55 + 0.9 * vnoise(vP * 55.0));
          band = mix(fire * flick, soot, smoothstep(0.38, 0.58, x));
          k = mix(smoothstep(0.54, 1.0, x), 1.0, 1.0 - live);

          toast = 0.8 * (1.0 - smoothstep(0.9, 2.5, x)) * live;
          spill = 0.3 * exp(-1.6 * max(x - 0.5, 0.0)) * flick * live;

          // El calor deforma un poco la imagen cerca del frente.
          float haze = (1.0 - smoothstep(0.6, 3.0, x)) * live;
          vec2 hz = vec2(vnoise(vP * 9.0 + vec2(0.0, uTime * 1.7)), vnoise(vP * 9.0 + vec2(31.0, -uTime * 1.3))) - 0.5;
          uv += hz * 0.007 * haze;

          // Brasitas que titilan sobre el tizne y el papel nuevo.
          vec2 gc = vP * 46.0;
          float h = hash21(floor(gc) + floor(uSeed * 97.0));
          float tw = 0.5 + 0.5 * sin(uTime * (2.0 + 7.0 * fract(h * 61.7)) + h * 311.0);
          float dotm = 1.0 - smoothstep(0.1, 0.44, length(fract(gc) - 0.5));
          float zone = smoothstep(0.38, 0.62, x) * (1.0 - smoothstep(0.9, 2.3, x));
          sparks = vec3(1.7, 0.55, 0.08) * (step(0.955, h) * dotm * tw * tw * zone * live);
        }

        vec3 c = texture2D(uMap, uv).rgb;
        if (uMix > 0.001) c = mix(c, texture2D(uMapB, uv).rgb, uMix);

        // Mismo etalonaje de siempre, y la brasa respira (+-2%).
        c = pow(max(c, 0.0), vec3(1.07)) * vec3(1.05, 1.0, 0.95);
        c *= 1.0 + 0.014 * sin(uTime * 1.1 + uSeed * 40.0) + 0.007 * sin(uTime * 2.9 + uSeed * 17.0);

        c *= mix(vec3(1.0), vec3(0.62, 0.48, 0.4), toast);
        c += vec3(1.0, 0.36, 0.07) * spill;
        c = mix(band, c, k) + sparks;

        if (a < 0.012) discard;
        gl_FragColor = vec4(c, a);
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.rotation.y = rotY;
  mesh.visible = false;
  const warmup = makeWarmup(mesh, mat);

  // 0 = nada, 1 = foto completa; en medio la foto se enciende con el frente de fuego.
  mesh.userData.setReveal = (v) => {
    const r = clamp01(v);
    reveal.value = r;
    mesh.visible = r > VISIBLE_MIN;
    warmup.release();
  };
  // Mezcla uMap -> uMapB (para texturas de video en loop).
  mesh.userData.setMix = (m) => {
    mat.uniforms.uMix.value = clamp01(m);
  };
  // Cambia la segunda textura después de creada la foto (null = vuelve a la foto base).
  mesh.userData.setMapB = (tex) => {
    mat.uniforms.uMapB.value = tex ?? mat.uniforms.uMap.value;
  };
  return mesh;
}
