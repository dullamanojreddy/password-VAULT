// Bundles each extension entry point into ONE self-contained file (so
// @aegis/shared's imports resolve at build time, not via runtime module
// resolution the extension package would otherwise need to ship separately)
// and assembles dist/ into a directly loadable unpacked extension.
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const dist = join(root, 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const entries = [
  // Service workers must be ESM (manifest declares "type": "module").
  { in: 'src/background/service-worker.js', out: 'background/service-worker.js', format: 'esm' },
  // Content scripts run as classic scripts unless the manifest opts them
  // into module type (which has patchier support) — IIFE avoids that
  // entirely by inlining every import into one flat, dependency-free file.
  { in: 'src/content/content-script.js', out: 'content/content-script.js', format: 'iife' },
  // Loaded via <script type="module"> from their own HTML pages, so ESM
  // works natively here — no bundler-specific loader needed at runtime.
  { in: 'src/popup/popup.js', out: 'popup/popup.js', format: 'esm' },
  { in: 'src/options/options.js', out: 'options/options.js', format: 'esm' },
]

const sharedSrc = join(root, '../../packages/shared/src')

for (const e of entries) {
  await build({
    entryPoints: [join(root, e.in)],
    outfile: join(dist, e.out),
    bundle: true,
    format: e.format,
    target: 'chrome116',
    minify: false,
    sourcemap: true,
    logLevel: 'info',
    alias: {
      '@aegis/shared/vault-client': join(sharedSrc, 'vault-client.js'),
      '@aegis/shared/crypto': join(sharedSrc, 'crypto.js'),
      '@aegis/shared/strength': join(sharedSrc, 'strength.js'),
      '@aegis/shared/config': join(sharedSrc, 'config.js'),
      '@aegis/shared/credential-schema': join(sharedSrc, 'credential-schema.js'),
      '@aegis/shared/audit': join(sharedSrc, 'audit.js'),
      '@aegis/shared': join(sharedSrc, 'index.js'),
    },
  })
}

// Static assets: manifest, icons, and the HTML/CSS shells the JS bundles above attach to.
cpSync(join(root, 'manifest.json'), join(dist, 'manifest.json'))
cpSync(join(root, 'public', 'icons'), join(dist, 'icons'), { recursive: true })
cpSync(join(root, 'src', 'popup', 'popup.html'), join(dist, 'popup', 'popup.html'))
cpSync(join(root, 'src', 'popup', 'popup.css'), join(dist, 'popup', 'popup.css'))
cpSync(join(root, 'src', 'options', 'options.html'), join(dist, 'options', 'options.html'))

console.log(`\n✓ Built unpacked extension → ${dist}`)
console.log('  Load it via chrome://extensions → Developer mode → Load unpacked')
