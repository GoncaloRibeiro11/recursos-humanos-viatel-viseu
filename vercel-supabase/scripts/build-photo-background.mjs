import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';

await build({
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['src/photo-background-removal.js'],
  outfile: 'public/photo-background-removal.js',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome100', 'safari16'],
  logLevel: 'info'
});
await copyFile(new URL('../public/mapa-recursos-humanos.html', import.meta.url), new URL('../public/mapa-coordenacao-2026.html', import.meta.url));
