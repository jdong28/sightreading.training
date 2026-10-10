// What the command trusts of Claude's answer (F1-F12 of the plan): each
// flag's evidence is looked for in the score by code, and nothing unproven is
// kept. Needs headless Chrome.

import {describe, it, before, after} from "node:test"
import assert from "node:assert/strict"

import {openBridge} from "../lib/bridge.mjs"
import {smallXML, musicxmlInput} from "./helpers.mjs"

// a plain piece, C5 four times in the right hand and a C3 whole note in the
// left of every bar, long enough for the budget's 40% of bars
function plainScore(barCount) {
  let bars = Array.from({length: barCount}, (_, i) => {
    let first = i == 0 ? "<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef><clef number=\"2\"><sign>F</sign><line>4</line></clef></attributes>" : ""
    let quarter = "<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>"
    return `<measure number="${i + 1}">${first}${quarter.repeat(4)}<backup><duration>4</duration></backup>` +
      "<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note></measure>"
  })
  return "<?xml version=\"1.0\"?><score-partwise version=\"4.0\"><work><work-title>Plain</work-title></work>" +
    `<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${bars.join("")}</part></score-partwise>`
}

function flag(over = {}) {
  return {
    start: 3, end: 3, hand: "right", level: "hard", kinds: ["reading"],
    title: "A hard bar", reason: "The Eb5 is the accidental.", tip: "Play it slowly.",
    evidence: [{bar: 3, hand: "right", notes: ["Eb5"], what: "the accidental"}],
    citations: [], confidence: "high", analysis: "new", analysis_note: "",
    ...over,
  }
}

const output = (...flags) => ({work: "Small Study", notes: "", flags})

describe("verify", () => {
  let bridge, small, plain

  before(async () => {
    bridge = await openBridge()
    small = (await bridge.prepare(musicxmlInput(smallXML()), {web: true})).key
    plain = (await bridge.prepare(musicxmlInput(plainScore(40), "plain.xml"), {web: true})).key
  })
  after(async () => { await bridge.close() })

  const only = result => {
    assert.equal(result.error, undefined)
    return result
  }

  it("F1: keeps a flag whose notes are in the claimed bar and hand", async () => {
    let result = only(await bridge.verify(small, output(flag())))
    assert.deepEqual(result.rejected, [])
    assert.equal(result.kept.length, 1)

    let [kept] = result.kept
    assert.equal(kept.source, "claude")
    assert.deepEqual([kept.start, kept.end, kept.startIndex, kept.endIndex], [3, 3, 3, 3])
    assert.equal(kept.hand, "upper")
    assert.equal(kept.level, 2)
    assert.deepEqual(kept.evidence, [{bar: 3, index: 3, hand: "upper", notes: ["Eb5"], what: "the accidental"}])
    assert.equal(kept.claude.shift, undefined)
    assert.match(kept.id, /^claude:3-3:[0-9a-f]{8}$/)
    assert.deepEqual(kept.reasons, [kept.reason])
  })

  it("F2: moves a flag whose every item is one bar later, and records what Claude named", async () => {
    let result = only(await bridge.verify(small, output(flag({
      start: 2, end: 2, evidence: [{bar: 2, hand: "right", notes: ["Eb5"], what: "the accidental"}],
    }))))

    assert.equal(result.kept.length, 1)
    let [kept] = result.kept
    assert.deepEqual([kept.start, kept.end], [3, 3])
    assert.equal(kept.claude.shift, 1)
    assert.deepEqual(kept.claude.claimed, {start: 2, end: 2})
    assert.equal(kept.evidence[0].bar, 3)
    assert.equal(result.shifted, 1)
  })

  it("F3: rejects evidence found nowhere within two bars", async () => {
    let result = only(await bridge.verify(small, output(flag({
      evidence: [{bar: 3, hand: "right", notes: ["F#6"], what: "a note that isn't there"}],
    }))))
    assert.deepEqual(result.kept, [])
    assert.deepEqual(result.rejected.map(r => r.reason), ["evidence-not-found"])
  })

  it("F4: rejects right-hand notes claimed for the left hand", async () => {
    let result = only(await bridge.verify(small, output(flag({
      hand: "left", evidence: [{bar: 3, hand: "left", notes: ["Eb5"], what: "the wrong hand"}],
    }))))
    assert.deepEqual(result.kept, [])
    assert.deepEqual(result.rejected.map(r => r.reason), ["evidence-not-found"])
  })

  it("F4: a flag naming one hand needs evidence in that hand", async () => {
    let result = only(await bridge.verify(small, output(flag({
      hand: "left",
      evidence: [
        {bar: 3, hand: "right", notes: ["Eb5"], what: "the accidental"},
        {bar: 3, hand: "left", notes: ["C3"], what: "the chord"},
      ],
    }))))
    assert.equal(result.kept.length, 1, "left evidence is there")

    let wrong = only(await bridge.verify(small, output(flag({
      hand: "left", evidence: [{bar: 3, hand: "right", notes: ["Eb5"], what: "the accidental"}],
    }))))
    assert.deepEqual(wrong.rejected.map(r => r.reason), ["hand-not-evidenced"])
  })

  it("F5: a D#5 holds for an Eb5, whatever the spelling", async () => {
    for (let name of ["D#5", "Eb5", "D♯5", "E♭5", "Fbb5", "A##5"]) {
      let result = only(await bridge.verify(small, output(flag({
        evidence: [{bar: 3, hand: "right", notes: [name], what: "spelled another way"}],
      }))))
      // Fbb5 and Eb5 are one key; A##5 is a B, which this score never has
      assert.equal(result.kept.length, name == "A##5" ? 0 : 1, name)
      if (result.kept.length) { assert.equal(result.kept[0].claude.shift, undefined, name) }
    }
  })

  it("F6: a note tied into the bar holds as sounding", async () => {
    let result = only(await bridge.verify(small, output(flag({
      start: 2, end: 2, hand: "left", evidence: [{bar: 2, hand: "left", notes: ["G3"], what: "the held G"}],
    }))))
    assert.equal(result.kept.length, 1)
    assert.deepEqual(result.kept[0].claude.shift, undefined)
    assert.deepEqual([result.kept[0].start, result.kept[0].evidence[0].bar], [2, 2])
  })

  it("F7: evidence in the second half of a split bar holds", async () => {
    let result = only(await bridge.verify(small, output(flag({
      start: 4, end: 4, hand: "left", evidence: [{bar: 4, hand: "left", notes: ["A2"], what: "after the repeat"}],
    }))))
    assert.equal(result.kept.length, 1)

    let [kept] = result.kept
    assert.deepEqual([kept.startIndex, kept.endIndex], [4, 5], "a split bar spans two indices")
    assert.equal(kept.evidence[0].index, 5)
  })

  it("F8: a bar that isn't in the piece is a bad range", async () => {
    let missing = only(await bridge.verify(small, output(flag({start: 999, end: 999}))))
    assert.deepEqual(missing.rejected.map(r => r.reason), ["bad-range"])

    // bar 0 is only a bar in a piece with a pickup
    let noPickup = only(await bridge.verify(plain, output(flag({
      start: 0, end: 0, evidence: [{bar: 0, hand: "right", notes: ["C5"], what: "x"}],
    }))))
    assert.deepEqual(noPickup.rejected.map(r => r.reason), ["bad-range"])

    let backwards = only(await bridge.verify(plain, output(flag({start: 5, end: 4}))))
    assert.deepEqual(backwards.rejected.map(r => r.reason), ["bad-range"])
  })

  it("F9: a range of more than 8 bars is too long", async () => {
    let result = only(await bridge.verify(plain, output(flag({
      start: 1, end: 10, evidence: [{bar: 1, hand: "right", notes: ["C5"], what: "x"}],
    }))))
    assert.deepEqual(result.rejected.map(r => r.reason), ["too-long"])

    let eight = only(await bridge.verify(plain, output(flag({
      start: 1, end: 8, evidence: [{bar: 1, hand: "right", notes: ["C5"], what: "x"}],
    }))))
    assert.equal(eight.kept.length, 1)
  })

  it("F10: keeps 10 of 14 flags, hardest then surest first", async () => {
    let levels = ["hardest", "hardest", ...Array(6).fill("hard"), ...Array(6).fill("worth a look")]
    let flags = levels.map((level, i) => flag({
      start: i + 1, end: i + 1, level, hand: "right", title: `Bar ${i + 1}`,
      confidence: i % 2 ? "low" : "high",
      evidence: [{bar: i + 1, hand: "right", notes: ["C5"], what: "x"}],
    }))

    let result = only(await bridge.verify(plain, output(...flags)))
    assert.equal(result.kept.length, 10)
    assert.equal(result.rejected.length, 4)
    assert.ok(result.rejected.every(r => r.reason == "over-budget"))
    assert.equal(result.kept.filter(p => p.level >= 2).length, 8)
    assert.deepEqual(result.kept.map(p => p.start), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11])
    assert.deepEqual(result.kept.map(p => p.start), [...result.kept.map(p => p.start)].sort((a, b) => a - b))
  })

  it("F10: no more than 8 hard flags, and no more than 40% of the bars", async () => {
    let hard = Array.from({length: 11}, (_, i) => flag({
      start: i + 1, end: i + 1, level: "hard", title: `Bar ${i + 1}`,
      evidence: [{bar: i + 1, hand: "right", notes: ["C5"], what: "x"}],
    }))
    let eight = only(await bridge.verify(plain, output(...hard)))
    assert.equal(eight.kept.length, 8)

    // 6 bars of a 12 bar piece is half of it: the first flag stays, then the budget closes
    let twelve = (await bridge.prepare(musicxmlInput(plainScore(12), "twelve.xml"), {web: true})).key
    let wide = [1, 2, 3].map(n => flag({
      start: n * 4 - 3, end: n * 4 - 2, level: "hard", title: `Wide ${n}`,
      evidence: [{bar: n * 4 - 3, hand: "right", notes: ["C5"], what: "x"}],
    }))
    let covered = only(await bridge.verify(twelve, output(...wide)))
    assert.equal(covered.kept.length, 2, "4 bars is a third; 6 would be half")
    assert.deepEqual(covered.rejected.map(r => r.reason), ["over-budget"])

    let lone = only(await bridge.verify(twelve, output(flag({
      start: 1, end: 8, level: "hard", evidence: [{bar: 1, hand: "right", notes: ["C5"], what: "x"}],
    }))))
    assert.equal(lone.kept.length, 1, "the first flag always stays")
  })

  it("F11: a second flag on the same range is a duplicate", async () => {
    let first = flag({title: "First"})
    let second = flag({title: "Second", kinds: ["speed"]})
    let result = only(await bridge.verify(small, output(first, second)))
    assert.equal(result.kept.length, 1)
    assert.equal(result.kept[0].title, "First")
    assert.deepEqual(result.rejected.map(r => r.reason), ["duplicate"])
  })

  it("F12: trims a long reason, and drops a bad link while keeping the flag", async () => {
    let result = only(await bridge.verify(small, output(flag({
      reason: `${"The right hand reaches for the accidental. ".repeat(10)}`.trim(),
      citations: [
        {url: "javascript:alert(1)", title: "Bad", says: "x", quote: "", source_bars: ""},
        {url: "not a url", title: "Worse", says: "x", quote: "", source_bars: ""},
        {url: "http://example.com/one", title: "One", says: "x", quote: "", source_bars: "1–2"},
        {url: "https://example.com/two", title: "Two", says: "x", quote: "q", source_bars: ""},
        {url: "https://example.com/three", title: "Three", says: "x", quote: "", source_bars: ""},
      ],
    }))))

    assert.equal(result.kept.length, 1)
    let [kept] = result.kept
    assert.ok(kept.reason.length <= 220)
    assert.ok(kept.reason.endsWith("…"))
    assert.deepEqual(kept.reasons, [kept.reason])
    assert.deepEqual(result.trimmed.map(t => [t.field, t.from]), [["reason", 429]])

    assert.deepEqual(kept.citations.map(c => c.title), ["One", "Two", "Three"])
    assert.ok(kept.citations.every(c => c.verified === false))
    assert.equal(kept.citations[0].sourceBars, "1–2")
    assert.equal(result.citationsDropped, 2)
  })

  it("refuses an output that has not the asked shape", async () => {
    for (let broken of [
      {work: 1, notes: "", flags: []},
      {work: "", notes: "", flags: [], extra: true},
      output({...flag(), hand: "middle"}),
      output({...flag(), kinds: ["sparkle"]}),
      output({...flag(), start: 3.5}),
      output({...flag(), citations: [{url: "https://e.com", title: "t"}]}),
      output({...flag(), surprise: 1}),
    ]) {
      let result = await bridge.verify(small, broken)
      assert.match(result.error, /^invalid output: /, JSON.stringify(broken).slice(0, 80))
    }
  })

  it("a flag with no evidence or no kinds is rejected, not trusted", async () => {
    let none = only(await bridge.verify(small, output(flag({evidence: []}))))
    assert.deepEqual(none.rejected.map(r => r.reason), ["evidence-not-found"])

    let kindless = only(await bridge.verify(small, output(flag({kinds: []}))))
    assert.deepEqual(kindless.rejected.map(r => r.reason), ["no-kinds"])
  })

  it("keeps an evidence item only inside the flag, and needs half of them", async () => {
    let two = only(await bridge.verify(small, output(flag({
      start: 3, end: 3,
      evidence: [
        {bar: 3, hand: "right", notes: ["Eb5"], what: "inside"},
        {bar: 2, hand: "right", notes: ["G5"], what: "outside the flag"},
      ],
    }))))
    assert.equal(two.kept.length, 1, "half is enough")
    assert.deepEqual(two.kept[0].evidence.map(e => e.bar), [3])

    let thirds = only(await bridge.verify(small, output(flag({
      start: 3, end: 3,
      evidence: [
        {bar: 3, hand: "right", notes: ["Eb5"], what: "inside"},
        {bar: 3, hand: "right", notes: ["F#6"], what: "not there"},
        {bar: 3, hand: "right", notes: ["G#6"], what: "not there"},
      ],
    }))))
    assert.deepEqual(thirds.rejected.map(r => r.reason), ["evidence-not-found"])

    let unparsed = only(await bridge.verify(small, output(flag({
      evidence: [{bar: 3, hand: "right", notes: ["Eb"], what: "no octave"}],
    }))))
    assert.deepEqual(unparsed.rejected.map(r => r.reason), ["evidence-not-found"])
  })
})
