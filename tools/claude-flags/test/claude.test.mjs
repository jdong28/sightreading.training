// The one call to `claude` (G1-G3 of the plan), against the stub: its exact
// arguments, what it can see, and what each way of failing is called.

import {describe, it, beforeEach, afterEach} from "node:test"
import assert from "node:assert/strict"
import {realpathSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

import {runClaude, claudeStatus, claudeArgs} from "../lib/claude.mjs"
import {STUB, tempDir, readLog} from "./helpers.mjs"

const SCHEMA = {type: "object", properties: {x: {type: "string"}}}

describe("runClaude", () => {
  let log
  let saved = {}
  const KEYS = ["FAKE_CLAUDE_LOG", "FAKE_CLAUDE_MODE", "FAKE_CLAUDE_COST", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]

  beforeEach(() => {
    for (let key of KEYS) { saved[key] = process.env[key] }
    log = join(tempDir("claude"), "log.jsonl")
    process.env.FAKE_CLAUDE_LOG = log
    process.env.ANTHROPIC_API_KEY = "sk-secret-key"
    process.env.ANTHROPIC_AUTH_TOKEN = "secret-token"
    delete process.env.FAKE_CLAUDE_MODE
  })

  afterEach(() => {
    for (let key of KEYS) {
      if (saved[key] === undefined) { delete process.env[key] } else { process.env[key] = saved[key] }
    }
  })

  const call = (over = {}) => runClaude({
    bin: STUB, model: "claude-opus-5-5", effort: "high", schema: SCHEMA, systemPrompt: "Be a teacher.",
    userPrompt: "# A piece\nthe score\n", web: true, pieceBudget: 2, timeoutMs: 20000, ...over,
  })

  it("G1: spawns with exactly the planned arguments, no API keys, an empty temp cwd and the piece on stdin", async () => {
    let result = await call()
    assert.equal(result.ok, true)

    let [entry] = readLog(log)
    assert.deepEqual(entry.argv, [
      "-p",
      "--model", "claude-opus-5-5", "--effort", "high",
      "--output-format", "json",
      "--json-schema", JSON.stringify(SCHEMA),
      "--system-prompt", "Be a teacher.",
      "--tools", "WebSearch,WebFetch", "--allowedTools", "WebSearch WebFetch",
      "--permission-mode", "dontAsk",
      "--safe-mode", "--strict-mcp-config", "--no-session-persistence",
      "--max-budget-usd", "2",
    ])

    assert.ok(!entry.envKeys.includes("ANTHROPIC_API_KEY"))
    assert.ok(!entry.envKeys.includes("ANTHROPIC_AUTH_TOKEN"))
    assert.ok(entry.envKeys.includes("PATH"), "the rest of the environment stays")

    assert.deepEqual(entry.cwdEntries, [])
    // the stub records its cwd as the system resolves it; the directory is
    // gone again by now
    assert.ok(entry.cwd.startsWith(realpathSync(tmpdir())))
    assert.notEqual(entry.cwd, realpathSync(process.cwd()))
    assert.equal(entry.stdin, "# A piece\nthe score\n")
  })

  it("G1: --no-web gives the tools an empty list and no allowed tools", async () => {
    await call({web: false})
    let [entry] = readLog(log)
    let at = entry.argv.indexOf("--tools")
    assert.equal(entry.argv[at + 1], "")
    assert.ok(!entry.argv.includes("--allowedTools"))
    assert.ok(!entry.argv.includes("WebSearch,WebFetch"))
  })

  it("passes the piece budget on as given, and never as a shell string", () => {
    let args = claudeArgs({
      model: "m", effort: "e", schema: SCHEMA, web: true, pieceBudget: 0.005,
      systemPrompt: "a; rm -rf /\n$(whoami) `id`",
    })
    assert.equal(args[args.indexOf("--max-budget-usd") + 1], "0.005")
    assert.equal(args[args.indexOf("--system-prompt") + 1], "a; rm -rf /\n$(whoami) `id`")
  })

  it("G3: a good answer carries the output, the cost and the usage of every model", async () => {
    process.env.FAKE_CLAUDE_COST = "0.52"
    let result = await call()

    assert.equal(result.ok, true)
    assert.equal(result.costUsd, 0.52)
    assert.equal(result.turns, 3)
    assert.equal(result.output.work, "A. Composer, Small Study")
    assert.deepEqual(result.usage["claude-opus-5-5"], {in: 6, cacheWrite: 20000, cacheRead: 100000, out: 9000, costUsd: 0.45})
    assert.deepEqual(result.usage["claude-haiku-5-5"], {in: 40000, cacheWrite: 0, cacheRead: 0, out: 2000, costUsd: 0.05})
  })

  it("G3: names each way of failing", async () => {
    let kinds = {}
    for (let mode of ["budget", "error", "crash", "badjson", "nostructured"]) {
      process.env.FAKE_CLAUDE_MODE = mode
      let result = await call()
      assert.equal(result.ok, false, mode)
      kinds[mode] = result.error
    }

    assert.equal(kinds.budget.kind, "budget")
    assert.match(kinds.budget.message, /Reached maximum budget/)
    assert.equal(kinds.error.kind, "error")
    assert.match(kinds.error.message, /error_during_execution: tool exploded/)
    assert.equal(kinds.crash.kind, "crash")
    assert.match(kinds.crash.message, /exit 1: something broke inside claude/)
    assert.equal(kinds.badjson.kind, "bad output")
    assert.equal(kinds.nostructured.kind, "no structured output")
  })

  it("G3: a budget stop still reports what it cost, which is what it overshot by", async () => {
    process.env.FAKE_CLAUDE_MODE = "budget"
    let result = await call({pieceBudget: 0.005})
    assert.equal(result.costUsd, 0.074)
    assert.equal(result.raw.subtype, "error_max_budget_usd")
  })

  it("G3: a timeout kills the child, and only the child", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang"
    let spawned = null
    let result = await call({timeoutMs: 400, onSpawn: child => { spawned = child }})

    assert.equal(result.ok, false)
    assert.equal(result.error.kind, "timeout")
    assert.ok(spawned.killed)
    assert.throws(() => process.kill(spawned.pid, 0), "the child is gone")
  })

  it("G3: a command that can't start is a crash, not an exception", async () => {
    let result = await call({bin: join(tmpdir(), "no-such-claude-here")})
    assert.equal(result.ok, false)
    assert.equal(result.error.kind, "crash")
  })
})

describe("claudeStatus", () => {
  let saved
  beforeEach(() => { saved = process.env.FAKE_CLAUDE_AUTH })
  afterEach(() => {
    if (saved === undefined) { delete process.env.FAKE_CLAUDE_AUTH } else { process.env.FAKE_CLAUDE_AUTH = saved }
  })

  it("reads how Claude Code is signed in, and its version", async () => {
    delete process.env.FAKE_CLAUDE_AUTH
    assert.deepEqual(await claudeStatus(STUB), {
      ok: true, loggedIn: true, authMethod: "claude.ai", subscription: "max", version: "2.1.296",
    })

    process.env.FAKE_CLAUDE_AUTH = "api_key"
    assert.equal((await claudeStatus(STUB)).authMethod, "api_key")

    process.env.FAKE_CLAUDE_AUTH = "loggedout"
    assert.equal((await claudeStatus(STUB)).loggedIn, false)
  })

  it("says so when the command isn't there", async () => {
    let status = await claudeStatus(join(tmpdir(), "no-such-claude-here"))
    assert.equal(status.ok, false)
    assert.match(status.error, /couldn't start/)
  })
})
