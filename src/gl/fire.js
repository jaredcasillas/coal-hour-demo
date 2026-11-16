// El fuego: brasas (versión simple de respaldo), parrilla, llama, chispas, pavesas y humo.
// Todo es shader propio (sin luces): lo que se escribe es lo que se ve.
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const rnd = (a = 1, b = 0) => b + Math.random() * (a - b);

/* ───────────── Brasas ───────────── */
export function makeCoals(U, count) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.abs(Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453) % 1;
    v.multiplyScalar(0.74 + 0.4 * h);
    pos.setXYZ(i, v.x, v.y * 0.8, v.z);
  }
  geo.computeVertexNormals();

  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uIgnite: U.ignite },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec3 vW; varying vec3 vN; varying float vSeed;
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime; uniform float uIgnite;
      varying vec3 vW; varying vec3 vN; varying float vSeed;
      ${NOISE}
      void main(){
        vec3 n = normalize(vN);
        float heat = fbm3(vW * 2.6 + vec3(0.0, uTime * 0.05, 0.0) + vSeed * 3.0);
        float pulse = 0.5 + 0.5 * sin(uTime * (0.6 + vSeed * 0.9) + vSeed * 40.0);
        float under = clamp(0.55 - n.y * 0.75, 0.0, 1.0);
        float deep = 1.0 - smoothstep(0.05, 0.6, vW.y);
        float r = length(vW.xz - vec2(0.0, -0.3));
        float R = uIgnite * 5.2;
        float ignite = 1.0 - smoothstep(R - 1.3, R, r);
        float glow = smoothstep(0.32, 0.74, heat + 0.2 * pulse) * (0.3 + 0.7 * under) * (0.45 + 0.55 * deep) * ignite;
        float crack = smoothstep(0.52, 0.7, vnoise3(vW * 9.0 + vSeed * 5.0)) * ignite * (0.35 + 0.65 * under);
        glow = max(glow, crack * 0.85);
        vec3 ash = vec3(0.05, 0.044, 0.042) + 0.05 * hash31(floor(vW * 42.0));
        ash *= 0.3 + 0.7 * clamp(n.y, 0.0, 1.0);
        vec3 hot = mix(vec3(0.6, 0.03, 0.0), vec3(1.0, 0.36, 0.03), smoothstep(0.1, 0.6, glow));
        hot = mix(hot, vec3(1.0, 0.86, 0.55), smoothstep(0.65, 1.0, glow));
        vec3 bounce = vec3(0.42, 0.07, 0.01) * under * deep * ignite * 0.7;
        gl_FragColor = vec4(ash + bounce + hot * glow * 1.6, 1.0);
      }`,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const d = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const x = rnd(2.65, -2.65), z = rnd(1.45, -2.05);
    const mound = 0.16 * Math.exp(-(x * x) / 5) + 0.05 * Math.sin(x * 2.1 + z * 1.7);
    d.position.set(x, 0.06 + Math.random() * 0.2 + mound, z);
    const s = 0.12 + Math.random() ** 2 * 0.2;
    d.scale.set(s, s * rnd(1.05, 0.6), s * rnd(1.2, 0.8));
    d.rotation.set(rnd(6.28), rnd(6.28), rnd(6.28));
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;

  // Lecho encendido debajo, para que los huecos entre brasas ardan.
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 4.4),
    new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uIgnite: U.ignite },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float; uniform float uTime; uniform float uIgnite; varying vec2 vUv;
        ${NOISE}
        void main(){
          vec2 p = (vUv - 0.5) * vec2(6.2, 4.4);
          float n = fbm(p * 2.4 + vec2(0.0, uTime * 0.08));
          float edge = 1.0 - smoothstep(0.55, 1.0, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0);
          float g = (0.35 + 0.65 * n) * edge * uIgnite;
          vec3 c = mix(vec3(1.0, 0.2, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.45, 0.8, n));
          gl_FragColor = vec4(c * g * 1.15, 1.0);
        }`,
    }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(0, 0.0, -0.3);

  const g = new THREE.Group();
  g.add(bed, mesh);
  return g;
}

/* ───────────── Parrilla (rejilla + caja) ───────────── */
export function makeGrill(U) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uIgnite: U.ignite },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main(){
        #ifdef USE_INSTANCING
          mat4 m = modelMatrix * instanceMatrix;
        #else
          mat4 m = modelMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vW = wp.xyz; vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; uniform float uTime; uniform float uIgnite;
      varying vec3 vW; varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        float under = clamp(-n.y * 0.9 + 0.22, 0.0, 1.0);
        float low = 1.0 - smoothstep(-0.2, 1.7, vW.y);
        float flick = 0.85 + 0.15 * sin(uTime * 3.1 + vW.x * 2.0) * sin(uTime * 1.7 + vW.z * 3.0);
        vec3 col = vec3(0.017, 0.016, 0.018);
        col += vec3(0.95, 0.23, 0.03) * under * low * uIgnite * flick;
        col += vec3(0.055, 0.05, 0.055) * clamp(n.y, 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const g = new THREE.Group();
  const Y = 0.95;

  const barGeo = new THREE.CylinderGeometry(0.022, 0.022, 3.8, 6);
  barGeo.rotateX(Math.PI / 2);
  const N = 28;
  const bars = new THREE.InstancedMesh(barGeo, mat, N);
  const d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    d.position.set(-2.7 + i * 0.2, Y, -0.3);
    d.updateMatrix();
    bars.setMatrixAt(i, d.matrix);
  }
  bars.frustumCulled = false;
  g.add(bars);

  const crossGeo = new THREE.CylinderGeometry(0.03, 0.03, 5.7, 6);
  crossGeo.rotateZ(Math.PI / 2);
  for (const z of [-2.15, -0.3, 1.55]) {
    const c = new THREE.Mesh(crossGeo, mat);
    c.position.set(0, Y - 0.04, z);
    g.add(c);
  }

  const back = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.35, 0.08), mat);
  back.position.set(0, 0.33, -2.28);
  const sideGeo = new THREE.BoxGeometry(0.08, 1.35, 3.95);
  const L = new THREE.Mesh(sideGeo, mat); L.position.set(-2.88, 0.33, -0.34);
  const R = new THREE.Mesh(sideGeo, mat); R.position.set(2.88, 0.33, -0.34);
  g.add(back, L, R);
  return g;
}

/* ───────────── Llama ───────────── */
export function makeFlame(U) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.time, uAmt: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float; uniform float uTime; uniform float uAmt; varying vec2 vUv;
      ${NOISE}
      void main(){
        vec2 uv = vUv; float t = uTime;
        float px = (uv.x - 0.5) * 2.0;
        float n1 = fbm(vec2(px * 2.2, uv.y * 2.6 - t * 1.1));
        float n2 = fbm(vec2(px * 4.6 + n1 * 0.9, uv.y * 5.2 - t * 1.9));
        float shape = 1.0 - smoothstep(0.0, 1.0, abs(px) * (1.05 + uv.y * 1.7));
        float f = shape * (1.3 - uv.y * 1.2) + (n1 * 0.7 + n2 * 0.5 - 0.64);
        f = clamp(f, 0.0, 1.0) * smoothstep(0.0, 0.1, uv.y);
        vec3 col = mix(vec3(0.62, 0.03, 0.0), vec3(1.0, 0.38, 0.02), smoothstep(0.1, 0.5, f));
        col = mix(col, vec3(1.0, 0.9, 0.55), smoothstep(0.55, 0.95, f));
        float a = smoothstep(0.02, 0.4, f) * uAmt;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.8), mat);
  m.position.set(0, 3.15, -0.75);
  m.renderOrder = 2;
  return m;
}

/* ───────────── Chispas que suben de las brasas ───────────── */
export function makeSparks(U, count) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.time, uIgnite: U.ignite, uPx: U.px },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime; uniform float uPx;
      varying float vLife;
      void main(){
        float life = fract(uTime * (0.09 + aSeed.z * 0.15) + aSeed.w);
        vec3 p = vec3((aSeed.x - 0.5) * 5.0, 0.3 + life * 1.3 + life * life * 5.6, (aSeed.y - 0.5) * 3.2 - 0.3);
        p.x += sin(life * 9.0 + aSeed.w * 30.0) * 0.28 * life + (aSeed.x - 0.5) * life * 1.6;
        p.z += cos(life * 7.0 + aSeed.z * 30.0) * 0.28 * life;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = uPx * (0.55 + aSeed.z) * (1.0 - life * 0.7) / max(-mv.z, 0.15);
        vLife = life;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; uniform float uIgnite; varying float vLife;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a;
        vec3 c = mix(vec3(1.0, 0.86, 0.5), vec3(1.0, 0.32, 0.02), smoothstep(0.0, 0.5, vLife));
        c = mix(c, vec3(0.6, 0.05, 0.0), smoothstep(0.5, 1.0, vLife));
        a *= (1.0 - smoothstep(0.7, 1.0, vLife)) * smoothstep(0.0, 0.05, vLife) * uIgnite;
        gl_FragColor = vec4(c, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

/* ───────────── Pavesas: flotan alrededor de la cámara todo el recorrido ───────────── */
export function makeEmbers(U, count) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 3);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.time, uCam: U.cam, uPx: U.px, uIgnite: U.ignite },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed; uniform float uTime; uniform float uPx; uniform vec3 uCam;
      varying float vA;
      void main(){
        vec3 box = vec3(14.0, 10.0, 14.0);
        vec3 p = aSeed * box;
        p.y += uTime * (0.22 + aSeed.x * 0.35);
        p.x += sin(uTime * 0.3 + aSeed.y * 20.0) * 0.45;
        p.z += cos(uTime * 0.23 + aSeed.z * 20.0) * 0.45;
        p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float tw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed.z * 3.0) + aSeed.x * 50.0);
        float dist = -mv.z;
        gl_PointSize = uPx * (0.45 + aSeed.y * 0.9) * (0.5 + 0.5 * tw) / max(dist, 0.2);
        vA = tw * (1.0 - smoothstep(4.0, 7.0, dist)) * smoothstep(0.4, 1.2, dist);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float; uniform float uIgnite; varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a;
        gl_FragColor = vec4(vec3(1.0, 0.42, 0.08), a * vA * 0.85 * uIgnite);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

/* ───────────── Humo: cartelones suaves repartidos por el recorrido ───────────── */
export function makeSmoke(U, spots) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const base = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: U.time, uIgnite: U.ignite, uSeed: { value: 0 }, uScale: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uAlpha: { value: 0.3 } },
    vertexShader: /* glsl */ `
      uniform float uScale; uniform float uSeed; uniform float uTime;
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float a = uSeed * 6.28 + uTime * 0.03 * (uSeed - 0.5);
        vec2 q = position.xy * uScale;
        mv.xy += vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime; uniform float uSeed; uniform float uAlpha; uniform float uIgnite; uniform vec3 uTint;
      varying vec2 vUv;
      ${NOISE}
      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float n = fbm(vUv * 2.3 + vec2(uSeed * 13.0, uSeed * 7.0 - uTime * 0.045));
        float a = (1.0 - smoothstep(0.25, 1.0, r)) * smoothstep(0.28, 0.85, n);
        gl_FragColor = vec4(uTint * (0.55 + 0.6 * n), a * uAlpha * uIgnite);
      }`,
  });
  const g = new THREE.Group();
  for (const s of spots) {
    const mat = base.clone();
    mat.uniforms.uTime = U.time;
    mat.uniforms.uIgnite = U.ignite;
    mat.uniforms.uSeed.value = Math.random();
    mat.uniforms.uScale.value = s.scale;
    mat.uniforms.uTint.value = new THREE.Vector3(...s.tint);
    mat.uniforms.uAlpha.value = s.alpha;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...s.pos);
    m.frustumCulled = false;
    m.renderOrder = s.order ?? 4;
    g.add(m);
  }
  return g;
}
