// Generates PNG icons from public/favicon.svg (idempotent, runs before build).
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';

const svgPath = new URL('../public/favicon.svg', import.meta.url);
if (!existsSync(svgPath)) {
  console.error('[icons] public/favicon.svg missing');
  process.exit(1);
}
const svg = await readFile(svgPath);
const svgTime = (await stat(svgPath)).mtimeMs;
const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];
for (const [name, size] of targets) {
  const out = new URL(`../public/${name}`, import.meta.url);
  if (existsSync(out) && (await stat(out)).mtimeMs > svgTime) continue;
  const png = await sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await writeFile(out, png);
  console.log(`[icons] wrote ${name}`);
}
