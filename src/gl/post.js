// Postproceso: escena → bloom → un solo pase final ("grade") con calor, aberración
// cromática, viñeta y grano. Los materiales ya escriben color de pantalla (sRGB),
// así que aquí NO hay tone mapping, ni OutputPass, ni conversión de color:
// con todos los efectos en cero la imagen es la misma que renderer.render().
//
//   const post = createPost(renderer, scene, camera, { quality });   // 'high' | 'low'
//   post.params.heat = 0.6;          // se puede tocar en cada cuadro
//   post.setSize(w, h, pixelRatio);  // después de renderer.setPixelRatio / setSize
//   post.render();                   // en lugar de renderer.render(scene, camera)
//
// Opción extra: { samples } = MSAA del buffer de la escena (4 por defecto, 0 lo apaga).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { NOISE } from './glsl.js';

const DEFAULTS = {
  bloomStrength: 0.85,
  bloomRadius: 0.6,
  bloomThreshold: 0.82,
  aberration: 0.0015, // desplazamiento de R y B en la esquina (en altos de pantalla)
  grain: 0.045,
  vignette: 0.55,
  heat: 0, // 0..1
};

const GRAIN_FPS = 24; // el grano cambia a cadencia de cine (y pesa menos al comprimir el video)
const BLOOM_KNEE = 0.09; // el bloom entra en curva entre el umbral y umbral + 2 * esto

// Un NaN o un undefined en un uniform apaga la pantalla entera: se cambia por un valor seguro.
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Muestras de MSAA que el GPU acepta para un buffer RGBA16F. El tope general (MAX_SAMPLES)
// no vale para formatos flotantes: ahí el MSAA es opcional y pedir de más deja el buffer
// incompleto (pantalla negra). Se pregunta por el formato y se toma la mayor que quepa.
function msaaSamples(renderer, wanted) {
  const max = Math.min(Math.floor(num(wanted)), renderer.capabilities.maxSamples);
  if (!(max > 0)) return 0;
  const gl = renderer.getContext();
  const ok = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
  let best = 0;
  if (ok) for (let i = 0; i < ok.length; i++) if (ok[i] <= max && ok[i] > best) best = ok[i];
  return best;
}

// Filtro de brillo del bloom. Reemplaza al de three, que deja pasar el color completo
// de todo lo que cruza el umbral: con fuego en pantalla la llama se vuelve una mancha
// blanca y las brasas se lavan. Usa los mismos uniforms que UnrealBloomPass ya maneja.
// Antes limpia el texel: un NaN o un valor desbocado en el buffer HDR se regaría por
// todo el desenfoque como un cuadro.
const HIGHPASS_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  varying vec2 vUv;
  void main(){
    vec3 c = clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 24.0);
    if (!(c.r + c.g + c.b < 80.0)) c = vec3(0.0);
    // Brillo = canal más alto (un rojo vivo también cuenta). Solo pasa lo que EXCEDE el
    // umbral, y arranca en curva: lo apenas brillante casi no aporta, lo HDR sí.
    float br = max(c.r, max(c.g, c.b));
    float x = max(br - luminosityThreshold, 0.0);
    float knee = max(smoothWidth, 0.0001);
    float k = x < 2.0 * knee ? x * x / (4.0 * knee) : x - knee;
    gl_FragColor = vec4(c * (k / max(br, 0.0001)), 1.0);
  }`;

const GRADE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const GRADE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uTime; uniform float uGrainT; uniform float uAspect;
  uniform float uHeat; uniform float uAberration; uniform float uVignette; uniform float uGrain;
  varying vec2 vUv;
  ${NOISE}
  void main(){
    vec2 uv = vUv;

    // 1 · Calor: ruido que sube (restarle tiempo a la y hace viajar el dibujo hacia arriba).
    //     Parejo en el 55% de abajo y se apaga hacia el borde de arriba.
    if (uHeat > 0.0) {
      float m = 1.0 - smoothstep(0.55, 1.0, vUv.y);
      vec2 p = vec2(vUv.x * uAspect, vUv.y);
      float n1 = vnoise(vec2(p.x * 13.0, p.y * 9.0 - uTime * 2.0));
      float n2 = vnoise(vec2(p.x * 31.0 + 7.3, p.y * 22.0 - uTime * 5.0));
      float n3 = vnoise(vec2(p.x * 11.0 - 3.1, p.y * 8.0 - uTime * 1.7) + 19.0);
      vec2 w = vec2(n1 * 0.65 + n2 * 0.35, n3 * 0.65 + n2 * 0.35) * 2.0 - 1.0;
      uv += vec2(w.x / uAspect, w.y * 0.6) * (0.006 * uHeat * m);
    }

    // 2 · Aberración cromática: R y B se separan en dirección radial, con la distancia al cuadrado.
    vec2 d = vUv - 0.5;
    vec2 q = vec2(d.x * uAspect, d.y);
    float corner2 = 0.25 * (uAspect * uAspect + 1.0);
    vec2 ca = q * (length(q) / corner2) * uAberration;
    ca.x /= uAspect;
    vec3 col = vec3(
      texture2D(tDiffuse, uv + ca).r,
      texture2D(tDiffuse, uv).g,
      texture2D(tDiffuse, uv - ca).b);
    col = max(col, 0.0);

    // 3 · Viñeta: 0 en el centro, completa en las esquinas.
    float vd = length(d) * 1.41421356;
    col *= 1.0 - uVignette * smoothstep(0.45, 1.0, vd);

    // 4 · Grano: se multiplica por el propio color, así el negro puro sigue en 0 exacto.
    float n = hash31(vec3(gl_FragCoord.xy, uGrainT)) + hash31(vec3(gl_FragCoord.xy, uGrainT + 61.7)) - 1.0;
    float br = max(col.r, max(col.g, col.b));
    float amp = uGrain * inversesqrt(max(br, 0.0004)) * (1.0 - 0.5 * smoothstep(0.5, 1.0, br));
    col += col * (n * amp);

    gl_FragColor = vec4(col, 1.0);
  }`;

export function createPost(renderer, scene, camera, { quality = 'high', samples = 4 } = {}) {
  renderer.toneMapping = THREE.NoToneMapping;

  const params = { ...DEFAULTS };
  const direct = () => renderer.render(scene, camera);
  const api = { enabled: false, render: direct, setSize() {}, params, dispose() {} };

  if (quality !== 'high') return api;

  const ext = renderer.extensions;
  if (!ext.has('EXT_color_buffer_float') && !ext.has('EXT_color_buffer_half_float')) {
    console.warn('post: sin buffers de media precisión; se dibuja sin postproceso.');
    return api;
  }

  // Buffer de la escena: HDR (los valores > 1 llegan vivos al bloom) y con MSAA propio,
  // porque el antialias del canvas no aplica al dibujar dentro de un render target.
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(Math.max(1, buf.x), Math.max(1, buf.y), {
    type: THREE.HalfFloatType,
    samples: msaaSamples(renderer, samples),
    resolveDepthBuffer: false,
  });

  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(1); // el composer trabaja en píxeles reales; el tamaño lo pone setSize()
  composer.readBuffer.texture.name = 'post.scene'; // aquí se dibuja la escena y se suma el bloom

  const renderPass = new RenderPass(scene, camera);

  const bloom = new UnrealBloomPass(new THREE.Vector2(buf.x, buf.y), params.bloomStrength, params.bloomRadius, params.bloomThreshold);
  if (bloom.materialHighPassFilter) {
    bloom.materialHighPassFilter.fragmentShader = HIGHPASS_FRAGMENT;
    bloom.materialHighPassFilter.needsUpdate = true;
    bloom.highPassUniforms.smoothWidth.value = BLOOM_KNEE;
  }

  const gu = {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrainT: { value: 0 },
    uAspect: { value: 1 },
    uHeat: { value: 0 },
    uAberration: { value: 0 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
  };
  const grade = new ShaderPass(new THREE.ShaderMaterial({
    name: 'post.grade',
    uniforms: gu,
    vertexShader: GRADE_VERTEX,
    fragmentShader: GRADE_FRAGMENT,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }));
  // Va directo a pantalla: sin intercambio de buffers, el segundo buffer del composer
  // nunca se usa y nunca llega a ocupar memoria de video.
  grade.needsSwap = false;

  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(grade);

  function setSize(width, height, pixelRatio) {
    if (!alive) return;
    if (width > 0 && height > 0) {
      const pr = pixelRatio > 0 ? pixelRatio : renderer.getPixelRatio();
      buf.set(Math.floor(width * pr), Math.floor(height * pr)); // igual que renderer.setSize
    } else {
      renderer.getDrawingBufferSize(buf);
    }
    const w = Math.max(1, buf.x), h = Math.max(1, buf.y);
    composer.setSize(w, h); // buffers + pases (el bloom arma su cadena desde la mitad)
    bloom.resolution.set(w, h);
    gu.uAspect.value = w / h;
  }

  const t0 = performance.now();
  let alive = true;

  function render() {
    if (!alive) return direct();
    const p = params;
    bloom.strength = num(p.bloomStrength);
    bloom.enabled = bloom.strength > 0.001;
    bloom.radius = clamp01(num(p.bloomRadius, DEFAULTS.bloomRadius)); // three lo pide entre 0 y 1
    bloom.threshold = num(p.bloomThreshold, DEFAULTS.bloomThreshold);

    const t = (performance.now() - t0) / 1000;
    gu.uTime.value = t;
    gu.uGrainT.value = Math.floor(t * GRAIN_FPS) % 1024;
    gu.uHeat.value = clamp01(num(p.heat));
    gu.uAberration.value = num(p.aberration);
    gu.uVignette.value = num(p.vignette);
    gu.uGrain.value = num(p.grain);

    composer.render();
  }

  function dispose() {
    if (!alive) return;
    alive = false;
    api.enabled = false;
    composer.dispose(); // los dos buffers y el pase interno de copia
    bloom.dispose();
    bloom.materialHighPassFilter?.dispose(); // three no lo libera en su dispose()
    grade.dispose();
  }

  setSize();

  api.enabled = true;
  api.render = render;
  api.setSize = setSize;
  api.dispose = dispose;
  return api;
}
