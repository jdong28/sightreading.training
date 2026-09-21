// The esbuild builds shared by dev/serve.mjs and dev/run_specs.mjs, mirroring
// static/Tupfile: the app and spec bundles, and the engraving engines bundle
// (st/score_render), which is its own ES module entry so only the pages that
// draw with an engine load it (see st/score_render/load.js)

import {copyFileSync, mkdirSync} from "fs"
import {join} from "path"

export const OUTDIR = "dev/out"

export const APP_BUILD = {
  entryPoints: [
    {in: "static/js/st/main.jsx", out: "main"},
    {in: "static/js/specs.js", out: "specs"},
  ],
  bundle: true,
  sourcemap: true,
  outdir: OUTDIR,
  nodePaths: ["static/js"],
  external: ["/static/fonts/*"],
  define: {ST_FRONTEND_ONLY: "true"},
  logLevel: "info",
}

export const ENGINES_BUILD = {
  entryPoints: [{in: "static/js/st/score_render/index.ts", out: "score_engines"}],
  bundle: true,
  format: "esm",
  sourcemap: true,
  outdir: OUTDIR,
  logLevel: "info",
}

// Verovio is LGPL: its distributed modules are served unmodified as their
// own files beside the engines bundle, which imports them by URL
export const VEROVIO_FILES = ["verovio-module.mjs", "verovio.mjs"]

export function copyVerovio(outdir=OUTDIR) {
  mkdirSync(outdir, {recursive: true})
  for (const file of VEROVIO_FILES) {
    copyFileSync(join("node_modules/verovio/dist", file), join(outdir, file))
  }
}
