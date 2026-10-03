import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// PDF.js fonts and decoders are served from this site, including on GitHub Pages.
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  mkdirSync(resolve('dist/pdfjs', folder), { recursive: true })
  cpSync(resolve('node_modules/pdfjs-dist', folder), resolve('dist/pdfjs', folder), { recursive: true })
}
