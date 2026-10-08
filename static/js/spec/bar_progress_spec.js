import {
  passHistory, passAccuracy, isClean, learnedness, learnedCount, sessionMarks, endedSummary,
  TROUBLE_BELOW,
} from "st/bar_progress"
import {newItem} from "st/srs/records"

// a bar item with the given passes history, played
const barItem = (passes, extra={}) => ({
  ...newItem({pieceId: "p", startMeasure: 5, endMeasure: 5}, 10),
  attempts: passes.length,
  passes,
  ...extra,
})

describe("bar progress", function() {
  it("exports the nearly/trouble threshold", function() {
    expect(TROUBLE_BELOW).toEqual(80)
  })

  describe("passHistory", function() {
    it("reads passes, falling back to recent, or [] without an item", function() {
      expect(passHistory(null)).toEqual([])
      expect(passHistory({recent: [[1, 3, 3, 4]]})).toEqual([[1, 3, 3, 4]])
      expect(passHistory({recent: [[1, 3, 3, 4]], passes: [[2, 3, 2, 2]]})).toEqual([[2, 3, 2, 2]])
    })
  })

  describe("passAccuracy and isClean", function() {
    it("reads a detected entry's accuracy, null for a self-graded one", function() {
      expect(passAccuracy([1, 4, 4, 3])).toEqual(100)
      expect(passAccuracy([1, 4, 3, 2])).toEqual(75)
      expect(passAccuracy([1, null, null, 3])).toBeNull()
    })

    it("is clean at 100% accuracy, or a self grade of Clean or Easy", function() {
      expect(isClean([1, 4, 4, 3])).toBe(true)
      expect(isClean([1, 4, 3, 2])).toBe(false)
      expect(isClean([1, null, null, 3])).toBe(true)
      expect(isClean([1, null, null, 4])).toBe(true)
      expect(isClean([1, null, null, 2])).toBe(false)
      expect(isClean([1, null, null, 1])).toBe(false)
    })
  })

  describe("learnedness", function() {
    let clean = (at=1) => [at, 4, 4, 3]
    let miss = (at=1) => [at, 4, 3, 2]
    let selfClean = (at=1, grade=3) => [at, null, null, grade]
    let selfMiss = (at=1, grade=2) => [at, null, null, grade]

    it("isn't played without an item", function() {
      expect(learnedness(null)).toEqual({played: false, count: 0})
    })

    it("is played with no history once attempted", function() {
      let item = {...newItem({pieceId: "p", startMeasure: 5, endMeasure: 5}, 10), attempts: 1}
      expect(learnedness(item)).toEqual({played: true, count: 0})
    })

    it("counts the clean passes at the end of the history, oldest first", function() {
      expect(learnedness(barItem([clean(1), clean(2)]))).toEqual({played: true, count: 2})
      expect(learnedness(barItem([clean(1), miss(2), clean(3), clean(4), clean(5)]))).toEqual({played: true, count: 3})
      expect(learnedness(barItem([clean(1), clean(2), clean(3), miss(4)]))).toEqual({played: true, count: 0})
    })

    it("caps the count at 3 (Learned) however long the clean run", function() {
      let history = [1, 2, 3, 4, 5, 6].map(clean)
      expect(learnedness(barItem(history))).toEqual({played: true, count: 3})
    })

    it("counts a self grade of Clean or Easy as clean, Fell apart or Stumbled as not", function() {
      expect(learnedness(barItem([selfClean(1, 3), selfClean(2, 4)]))).toEqual({played: true, count: 2})
      expect(learnedness(barItem([selfClean(1, 3), selfMiss(2, 1)]))).toEqual({played: true, count: 0})
      expect(learnedness(barItem([selfMiss(1, 2)]))).toEqual({played: true, count: 0})
    })

    it("mixes detected and self passes in one run", function() {
      expect(learnedness(barItem([miss(1), clean(2), selfClean(3)]))).toEqual({played: true, count: 2})
    })

    it("ignores an entry with 0 columns, neither counting nor breaking the run", function() {
      let zero = [9, 0, 0, null]
      expect(learnedness(barItem([clean(1), clean(2), zero]))).toEqual({played: true, count: 2})
    })
  })

  describe("learnedCount", function() {
    let learnedBar = measure => ({
      ...newItem({pieceId: "p", hand: "both", startMeasure: measure, endMeasure: measure}, 10),
      attempts: 3, passes: [[1, 4, 4, 3], [2, 4, 4, 3], [3, 4, 4, 3]],
    })
    let unlearnedBar = measure => ({
      ...newItem({pieceId: "p", hand: "both", startMeasure: measure, endMeasure: measure}, 10),
      attempts: 1, passes: [[1, 4, 3, 2]],
    })

    it("counts the piece's bars learned under the given hand", function() {
      let items = [learnedBar(1), unlearnedBar(2), learnedBar(3)]
      expect(learnedCount(items, [1, 2, 3], "both")).toEqual(2)
    })

    it("reads only the setup hand's item", function() {
      let bothLearned = learnedBar(1)
      let lowerUnlearned = {...unlearnedBar(1), hand: "lower", id: "p:lower:1-1"}
      expect(learnedCount([bothLearned, lowerUnlearned], [1], "both")).toEqual(1)
      expect(learnedCount([bothLearned, lowerUnlearned], [1], "lower")).toEqual(0)
    })
  })

  describe("sessionMarks", function() {
    let detected = (measure, columns, clean) => ({bars: [{measure, columns, clean, grade: null}]})

    it("sums columns and clean across passes at a bar, tinting at the thresholds", function() {
      let log = [detected(1, 10, 10), detected(2, 9, 8), detected(3, 7, 5)]
      let marks = sessionMarks(log)
      expect(marks.get(1)).toEqual(jasmine.objectContaining({tint: "clean", label: "100%"}))
      expect(marks.get(2)).toEqual(jasmine.objectContaining({tint: "near", label: "89%"}))
      expect(marks.get(3)).toEqual(jasmine.objectContaining({tint: "trouble", label: "71%"}))
    })

    it("tints exactly 80% near and 79% trouble", function() {
      let marks = sessionMarks([detected(1, 100, 80), detected(2, 100, 79)])
      expect(marks.get(1).tint).toEqual("near")
      expect(marks.get(2).tint).toEqual("trouble")
    })

    it("marks a bar with only self passes by the share clean", function() {
      let log = [
        {bars: [{measure: 5, columns: null, clean: null, grade: 3}]},
        {bars: [{measure: 5, columns: null, clean: null, grade: 2}]},
        {bars: [{measure: 5, columns: null, clean: null, grade: 4}]},
      ]
      expect(sessionMarks(log).get(5)).toEqual(jasmine.objectContaining({
        acoustic: true, tint: "trouble", label: "2 of 3 clean",
      }))
    })

    it("leaves out bars not in the log", function() {
      expect(sessionMarks([detected(1, 4, 4)]).has(2)).toBe(false)
    })
  })

  describe("endedSummary", function() {
    let record = (notesRead, misses, extra={}) =>
      ({notesRead, misses, elapsedSeconds: 600, settings: {piece: "a"}, startedAt: 10000, ...extra})
    let log = [
      {bars: [{measure: 1, columns: 4, clean: 4, grade: null}]},
      {bars: [{measure: 2, columns: 4, clean: 3, grade: null}]},
    ]

    it("heads with the session's accuracy, equal to accuracyPercent", function() {
      let summary = endedSummary({record: record(50, 5), log})
      expect(summary.headline).toEqual(91) // round(100*50/55)
      expect(summary.headlineUnit).toEqual("accuracy")
    })

    it("compares with the previous session on the same piece, up, down or level", function() {
      let current = record(91, 9) // 91%
      expect(endedSummary({record: current, previous: record(87, 13, {startedAt: 1000}), log}).comparison)
        .toEqual("Up 4 points on your last session")
      expect(endedSummary({record: current, previous: record(94, 6, {startedAt: 1000}), log}).comparison)
        .toEqual("Down 3 points on your last session")
      expect(endedSummary({record: current, previous: record(91, 9, {startedAt: 1000}), log}).comparison)
        .toEqual("Level with your last session")
    })

    it("gives no comparison without a previous session, or one too old, another piece, or empty", function() {
      let current = record(91, 9)
      expect(endedSummary({record: current, log}).comparison).toBeNull()
      expect(endedSummary({record: current, previous: record(50, 5, {startedAt: 20000}), log}).comparison).toBeNull()
      expect(endedSummary({
        record: current, previous: record(50, 5, {startedAt: 1000, settings: {piece: "b"}}), log,
      }).comparison).toBeNull()
      expect(endedSummary({record: current, previous: record(0, 0, {startedAt: 1000}), log}).comparison).toBeNull()
    })

    it("words the minutes and bars played", function() {
      expect(endedSummary({record: record(4, 0, {elapsedSeconds: 10}), log: []}).detail)
        .toEqual("Under a minute · 0 bars played · each bar's accuracy is marked on the score")
      let oneBar = [{bars: [{measure: 1, columns: 4, clean: 4, grade: null}]}]
      expect(endedSummary({record: record(4, 0, {elapsedSeconds: 60}), log: oneBar}).detail)
        .toEqual("1 minute · 1 bar played · each bar's accuracy is marked on the score")
      expect(endedSummary({record: record(4, 0, {elapsedSeconds: 1200}), log}).detail)
        .toEqual("20 minutes · 2 bars played · each bar's accuracy is marked on the score")
    })

    it("gives an acoustic-only record's share of clean passes, with no comparison", function() {
      let acoustic = record(0, 0, {selfGraded: {passes: 6, clean: 4}})
      let summary = endedSummary({
        record: acoustic, previous: record(50, 5, {startedAt: 1000}), log: [],
      })
      expect(summary.headline).toEqual("4 of 6")
      expect(summary.headlineUnit).toEqual("passes clean")
      expect(summary.comparison).toBeNull()
    })
  })
})
