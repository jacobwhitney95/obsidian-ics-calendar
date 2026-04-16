import esbuild from 'esbuild';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === 'production';
const watch = process.argv[2] === '--watch';

// Output directly to vault plugin folder (3 levels up from project dir)
const PLUGIN_OUT = resolve(__dirname, '../../../.obsidian/plugins/obsidian-ics-calendar');

if (!existsSync(PLUGIN_OUT)) {
  mkdirSync(PLUGIN_OUT, { recursive: true });
}

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@electron/remote',
    'codemirror',
    '@codemirror/*',
    '@lezer/*',
    'tls',
    'net',
    'crypto',
  ],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: `${PLUGIN_OUT}/main.js`,
  minify: prod,
  define: {
    'process.env.NODE_ENV': prod ? '"production"' : '"development"',
  },
});

if (watch) {
  await ctx.watch();
  console.log('Watching for changes... Output:', PLUGIN_OUT);
} else {
  await ctx.rebuild();
  await ctx.dispose();

  // Copy static assets
  copyFileSync('manifest.json', `${PLUGIN_OUT}/manifest.json`);
  copyFileSync('styles.css', `${PLUGIN_OUT}/styles.css`);
  console.log(`\n✅ Build complete → ${PLUGIN_OUT}`);
}
