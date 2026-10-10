// The app's own code, run in headless Chrome: esbuild bundles
// bridge/index.js with the app's modules (as dev/esbuild_options.mjs does for
// the specs) and puppeteer loads it into a blank page. One page serves a
// whole run.

/* global window */

import {join, dirname} from "node:path"
import {fileURLToPath} from "node:url"

import * as esbuild from "esbuild"
import puppeteer from "puppeteer"

import {buildAssets} from "../../../dev/build_assets.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const ENTRY = join(ROOT, "tools", "claude-flags", "bridge", "index.js")

/**
 * Bundles the bridge and opens it in a headless page.
 * @returns {Promise<{prepare: Function, schema: Function, verify: Function,
 * flagsFile: Function, close: Function}>}
 */
export async function openBridge() {
  // the song parser the importer needs is generated, never committed
  buildAssets()

  let built = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    nodePaths: [join(ROOT, "static", "js")],
    define: {ST_FRONTEND_ONLY: "true"},
    logLevel: "silent",
  })

  let browser = await puppeteer.launch({
    headless: true,
    // the command owns Ctrl+C: it stops its Claude child and closes this itself
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  })

  try {
    let page = await browser.newPage()
    page.on("pageerror", err => console.error("bridge page error:", err.message || err))
    await page.setContent("<!doctype html><html><body></body></html>")
    await page.addScriptTag({content: built.outputFiles[0].text})

    let call = (name, ...args) => page.evaluate((fn, params) => window.claudeFlags[fn](...params), name, args)

    return {
      prepare: (input, opts) => call("prepare", input, opts),
      schema: () => call("schema"),
      verify: (key, output) => call("verify", key, output),
      flagsFile: (key, opts) => call("flagsFile", key, opts),
      // for the specs
      flagKinds: () => call("flagKinds"),
      fingerprintsOf: input => call("fingerprintsOf", input),
      storedSong: input => call("storedSong", input),
      close: () => browser.close(),
    }
  } catch (e) {
    await browser.close()
    throw e
  }
}
