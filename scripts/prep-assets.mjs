// Prepara las imágenes generadas para el sitio.
//   assets-src/<id>-l.(jpg|png)   escena horizontal  → public/img/<id>-l.webp + <id>-l-depth.webp
//   assets-src/<id>-p.(jpg|png)   escena vertical    → public/img/<id>-p.webp + <id>-p-depth.webp
//   assets-src/menu-<nombre>.jpg  vista previa menú  → public/img/menu/<nombre>.webp (sin profundidad)
// La profundidad se calcula en local con Depth Anything V2 small. Uso: npm run assets
import { mkdir, readdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'img');
const only = process.argv.slice(2); // opcional: procesar solo estos ids

await mkdir(path.join(OUT, 'menu'), { recursive: true });
await mkdir(path.join(ROOT, 'src', 'data'), { recursive: true });

let depthPipe = null;
async function getDepth() {
  if (depthPipe) return depthPipe;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(ROOT, '.cache');
  depthPipe = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'fp32' });
  return depthPipe;
}

const manifestPath = path.join(ROOT, 'src', 'data', 'shots.json');
const manifest = existsSync(manifestPath) ? JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8')) : {};
const files = (await readdir(SRC)).filter((f) => /\.(jpe?g|png)$/i.test(f));

for (const f of files) {
  const name = f.replace(/\.\w+$/, '');
  const srcPath = path.join(SRC, f);

  if (name.startsWith('menu-')) {
    const out = path.join(OUT, 'menu', `${name.slice(5)}.webp`);
    if (only.length && !only.includes(name)) continue;
    await sharp(srcPath).resize({ width: 720, height: 900, fit: 'cover' }).webp({ quality: 80 }).toFile(out);
    console.log(`${name}: vista previa de menú`);
    continue;
  }
  if (!/-(l|p)$/.test(name)) continue;
  if (only.length && !only.includes(name)) continue;

  const landscape = name.endsWith('-l');
  const img = sharp(srcPath).resize({ width: landscape ? 1600 : 1200, withoutEnlargement: true });
  const info = await img.clone().webp({ quality: 80 }).toFile(path.join(OUT, `${name}.webp`));

  const tmp = path.join(OUT, `_${name}.png`);
  await sharp(srcPath).resize({ width: 768 }).png().toFile(tmp);
  let depthOk = false;
  try {
    const pipe = await getDepth();
    const { depth } = await pipe(tmp);
    await sharp(Buffer.from(depth.data), { raw: { width: depth.width, height: depth.height, channels: 1 } })
      .resize({ width: 512 }).blur(1.2).webp({ quality: 88 })
      .toFile(path.join(OUT, `${name}-depth.webp`));
    depthOk = true;
  } catch (err) {
    console.error(`profundidad falló para ${name}:`, err.message);
  }
  if (existsSync(tmp)) await unlink(tmp);

  manifest[name] = { aspect: +(info.width / info.height).toFixed(4), depth: depthOk };
  console.log(`${name}: ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB · profundidad ${depthOk ? 'ok' : 'NO'}`);
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log('listo → public/img y src/data/shots.json');
