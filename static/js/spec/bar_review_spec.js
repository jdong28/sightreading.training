import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {MemoryRouter, useLocation} from "react-router-dom"

import ScorePage from "st/components/pages/score_page"
import {importMusicXMLPiece} from "st/sheet_music_deck"
import {TROUBLE_CLASS} from "st/components/score_sheet"
import popupStyles from "st/components/sight_reading/bar_popup.module.css"
import sheetStyles from "st/components/score_sheet.module.css"
import {setAppStore} from "st/storage"
import {SHEET_MUSIC_STORAGE_KEY, BOTH_HANDS, FREE_PRACTICE} from "st/data"
import {SCORE_DRILL_STORAGE_KEY} from "st/generators"
import {openTestStore, dynamicsOpening} from "spec/helpers"
import {
  barReview, beatLabel, keyWords, ghostSteps, BAR_REVIEW_WINDOW, HABIT_PASSES, STEADY_BAND,
} from "st/bar_review"
import {giveBars} from "st/score_give"
import {validBarLog} from "st/srs/records"

let waitFor = async (test, {timeout=15000, message="the condition"}={}) => {
  let start = Date.now()
  for (;;) {
    let value = test()
    if (value) { return value }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe("the ended strip survives a reload", function() {
  let container, root, page, store, previous
  afterEach(function() {
    if (root) { flushSync(() => root.unmount()); root = null }
    if (container) { container.remove(); container = null }
    setAppStore(previous); store.close()
  })

  it("comes back after a remount with the same log and no Play on; Done clears it for good", async function() {
    store = await openTestStore()
    previous = setAppStore(store)
    window.localStorage.removeItem(SCORE_DRILL_STORAGE_KEY)
    let xml = await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
    let {piece} = await importMusicXMLPiece("fixture.musicxml", xml, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: BOTH_HANDS, measuresPerCard: 1, practice: FREE_PRACTICE, startMeasure: 1, endMeasure: 2,
    }))
    let mount = async () => {
      container = document.createElement("div")
      container.style.width = "1440px"
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240}))))
      await waitFor(() => container.querySelectorAll('button[aria-label^="Bar "]').length > 0, {message: "bars"})
    }
    let unmount = () => { flushSync(() => root.unmount()); root = null; container.remove(); container = null }
    let button = text => [...container.querySelectorAll("button")].find(b => b.textContent.trim() == text)
    let playCard = () => {
      let columns = page.currentCard().card.columns.length
      for (let i = 0; i < columns; i++) {
        let column = page.state.notes.currentColumn()
        for (let note of column) { flushSync(() => page.pressNote(note)) }
        for (let note of column) { flushSync(() => page.releaseNote(note)) }
      }
    }

    await mount()
    flushSync(() => button("Begin").click())
    playCard()
    playCard()
    await page.state.notes.generator.finishing
    let log = page.state.sessionLog
    flushSync(() => button("End session").click())
    await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip"})
    let headline = container.textContent.match(/\d+%\s*accuracy/)[0]
    unmount()

    await mount()
    await waitFor(() => container.textContent.includes("Session ended"), {timeout: 3000, message: "the strip to come back"})
    expect(container.textContent).toContain(headline)
    expect(page.state.sessionLog).toEqual(log)
    expect(button("Play on")).toBeUndefined()
    flushSync(() => button("Done").click())
    unmount()

    await mount()
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(container.textContent).not.toContain("Session ended")
  })
})

// the bar of four crotchets the model specs read, starting at beat 8: C5, D5
// over D3, E5 and F5, a row of the bar log for each pass of it
const BAR_START = 8
const row = (at, extra={}) => ({
  itemId: "p:both:3-3", at, pieceId: "p", hand: "both", measure: 3, sessionId: "s1", mode: "wait",
  card: [3, 3], cardGrade: 3, columns: 4, clean: 4, grade: 3, reviewed: true,
  beats: [8, 9, 10, 11], gaps: [null, 1, 1, 1], iois: [null, 500, 500, 500], pulse: 500,
  ...extra,
})

// a pass with the chord at beat 9 gone wrong: D#3 struck instead
const slipped = (at, extra={}) => row(at, {
  clean: 3, grade: 2,
  marks: [[1, "wrong", ["D3", "D5"], ["D#3"], 1, null]],
  ...extra,
})

const NOTE_NAME = /\b[A-G][#b]?-?\d\b/

// every string a review says
function wordsOf(review) {
  let words = []
  let walk = value => {
    if (typeof value == "string") { words.push(value) }
    else if (Array.isArray(value)) { value.forEach(walk) }
    else if (value && typeof value == "object") { Object.values(value).forEach(walk) }
  }
  walk(review)
  return words
}

describe("a bar's review (st/bar_review)", function() {
  let review = (rows, opts={}) => barReview({
    rows, item: {attempts: rows.length}, measure: 3, barStart: BAR_START, engraved: true, ...opts,
  })

  it("keeps its thresholds as constants", function() {
    expect([BAR_REVIEW_WINDOW, HABIT_PASSES, STEADY_BAND]).toEqual([5, 2, 0.25])
  })

  describe("labels and keys", function() {
    it("calls a note by its beat in the bar, never by its name", function() {
      expect(beatLabel(8, 8, 0, 4)).toEqual("Beat 1")
      expect(beatLabel(10, 8, 2, 4)).toEqual("Beat 3")
      expect(beatLabel(9.5, 8, 2, 4)).toEqual("The & of beat 2")
      expect(beatLabel(9.25, 8, 2, 4)).toEqual("Note 3")
      expect(beatLabel(null, 8, 2, 6)).toEqual("Note 3 of 6")
      // a pickup bar starts where its own notes do
      expect(beatLabel(3.5, 3, 1, 3)).toEqual("The & of beat 1")
    })

    it("tells a wrong key by where it lies against the written one", function() {
      // D#3 (51) against D3 (50), E3 against D#3
      expect(keyWords(51, 50)).toEqual("the black key just above")
      expect(keyWords(52, 51)).toEqual("the white key just above")
      expect(keyWords(49, 50)).toEqual("the black key just below")
      expect(keyWords(60, 72)).toEqual("the same note an octave lower")
      expect(keyWords(77, 65)).toEqual("the same note an octave higher")
      expect(keyWords(53, 50)).toEqual("3 keys above")
      expect(keyWords(47, 50)).toEqual("3 keys below")
    })

    it("counts staff steps the way the key is spelled nearest the written note", function() {
      // C#4 above C4 is on C's line, a step either side of D4 spelled flat
      expect(ghostSteps(61, 60)).toEqual(0)
      expect(ghostSteps(63, 62)).toEqual(0) // D#4 over D4: sharp, the same line
      expect(ghostSteps(62, 60)).toEqual(1)
      expect(ghostSteps(59, 60)).toEqual(-1)
      expect(ghostSteps(60 + 12, 60)).toEqual(7)
      expect(ghostSteps(58, 59)).toEqual(0) // Bb3 under B3: spelled flat, the same line as B
    })
  })

  describe("the states", function() {
    it("says nothing for a bar never played", function() {
      expect(barReview({rows: [], item: null, measure: 3, barStart: BAR_START}).state).toEqual("never")
      expect(barReview({rows: [], item: {attempts: 0}, measure: 3, barStart: BAR_START}).state).toEqual("never")
    })

    it("says a bar played before the log began has only its score", function() {
      let before = review([], {item: {attempts: 3}})
      expect(before.state).toEqual("before")
      expect(before.text).toEqual("Beat-by-beat details start with the passes you play from now on. Earlier passes kept only their score.")
    })

    it("gives a bar graded by ear the tags the player gave, and what they are", function() {
      let acoustic = review([row(1000), {
        ...row(2000), mode: "self", columns: null, clean: null, grade: 2, slipped: ["rhythm", "tempo"],
        beats: undefined, gaps: undefined, iois: undefined, pulse: undefined,
      }])
      expect(acoustic.state).toEqual("acoustic")
      expect(acoustic.tags).toEqual(["Rhythm", "Tempo"])
      expect(acoustic.text).toEqual("Nothing is detected on an acoustic piano: these are your own \"What slipped?\" tags.")

      let untagged = review([{...row(2000), mode: "self", columns: null, clean: null, grade: 3}])
      expect(untagged.state).toEqual("acoustic")
      expect(untagged.tags).toEqual([])
      expect(untagged.text).toBe(null)
    })
  })

  describe("what went wrong", function() {
    it("says the worst beat's trouble in words and marks it on the score: filled when it keeps going wrong", function() {
      let result = review([slipped(1000), slipped(2000), slipped(3000)])

      expect(result.state).toEqual("detected")
      expect(result.pct).toEqual(75)
      expect(result.header.left).toEqual("Behind the 75%")
      expect(result.header.behind).toBe(true)
      expect(result.lines[0]).toEqual("Beat 2 went wrong in all 3 of your last passes, filled in on the score.")
      expect(result.lines).toContain("The grey head beside it is the key you pressed instead: the black key just above.")
      expect(result.marks.heads).toEqual([
        {beat: 9, pitch: 50, kind: "habit"}, {beat: 9, pitch: 74, kind: "habit"},
      ])
      expect(result.marks.ghosts).toEqual([{beat: 9, pitch: 50, played: 51, steps: 0}])
      expect(result.marks.tags).toEqual([{beat: 9, pitch: 50, tone: "oxblood", text: "wrong 3 of 3"}])
    })

    it("rings a note that went wrong once, with the line saying why", function() {
      let result = review([row(1000), slipped(2000), row(3000)])
      // the newest pass is clean
      expect(result.pct).toEqual(100)
      expect(result.header.left).toEqual("Every note right")
      expect(result.lines[0]).toEqual("Beat 2 went wrong once in your last 3 passes, ringed on the score.")
      expect(result.lines).toContain("Ringed rather than filled: once is a slip, not a habit.")
      expect(result.marks.heads.map(head => head.kind)).toEqual(["once", "once"])
      expect(result.marks.tags[0].text).toEqual("wrong once in 3")
    })

    it("ranks by passes, then the latest, then the earliest beat, naming the next two", function() {
      let at = (index, kind="wrong") => [index, kind, ["C5"], [], 1, null]
      let result = review([
        row(1000, {clean: 2, marks: [at(0), at(2)]}),
        row(2000, {clean: 2, marks: [at(1), at(2)]}),
        row(3000, {clean: 2, marks: [at(3), at(1)]}),
        row(4000, {clean: 3, marks: [at(2, "skipped")]}),
      ])

      // beat 3 in 3 passes; beat 2 in 2, beat 1 and 4 once
      expect(result.lines[0]).toEqual("Beat 3 was skipped in 3 of your last 4 passes, filled in on the score.")
      // beat 4 went wrong in the pass before the last, beat 1 only in the first
      expect(result.lines[1]).toEqual("Also beat 2 and beat 4.")
    })

    it("tells a scrolled past note from a skipped one and one wrong", function() {
      let note = kind => review([row(1000, {clean: 3, marks: [[1, kind, ["D5"], [], 1, null]]})]).lines[0]
      expect(note("wrong")).toEqual("Beat 2 went wrong in your last pass, ringed on the score.")
      expect(note("skipped")).toEqual("Beat 2 was skipped in your last pass, ringed on the score.")
      expect(note("scrolled")).toEqual("Beat 2 went by unplayed in your last pass, ringed on the score.")
    })

    it("reads a clean window as clean, with nothing to colour on an engraved score", function() {
      let clean = review([row(1000), row(2000)])
      expect(clean.lines).toEqual(["Every note right in your last 2 passes. Nothing to colour on the score."])
      expect(clean.header.left).toEqual("Every note right")
      expect(clean.marks.heads).toEqual([])
      expect(review([row(1000)], {engraved: false}).lines).toEqual(["Every note right in your last pass."])
    })

    it("reads only the last five passes", function() {
      let rows = [slipped(1000), slipped(2000), row(3000), row(4000), row(5000), row(6000), row(7000)]
      let result = review(rows)
      expect(result.passes).toEqual(5)
      expect(result.lines).toEqual(["Every note right in your last 5 passes. Nothing to colour on the score."])
    })

    it("marks nothing on a score that isn't engraved, and ends its words without the score", function() {
      let result = review([slipped(1000), slipped(2000)], {engraved: false})
      expect(result.lines[0]).toEqual("Beat 2 went wrong in all 2 of your last passes.")
      expect(result.marks).toBe(null)
      expect(result.lines.some(line => line.includes("grey head"))).toBe(false)
    })

    it("never marks a bar without the score's rhythm, whose notes are told by their place", function() {
      let bare = at => slipped(at, {beats: [null, null, null, null], gaps: [null, null, null, null]})
      let result = review([bare(1000), bare(2000)])
      expect(result.lines[0]).toEqual("Note 2 of 4 went wrong in all 2 of your last passes.")
      expect(result.marks.heads).toEqual([])
      expect(result.marks.tags).toEqual([])
    })

    it("puts the key pressed beside the note nearest it, the most frequent, and never one far away", function() {
      let key = (at, ...keys) => slipped(at, {marks: [[1, "wrong", ["D3", "D5"], keys, 1, null]]})
      let result = review([key(1000, "D#3"), key(2000, "C#3"), key(3000, "C#3", "C#8")])
      // C#3 twice against D#3 once; C#8 is nowhere near either written note
      expect(result.marks.ghosts).toEqual([{beat: 9, pitch: 50, played: 49, steps: 0}])
      expect(result.lines).toContain("The grey head beside it is the key you pressed instead: the black key just below.")

      // a tie goes to the latest
      let tie = review([key(1000, "D#3"), key(2000, "C#3")])
      expect(tie.marks.ghosts[0].played).toEqual(49)
    })

    it("tells wrong keys of both hands of a chord apart", function() {
      let both = at => slipped(at, {marks: [[1, "wrong", ["D3", "D5"], ["D#3", "E5"], 1, null]]})
      let result = review([both(1000), both(2000)])
      expect(result.marks.ghosts).toEqual([
        {beat: 9, pitch: 50, played: 51, steps: 0}, {beat: 9, pitch: 74, played: 76, steps: 1},
      ])
      expect(result.lines).toContain(
        "The grey head beside it is the key you pressed instead: the black key just above and 2 keys above.")
    })
  })

  describe("the timing strip", function() {
    // beat 3 started 2.5 s after the one before it
    let paused = (at, extra={}) => row(at, {
      iois: [null, 500, 3000, 500], marks: [[2, "hesitated", ["E5"], [], 0, 3000]], ...extra,
    })

    it("is left out of a bar played steadily, and out of the %", function() {
      let steady = review([row(1000), row(2000, {iois: [null, 450, 560, 520]})])
      expect(steady.strip).toBe(null)
      expect(steady.pauseLines).toEqual([])
      expect(steady.header.left).toEqual("Every note right")
    })

    it("shows a pause where it fell, keeping the 100% as it was", function() {
      let result = review([paused(1000)])
      expect(result.pct).toEqual(100)
      expect(result.header.left).toEqual("Every note right · timing")
      expect(result.header.behind).toBe(false)

      let {strip} = result
      expect(strip.cells.map(cell => cell.kind)).toEqual(["first", "steady", "off", "steady"])
      expect(strip.cells.map(cell => cell.name)).toEqual(["Beat 1", "Beat 2", "Beat 3", "Beat 4"])
      expect(strip.cells.map(cell => cell.words)).toEqual(["first note", "on time", "2.5 s late", "on time"])
      expect(strip.band).toEqual({from: 37.5, to: 62.5})
      // 3000 ms against 500: five times late, the far edge, its dot beside the arrow
      expect(strip.cells[2].left).toEqual(76)
      expect(strip.cells[2].arrow).toEqual("»")
      expect(strip.cells[1].left).toEqual(50)
      expect(strip.caption).toEqual("Against a steady pulse at your own pace (0.50 s a beat): inside the shading is steady. Timing is not in the %.")
      expect(strip.ariaLabel).toEqual("Beat 3 started 2.5 seconds late; the others on time")
      expect(result.pauseLines).toEqual(["Beat 3 paused 3.0 s before it started, marked ▾ on the score."])
      expect(result.marks.pauses).toEqual([{beat: 10}])
      expect(result.marks.tags).toEqual([{beat: 10, pitch: null, tone: "gilt", text: "3.0 s pause"}])
    })

    it("places a note started early left of the tick and a late one right of it, past 90% off as an arrow", function() {
      let result = review([row(1000, {iois: [null, 250, 1000, 20]})])
      let cells = result.strip.cells
      expect(cells[1].left).toBeLessThan(50)
      expect(cells[2].left).toBeGreaterThan(50)
      expect(cells.map(cell => cell.arrow)).toEqual([null, null, "»", "«"])
      expect(cells.map(cell => cell.words)).toEqual(["first note", "0.3 s early", "0.5 s late", "0.5 s early"])
    })

    it("says after a slip on a column that went wrong", function() {
      let result = review([slipped(1000, {iois: [null, 1500, 500, 500]})])
      expect(result.strip.cells[1].words).toEqual("1.0 s late, after a slip")
    })

    it("shows an older pass that paused when the newest was steady, as an earlier one", function() {
      let result = review([paused(1000), row(2000)])
      expect(result.strip.cells[2].kind).toEqual("off")
      expect(result.header.right).toMatch(/^Earlier pass · \d\d:\d\d$/)
      expect(review([row(1000), paused(2000)]).header.right).toMatch(/^Latest pass · \d\d:\d\d$/)
    })

    it("says skipped and held for notes with no start of their own, and the first note once", function() {
      let result = review([row(1000, {
        clean: 3, iois: [null, null, 2500, 500], gaps: [null, null, 2, 1],
        marks: [[1, "skipped", ["D5", "D3"], [], 0, null]],
      })])
      expect(result.strip.cells.map(cell => cell.words)).toEqual(["first note", "skipped", "1.5 s late", "on time"])

      // in a bar after the first of its card, a column with no start was held by the keys
      let later = review([row(1000, {
        card: [2, 3], iois: [null, 500, 500, 2000], gaps: [null, 1, 1, 1],
      })])
      expect(later.strip.cells[0].words).toEqual("held")
    })

    it("tells the worst in the caption when there are more notes than room for words", function() {
      let eight = {
        columns: 8, clean: 8, beats: [8, 9, 10, 11, 12, 13, 14, 15], gaps: [null, 1, 1, 1, 1, 1, 1, 1],
        iois: [null, 500, 500, 2500, 500, 500, 500, 500], pulse: 500,
      }
      let result = review([row(1000, eight)])
      expect(result.strip.words).toBe(false)
      expect(result.strip.cells[3].label).toEqual("4")
      expect(result.strip.caption).toContain("Furthest from the pulse: beat 4, 2.0 s late.")
    })

    it("judges no timing in a bar that asks for give: its dots stay, with no shading, words or ▾", function() {
      let result = review([paused(1000, {iois: [null, 500, 4000, 500]})], {give: true})
      expect(result.strip.band).toBe(null)
      expect(result.strip.words).toBe(false)
      expect(result.strip.cells.every(cell => cell.words == null || cell.kind == "first")).toBe(true)
      expect(result.strip.cells.some(cell => cell.kind == "off")).toBe(false)
      expect(result.pauseLines).toEqual([])
      expect(result.marks.pauses).toEqual([])
      expect(result.marks.tags).toEqual([])
      expect(result.giveLine).toEqual("The score asks for give here (a fermata or a rit.), so this bar's timing isn't judged.")
      expect(result.strip.cells[2].left).toBeGreaterThan(50)

      // steady or not, nothing to say when its dots are all inside what would be the band
      expect(review([row(1000)], {give: true}).strip).toBe(null)
      expect(review([row(1000)], {give: true}).giveLine).toBe(null)
    })

    it("has no strip without a pulse to measure by", function() {
      expect(review([paused(1000, {pulse: null})]).strip).toBe(null)
    })
  })

  it("names no note anywhere: not in a sentence, a tag, a label or a mark's words", function() {
    let results = [
      review([slipped(1000), slipped(2000), slipped(3000)]),
      review([row(1000), slipped(2000), row(3000)]),
      review([row(1000, {iois: [null, 500, 3000, 500], marks: [[2, "hesitated", ["E5"], [], 0, 3000]]})]),
      review([slipped(1000, {marks: [[1, "wrong", ["D3", "D5"], ["D#3", "E5"], 1, null]]})]),
      review([slipped(1000, {beats: [null, null, null, null], gaps: [null, null, null, null]})]),
    ]
    for (let result of results) {
      let words = wordsOf({...result, marks: undefined})
      expect(words.filter(word => NOTE_NAME.test(word))).toEqual([])
    }
  })

  it("agrees with the rows a real pass writes", function() {
    for (let at of [1000, 2000]) { expect(validBarLog(slipped(at))).toBe(true) }
  })
})

describe("the bars that ask for give (st/score_give)", function() {
  // four bars of one whole note, extra of each bar given: notations in the
  // note, a direction before it
  let score = extras => `<?xml version="1.0"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
<part id="P1">${[1, 2, 3, 4, 5, 6, 7, 8].map(number => `
<measure number="${number}">${number == 1 ? "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>" : ""}
${(extras[number] || {}).direction ? `<direction placement="above"><direction-type><words>${extras[number].direction}</words></direction-type></direction>` : ""}
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type>${(extras[number] || {}).notations || ""}</note>
</measure>`).join("")}
</part></score-partwise>`

  it("gives a fermata's bar and the next", function() {
    expect([...giveBars(score({4: {notations: "<notations><fermata/></notations>"}}))].sort()).toEqual([4, 5])
  })

  it("gives a slowing word's bar and the next, however it is written", function() {
    expect([...giveBars(score({7: {direction: "poco rit."}}))].sort()).toEqual([7, 8])
    expect([...giveBars(score({2: {direction: "Ritardando"}}))].sort()).toEqual([2, 3])
    expect([...giveBars(score({3: {direction: "a piacere"}}))].sort()).toEqual([3, 4])
    expect([...giveBars(score({1: {direction: "rall. e smorz."}}))].sort()).toEqual([1, 2])
  })

  it("gives nothing for a tempo or a word that only looks like one", function() {
    expect([...giveBars(score({2: {direction: "a tempo"}, 5: {direction: "tenderly"}, 6: {direction: "Allegro"}}))]).toEqual([])
  })

  it("gives nothing for a score that can't be read", function() {
    expect(giveBars("").size).toEqual(0)
    expect(giveBars("not xml").size).toEqual(0)
    expect(giveBars(null).size).toEqual(0)
  })

  it("reads the bars as the score prints them: a pickup is bar 0", function() {
    let pickup = score({}).replace('<measure number="1">', '<measure number="0" implicit="yes">')
      .replace('<measure number="2">', '<measure number="1">')
      .replace(/<measure number="3">([\s\S]*?)<\/measure>/, '<measure number="2">$1<direction><direction-type><words>rit.</words></direction-type></direction></measure>')
    expect([...giveBars(pickup)].sort()).toEqual([2, 3])
  })
})

// the bar window on the real page: the real fixture (16 bars, a chord of C5
// over C3 up to F5 over F3 in each, grand staff) mounted through ScorePage,
// played with the page's own keys, then its bars clicked as a player would.
// Times are the events' own, so the timing the log keeps is the played one
describe("the bar window behind a bar's score, mounted", function() {
  let container, root, page, store, previous, saved, location
  let LocationProbe = () => {
    location = useLocation()
    return null
  }
  const KEYS = [SCORE_DRILL_STORAGE_KEY, SHEET_MUSIC_STORAGE_KEY]
  let clock

  beforeEach(async function() {
    saved = KEYS.map(key => [key, window.localStorage.getItem(key)])
    for (let key of KEYS) { window.localStorage.removeItem(key) }
    store = await openTestStore()
    previous = setAppStore(store)
    clock = 100000
  })

  afterEach(function() {
    if (root) { flushSync(() => root.unmount()); root = null }
    if (container) { container.remove(); container = null }
    setAppStore(previous)
    store.close()
    for (let [key, value] of saved) {
      if (value == null) { window.localStorage.removeItem(key) } else { window.localStorage.setItem(key, value) }
    }
  })

  let button = text => [...container.querySelectorAll("button")].find(b => b.textContent.trim() == text)
  let bar = number => container.querySelector(`button[aria-label="Bar ${number}"]`)
  let click = el => flushSync(() => el.click())
  let popup = () => container.querySelector('[role="dialog"]')
  let marked = () => container.querySelectorAll(`.${TROUBLE_CLASS}`)
  let layer = kind => container.querySelectorAll(`[data-mark="${kind}"]`)

  let mount = async (settings={}, xml=null, {width=1440, entries}={}) => {
    let musicXML = xml || await (await fetch("/tools/fingerings/tests/fixture/score.musicxml")).text()
    let {piece} = await importMusicXMLPiece("fixture.musicxml", musicXML, store)
    window.localStorage.setItem(SHEET_MUSIC_STORAGE_KEY, JSON.stringify({
      piece: piece.id, hand: BOTH_HANDS, measuresPerCard: 1, practice: FREE_PRACTICE,
      startMeasure: 3, endMeasure: 3, ...settings,
    }))
    await render({width, entries})
    return piece
  }

  // the page, drawn afresh as a visit does, over what the store and the
  // settings hold
  let render = async ({width=1440, entries=["/sheet-music"]}={}) => {
    container = document.createElement("div")
    container.style.width = `${width}px`
    document.body.appendChild(container)
    root = createRoot(container)
    flushSync(() => root.render(React.createElement(MemoryRouter, {initialEntries: entries},
      React.createElement(LocationProbe),
      React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240}))))
    // the engraved score and its bars: before it is drawn the page only holds a grid
    await waitFor(() => container.querySelector("[data-score-sheet] svg") && container.querySelector('button[aria-label^="Bar "]'),
      {message: "the score to be engraved"})
    await paginated()
  }

  // leaves the page as a reload does, the store and the settings staying
  let leave = () => {
    flushSync(() => root.unmount())
    root = null
    container.remove()
    container = null
  }

  // waits for the pages to stop changing: the first pagination may be drawn
  // before the plate's width is known, and a second follows it
  let paginated = async () => {
    let count = () => container.querySelectorAll('button[aria-label^="Bar "]').length
    let seen = -1
    for (let stable = 0; stable < 6;) {
      await new Promise(resolve => setTimeout(resolve, 50))
      let now = count()
      stable = now == seen ? stable + 1 : 0
      seen = now
    }
  }

  // a pass through the card: a column's notes down together a column's gap
  // apart, a gap given for a column (ms before it) and wrong keys struck
  // before it ({column: [keys]})
  let play = ({gaps={}, wrong={}, step=500}={}) => {
    let columns = page.currentCard().card.columns.length
    for (let i = 0; i < columns; i++) {
      clock += gaps[i] ?? step
      let column = [...page.state.notes.currentColumn()]
      for (let key of wrong[i] || []) {
        flushSync(() => page.pressNote(key, clock))
        flushSync(() => page.releaseNote(key, clock + 10))
      }
      for (let note of column) { flushSync(() => page.pressNote(note, clock)) }
      for (let note of column) { flushSync(() => page.releaseNote(note, clock + 20)) }
    }
  }

  // Begin, the passes (each a play), End session and Done: the bars are back
  // at rest, shaded, with nothing marked
  let session = async (...passes) => {
    click(button("Begin"))
    for (let pass of passes) { play(pass) }
    await page.state.notes.generator.finishing
    click(button("End session"))
    await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip"})
    click(button("Done"))
    await waitFor(() => bar(3), {message: "the score back"})
  }

  let ready = async test => waitFor(test, {message: "the bar's window"})

  // the bar's page, a click on its bar: the puppeteer window is narrower
  // than the design's, so a page holds fewer systems
  let showBar = number => {
    for (let turns = 0; !bar(number) && !button("Next page ›").disabled && turns < 10; turns++) {
      click(button("Next page ›"))
    }
    expect(bar(number)).withContext(`bar ${number} on a page`).toBeTruthy()
    return bar(number)
  }

  describe("a bar that keeps going wrong", function() {
    it("marks nothing until the bar is clicked, then fills its trouble notes, ghosts the key struck and says why", async function() {
      await mount()
      await session({wrong: {1: ["D#3"]}}, {wrong: {1: ["D#3"]}}, {wrong: {1: ["D#3"]}})

      // nothing is marked on the score at rest
      expect(popup()).toBe(null)
      expect(marked().length).toEqual(0)
      expect(layer("ghost").length).toEqual(0)

      click(showBar(3))
      await ready(() => popup() && popup().textContent.includes("Behind the 75%"))

      expect(popup().textContent).toContain("Beat 2 went wrong in all 3 of your last passes, filled in on the score.")
      expect(popup().textContent).toContain("The grey head beside it is the key you pressed instead: the black key just above.")
      // the accuracy chart is kept, the new block below it
      expect(popup().querySelector(`.${popupStyles.chart}`)).toBeTruthy()
      expect(popup().querySelector(`.${popupStyles.chart}`).compareDocumentPosition(
        popup().querySelector('[data-behind="detected"]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      // the D5 and the D3 of beat 2, coloured on the engraving
      await ready(() => marked().length == 2)
      expect(layer("ghost").length).toEqual(1)
      expect([...layer("tag")].map(tag => tag.textContent)).toEqual(["wrong 3 of 3"])
      expect(layer("ring").length).toEqual(0)
    })

    it("follows the selection: another bar, the same bar again, Escape, the cross and a page turn clear it, and no shade does", async function() {
      await mount()
      await session({wrong: {1: ["D#3"]}}, {wrong: {1: ["D#3"]}}, {wrong: {1: ["D#3"]}})

      click(showBar(3))
      await ready(() => marked().length == 2)

      // a bar never played has nothing to mark: its own words, and the marks of bar 3 gone
      click(showBar(4))
      await ready(() => popup() && popup().textContent.includes("Bar 4") && marked().length == 0)
      expect(popup().textContent).toContain("No practice recorded for bar 4 yet.")
      expect(layer("ghost").length + layer("tag").length).toEqual(0)

      // the same bar again closes it
      click(showBar(4))
      expect(popup()).toBe(null)

      click(showBar(3))
      await ready(() => marked().length == 2)
      document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
      await ready(() => popup() == null)
      expect(marked().length).toEqual(0)
      expect(layer("ghost").length).toEqual(0)

      click(showBar(3))
      await ready(() => marked().length == 2)
      click(popup().querySelector('button[aria-label="Close bar stats"]'))
      await ready(() => popup() == null)
      expect(marked().length).toEqual(0)

      // the shades are only tints: the bar stays open, its marks as they were
      click(showBar(3))
      await ready(() => marked().length == 2)
      for (let shade of ["Score difficulty", "Off", "Learnedness"]) {
        click(button(shade))
        expect(popup()).toBeTruthy()
        expect(marked().length).toEqual(2)
        expect(layer("ghost").length).toEqual(1)
      }

      // a page turn closes the bar and with it the marks
      click(button("Next page ›"))
      expect(popup()).toBe(null)
      expect(marked().length).toEqual(0)
      expect(layer("ghost").length + layer("ring").length + layer("tag").length).toEqual(0)
      click(button("‹ Previous page"))
      expect(marked().length).toEqual(0)
    })
  })

  describe("a real piece", function() {
    it("marks a bar of a piece with a title, key signature, dynamics, slurs and a pickup bar, each mark on its head", async function() {
      // the expressive study: a one beat pickup (bar 0), then bars of four crotchets, E major
      await mount({startMeasure: 2, endMeasure: 2}, dynamicsOpening())
      expect(container.querySelector("h1").textContent).toContain("Expressive Study")
      await session({wrong: {1: ["F#3"]}}, {wrong: {1: ["F#3"]}}, {})

      click(showBar(2))
      await ready(() => popup() && popup().textContent.includes("Beat 2 went wrong in 2 of your last 3 passes, filled in on the score."))
      await ready(() => marked().length == 2 && layer("ghost").length == 1)

      expect(popup().textContent).toContain("The grey head beside it is the key you pressed instead: the black key just above.")
      expect([...layer("tag")].map(tag => tag.textContent)).toEqual(["wrong 2 of 3"])

      // the ghost sits a quarter of a head right of the bass head, on its line
      let heads = [...marked()].map(el => el.getBoundingClientRect())
      let bass = heads.reduce((low, rect) => rect.top > low.top ? rect : low)
      let ghost = layer("ghost")[0].getBoundingClientRect()
      expect(Math.abs(ghost.left - (bass.right + bass.width * 0.25))).toBeLessThanOrEqual(2)
      expect(Math.abs(ghost.top - bass.top)).toBeLessThanOrEqual(2)

      // the tag sits under the bar's band, the dynamics and slur beside it left alone
      let band = bar(2).getBoundingClientRect()
      let tag = layer("tag")[0].getBoundingClientRect()
      expect(Math.abs(tag.bottom - band.bottom)).toBeLessThanOrEqual(2)
      expect(tag.left).toBeGreaterThanOrEqual(band.left - 40)
      expect(tag.right).toBeLessThanOrEqual(band.right + 40)
    })
  })

  describe("a bar played steadily with one long wait", function() {
    it("keeps the % as it was and shows the wait on the strip and the score, without touching what the bar has learned", async function() {
      await mount({startMeasure: 5, endMeasure: 5})
      await session({gaps: {2: 2500}})

      click(showBar(5))
      await ready(() => popup() && popup().querySelector("[data-behind]"))

      expect(popup().textContent).toContain("Latest100%")
      expect(popup().textContent).toContain("Every note right · timing")
      expect(popup().querySelector(`.${popupStyles.chart}`)).toBeTruthy()

      // the strip, a cell a beat, the long wait on beat 3 and nowhere else
      let cells = [...popup().querySelectorAll(`.${popupStyles.cell}`)]
      expect(cells.length).toEqual(4)
      expect(popup().querySelector('[role="img"][aria-label^="Beat 3 started 2.0 seconds late"]')).toBeTruthy()
      let words = [...popup().querySelectorAll(`.${popupStyles.words} > span`)].map(span => span.textContent)
      expect(words).toEqual(["first note", "on time", "2.0 s late", "on time"])
      expect(popup().textContent).toContain("Beat 3 paused 2.5 s before it started, marked ▾ on the score.")

      // a ▾ over the column and a gilt tag; nothing is filled in or ringed, and no head is coloured
      await ready(() => layer("pause").length == 1)
      expect(layer("pause")[0].textContent).toEqual("▾")
      expect([...layer("tag")].map(tag => tag.textContent)).toEqual(["2.5 s pause"])
      expect(marked().length).toEqual(0)
      expect(layer("ring").length).toEqual(0)

      // one clean pass counts one of three, the wait costing it nothing
      expect(popup().textContent).toContain("1 of 3 clean passes in a row")
      expect(store.item(`${store.items()[0].pieceId}:both:5-5`).passes[0].slice(1, 3)).toEqual([4, 4])
    })

    it("keeps the dots' places and the % when a further steady pass follows, showing the wait as an earlier pass", async function() {
      await mount({startMeasure: 5, endMeasure: 5})
      await session({gaps: {2: 2500}}, {})

      click(showBar(5))
      await ready(() => popup() && popup().textContent.includes("Earlier pass"))
      expect(popup().textContent).toContain("Every note right in your last 2 passes.")
      expect(popup().querySelector('[role="img"][aria-label^="Beat 3 started 2.0 seconds late"]')).toBeTruthy()
    })
  })

  describe("a bar with a single wrong key in three passes", function() {
    it("rings the note, fills nothing, and says it went wrong once", async function() {
      await mount({startMeasure: 6, endMeasure: 6})
      await session({}, {wrong: {2: ["F#3"]}}, {})

      click(showBar(6))
      await ready(() => popup() && popup().textContent.includes("went wrong once in your last 3 passes"))

      expect(popup().textContent).toContain("Beat 3 went wrong once in your last 3 passes, ringed on the score.")
      expect(popup().textContent).toContain("Ringed rather than filled: once is a slip, not a habit.")
      await ready(() => layer("ring").length == 2)
      expect(marked().length).toEqual(0)
      expect([...layer("tag")].map(tag => tag.textContent)).toEqual(["wrong once in 3"])
    })
  })

  describe("the marks when the container changes width", function() {
    it("puts each mark on its head again after the score is engraved again", async function() {
      await mount({}, null, {width: 1440})
      await session({wrong: {1: ["D#3"]}}, {wrong: {1: ["D#3"]}}, {wrong: {1: ["D#3"]}})
      click(showBar(3))
      await ready(() => marked().length == 2 && layer("ghost").length == 1)

      let svg = container.querySelector("svg")
      // the page's score column narrows, as a narrower window would make it
      let column = container.querySelector('section[aria-label="The score"]')
      let wide = column.getBoundingClientRect().width
      column.style.maxWidth = "560px"
      column.style.flex = "none"
      await waitFor(() => container.querySelector("svg") !== svg, {message: "the re-engraving"})
      await ready(() => marked().length == 2 && layer("ghost").length == 1)

      // the class is on the new svg's heads
      for (let head of marked()) { expect(container.querySelector("svg").contains(head)).toBe(true) }

      // each mark within 2 px of its head: the ghost a quarter head right of the bass one
      let headBoxes = [...marked()].map(el => el.getBoundingClientRect())
      let bass = headBoxes.reduce((low, rect) => rect.top > low.top ? rect : low)
      let ghost = layer("ghost")[0].getBoundingClientRect()
      expect(Math.abs(ghost.left - (bass.right + bass.width * 0.25))).toBeLessThanOrEqual(2)
      expect(Math.abs(ghost.top - bass.top)).toBeLessThanOrEqual(2)
      expect(Math.abs(ghost.width - bass.width)).toBeLessThanOrEqual(2)

      let tag = layer("tag")[0].getBoundingClientRect()
      let band = bar(3).getBoundingClientRect()
      expect(Math.abs(tag.bottom - band.bottom)).toBeLessThanOrEqual(2)
      expect(Math.abs((tag.left + tag.right) / 2 - (bass.left + bass.right) / 2)).toBeLessThanOrEqual(3)
    }, 30000)
  })

  describe("a bar's window in its other states", function() {
    // a bar played before the log began, written as an old one: its item, review and passes only
    let playedBefore = async (piece, measure, extra={}) => {
      let id = `${piece.id}:${extra.hand || "both"}:${measure}-${measure}`
      await store.recordAttempt({
        item: {
          id, pieceId: piece.id, hand: "both", startMeasure: measure, endMeasure: measure, level: "bar",
          state: "learning", step: 1, reps: 1, lapses: 0, streak: 1, hits: 4, misses: 0, attempts: 1,
          lastPracticed: Date.now(), recent: [[Date.now(), 4, 4, 3]], passes: [[Date.now(), 4, 4, 3]], algo: 1, createdAt: 1,
          ...extra,
        },
        review: {itemId: id, at: Date.now(), pieceId: piece.id, kind: "attempt", grade: 3, was: "new", columns: 4,
          clean: 4, misses: 0, stuck: 0, skipped: 0, hesitations: 0, mode: "wait", algo: 3},
      })
    }

    it("says a bar played before the log began has only its score, with no mark on the score", async function() {
      let piece = await mount()
      await playedBefore(piece, 7)
      click(showBar(7))
      await ready(() => popup() && popup().textContent.includes("Beat-by-beat details start with the passes you play from now on."))

      expect(popup().textContent).toContain("Earlier passes kept only their score.")
      expect(popup().querySelector('[data-behind="before"]')).toBeTruthy()
      expect(marked().length + layer("ring").length + layer("ghost").length).toEqual(0)
    })

    it("tells a bar graded by ear by the tags the player gave, never a mark on the score", async function() {
      let piece = await mount()
      await playedBefore(piece, 8)
      let at = Date.now()
      await store.recordBarLog([{
        itemId: `${piece.id}:both:8-8`, at, pieceId: piece.id, hand: "both", measure: 8, mode: "self", card: [8, 8],
        cardGrade: 2, columns: null, clean: null, grade: 2, reviewed: true, slipped: ["rhythm", "tempo"],
      }])
      click(showBar(8))
      await ready(() => popup() && popup().textContent.includes("You noted"))

      let chips = [...popup().querySelectorAll(`.${popupStyles.chip}`)].map(chip => chip.textContent)
      expect(chips).toEqual(["Rhythm", "Tempo"])
      expect(popup().textContent).toContain("Nothing is detected on an acoustic piano")
      expect(marked().length + layer("ring").length + layer("ghost").length + layer("tag").length).toEqual(0)
    })

    it("reads the rows of the hand picked when it changes with the window open", async function() {
      let piece = await mount()
      await playedBefore(piece, 9)
      await playedBefore(piece, 9, {hand: "upper"})
      let rowOf = (hand, clean) => ({
        itemId: `${piece.id}:${hand}:9-9`, at: Date.now() - (hand == "both" ? 2000 : 1000), pieceId: piece.id, hand,
        measure: 9, mode: "wait", card: [9, 9], cardGrade: 2, columns: 4, clean, grade: 2, reviewed: true,
        beats: [32, 33, 34, 35], gaps: [null, 1, 1, 1], iois: [null, 500, 500, 500], pulse: 500,
        marks: clean == 4 ? undefined : [[1, "wrong", ["D5"], ["E5"], 1, null]],
      })
      await store.recordBarLog([rowOf("both", 4), {...rowOf("upper", 3)}])

      click(showBar(9))
      await ready(() => popup() && popup().textContent.includes("Every note right in your last pass."))

      click(button("Right hand"))
      await ready(() => popup() && popup().textContent.includes("Behind the 75%"))
      expect(popup().textContent).toContain("Beat 2 went wrong in your last pass")
      expect(popup().textContent).not.toContain("Every note right in your last pass.")

      click(button("Both hands"))
      await ready(() => popup() && popup().textContent.includes("Every note right in your last pass."))
    })

    it("marks nothing on a piece drawn as a grid, its words ending without the score", async function() {
      let piece = await mount()
      await store.putPiece(store.piece(piece.id), {source: null})
      await store.recordBarLog([2000, 3000].map(at => ({
        itemId: `${piece.id}:both:3-3`, at, pieceId: piece.id, hand: "both", measure: 3, mode: "wait", card: [3, 3], cardGrade: 2,
        columns: 4, clean: 3, grade: 2, reviewed: true,
        beats: [8, 9, 10, 11], gaps: [null, 1, 1, 1], iois: [null, 500, 500, 500], pulse: 500,
        marks: [[1, "wrong", ["D3", "D5"], ["D#3"], 1, null]],
      })))
      await playedBefore(piece, 3)

      flushSync(() => root.unmount())
      container.remove()
      container = document.createElement("div")
      container.style.width = "1440px"
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240}))))
      await waitFor(() => bar(3), {message: "the grid"})
      expect(container.querySelector("svg")).toBe(null)

      click(showBar(3))
      await ready(() => popup() && popup().textContent.includes("Behind the 75%"))
      expect(popup().textContent).toContain("Beat 2 went wrong in all 2 of your last passes.")
      expect(popup().textContent).not.toContain("on the score")
      expect(popup().textContent).not.toContain("grey head")
      expect(marked().length + container.querySelectorAll("[data-mark]").length).toEqual(0)
    })
  })

  describe("the ended strip after a reload", function() {
    let endedSession = async ({rest=false}={}) => {
      click(button("Begin"))
      play({})
      play({wrong: {1: ["D#3"]}})
      await page.state.notes.generator.finishing
      if (rest) { click(button("Rest")) }
      click(button("End session"))
      await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip"})
    }

    it("comes back for a session ended from a pause, with the bars it played tinted and labelled", async function() {
      await mount()
      await endedSession({rest: true})
      let log = page.state.sessionLog
      expect(log.length).toEqual(2)

      leave()
      await render()
      await waitFor(() => container.textContent.includes("Session ended"), {timeout: 4000, message: "the strip to come back"})
      expect(page.state.sessionLog).toEqual(log)
      expect(page.state.endedRestored).toBe(true)
      expect(button("Play on")).toBeUndefined()
      expect(button("Done")).toBeTruthy()

      // the strip's marks: bar 3 played twice, 7 of 8 notes right
      click(button("This session"))
      expect(container.textContent).toContain("88%")
      expect(container.textContent).toContain("Session ended")
    })

    it("leads to Today's practice, with the day's minutes, also once it is brought back after a reload", async function() {
      await mount()
      await endedSession()

      let todayLink = () => [...container.querySelectorAll("a")].find(a => a.textContent.includes("Today's practice"))
      expect(todayLink().getAttribute("href")).toEqual("/stats")
      expect(container.textContent).toContain("of 10 minutes today")

      leave()
      await render()
      await waitFor(() => container.textContent.includes("Session ended"), {timeout: 4000, message: "the strip to come back"})
      expect(todayLink().getAttribute("href")).toEqual("/stats")
      // the session counted once, not twice, though the strip holds its record and the cache does too
      expect(container.textContent).toContain("of 10 minutes today")
      expect(container.textContent).not.toContain("20 minutes today")
    })

    it("brings back the last of two sessions in a visit, and only its passes", async function() {
      await mount()
      await endedSession()
      click(button("Done"))
      await waitFor(() => bar(3))

      click(button("Begin"))
      play({})
      await page.state.notes.generator.finishing
      click(button("End session"))
      await waitFor(() => container.textContent.includes("Session ended"), {message: "the second strip"})
      let log = page.state.sessionLog
      expect(log.length).toEqual(1)
      let marker = await store.scoreEnded()
      expect(marker.sessionId).toEqual(store.recentSessions()[store.recentSessions().length - 1].id)

      leave()
      await render()
      await waitFor(() => container.textContent.includes("Session ended"), {timeout: 4000, message: "the strip to come back"})
      expect(page.state.sessionLog).toEqual(log)
      expect(container.textContent).toContain("100%")
    })

    // a marker the strip mustn't come back for, and forgotten
    let staleMarker = async (change, why) => {
      let piece = await mount()
      await endedSession()
      let marker = await store.scoreEnded()
      leave()
      await store.putScoreEnded({sessionId: marker.sessionId, pieceId: piece.id, at: marker.at, ...change(marker)})

      await render()
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(container.textContent).withContext(why).not.toContain("Session ended")
      expect(await store.scoreEnded()).withContext(why).toBe(null)
    }

    it("forgets a marker of another piece", async function() {
      await staleMarker(() => ({pieceId: "another-piece"}), "another piece")
    })

    it("forgets a marker of a day before today's practice day", async function() {
      await staleMarker(marker => ({at: marker.at - 26 * 60 * 60 * 1000}), "yesterday")
    })

    it("forgets a marker whose session isn't among the recent ones", async function() {
      await staleMarker(() => ({sessionId: "s-gone"}), "a session not kept")
    })

    it("leaves the strip alone when Begin comes before it is read", async function() {
      await mount()
      await endedSession()
      leave()
      container = null

      // the page remounts and Begin is pressed at once
      container = document.createElement("div")
      container.style.width = "1440px"
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => root.render(React.createElement(MemoryRouter, {},
        React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240}))))
      await waitFor(() => button("Begin"), {message: "Begin"})
      click(button("Begin"))
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(container.textContent).not.toContain("Session ended")
      expect(page.state.ended).toBe(null)
      expect(await store.scoreEnded()).toBe(null)
    })
  })

  describe("a bar asked for in the address", function() {
    // the bar's own window, open on the score's page that holds it
    let opened = number => popup() && popup().textContent.includes(`Bar ${number}`) && bar(number)

    it("turns to the page that holds the bar and opens its window, once", async function() {
      await mount({}, null, {entries: ["/sheet-music?bar=16"]})
      await ready(() => opened(16))

      // the plate's width may settle after it, drawing the pages again: the page stays on the bar
      await paginated()
      expect(opened(16)).toBeTruthy()
      expect(bar(16).getAttribute("aria-pressed")).toEqual("true")
      expect(bar(1)).toBe(null)
      expect(location.search).toEqual("")
      expect(page.state.session).toBe(false)

      // Begin and End session draw the score view afresh: the request is spent
      click(button("Begin"))
      play({})
      await page.state.notes.generator.finishing
      click(button("End session"))
      await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip"})
      click(button("Done"))
      await waitFor(() => bar(3), {message: "the score back"})
      expect(popup()).toBe(null)
      expect(location.search).toEqual("")
    })

    // the real piece: a title, a key signature, dynamics, slurs and a one beat pickup, numbered bar 0
    it("opens the pickup bar, number 0, of a piece with a title, a key signature, dynamics and slurs", async function() {
      await mount({startMeasure: 1, endMeasure: 1}, dynamicsOpening(), {entries: ["/sheet-music?bar=0"]})
      await ready(() => opened(0))

      expect(bar(0).getAttribute("aria-pressed")).toEqual("true")
      expect(popup().textContent).toContain("Bar 0")
      expect(container.textContent).toContain("Expressive Study")
      expect(location.search).toEqual("")

      // the popup sits under the bar's own band, as a clicked bar's does
      let band = bar(0).getBoundingClientRect()
      let box = popup().getBoundingClientRect()
      expect(box.top).toBeGreaterThanOrEqual(band.bottom - 2)
    })

    it("leaves the window shut for a bar the piece doesn't have, or one that isn't a number", async function() {
      await mount({}, null, {entries: ["/sheet-music?bar=99"]})
      expect(popup()).toBe(null)
      expect(page.state.session).toBe(false)
      // the request is dropped from the address as a spent one is
      await waitFor(() => location.search == "", {message: "the request to be dropped"})
      leave()

      await render({entries: ["/sheet-music?bar=abc"]})
      expect(popup()).toBe(null)
    })

    it("opens a bar's window directly on a piece drawn as a grid, with no score stored", async function() {
      let piece = await mount()
      await store.putPiece(store.piece(piece.id), {source: null})
      leave()

      container = document.createElement("div")
      container.style.width = "1440px"
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => root.render(React.createElement(MemoryRouter, {initialEntries: ["/sheet-music?bar=3"]},
        React.createElement(LocationProbe),
        React.createElement(ScorePage, {ref: p => page = p, viewportHeight: 1240}))))
      await waitFor(() => bar(3), {message: "the grid"})
      expect(container.querySelector("svg")).toBe(null)
      await ready(() => popup() && popup().textContent.includes("Bar 3"))
      expect(bar(3).getAttribute("aria-pressed")).toEqual("true")
      expect(location.search).toEqual("")
    })
  })

  describe("the ended strip's marker", function() {
    it("is cleared by Begin and by Play on, and written only for a session that was recorded", async function() {
      await mount()
      expect(await store.scoreEnded()).toBe(null)

      // End session with nothing played writes no session, so no marker
      click(button("Begin"))
      click(button("End session"))
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(await store.scoreEnded()).toBe(null)
      expect(container.textContent).not.toContain("Session ended")

      click(button("Begin"))
      play()
      await page.state.notes.generator.finishing
      click(button("End session"))
      await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip"})
      let marker = await store.scoreEnded()
      expect(marker).toEqual(jasmine.objectContaining({sessionId: store.recentSessions()[0].id}))

      // Play on goes back to the session and forgets the marker
      click(button("Play on"))
      await waitFor(async () => (await store.scoreEnded()) === null, {message: "Play on to clear it"})
        .catch(() => {})
      expect(await store.scoreEnded()).toBe(null)
      expect(container.textContent).not.toContain("Session ended")

      // ended again, then Begin from the strip's own page clears it too
      click(button("End session"))
      await waitFor(() => container.textContent.includes("Session ended"), {message: "the strip again"})
      expect(await store.scoreEnded()).not.toBe(null)
      click(button("Begin"))
      expect(await store.scoreEnded()).toBe(null)
      expect(container.textContent).not.toContain("Session ended")
    })
  })
})
