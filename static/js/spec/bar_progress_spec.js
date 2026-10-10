import {
  passHistory, passAccuracy, isClean, learnedness, learnedCount, sessionMarks, endedSummary, sessionLogOf,
  TROUBLE_BELOW,
} from "st/bar_progress"
import {measureCards, MeasureCardDeck, MeasureCardGenerator, IN_ORDER} from "st/measure_cards"
import NoteList from "st/note_list"
import NoteStats from "st/note_stats"
import {openTestStore} from "spec/helpers"
import {AGAIN, HARD, GOOD, EASY} from "st/srs/grade"

const item = (fields={}) => ({hand: "both", startMeasure: 5, endMeasure: 5, attempts: 0, recent: [], ...fields})

// a detected pass tuple, clean by default
const pass = (at, columns=4, clean=columns, grade=GOOD) => [at, columns, clean, grade]
// a self-graded pass tuple
const self = (at, grade) => [at, null, null, grade]

describe("bar progress", function() {
  describe("TROUBLE_BELOW", function() {
    it("is 80", function() {
      expect(TROUBLE_BELOW).toEqual(80)
    })
  })

  describe("passHistory", function() {
    it("reads passes, falling back to recent for an item without it, and [] for none", function() {
      expect(passHistory(null)).toEqual([])
      expect(passHistory(item({recent: [pass(1)]}))).toEqual([pass(1)])
      expect(passHistory(item({recent: [pass(1)], passes: [pass(2)]}))).toEqual([pass(2)])
    })
  })

  describe("passAccuracy and isClean", function() {
    it("reads a detected entry's accuracy, null for a self one", function() {
      expect(passAccuracy(pass(1, 4, 3))).toEqual(75)
      expect(passAccuracy(pass(1, 4, 4))).toEqual(100)
      expect(passAccuracy(self(1, GOOD))).toBe(null)
    })

    it("is clean at 100% accuracy, or self-graded Clean or Easy", function() {
      expect(isClean(pass(1, 4, 4))).toBe(true)
      expect(isClean(pass(1, 4, 3))).toBe(false)
      expect(isClean(self(1, GOOD))).toBe(true)
      expect(isClean(self(1, EASY))).toBe(true)
      expect(isClean(self(1, HARD))).toBe(false)
      expect(isClean(self(1, AGAIN))).toBe(false)
    })
  })

  describe("learnedness", function() {
    it("reads null for a bar never played", function() {
      expect(learnedness(null)).toBe(null)
      expect(learnedness(item({attempts: 0, recent: []}))).toBe(null)
    })

    it("reads 0 (Started) for a bar played with no history kept", function() {
      expect(learnedness(item({attempts: 2, recent: []}))).toEqual(0)
    })

    it("counts the clean passes at the end of the history, capped at 3", function() {
      expect(learnedness(item({attempts: 2, passes: [pass(1), pass(2)]}))).toEqual(2)
      expect(learnedness(item({attempts: 5, passes: [
        pass(1), pass(2, 4, 2), pass(3), pass(4), pass(5),
      ]}))).toEqual(3)
      expect(learnedness(item({attempts: 4, passes: [
        pass(1), pass(2), pass(3), pass(4, 4, 2),
      ]}))).toEqual(0)
      expect(learnedness(item({attempts: 6, passes: [
        pass(1), pass(2), pass(3), pass(4), pass(5), pass(6),
      ]}))).toEqual(3)
    })

    it("counts a self-graded Clean or Easy as clean, Stumbled or Fell apart as not", function() {
      expect(learnedness(item({attempts: 3, passes: [self(1, GOOD), self(2, EASY), self(3, GOOD)]})))
        .toEqual(3)
      expect(learnedness(item({attempts: 2, passes: [self(1, HARD), self(2, AGAIN)]}))).toEqual(0)
    })

    it("mixes detected and self-graded passes in one history", function() {
      expect(learnedness(item({attempts: 3, passes: [pass(1), self(2, EASY), pass(3)]}))).toEqual(3)
      expect(learnedness(item({attempts: 3, passes: [pass(1), self(2, HARD), pass(3)]}))).toEqual(1)
    })

    it("ignores a pass of 0 columns, as if it weren't in the history", function() {
      expect(learnedness(item({attempts: 3, passes: [pass(1), [2, 0, 0, null], pass(3)]}))).toEqual(2)
    })

    it("reads only the given item, the setup hand's", function() {
      let both = item({hand: "both", attempts: 3, passes: [pass(1), pass(2), pass(3)]})
      expect(learnedness(both)).toEqual(3)
      // a caller picking the wrong hand's item would read it wrong, but
      // learnedness itself just reads whatever item it is handed
      let upper = item({hand: "upper", attempts: 0, recent: []})
      expect(learnedness(upper)).toBe(null)
    })
  })

  describe("learnedCount", function() {
    it("counts the piece's bars learned under a hand, out of the measures given", function() {
      let items = [
        item({startMeasure: 1, endMeasure: 1, attempts: 3, passes: [pass(1), pass(2), pass(3)]}),
        item({startMeasure: 2, endMeasure: 2, attempts: 1, passes: [pass(1)]}),
        // the right hand's own bar 1, learned, never counted under "both"
        item({startMeasure: 1, endMeasure: 1, hand: "upper", attempts: 3, passes: [pass(1), pass(2), pass(3)]}),
        // a span, never a bar
        item({startMeasure: 1, endMeasure: 2, attempts: 3, passes: [pass(1), pass(2), pass(3)]}),
      ]

      expect(learnedCount(items, [1, 2, 3], "both")).toEqual(1)
      expect(learnedCount(items, [1, 2, 3], "upper")).toEqual(1)
    })
  })

  describe("sessionMarks", function() {
    let entry = (measure, columns, clean, grade=GOOD) =>
      ({startMeasure: measure, endMeasure: measure, hand: "both", readThrough: false, self: false, grade,
        bars: [{measure, columns, clean, grade}]})
    let selfEntry = (measure, grade) =>
      ({startMeasure: measure, endMeasure: measure, hand: "both", readThrough: false, self: true, grade,
        bars: [{measure, columns: null, clean: null, grade}]})

    it("sums a bar's clean and columns across its passes in the log", function() {
      let marks = sessionMarks([entry(1, 4, 4), entry(1, 4, 4)])
      expect(marks.get(1)).toEqual({kind: "clean", label: "100%"})

      let near = sessionMarks([entry(2, 10, 8, AGAIN)])
      expect(near.get(2)).toEqual({kind: "near", label: "80%"})

      let trouble = sessionMarks([entry(3, 10, 7, AGAIN)])
      expect(trouble.get(3)).toEqual({kind: "trouble", label: "70%"})

      // the boundary itself: 80 is near, 79 is trouble
      expect(sessionMarks([entry(4, 100, 80, AGAIN)]).get(4).kind).toEqual("near")
      expect(sessionMarks([entry(5, 100, 79, AGAIN)]).get(5).kind).toEqual("trouble")

      // exact figures from the build note's sample
      expect(sessionMarks([entry(6, 100, 100)]).get(6)).toEqual({kind: "clean", label: "100%"})
      expect(sessionMarks([entry(7, 100, 89, AGAIN)]).get(7)).toEqual({kind: "near", label: "89%"})
      expect(sessionMarks([entry(8, 100, 71, AGAIN)]).get(8)).toEqual({kind: "trouble", label: "71%"})
    })

    it("marks a self-graded-only bar by its share of clean passes", function() {
      // 4 of 5 clean is exactly the 80% near/trouble boundary
      let marks = sessionMarks([
        selfEntry(9, GOOD), selfEntry(9, GOOD), selfEntry(9, GOOD), selfEntry(9, EASY), selfEntry(9, HARD),
      ])
      expect(marks.get(9)).toEqual({kind: "near", label: "4 of 5 clean"})

      expect(sessionMarks([selfEntry(10, GOOD)]).get(10)).toEqual({kind: "clean", label: "1 of 1 clean"})
      expect(sessionMarks([selfEntry(11, AGAIN)]).get(11)).toEqual({kind: "trouble", label: "0 of 1 clean"})
    })

    // a bar with any detected pass this session keeps its accuracy label,
    // whatever self-graded passes it also has (the instrument toggled
    // mid-session): the self-graded label is only for a bar with nothing
    // but self-graded passes
    it("keeps a bar's detected accuracy label over a self-graded one, even one graded worse", function() {
      let marks = sessionMarks([entry(12, 4, 4), selfEntry(12, AGAIN)])
      expect(marks.get(12)).toEqual({kind: "clean", label: "100%"})

      // order doesn't matter: a self-graded pass before the detected one
      // still loses to it
      let reversed = sessionMarks([selfEntry(13, GOOD), entry(13, 10, 7, AGAIN)])
      expect(reversed.get(13)).toEqual({kind: "trouble", label: "70%"})
    })

    it("leaves a bar not in the log untinted (absent from the map)", function() {
      expect(sessionMarks([entry(1, 4, 4)]).has(2)).toBe(false)
    })
  })

  describe("endedSummary", function() {
    let record = (fields={}) => ({id: "s1", startedAt: 10000, notesRead: 91, misses: 9, elapsedSeconds: 1200, ...fields})

    it("headlines the session's accuracy, as accuracyPercent(notesRead, misses) reads it", function() {
      let summary = endedSummary({record: record(), pieceId: "p", log: []})
      expect(summary.headline).toEqual("91%")
      expect(summary.headlineItalic).toEqual("accuracy")
    })

    it("compares with the previous session on this piece, up, down or level", function() {
      let sessions = [
        {id: "prev", startedAt: 5000, settings: {piece: "p"}, notesRead: 87, misses: 13},
      ]
      expect(endedSummary({record: record(), pieceId: "p", sessions, log: []}).comparison)
        .toEqual("Up 4 points on your last session")

      let worse = [{id: "prev", startedAt: 5000, settings: {piece: "p"}, notesRead: 94, misses: 6}]
      expect(endedSummary({record: record(), pieceId: "p", sessions: worse, log: []}).comparison)
        .toEqual("Down 3 points on your last session")

      let same = [{id: "prev", startedAt: 5000, settings: {piece: "p"}, notesRead: 91, misses: 9}]
      expect(endedSummary({record: record(), pieceId: "p", sessions: same, log: []}).comparison)
        .toEqual("Level with your last session")
    })

    it("omits the comparison without a previous session, or a later one, or on another piece", function() {
      expect(endedSummary({record: record(), pieceId: "p", sessions: [], log: []}).comparison).toBe(null)

      let later = [{id: "x", startedAt: 20000, settings: {piece: "p"}, notesRead: 50, misses: 50}]
      expect(endedSummary({record: record(), pieceId: "p", sessions: later, log: []}).comparison).toBe(null)

      let otherPiece = [{id: "x", startedAt: 5000, settings: {piece: "q"}, notesRead: 50, misses: 50}]
      expect(endedSummary({record: record(), pieceId: "p", sessions: otherPiece, log: []}).comparison).toBe(null)
    })

    it("gives the minutes and bars played, from the log's distinct bars", function() {
      let log = [
        {bars: [{measure: 1, columns: 4, clean: 4, grade: GOOD}]},
        {bars: [{measure: 1, columns: 4, clean: 4, grade: GOOD}, {measure: 2, columns: 4, clean: 4, grade: GOOD}]},
      ]

      expect(endedSummary({record: record({elapsedSeconds: 10}), pieceId: "p", log: []}).detail)
        .toEqual("Under a minute · 0 bars played · each bar's accuracy is marked on the score")
      expect(endedSummary({record: record({elapsedSeconds: 65}), pieceId: "p", log: [log[0]]}).detail)
        .toEqual("1 minute · 1 bar played · each bar's accuracy is marked on the score")
      expect(endedSummary({record: record({elapsedSeconds: 20 * 60}), pieceId: "p", log}).detail)
        .toEqual("20 minutes · 2 bars played · each bar's accuracy is marked on the score")
    })

    it("headlines an acoustic-only record's share of clean passes, with no comparison", function() {
      let acoustic = record({notesRead: 0, misses: 0, selfGraded: {passes: 6, clean: 4}})
      let sessions = [{id: "prev", startedAt: 5000, settings: {piece: "p"}, notesRead: 80, misses: 20}]
      let summary = endedSummary({record: acoustic, pieceId: "p", sessions, log: []})

      expect(summary.headline).toEqual("4 of 6")
      expect(summary.headlineItalic).toEqual("passes clean")
      expect(summary.comparison).toBe(null)
    })
  })
})

describe("sessionLogOf", function() {
  let store, generators

  beforeEach(async function() {
    store = await openTestStore()
    generators = []
  })

  afterEach(async function() {
    generators.forEach(g => g.stop())
    await store.close()
  })

  // two bars of three crotchets each in one card, played detected and then self-graded
  let twoBarCard = () => {
    let bar = (number, notes, from) => ({
      number, columns: notes.map((note, idx) => Object.assign([note], {beat: from + idx})),
    })
    return measureCards([bar(1, ["C4", "D4", "E4"], 0), bar(2, ["F4", "G4", "A4"], 3)], 2)
  }

  it("equals the entries the generator reported while the passes were played, in order", async function() {
    let time = 0
    let deck = new MeasureCardDeck(twoBarCard(), {pieceId: "p", order: IN_ORDER, store})
    let generator = new MeasureCardGenerator(deck, {now: () => time})
    generators.push(generator)
    let reported = []
    generator.setOnPass(entry => reported.push(entry))

    let notes = new NoteList([], {generator})
    notes.fillBuffer(8)
    let stats = new NoteStats()
    let play = measured => {
      let column = notes.currentColumn()
      notes = notes.clone()
      notes.shift(measured)
      notes.pushRandom()
      stats.hitNotes(column)
    }

    // a detected pass with a wrong key at bar 2's second column, then a clean one
    for (let t of [1000, 1500, 2000, 2500]) { time = t; play({latency: 500, onset: t}) }
    stats.missNotes(["G4"], ["G4"], ["F#4"])
    for (let t of [3000, 3500]) { time = t; play({latency: 500, onset: t}) }
    await generator.finishing
    for (let t of [5000, 5500, 6000, 6500, 7000, 7500]) { time = t; play({latency: 500, onset: t}) }
    await generator.finishing

    // then a self-graded one, naming only bar 2
    generator.setDrill(() => ({mode: "self"}))
    time = 9000
    generator.selfGrade(2, {bars: [2], slipped: ["tempo"]})
    await generator.finishing

    expect(reported.length).toEqual(3)
    expect(reported.map(entry => entry.self)).toEqual([false, false, true])

    let rows = await store.barLog({pieceId: "p"})
    expect(rows.length).toEqual(5)
    expect(sessionLogOf(rows)).toEqual(reported)

    // however the rows come
    expect(sessionLogOf([...rows].reverse())).toEqual(reported)
  })

  it("is empty for no rows", function() {
    expect(sessionLogOf([])).toEqual([])
  })
})
