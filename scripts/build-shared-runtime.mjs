import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const pnpmStore = path.join(root, 'node_modules', '.pnpm');
const esbuildEntry = fs.readdirSync(pnpmStore)
  .find((name) => name.startsWith('esbuild@'));

if (!esbuildEntry) {
  throw new Error('esbuild is required by the workspace toolchain but was not found.');
}

const esbuildPath = path.join(pnpmStore, esbuildEntry, 'node_modules', 'esbuild', 'lib', 'main.js');
const { build } = await import(pathToFileURL(esbuildPath).href);
const entry = path.join(root, 'packages', 'shared', 'src', 'index.ts');
const outdir = path.join(root, 'packages', 'shared', 'dist');

await Promise.all([
  build({ entryPoints: [entry], outfile: path.join(outdir, 'index.mjs'), bundle: true, format: 'esm', platform: 'neutral', target: 'es2020' }),
  build({ entryPoints: [entry], outfile: path.join(outdir, 'index.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'node18' }),
]);
