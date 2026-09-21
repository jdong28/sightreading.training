// Headless Jasmine spec runner: builds the same esbuild bundle used by
// dev/serve.mjs, serves it on a free port, and runs the specs bundled at
// /dev/specs.html in headless Chromium (puppeteer), printing a summary and
// every failure. Exits non-zero on any Jasmine failure or on timeout.
//
//   npm test

import {join, dirname} from "path"
import {fileURLToPath} from "url"

import * as esbuild from "esbuild"
import puppeteer from "puppeteer"
import {buildAssets} from "./build_assets.mjs"
import {APP_BUILD, ENGINES_BUILD, copyVerovio} from "./esbuild_options.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(ROOT)

const TIMEOUT_MS = 120_000

async function main() {
  buildAssets()

  const ctx = await esbuild.context(APP_BUILD)
  const enginesCtx = await esbuild.context(ENGINES_BUILD)

  try {
    await ctx.rebuild()
    await enginesCtx.rebuild()
    copyVerovio()

    const {port} = await ctx.serve({
      servedir: ".",
      fallback: "dev/index.html",
      port: 0,
    })

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    })

    try {
      const page = await browser.newPage()
      page.on("pageerror", err => console.error("page error:", err))
      page.on("console", msg => {
        if (msg.type() === "error") console.error("console error:", msg.text())
      })

      // jasmine-core's boot0/boot1 expose window.jsApiReporter but no longer
      // register it as a reporter (only the HTML reporter is auto-wired), so
      // without this it never receives jasmineStarted/jasmineDone and
      // status() stays "loaded" forever. Trap both globals as they're
      // assigned and register the reporter ourselves before Jasmine runs.
      await page.evaluateOnNewDocument(() => {
        let reporter = null
        let registered = false
        function tryRegister() {
          if (!registered && reporter && window.jasmine) {
            window.jasmine.getEnv().addReporter(reporter)
            registered = true
          }
        }
        Object.defineProperty(window, "jsApiReporter", {
          configurable: true,
          get() { return reporter },
          set(v) { reporter = v; tryRegister() },
        })
        let jasmineVal
        Object.defineProperty(window, "jasmine", {
          configurable: true,
          get() { return jasmineVal },
          set(v) { jasmineVal = v; tryRegister() },
        })
      })

      await page.goto(`http://localhost:${port}/dev/specs.html`, {waitUntil: "load"})

      try {
        await page.waitForFunction(
          () => window.jsApiReporter && window.jsApiReporter.status() === "done",
          {timeout: TIMEOUT_MS, polling: 100}
        )
      } catch (err) {
        console.error(`Timed out after ${TIMEOUT_MS}ms waiting for Jasmine to finish`)
        process.exitCode = 1
        return
      }

      const specs = await page.evaluate(() => window.jsApiReporter.specs())
      const failed = specs.filter(s => s.status === "failed")
      const pending = specs.filter(s => s.status === "pending")

      console.log(`\n${specs.length} specs, ${failed.length} failures, ${pending.length} pending\n`)

      for (const spec of failed) {
        console.log(`FAILED: ${spec.fullName}`)
        for (const exp of spec.failedExpectations) {
          console.log(`  ${exp.message}`)
          if (exp.stack) {
            console.log(exp.stack.split("\n").slice(0, 5).map(line => `    ${line}`).join("\n"))
          }
        }
      }

      process.exitCode = failed.length > 0 ? 1 : 0
    } finally {
      await browser.close()
    }
  } finally {
    await ctx.dispose()
    await enginesCtx.dispose()
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
