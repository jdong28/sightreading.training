// The app's own code behind the command: the compact score, the fingerprint
// and the file it writes (E1-E4 of the plan). Needs headless Chrome, as
// `npm test` does.

import {describe, it, before, after} from "node:test"
import assert from "node:assert/strict"
import {readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {gzipSync} from "node:zlib"

import {openBridge} from "../lib/bridge.mjs"
import {collectInputs} from "../lib/inputs.mjs"
import {FIXTURES, smallXML, musicxmlInput, tempDir} from "./helpers.mjs"

describe("the bridge", () => {
  let bridge

  before(async () => { bridge = await openBridge() })
  after(async () => { await bridge.close() })

  it("E1: reads a score into the golden compact text, the numbers, the title and the app's fingerprint", async () => {
    let prepared = await bridge.prepare(musicxmlInput(smallXML()), {web: true})
    assert.equal(prepared.error, undefined)

    let golden = readFileSync(join(FIXTURES, "small.message.txt"), "utf8")
    assert.equal(prepared.userMessage, golden)

    assert.deepEqual(prepared.numbers, [0, 1, 2, 3, 4])
    assert.equal(prepared.title, "Small Study")
    assert.equal(prepared.composer, "A. Composer")
    assert.equal(prepared.bars, 5)

    // the same fingerprint the app computes, before and after the store's
    // round trip through JSON
    let {raw, stored} = await bridge.fingerprintsOf(musicxmlInput(smallXML()))
    assert.deepEqual(prepared.fingerprint, stored)
    assert.deepEqual(raw, stored)
    assert.equal(prepared.fingerprint.bars.length, 6)
  })

  it("E1: marks a pickup, a key change, a triplet, a tie, words, pedal and a split bar", async () => {
    let {compact} = await bridge.prepare(musicxmlInput(smallXML()), {web: true})
    let lines = compact.split("\n")

    assert.match(lines[0], /^m0 len=1$/)
    assert.match(compact, /m1 len=4 "dolce" p ped/)
    assert.match(compact, /L: 0:G3\/8~/)
    assert.match(compact, /D5\/0\.333t/)
    assert.match(compact, /gr\(C#5\)D5/)
    assert.match(compact, /G5\/1tr/)
    assert.match(compact, /m3 key=-1 len=3/)
    assert.match(compact, /Eb5\/3/)
    assert.match(compact, /C3\+E3\+G3\/3/)
    assert.match(compact, /m4 len=2/)
    assert.match(compact, /m4' len=1 \*/)
  })

  it("E1: says when the web tools are off, and when the score's marks can't be matched to its bars", async () => {
    let off = await bridge.prepare(musicxmlInput(smallXML()), {web: false})
    assert.match(off.userMessage, /Web tools are off for this run: give no citations\.\n$/)

    // a second part with more measures than the first: the song has a bar
    // the first part's <measure> elements don't
    let rests = Array.from({length: 7}, (_, i) =>
      `<measure number="${i}"><note><rest/><duration>48</duration><voice>1</voice></note></measure>`).join("")
    let extra = smallXML()
      .replace("</part-list>", "<score-part id=\"P2\"><part-name>Extra</part-name></score-part></part-list>")
      .replace("</score-partwise>", `<part id="P2">${rests}</part></score-partwise>`)
    let marksless = await bridge.prepare(musicxmlInput(extra), {web: true})
    assert.equal(marksless.error, undefined)
    assert.match(marksless.userMessage, /words, dynamics and pedal marks are not shown/)
    assert.doesNotMatch(marksless.compact, /dolce/)
  })

  it("E2: a library piece gives the same text as its MusicXML, and sends nothing of the owner's practice", async () => {
    let song = await bridge.storedSong(musicxmlInput(smallXML()))
    let library = {
      format: "sightreading-library", version: 8, exportedAt: "2026-10-09T00:00:00.000Z",
      pieces: [{id: "p-small", title: "Small Study", fileName: "small.musicxml", importedAt: 1, song}],
      sources: [{pieceId: "p-small", encoding: "gzip", storedAt: 1, data: gzipSync(smallXML()).toString("base64")}],
      items: [{id: "ITEM-PLANTED-1", pieceId: "p-small", hand: "both", startMeasure: 1, endMeasure: 1}],
      reviews: [{itemId: "ITEM-PLANTED-1", pieceId: "p-small", at: 1791500000123, grade: 1, note: "REVIEW-PLANTED"}],
      sessions: [{id: "SESSION-PLANTED-1", startedAt: 1791500000999}],
      annotations: [{pieceId: "p-small", proposals: [], decisions: [{flagId: "DECISION-PLANTED"}], runs: {}}],
    }

    let dir = tempDir("library")
    let path = join(dir, "library.json")
    writeFileSync(path, JSON.stringify(library))

    let {inputs, errors} = collectInputs([path])
    assert.deepEqual(errors, [])
    assert.equal(inputs.length, 1)

    let fromLibrary = await bridge.prepare(inputs[0], {web: true})
    let fromFile = await bridge.prepare(musicxmlInput(smallXML()), {web: true})
    assert.equal(fromLibrary.error, undefined)
    assert.equal(fromLibrary.userMessage, fromFile.userMessage)
    assert.deepEqual(fromLibrary.fingerprint, fromFile.fingerprint)

    for (let planted of ["ITEM-PLANTED", "REVIEW-PLANTED", "SESSION-PLANTED", "DECISION-PLANTED", "1791500000"]) {
      assert.ok(!fromLibrary.userMessage.includes(planted), `${planted} must not be sent`)
    }

    let wanted = collectInputs([path], {pieces: ["nothing of that name"]})
    assert.equal(wanted.inputs.length, 0)
    assert.equal(collectInputs([path], {pieces: ["p-small"]}).inputs.length, 1)
    assert.equal(collectInputs([path], {pieces: ["small study"]}).inputs.length, 1)
  })

  it("E3: a file made from verified proposals reads back through the app's reader whole", async () => {
    let prepared = await bridge.prepare(musicxmlInput(smallXML()), {web: true})
    let output = JSON.parse(readFileSync(join(FIXTURES, "outputs", "default.json"), "utf8"))
    let verified = await bridge.verify(prepared.key, output)
    assert.equal(verified.error, undefined)
    assert.equal(verified.kept.length, 2)

    let {file, check} = await bridge.flagsFile(prepared.key, {
      proposals: verified.kept,
      run: {source: "claude", model: "claude-opus-5-5", effort: "high", web: true,
        promptVersion: 1, schemaVersion: 1, compactVersion: 1, cli: "2.1.296", at: 5},
      at: 5,
    })

    assert.deepEqual(check, {ok: true})
    assert.equal(file.version, 2)
    assert.equal(file.format, "sightreading-flags")
    assert.equal(file.by, "Claude")
    assert.deepEqual(file.decisions, [])
    assert.equal(file.proposals.length, 2)
    assert.equal(new Set(file.proposals.map(p => p.id)).size, 2)
    assert.deepEqual(file.piece.fingerprint.bars, prepared.fingerprint.bars)
    assert.deepEqual(file.piece.fingerprint.numbers, [0, 1, 2, 3, 4, 4])
    assert.deepEqual(file.proposals.map(p => [p.start, p.end, p.startIndex, p.endIndex]), [[2, 2, 2, 2], [3, 3, 3, 3]])
    assert.ok(file.proposals.every(p => p.citations.every(c => c.verified === false)))
  })

  it("E4: the schema's kinds are the app's own", async () => {
    let schema = await bridge.schema()
    let kinds = await bridge.flagKinds()
    assert.deepEqual(schema.properties.flags.items.properties.kinds.items.enum, kinds)
    assert.ok(kinds.includes("3:2"))
  })

  it("refuses a file that is not a score, and one with no notes", async () => {
    let bad = await bridge.prepare(musicxmlInput("<not-music/>", "bad.xml"), {web: true})
    assert.match(bad.error, /can't read the score/)

    let empty = smallXML().replace(/<note>[\s\S]*?<\/note>/g, "")
    let none = await bridge.prepare(musicxmlInput(empty), {web: true})
    assert.ok(none.error)
  })
})
