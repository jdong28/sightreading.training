// A whole run of the command against the stub `claude` (G2 and G4-G8 of the
// plan): what it reads, what it writes, and what each way a run can go wrong
// leaves behind.

import {describe, it} from "node:test"
import assert from "node:assert/strict"
import {existsSync, readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"

import {STUB, tempDir, writeScores, readLog, runCli, filesIn, waitFor} from "./helpers.mjs"

const readJson = path => JSON.parse(readFileSync(path, "utf8"))

// three scores in a folder, the command run over it against the stub
async function runOver(titles, {args = [], env = {}, dir = tempDir("scores"), out = join(tempDir("out"), "out"), write = true} = {}) {
  if (write) { writeScores(dir, titles) }
  let log = join(tempDir("log"), "log.jsonl")
  let {done} = runCli([dir, "--out", out, "--claude-bin", STUB, ...args], {env: {FAKE_CLAUDE_LOG: log, ...env}})
  let result = await done
  return {...result, dir, out, log, calls: () => readLog(log)}
}

const THREE = ["First Piece", "Second Piece", "Third Piece"]
const runJson = out => readJson(join(out, "run.json"))

describe("the command", () => {
  it("G2: refuses to start unless Claude Code is signed in with a Claude account", async () => {
    let api = await runOver(["First Piece"], {env: {FAKE_CLAUDE_AUTH: "api_key"}})
    assert.equal(api.code, 2)
    assert.match(api.stderr, /signed in with api_key/)
    assert.deepEqual(api.calls(), [], "no piece was run")
    assert.ok(!existsSync(join(api.out, "run.json")))

    let out = await runOver(["First Piece"], {env: {FAKE_CLAUDE_AUTH: "loggedout"}})
    assert.equal(out.code, 2)
    assert.match(out.stderr, /isn't signed in/)
    assert.deepEqual(out.calls(), [])

    let allowed = await runOver(["First Piece"], {args: ["--allow-api-key"], env: {FAKE_CLAUDE_AUTH: "api_key"}})
    assert.equal(allowed.code, 0)
    assert.equal(allowed.calls().length, 1)
    assert.equal(runJson(allowed.out).claude.auth, "api_key")
  })

  it("asks for something to read, and for sensible options", async () => {
    let none = await runCli([]).done
    assert.equal(none.code, 2)
    assert.match(none.stderr, /Usage:/)

    let bad = await runCli(["--limit", "0", "somewhere"]).done
    assert.equal(bad.code, 2)
    assert.match(bad.stderr, /--limit needs a positive number/)

    let missing = await runCli(["/no/such/score.musicxml"]).done
    assert.equal(missing.code, 2)
    assert.match(missing.stderr, /no such file/)
  })

  it("writes a flags file per piece, the prompts, and a run record that names what ran", async () => {
    let run = await runOver(["First Piece"], {env: {FAKE_CLAUDE_COST: "0.52"}})
    assert.equal(run.code, 0, run.stderr)

    assert.deepEqual(filesIn(run.out), [
      "first-piece.flags.json", "first-piece.prompt.md", "first-piece.report.json", "first-piece.result.json",
      "run.json", "schema.json", "system-prompt.md",
    ])

    let doc = runJson(run.out)
    assert.equal(doc.status, "ok")
    assert.equal(doc.model, "claude-opus-5-5")
    assert.equal(doc.effort, "high")
    assert.equal(doc.web, true)
    assert.deepEqual([doc.promptVersion, doc.schemaVersion, doc.compactVersion], [1, 1, 1])
    assert.deepEqual(doc.claude, {version: "2.1.296", auth: "claude.ai", subscription: "max"})
    assert.deepEqual(doc.budgets, {piece: 2, run: 10})

    let [piece] = doc.pieces
    assert.equal(piece.status, "ok")
    assert.equal(piece.title, "First Piece")
    assert.equal(piece.bars, 5)
    assert.equal(piece.flags.proposed, 2)
    assert.equal(piece.flags.kept, 2)
    assert.equal(piece.citations, 1)
    assert.equal(piece.turns, 3)
    assert.equal(piece.costUsd, 0.52)
    assert.deepEqual(piece.files, {flags: "first-piece.flags.json"})
    assert.match(piece.scoreHash, /^[0-9a-f]{64}$/)
    assert.deepEqual(piece.usage["claude-opus-5-5"], {in: 6, cacheWrite: 20000, cacheRead: 100000, out: 9000, costUsd: 0.45})
    assert.equal(doc.totals.costUsd, 0.52)
    assert.deepEqual(doc.totals.byModel["claude-haiku-5-5"].in, 40000)
    assert.ok(!JSON.stringify(doc).includes("@"), "no email is kept")

    let file = readJson(join(run.out, "first-piece.flags.json"))
    assert.equal(file.version, 2)
    assert.equal(file.proposals.length, 2)
    assert.equal(file.run.model, "claude-opus-5-5")
    assert.equal(file.run.cli, "2.1.296")
    assert.equal(file.run.promptVersion, 1)
    assert.ok(file.proposals.every(p => p.source == "claude" && p.citations.every(c => c.verified === false)))

    assert.equal(readFileSync(join(run.out, "system-prompt.md"), "utf8").slice(0, 25), "You are an experienced pi")
    assert.match(run.stdout, /First Piece: ok, 2 of 2 flags kept/)
    assert.match(run.stdout, /not billed/)
  })

  it("G4: a failed piece in the middle leaves the rest, exit 1, and totals that add up", async () => {
    let run = await runOver(THREE, {env: {FAKE_CLAUDE_FAIL: "Second Piece", FAKE_CLAUDE_COST: "0.4"}})
    assert.equal(run.code, 1)

    let doc = runJson(run.out)
    assert.deepEqual(doc.pieces.map(p => p.status), ["ok", "failed", "ok"])
    assert.equal(doc.pieces[1].reason, "crash")
    assert.equal(doc.status, "partial")

    let files = filesIn(run.out)
    assert.ok(files.includes("first-piece.flags.json"))
    assert.ok(!files.includes("second-piece.flags.json"))
    assert.ok(files.includes("third-piece.flags.json"))

    assert.equal(doc.totals.costUsd, 0.8, "the two answers; the crash cost nothing")
    assert.equal(doc.totals.byModel["claude-opus-5-5"].out, 18000)
    assert.match(run.stdout, /Second Piece\s+failed \(crash\)/)
  })

  it("G5: the same --out resumes: done pieces are not asked again, a failed one is retried, --force asks all", async () => {
    let first = await runOver(THREE, {env: {FAKE_CLAUDE_FAIL: "Second Piece"}})
    assert.equal(first.code, 1)
    assert.equal(first.calls().length, 3)

    let again = await runOver(THREE, {dir: first.dir, out: first.out})
    assert.equal(again.code, 0, again.stderr)
    assert.deepEqual(again.calls().map(c => c.title), ["Second Piece"])
    assert.deepEqual(runJson(first.out).pieces.map(p => p.status), ["ok", "ok", "ok"])
    assert.match(again.stdout, /First Piece: already done/)

    let nothing = await runOver(THREE, {dir: first.dir, out: first.out})
    assert.equal(nothing.code, 0)
    assert.deepEqual(nothing.calls(), [])

    let forced = await runOver(THREE, {dir: first.dir, out: first.out, args: ["--force"]})
    assert.equal(forced.code, 0)
    assert.equal(forced.calls().length, 3)

    // an edit to the prompt (its version differs from the one recorded) asks again
    let doc = runJson(first.out)
    for (let piece of doc.pieces) { piece.promptVersion = 0 }
    writeFileSync(join(first.out, "run.json"), JSON.stringify(doc))
    let reprompted = await runOver(THREE, {dir: first.dir, out: first.out})
    assert.equal(reprompted.calls().length, 3)
  })

  it("G5: a changed score, model or web setting asks again", async () => {
    let first = await runOver(["First Piece"])
    assert.equal(first.calls().length, 1)

    let model = await runOver(["First Piece"], {dir: first.dir, out: first.out, args: ["--model", "claude-sonnet-5-5"]})
    assert.equal(model.calls().length, 1)
    assert.equal(model.calls()[0].argv[model.calls()[0].argv.indexOf("--model") + 1], "claude-sonnet-5-5")
    assert.equal(runJson(first.out).pieces[0].model, "claude-sonnet-5-5")

    let noWeb = await runOver(["First Piece"], {dir: first.dir, out: first.out, args: ["--model", "claude-sonnet-5-5", "--no-web"]})
    assert.equal(noWeb.calls().length, 1)
    assert.equal(noWeb.calls()[0].argv[noWeb.calls()[0].argv.indexOf("--tools") + 1], "")

    let same = await runOver(["First Piece"], {dir: first.dir, out: first.out, args: ["--model", "claude-sonnet-5-5", "--no-web"]})
    assert.equal(same.calls().length, 0, "the same run again is done")

    // one note of the score changed
    let path = join(first.dir, "1-first-piece.musicxml")
    writeFileSync(path, readFileSync(path, "utf8").replace("<step>E</step><octave>5</octave>", "<step>D</step><octave>5</octave>"))
    let score = await runOver(["First Piece"], {
      dir: first.dir, out: first.out, write: false, args: ["--model", "claude-sonnet-5-5", "--no-web"],
    })
    assert.equal(score.calls().length, 1)
  })

  it("G6: stops starting pieces once the run has spent its budget", async () => {
    let run = await runOver(THREE, {args: ["--run-budget", "6"], env: {FAKE_CLAUDE_COST: "4"}})
    assert.equal(run.code, 1)
    assert.equal(run.calls().length, 2)

    let doc = runJson(run.out)
    assert.deepEqual(doc.pieces.map(p => p.status), ["ok", "ok", "skipped"])
    assert.equal(doc.pieces[2].reason, "run budget")
    assert.equal(doc.totals.costUsd, 8)
    assert.ok(!filesIn(run.out).includes("third-piece.flags.json"))

    let resumed = await runOver(THREE, {dir: run.dir, out: run.out, env: {FAKE_CLAUDE_COST: "4"}})
    assert.equal(resumed.code, 0)
    assert.deepEqual(resumed.calls().map(c => c.title), ["Third Piece"])
  })

  it("G7: Ctrl+C stops the child, marks the piece interrupted, writes the record and exits 130", async () => {
    let dir = tempDir("scores")
    writeScores(dir, ["First Piece", "Second Piece"])
    let out = join(tempDir("out"), "out")
    let log = join(tempDir("log"), "log.jsonl")

    let {child, done} = runCli([dir, "--out", out, "--claude-bin", STUB], {env: {FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_MODE: "hang"}})
    let [entry] = await waitFor(() => { let calls = readLog(log); return calls.length ? calls : null })

    process.kill(child.pid, "SIGINT")
    let result = await done
    assert.equal(result.code, 130)

    await waitFor(() => { try { process.kill(entry.pid, 0); return false } catch (e) { return true } }, {timeout: 10000})

    let doc = runJson(out)
    assert.equal(doc.status, "interrupted")
    assert.deepEqual(doc.pieces.map(p => p.status), ["interrupted", "pending"])
    assert.equal(readLog(log).length, 1, "the second piece was never started")
    assert.ok(!filesIn(out).includes("first-piece.flags.json"))

    // the same --out picks up where it stopped
    let resumed = await runOver(["First Piece", "Second Piece"], {dir, out})
    assert.equal(resumed.code, 0)
    assert.deepEqual(runJson(out).pieces.map(p => p.status), ["ok", "ok"])
  })

  it("G8: --dry-run calls nothing, writes the prompts and an estimate, and exits 0", async () => {
    let run = await runOver(THREE, {args: ["--dry-run"], env: {FAKE_CLAUDE_AUTH: "loggedout"}})
    assert.equal(run.code, 0, run.stderr)
    assert.deepEqual(run.calls(), [])

    let files = filesIn(run.out)
    for (let slug of ["first-piece", "second-piece", "third-piece"]) { assert.ok(files.includes(`${slug}.prompt.md`)) }
    assert.ok(!files.includes("run.json"), "a dry run is not a run to resume")

    let doc = readJson(join(run.out, "dry-run.json"))
    assert.equal(doc.pieces.length, 3)
    assert.ok(doc.pieces.every(p => p.status == "dry-run" && p.estimate.costUsd > 0 && p.estimate.tokens > 1000))
    assert.match(run.stdout, /Estimate only: nothing was sent/)
    assert.match(readFileSync(join(run.out, "first-piece.prompt.md"), "utf8"), /^# First Piece/)
  })

  it("an answer with no flag kept is an empty run, with a flags file that says so", async () => {
    let run = await runOver(["First Piece"], {env: {FAKE_CLAUDE_MODE: "empty"}})
    assert.equal(run.code, 0)

    let [piece] = runJson(run.out).pieces
    assert.equal(piece.status, "empty")
    assert.equal(readJson(join(run.out, "first-piece.flags.json")).proposals.length, 0)

    let again = await runOver(["First Piece"], {dir: run.dir, out: run.out, env: {FAKE_CLAUDE_MODE: "empty"}})
    assert.deepEqual(again.calls(), [], "an empty answer is an answer")
  })

  it("an output of the wrong shape, an exceeded budget and an error are failures with their reasons", async () => {
    let invalid = await runOver(["First Piece"], {env: {FAKE_CLAUDE_MODE: "invalid"}})
    assert.equal(invalid.code, 1)
    let [bad] = runJson(invalid.out).pieces
    assert.deepEqual([bad.status, bad.reason], ["failed", "invalid output"])
    assert.ok(existsSync(join(invalid.out, "first-piece.result.json")), "the raw answer is kept")
    assert.ok(!existsSync(join(invalid.out, "first-piece.flags.json")))

    let budget = await runOver(["First Piece"], {args: ["--piece-budget", "0.005"], env: {FAKE_CLAUDE_MODE: "budget"}})
    let [over] = runJson(budget.out).pieces
    assert.deepEqual([over.status, over.reason, over.costUsd], ["failed", "budget", 0.074])
    assert.equal(budget.calls()[0].argv[budget.calls()[0].argv.indexOf("--max-budget-usd") + 1], "0.005")

    let broken = await runOver(["First Piece"], {env: {FAKE_CLAUDE_MODE: "error"}})
    assert.equal(runJson(broken.out).pieces[0].reason, "error")

    let junk = await runOver(["First Piece"], {env: {FAKE_CLAUDE_MODE: "badjson"}})
    assert.equal(runJson(junk.out).pieces[0].reason, "bad output")
  })

  it("--limit runs only the first pieces, and a library is read piece by piece with --piece", async () => {
    let limited = await runOver(THREE, {args: ["--limit", "1"]})
    assert.deepEqual(limited.calls().map(c => c.title), ["First Piece"])

    // a library export of the first score
    let {openBridge} = await import("../lib/bridge.mjs")
    let bridge = await openBridge()
    let xml = readFileSync(join(limited.dir, "1-first-piece.musicxml"))
    let song = await bridge.storedSong({base64: xml.toString("base64")})
    await bridge.close()

    let dir = tempDir("library")
    let library = join(dir, "library.json")
    writeFileSync(library, JSON.stringify({
      format: "sightreading-library", version: 8,
      pieces: [
        {id: "a", title: "First Piece", fileName: "first.musicxml", song},
        {id: "b", title: "Other Piece", fileName: "other.musicxml", song},
      ],
      sources: [], items: [], reviews: [], sessions: [],
    }))
    let log = join(dir, "log.jsonl")
    let run = await runCli([library, "--piece", "b", "--out", join(dir, "out"), "--claude-bin", STUB], {env: {FAKE_CLAUDE_LOG: log}}).done
    assert.equal(run.code, 0, run.stderr)
    assert.deepEqual(readLog(log).map(c => c.title), ["Other Piece"])
    assert.ok(existsSync(join(dir, "out", "other-piece.flags.json")))
  })
})
