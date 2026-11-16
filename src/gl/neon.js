// Letrero de neón: el texto se dibuja en un canvas (núcleo nítido + halo desenfocado)
// y el shader lo enciende con parpadeo. Con bloom activo, el núcleo supera 1.0 y resplandece.
import * as THREE from 'three';

export function makeNeon(U, { text, font = "400 200px 'Anton', 'Arial Narrow', sans-serif", height = 0.62 }) {
  const pad = 120;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const tw = Math.ceil(probe.measureText(text).width);
  const cw = tw + pad * 2, ch = 200 + pad * 2;

  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = font;
  ctx.globalCompositeOperation = 'lighter';
  // El letrero es un tubo que sigue el contorno de cada letra, no letras rellenas.
  // Canal verde: halo ancho. Canal rojo: tubo nítido. Canal azul: relleno tenue del interior.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const y = ch / 2 + 8;
  ctx.filter = 'blur(22px)';
  ctx.strokeStyle = 'rgb(0,255,0)';
  ctx.lineWidth = 16;
  ctx.strokeText(text, cw / 2, y);
  ctx.filter = 'blur(7px)';
  ctx.strokeStyle = 'rgb(0,140,0)';
  ctx.lineWidth = 12;
  ctx.strokeText(text, cw / 2, y);
  ctx.filter = 'blur(3px)';
  ctx.fillStyle = 'rgb(0,0,255)';
  ctx.fillText(text, cw / 2, y);
  ctx.filter = 'none';
  ctx.strokeStyle = 'rgb(255,0,0)';
  ctx.lineWidth = 7;
  ctx.strokeText(text, cw / 2, y);

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.time, uMap: { value: tex }, uAmt: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uMap; uniform float uTime; uniform float uAmt;
      varying vec2 vUv;
      float h(float n){ return fract(sin(n * 78.233) * 43758.5453); }
      void main(){
        vec4 t = texture2D(uMap, vUv);
        // Zumbido constante + un mal contacto de vez en cuando.
        float buzz = 0.93 + 0.07 * sin(uTime * 47.0) * sin(uTime * 13.0);
        float tick = floor(uTime * 9.0);
        float drop = step(0.965, h(tick)) * step(0.5, h(tick + 3.7));
        float on = buzz * (1.0 - 0.75 * drop);
        // Al llegar, el tubo tarda en prender: parpadea mientras uAmt sube.
        float strike = smoothstep(0.0, 1.0, uAmt);
        float stutter = mix(step(0.45, h(floor(uTime * 22.0))), 1.0, smoothstep(0.55, 0.95, uAmt));
        float k = strike * stutter * on;
        vec3 halo = vec3(1.0, 0.1, 0.045) * t.g * 0.75;
        vec3 glass = vec3(1.35, 0.2, 0.13) * t.r;
        vec3 core = vec3(0.75, 0.7, 0.62) * smoothstep(0.72, 1.0, t.r);
        vec3 fill = vec3(0.22, 0.012, 0.006) * t.b;
        gl_FragColor = vec4((halo + glass + core + fill) * k, 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * (cw / ch), height), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  // La altura visible del texto es ~200/ch del plano: se escala para que `height` sea la del texto.
  mesh.geometry.scale(ch / 200, ch / 200, 1);

  return {
    mesh,
    setAmount(a) {
      mat.uniforms.uAmt.value = a;
      mesh.visible = a > 0.003;
    },
  };
}
