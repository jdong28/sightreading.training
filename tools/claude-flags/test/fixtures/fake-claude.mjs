#!/usr/bin/env node
// A stand-in for the `claude` command: the specs never run the real one.
// It answers `auth status` and `--version`, and for a piece writes what it
// was given (argv, the env's key names, the cwd, stdin) to FAKE_CLAUDE_LOG
// and prints a canned result. FAKE_CLAUDE_MODE picks what it does; titles
// named in FAKE_CLAUDE_FAIL (comma separated) crash instead.

import {appendFileSync, existsSync, readdirSync, readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const env = process.env

if (args[0] == "--version") {
  console.log("2.1.296 (Claude Code)")
  process.exit(0)
}

if (args[0] == "auth") {
  let method = env.FAKE_CLAUDE_AUTH || "claude.ai"
  if (method == "loggedout") {
    console.log(JSON.stringify({loggedIn: false}))
  } else {
    console.log(JSON.stringify({loggedIn: true, authMethod: method, subscriptionType: "max"}))
  }
  process.exit(0)
}

let stdin = readFileSync(0, "utf8")
let title = (stdin.match(/^# (.*)$/m) || [])[1] || ""

if (env.FAKE_CLAUDE_LOG) {
  appendFileSync(env.FAKE_CLAUDE_LOG, `${JSON.stringify({
    pid: process.pid, title, argv: args, envKeys: Object.keys(env),
    cwd: process.cwd(), cwdEntries: readdirSync(process.cwd()), stdin,
  })}\n`)
}

let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
let outputPath = join(HERE, "outputs", `${slug}.json`)
let output = JSON.parse(readFileSync(existsSync(outputPath) ? outputPath : join(HERE, "outputs", "default.json"), "utf8"))

let result = {
  type: "result", subtype: "success", is_error: false, num_turns: 3, duration_ms: 1200,
  total_cost_usd: Number(env.FAKE_CLAUDE_COST || 0.5),
  usage: {input_tokens: 6, output_tokens: 9000},
  modelUsage: {
    "claude-opus-5-5": {
      inputTokens: 6, cacheCreationInputTokens: 20000, cacheReadInputTokens: 100000, outputTokens: 9000, costUSD: 0.45,
    },
    "claude-haiku-5-5": {
      inputTokens: 40000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 2000, costUSD: 0.05,
    },
  },
  structured_output: output,
}

let mode = (env.FAKE_CLAUDE_FAIL || "").split(",").includes(title) ? "crash" : (env.FAKE_CLAUDE_MODE || "ok")

if (mode == "hang") {
  setTimeout(() => {}, 120000)
} else if (mode == "crash") {
  console.error("something broke inside claude")
  process.exit(1)
} else if (mode == "badjson") {
  console.log("this is not json")
} else if (mode == "budget") {
  console.log(JSON.stringify({...result, subtype: "error_max_budget_usd", is_error: true, structured_output: undefined,
    errors: ["Reached maximum budget ($0.005)"], total_cost_usd: 0.074}))
  process.exit(1)
} else if (mode == "error") {
  console.log(JSON.stringify({...result, subtype: "error_during_execution", is_error: true, structured_output: undefined,
    errors: ["tool exploded"]}))
  process.exit(1)
} else if (mode == "nostructured") {
  console.log(JSON.stringify({...result, structured_output: undefined}))
} else if (mode == "invalid") {
  console.log(JSON.stringify({...result, structured_output: {work: 1}}))
} else if (mode == "empty") {
  console.log(JSON.stringify({...result, structured_output: {work: "x", notes: "", flags: []}}))
} else {
  console.log(JSON.stringify(result))
}
