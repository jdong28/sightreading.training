#!/usr/bin/env node
// Asks Claude, through the owner's own Claude Code CLI, where each piece is
// hard, and writes a flags file of proposals per piece for the review pane.
// See README.md.

import {createHash} from "node:crypto"
import {mkdirSync, readFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {parseArgs} from "node:util"

import {openBridge} from "./lib/bridge.mjs"
import {runClaude, claudeStatus} from "./lib/claude.mjs"
import {collectInputs, slugFor} from "./lib/inputs.mjs"
import {
  writeJson, writeFileAtomic, readJson, totalsOf, summaryTable, estimatePiece, minutesText, COST_NOTE,
} from "./lib/report.mjs"
import {
  MODEL, DEFAULT_EFFORT, PROMPT_VERSION, SCHEMA_VERSION, COMPACT_VERSION,
} from "./lib/versions.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PROMPT_PATH = join(HERE, "prompt", "flags-v1.md")

const USAGE = `Usage: npm run claude-flags -- [options] <score.musicxml | folder | library.json>...

Asks Claude (through your own Claude Code sign-in) where each piece is hard and
writes <piece>.flags.json files to open in the app's review pane.

  --out <dir>             where files go; the same dir resumes (default ./claude-flags-out/<date-time>)
  --piece <id or title>   from a library export, only these pieces (repeatable)
  --limit <n>             stop after n pieces
  --no-web                the score alone: no web search, no citations
  --model <id>            default ${MODEL}
  --effort <level>        default ${DEFAULT_EFFORT}
  --piece-budget <usd>    a piece's cap, passed to Claude Code (default 2)
  --run-budget <usd>      no new piece starts once this run has spent this (default 10)
  --timeout <minutes>     per piece (default 15)
  --dry-run               write the prompts and an estimate; call nothing
  --force                 run pieces already done in --out again
  --claude-bin <path>     default claude
  --allow-api-key         run even when Claude Code isn't signed in with claude.ai
  --help
`

const OPTIONS = {
  out: {type: "string"},
  piece: {type: "string", multiple: true},
  limit: {type: "string"},
  "no-web": {type: "boolean"},
  model: {type: "string"},
  effort: {type: "string"},
  "piece-budget": {type: "string"},
  "run-budget": {type: "string"},
  timeout: {type: "string"},
  "dry-run": {type: "boolean"},
  force: {type: "boolean"},
  "claude-bin": {type: "string"},
  "allow-api-key": {type: "boolean"},
  help: {type: "boolean"},
}

const sha256 = text => createHash("sha256").update(text).digest("hex")

function stamp(date = new Date()) {
  let pad = n => String(n).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

function numberOption(name, value, fallback, {integer = false} = {}) {
  if (value == null) { return fallback }
  let number = Number(value)
  if (!(number > 0) || (integer && !Number.isInteger(number))) { throw new Error(`--${name} needs a positive number`) }
  return number
}

function parse(argv) {
  let {values, positionals} = parseArgs({args: argv, options: OPTIONS, allowPositionals: true})

  return {
    inputs: positionals,
    out: resolve(values.out || join("claude-flags-out", stamp())),
    pieces: values.piece || [],
    limit: numberOption("limit", values.limit, Infinity, {integer: true}),
    web: !values["no-web"],
    model: values.model || MODEL,
    effort: values.effort || DEFAULT_EFFORT,
    pieceBudget: numberOption("piece-budget", values["piece-budget"], 2),
    runBudget: numberOption("run-budget", values["run-budget"], 10),
    timeoutMs: numberOption("timeout", values.timeout, 15) * 60000,
    dryRun: !!values["dry-run"],
    force: !!values.force,
    bin: values["claude-bin"] || "claude",
    allowApiKey: !!values["allow-api-key"],
    help: !!values.help,
  }
}

// a piece's entry in run.json is the same shape from pending to done
const pendingEntry = input => ({input: input.id, title: input.label, status: "pending"})

/**
 * Runs the command.
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
export async function main(argv) {
  let options
  try {
    options = parse(argv)
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`)
    return 2
  }

  if (options.help) { console.log(USAGE); return 0 }
  if (!options.inputs.length) { console.error(`Nothing to read.\n\n${USAGE}`); return 2 }

  let {inputs: found, errors} = collectInputs(options.inputs, {pieces: options.pieces})
  for (let error of errors) { console.error(error) }
  let inputs = found.slice(0, options.limit)
  if (!inputs.length) { console.error("No pieces to run."); return 2 }

  let claude = {version: null, auth: null, subscription: null}
  if (!options.dryRun) {
    let status = await claudeStatus(options.bin)
    if (!status.ok) { console.error(status.error); return 2 }
    if (!status.loggedIn) {
      console.error("Claude Code isn't signed in. Run `claude` and sign in with your Claude account first.")
      return 2
    }
    if (status.authMethod != "claude.ai" && !options.allowApiKey) {
      console.error(
        `Claude Code is signed in with ${status.authMethod || "an unknown method"}, not a Claude account, ` +
        "so this run would be billed to an API key. Sign in with claude.ai, or pass --allow-api-key.")
      return 2
    }
    claude = {version: status.version, auth: status.authMethod, subscription: status.subscription}
  }

  mkdirSync(options.out, {recursive: true})

  let systemPrompt = readFileSync(PROMPT_PATH, "utf8")
  let bridge = await openBridge()
  try {
    return await run({options, inputs, claude, systemPrompt, bridge})
  } finally {
    await bridge.close()
  }
}

async function run({options, inputs, claude, systemPrompt, bridge}) {
  let schema = await bridge.schema()
  let schemaText = JSON.stringify(schema)
  writeFileAtomic(join(options.out, "system-prompt.md"), systemPrompt)
  writeFileAtomic(join(options.out, "schema.json"), `${schemaText}\n`)

  let versions = {promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, compactVersion: COMPACT_VERSION}
  let previous = readJson(join(options.out, "run.json"))
  let previousByInput = new Map(((previous && previous.pieces) || []).map(piece => [piece.input, piece]))
  let taken = new Set(((previous && previous.pieces) || []).map(piece => piece.slug).filter(Boolean))

  let runDoc = {
    runId: (previous && previous.runId) || stamp(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    claude, model: options.model, effort: options.effort, web: options.web,
    ...versions,
    budgets: {piece: options.pieceBudget, run: options.runBudget},
    pieces: [
      ...((previous && previous.pieces) || []).filter(piece => !inputs.some(input => input.id == piece.input)),
      ...inputs.map(input => previousByInput.get(input.id) || pendingEntry(input)),
    ],
    totals: null,
  }

  let entryFor = input => runDoc.pieces.find(piece => piece.input == input.id)
  let save = () => {
    runDoc.totals = totalsOf(runDoc.pieces)
    writeJson(join(options.out, options.dryRun ? "dry-run.json" : "run.json"), runDoc)
  }
  save()

  let interrupted = false
  let current = null
  let onSigint = () => {
    interrupted = true
    if (current && current.child) { current.child.kill("SIGTERM") }
  }
  process.on("SIGINT", onSigint)

  let spent = 0
  let index = 0

  try {
    for (let input of inputs) {
      index++
      let entry = entryFor(input)
      let label = `[${index}/${inputs.length}] ${input.label}`

      if (interrupted) { break }

      let prepared = await bridge.prepare(input, {web: options.web})
      if (prepared.error) {
        Object.assign(entry, {status: "failed", reason: prepared.error})
        console.log(`${label}: failed (${prepared.error})`)
        save()
        continue
      }

      label = `[${index}/${inputs.length}] ${prepared.title}`
      let slug = entry.slug || slugFor(prepared.title, taken)
      let scoreHash = sha256(`${prepared.compact}\n${prepared.analysisText}`)
      let flagsName = `${slug}.flags.json`

      // done: answered, with this score, model, web setting and these versions
      let done = (entry.status == "ok" || entry.status == "empty") &&
        entry.scoreHash == scoreHash && entry.model == options.model && entry.web == options.web &&
        entry.promptVersion == PROMPT_VERSION && entry.schemaVersion == SCHEMA_VERSION &&
        entry.compactVersion == COMPACT_VERSION && !!readJson(join(options.out, flagsName))
      if (!options.force && !options.dryRun && done) {
        console.log(`${label}: already done`)
        continue
      }

      // a stale entry is a fresh start
      for (let key of Object.keys(entry)) { if (key != "input") { delete entry[key] } }
      Object.assign(entry, {
        title: prepared.title, slug, bars: prepared.bars, scoreHash, status: "pending",
        model: options.model, effort: options.effort, web: options.web, ...versions,
      })

      writeFileAtomic(join(options.out, `${slug}.prompt.md`), prepared.userMessage)

      if (options.dryRun) {
        let tokens = Math.ceil((prepared.userMessage.length + systemPrompt.length + schemaText.length))
        let estimate = estimatePiece(tokens, options.web)
        entry.status = "dry-run"
        entry.estimate = {tokens, ...estimate}
        console.log(`${label}: ${tokens} tokens, about $${estimate.costUsd.toFixed(2)}, ` +
          `${estimate.minutes[0]}–${estimate.minutes[1]} minutes`)
        save()
        continue
      }

      if (spent >= options.runBudget) {
        Object.assign(entry, {status: "skipped", reason: "run budget"})
        console.log(`${label}: skipped (the run has spent $${spent.toFixed(2)} of $${options.runBudget})`)
        save()
        continue
      }

      entry.status = "running"
      save()

      current = {child: null}
      let result = await runClaude({
        bin: options.bin, model: options.model, effort: options.effort, schema, systemPrompt,
        userPrompt: prepared.userMessage, web: options.web, pieceBudget: options.pieceBudget,
        timeoutMs: options.timeoutMs, onSpawn: child => { current.child = child },
      })
      current = null

      spent += result.costUsd || 0
      Object.assign(entry, {
        turns: result.turns, durationMs: result.durationMs, costUsd: result.costUsd, usage: result.usage || {},
      })

      if (result.raw || result.stdout) {
        writeJson(join(options.out, `${slug}.result.json`), result.raw || {stdout: result.stdout})
      }

      if (interrupted) {
        Object.assign(entry, {status: "interrupted", reason: "interrupted"})
        console.log(`${label}: interrupted`)
        save()
        break
      }

      if (!result.ok) {
        Object.assign(entry, {status: "failed", reason: result.error.kind, message: result.error.message})
        console.log(`${label}: failed (${result.error.kind}: ${result.error.message})`)
        save()
        continue
      }

      let verified = await bridge.verify(prepared.key, result.output)
      if (verified.error) {
        Object.assign(entry, {status: "failed", reason: "invalid output", message: verified.error})
        console.log(`${label}: failed (${verified.error})`)
        save()
        continue
      }

      let rejectedBy = {}
      for (let {reason} of verified.rejected) { rejectedBy[reason] = (rejectedBy[reason] || 0) + 1 }
      let proposed = verified.kept.length + verified.rejected.length

      let at = Date.now()
      let built = await bridge.flagsFile(prepared.key, {
        proposals: verified.kept,
        run: {
          source: "claude", model: options.model, effort: options.effort, web: options.web,
          ...versions, cli: claude.version || "", at,
        },
        at,
      })

      writeJson(join(options.out, `${slug}.report.json`), {
        work: verified.work, notes: verified.notes,
        kept: verified.kept.map(p => ({start: p.start, end: p.end, title: p.title, shift: p.claude.shift || 0})),
        rejected: verified.rejected, trimmed: verified.trimmed, citationsDropped: verified.citationsDropped,
      })

      if (!built.check.ok) {
        Object.assign(entry, {status: "failed", reason: "self-check", message: built.check.error})
        console.log(`${label}: failed (self-check: ${built.check.error})`)
        save()
        continue
      }

      writeJson(join(options.out, flagsName), built.file)

      Object.assign(entry, {
        status: verified.kept.length ? "ok" : "empty",
        flags: {proposed, kept: verified.kept.length, rejected: rejectedBy, shifted: verified.shifted},
        citations: verified.kept.reduce((sum, p) => sum + p.citations.length, 0),
        files: {flags: flagsName},
      })
      console.log(`${label}: ${entry.status}, ${verified.kept.length} of ${proposed} flags kept, ` +
        `$${(entry.costUsd || 0).toFixed(2)}, ${minutesText(entry.durationMs || 0)}`)
      save()
    }
  } finally {
    process.off("SIGINT", onSigint)
  }

  let unfinished = runDoc.pieces.some(piece => !["ok", "empty", "dry-run"].includes(piece.status))
  runDoc.finishedAt = new Date().toISOString()
  runDoc.status = interrupted ? "interrupted" : (unfinished ? "partial" : "ok")
  save()

  if (options.dryRun) {
    console.log(`\nEstimate only: nothing was sent. ${COST_NOTE}`)
    console.log(`Prompts are in ${options.out}`)
    return 0
  }

  console.log(`\n${summaryTable(runDoc)}`)
  console.log(`\nFiles are in ${options.out}. Open each *.flags.json in the app's review pane ("Open a flags file").`)
  if (interrupted) { return 130 }
  return unfinished ? 1 : 0
}

// run as a command, not when a test imports it
if (process.argv[1] && resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error(error)
    process.exitCode = 1
  })
}
