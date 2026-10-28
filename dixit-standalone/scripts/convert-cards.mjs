import sharp from 'sharp';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'public', 'cards');
const outputDir = path.join(root, 'public', 'cards-webp');
await mkdir(outputDir, { recursive: true });

const sources = (await readdir(sourceDir)).filter(name => /^card-\d{3}\.png$/.test(name)).sort();
if (sources.length !== 84) throw new Error(`Expected 84 source cards, found ${sources.length}.`);

for (const name of sources) {
  const source = path.join(sourceDir, name);
  const output = path.join(outputDir, name.replace(/\.png$/, '.webp'));
  await sharp(source).webp({ quality: 90, effort: 6 }).toFile(output);
  const [original, optimized] = await Promise.all([sharp(source).metadata(), sharp(output).metadata()]);
  if (original.width !== optimized.width || original.height !== optimized.height) {
    throw new Error(`${name}: optimized image dimensions changed unexpectedly.`);
  }
  const [before, after] = await Promise.all([stat(source), stat(output)]);
  console.log(`${name}: ${original.width}x${original.height}, ${(before.size / 1024).toFixed(1)} KB -> ${(after.size / 1024).toFixed(1)} KB`);
}

console.log(`Created ${sources.length} native-size WebP app assets. PNG sources remain unchanged.`);
