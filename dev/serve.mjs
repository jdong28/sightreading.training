// Frontend-only dev server: bundles and serves the app with esbuild, no
// backend required. Backend features (login, stats, play-along song library)
// will 404; everything else works.
//
//   npm run dev

import {join, dirname} from "path"
import {fileURLToPath} from "url"

import * as esbuild from "esbuild"
import {buildAssets} from "./build_assets.mjs"
import {APP_BUILD, ENGINES_BUILD, copyVerovio} from "./esbuild_options.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(ROOT)

const generated = buildAssets()
if (generated.length) {
  console.log(`generated ${generated.length} asset file(s)`)
}

// bundle to dev/out rather than static/ so the tup-managed main.js on a
// full checkout is never overwritten by the frontend-only workflow. The
// jasmine specs are bundled too and run at /dev/specs.html. The engines
// bundle is built beside them with the Verovio files it loads
const ctx = await esbuild.context(APP_BUILD)
const enginesCtx = await esbuild.context(ENGINES_BUILD)
copyVerovio()

await enginesCtx.watch()
await ctx.watch()

const {port} = await ctx.serve({
  servedir: ".",
  fallback: "dev/index.html",
  port: Number(process.env.PORT) || 3000,
})

console.log(`\nSight Reading Trainer (frontend only): http://localhost:${port}/`)
console.log(`Jasmine specs: http://localhost:${port}/dev/specs.html`)
