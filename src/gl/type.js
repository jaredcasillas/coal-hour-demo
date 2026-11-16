// Letras de hierro: el nombre de la marca forjado en 3D detrás de la parrilla.
// Al encender, el calor sube por las letras (negro → rojo cereza → blanco vivo) y luego
// enfrían a color hueso, con la base todavía al rojo. El texto se dibuja en un canvas
// (rojo = letra nítida, verde = halo) y el shader hace el resto.
import * as THREE from 'three';
import { NOISE } from './glsl.js';

export function makeIronType(U, { lines, font = "'Anton', 'Arial Narrow', sans-serif", em = 2.1, pitch = 0.9 }) {
  const size = 240, pad = 160;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `400 ${size}px ${font}`;
  const tw = Math.ceil(Math.max(...lines.map((l) => probe.measureText(l).width)));
  const lineH = size * pitch;
  const cw = tw + pad * 2;
  const ch = Math.ceil(lineH * (lines.length - 1) + size + pad * 2);

  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  ctx.font = `400 ${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalCompositeOperation = 'lighter';
  const draw = (style, blur) => {
    ctx.filter = blur ? `blur(${blur}px)` : 'none';
    ctx.fillStyle = style;
    lines.forEach((l, i) => ctx.fillText(l, cw / 2, pad + size / 2 + i * lineH + 12));
  };
  draw('rgb(0,255,0)', 34);
  draw('rgb(0,140,0)', 12);
  draw('rgb(255,0,0)', 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;

  // Unidades de mundo por pixel: `em` es el alto del cuerpo de letra.
  const k = em / size;
  const W = cw * k, H = ch * k;
  const geo = new THREE.PlaneGeometry(W, H);
  // El pie del bloque de texto queda en y = 0.
  const footPx = pad + size * 0.14;
  geo.translate(0, H / 2 - footPx * k, 0);

  const uniforms = {
    uTime: U.time,
    uMap: { value: tex },
    uHeat: { value: 0 },
    uCool: { value: 0 },
    uAmt: { value: 0 },
    uY0: { value: footPx / ch },
    uY1: { value: 1 - (pad + size * 0.1) / ch },
  };
  const vertexShader = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const common = /* glsl */ `
    precision highp float;
    uniform sampler2D uMap; uniform float uTime; uniform float uHeat; uniform float uCool; uniform float uAmt;
    uniform float uY0; uniform float uY1;
    varying vec2 vUv;
    ${NOISE}
    // Temperatura 0..1 de este punto: el frente sube con uHeat, con borde irregular.
    float temp(out float yb, out float n){
      yb = clamp((vUv.y - uY0) / (uY1 - uY0), 0.0, 1.0);
      n = fbm(vec2(vUv.x * 9.0, vUv.y * 5.0 - uTime * 0.1));
      float front = uHeat * 1.6 - 0.28;
      return clamp((front - yb) * 2.3 + (n - 0.5) * 0.55 + 0.4, 0.0, 1.0) * step(0.001, uHeat);
    }`;

  // Núcleo de la letra: opaco, escribe profundidad (la llama de atrás no lo lava).
  const core = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader, transparent: true,
    fragmentShader: /* glsl */ `
      ${common}
      void main(){
        float a = smoothstep(0.42, 0.58, texture2D(uMap, vUv).r);
        if (a * uAmt < 0.02) discard;
        float yb, n;
        float T = temp(yb, n);
        float Tc = T * (1.0 - uCool);
        vec3 iron = vec3(0.04, 0.036, 0.038) + 0.03 * n;
        vec3 hot = mix(vec3(0.55, 0.02, 0.0), vec3(1.0, 0.34, 0.03), smoothstep(0.15, 0.55, Tc));
        hot = mix(hot, vec3(1.55, 1.08, 0.62), smoothstep(0.6, 1.0, Tc));
        vec3 col = mix(iron, hot, smoothstep(0.02, 0.2, Tc));
        vec3 bone = vec3(0.95, 0.915, 0.85) * (0.9 + 0.1 * n);
        col = mix(col, bone, uCool * smoothstep(0.05, 0.6, T));
        // La base sigue al rojo: las brasas están justo debajo.
        float base = (1.0 - smoothstep(0.0, 0.3, yb)) * uCool * step(0.001, uHeat);
        float flick = 0.9 + 0.1 * sin(uTime * 7.0 + vUv.x * 40.0) * sin(uTime * 3.1);
        col = mix(col, vec3(1.3, 0.38, 0.06) * flick, base * (0.5 + 0.5 * n));
        gl_FragColor = vec4(col * uAmt, a);
      }`,
  }));
  core.renderOrder = 1;

  // Halo: suma luz alrededor de las letras calientes.
  const halo = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    fragmentShader: /* glsl */ `
      ${common}
      void main(){
        vec4 t = texture2D(uMap, vUv);
        float yb, n;
        float T = temp(yb, n);
        float Tc = T * (1.0 - uCool);
        float base = (1.0 - smoothstep(0.0, 0.35, yb)) * uCool * step(0.001, uHeat);
        float flick = 0.92 + 0.08 * sin(uTime * 9.0 + vUv.x * 30.0);
        float g = t.g * (1.0 - smoothstep(0.42, 0.58, t.r));
        vec3 c = vec3(1.0, 0.24, 0.04) * g * (Tc * 0.7 + base * 0.45) * flick;
        gl_FragColor = vec4(c * uAmt, 1.0);
      }`,
  }));
  halo.renderOrder = 3;

  const group = new THREE.Group();
  group.add(core, halo);
  group.visible = false;

  return {
    group,
    width: tw * k,
    setHeat(v) { uniforms.uHeat.value = v; },
    setCool(v) { uniforms.uCool.value = v; },
    setAmount(a) { uniforms.uAmt.value = a; group.visible = a > 0.003; },
  };
}
