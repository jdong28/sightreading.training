// One `claude -p` call, spawned with an argv array (never a shell string) in
// an empty temp dir, with the API keys left out of its environment so it
// bills the owner's subscription, not an API account. The instructions go in
// --system-prompt and the piece on stdin.

import {spawn} from "node:child_process"
import {mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

const KILL_GRACE_MS = 5000
const STDERR_TAIL = 2048
const STRIPPED_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]

export function childEnv(env = process.env) {
  let out = {...env}
  for (let key of STRIPPED_ENV) { delete out[key] }
  return out
}

/**
 * The arguments of the call.
 * @param {Object} opts {model, effort, schema, systemPrompt, web, pieceBudget}
 * @returns {string[]}
 */
export function claudeArgs({model, effort, schema, systemPrompt, web, pieceBudget}) {
  return [
    "-p",
    "--model", model,
    "--effort", effort,
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    "--system-prompt", systemPrompt,
    ...(web ? ["--tools", "WebSearch,WebFetch", "--allowedTools", "WebSearch WebFetch"] : ["--tools", ""]),
    "--permission-mode", "dontAsk",
    "--safe-mode", "--strict-mcp-config", "--no-session-persistence",
    "--max-budget-usd", String(pieceBudget),
  ]
}

// stdout, stderr and the exit of a child, or its failure to start
function runChild(bin, args, {cwd, env, input, timeoutMs, onSpawn}) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(bin, args, {cwd, env, stdio: ["pipe", "pipe", "pipe"]})
    } catch (e) {
      resolve({spawnError: e.message})
      return
    }

    if (onSpawn) { onSpawn(child) }

    let stdout = []
    let stderr = []
    let timedOut = false
    let killTimer = null

    let timer = timeoutMs ? setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
    }, timeoutMs) : null

    child.stdout.on("data", chunk => stdout.push(chunk))
    child.stderr.on("data", chunk => stderr.push(chunk))
    child.stdin.on("error", () => {})
    child.on("error", e => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      resolve({spawnError: e.message})
    })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      resolve({
        code, signal, timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      })
    })

    child.stdin.end(input || "")
  })
}

const tail = text => text.length > STDERR_TAIL ? text.slice(-STDERR_TAIL) : text

// per-model token counts and cost of a result, summed over every model: the
// web tools run on Haiku, beside Opus
export function usageOf(result) {
  let byModel = {}
  for (let [model, row] of Object.entries(result.modelUsage || {})) {
    byModel[model] = {
      in: row.inputTokens || 0,
      cacheWrite: row.cacheCreationInputTokens || 0,
      cacheRead: row.cacheReadInputTokens || 0,
      out: row.outputTokens || 0,
      costUsd: row.costUSD || 0,
    }
  }
  return byModel
}

/**
 * Asks Claude about one piece.
 * @param {Object} opts {bin, model, effort, schema, systemPrompt, userPrompt, web,
 * pieceBudget, timeoutMs, onSpawn}
 * @returns {Promise<{ok: true, output: Object, raw: Object, usage: Object, costUsd: number,
 * turns: number, durationMs: number}|{ok: false, error: {kind: string, message: string},
 * raw?: Object, stdout?: string, usage: Object, costUsd: number}>}
 */
export async function runClaude({bin, userPrompt, timeoutMs, onSpawn, ...call}) {
  let cwd = mkdtempSync(join(tmpdir(), "claude-flags-"))
  let started = Date.now()

  try {
    let done = await runChild(bin, claudeArgs(call), {
      cwd, env: childEnv(), input: userPrompt, timeoutMs, onSpawn,
    })

    let fail = (kind, message, extra = {}) => ({
      ok: false, error: {kind, message}, usage: {}, costUsd: 0, durationMs: Date.now() - started, ...extra,
    })

    if (done.spawnError) { return fail("crash", `couldn't start ${bin}: ${done.spawnError}`) }
    if (done.timedOut) { return fail("timeout", `no answer within ${Math.round(timeoutMs / 60000)} minutes`) }
    if (done.signal && !done.stdout.trim()) { return fail("crash", `stopped by ${done.signal}`, {signal: done.signal}) }

    let raw
    try {
      raw = JSON.parse(done.stdout)
    } catch (e) {
      if (done.code) { return fail("crash", `exit ${done.code}: ${tail(done.stderr)}`, {stdout: done.stdout}) }
      return fail("bad output", "stdout wasn't JSON", {stdout: done.stdout})
    }

    let usage = usageOf(raw)
    let costUsd = Number(raw.total_cost_usd) || 0
    let base = {usage, costUsd, durationMs: Date.now() - started, turns: raw.num_turns || 0, raw}

    if (raw.subtype == "error_max_budget_usd") {
      return {ok: false, error: {kind: "budget", message: (raw.errors || []).join("; ") || "reached the piece's budget"}, ...base}
    }
    if (raw.is_error || (raw.subtype && raw.subtype != "success")) {
      let errors = Array.isArray(raw.errors) && raw.errors.length ? `: ${raw.errors.join("; ")}` : ""
      return {ok: false, error: {kind: "error", message: `${raw.subtype || "error"}${errors}`}, ...base}
    }
    if (done.code) {
      return {ok: false, error: {kind: "crash", message: `exit ${done.code}: ${tail(done.stderr)}`}, ...base}
    }
    if (!raw.structured_output || typeof raw.structured_output != "object") {
      return {ok: false, error: {kind: "no structured output", message: "Claude answered without the structured output"}, ...base}
    }

    return {ok: true, output: raw.structured_output, ...base}
  } finally {
    rmSync(cwd, {recursive: true, force: true})
  }
}

/**
 * `claude auth status` and `claude --version`: how Claude Code is signed in.
 * @returns {Promise<{ok: boolean, loggedIn?: boolean, authMethod?: string,
 * subscription?: string, version?: string, error?: string}>}
 */
export async function claudeStatus(bin) {
  let cwd = mkdtempSync(join(tmpdir(), "claude-flags-"))
  try {
    let [auth, version] = await Promise.all([
      runChild(bin, ["auth", "status"], {cwd, env: childEnv(), timeoutMs: 30000}),
      runChild(bin, ["--version"], {cwd, env: childEnv(), timeoutMs: 30000}),
    ])
    if (auth.spawnError) { return {ok: false, error: `couldn't start ${bin}: ${auth.spawnError}`} }

    let data = null
    try {
      data = JSON.parse(auth.stdout)
    } catch (e) {
      // the plain text form is read below
    }

    let text = auth.stdout
    let method = data ? data.authMethod : (text.match(/authMethod\W+([\w.]+)/) || [])[1]
    let loggedIn = data ? data.loggedIn !== false : !/not logged in|loggedIn\W+false/i.test(text)
    let subscription = data ? data.subscriptionType : (text.match(/subscriptionType\W+(\w+)/) || [])[1]

    return {
      ok: true, loggedIn, authMethod: method || null, subscription: subscription || null,
      version: ((version.stdout || "").match(/\d+\.\d+\.\d+/) || [])[0] || null,
    }
  } finally {
    rmSync(cwd, {recursive: true, force: true})
  }
}
