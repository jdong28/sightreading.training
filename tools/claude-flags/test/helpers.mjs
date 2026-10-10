// What the specs share: the fixtures, a bridge opened once per file, and a
// way to run the command against the stub `claude`.

import {spawn} from "node:child_process"
import {chmodSync, mkdtempSync, readFileSync, writeFileSync, readdirSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const FIXTURES = join(HERE, "fixtures")
export const CLI = join(HERE, "..", "cli.mjs")
export const STUB = join(FIXTURES, "fake-claude.mjs")

chmodSync(STUB, 0o755)

export const smallXML = () => readFileSync(join(FIXTURES, "small.musicxml"), "utf8")

export const musicxmlInput = (xml, fileName = "small.musicxml") =>
  ({kind: "musicxml", fileName, base64: Buffer.from(xml).toString("base64")})

export const tempDir = prefix => mkdtempSync(join(tmpdir(), `claude-flags-${prefix}-`))

// the small score under another title, written to a folder
export function writeScores(dir, titles) {
  titles.forEach((title, idx) => {
    let xml = smallXML().replace("<work-title>Small Study</work-title>", `<work-title>${title}</work-title>`)
    writeFileSync(join(dir, `${idx + 1}-${title.toLowerCase().replace(/\W+/g, "-")}.musicxml`), xml)
  })
}

export const readLog = path => {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line))
  } catch (e) {
    return []
  }
}

export const filesIn = dir => readdirSync(dir).sort()

/**
 * Runs the command as a child process against the stub.
 * @param {string[]} args
 * @param {Object} opts {env, onStart}
 * @returns {{child, done: Promise<{code, stdout, stderr}>}}
 */
export function runCli(args, {env = {}} = {}) {
  let child = spawn(process.execPath, [CLI, ...args], {
    env: {...process.env, ...env}, stdio: ["ignore", "pipe", "pipe"],
  })

  let stdout = ""
  let stderr = ""
  child.stdout.on("data", chunk => { stdout += chunk })
  child.stderr.on("data", chunk => { stderr += chunk })

  let done = new Promise(resolve => {
    child.on("close", (code, signal) => resolve({code, signal, stdout, stderr}))
  })
  return {child, done}
}

export async function waitFor(test, {timeout = 30000, step = 50} = {}) {
  let start = Date.now()
  for (;;) {
    let value = test()
    if (value) { return value }
    if (Date.now() - start > timeout) { throw new Error("timed out waiting") }
    await new Promise(resolve => setTimeout(resolve, step))
  }
}
