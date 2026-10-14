import { mkdir, copyFile, rm, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'dist');
// An explicit public-file list keeps environment files, keys and protocol artifacts out of hosting.
const files = ['index.html', 'styles.css', 'app.js', 'simulation.js', 'mark.svg', '404.html', 'robots.txt'];
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) await copyFile(path.join(root, 'frontend', file), path.join(output, file));
const html = await readFile(path.join(output, 'index.html'), 'utf8');
if (/<script(?![^>]*src=)[^>]*>/i.test(html) || /\son[a-z]+=/i.test(html)) {
  throw new Error('Inline scripts and event handlers are prohibited by the frontend CSP.');
}
console.log(`Built ${files.length} allowlisted static frontend files into dist/. No runtime secrets or protocol keys included.`);
