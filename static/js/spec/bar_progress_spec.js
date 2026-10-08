import {
  passHistory, passAccuracy, isClean, learnedness, learnedCount, sessionMarks, endedSummary, TROUBLE_BELOW,
} from "st/bar_progress"
import {newItem} from "st/srs/records"
import {AGAIN, HARD, GOOD, EASY} from "st/srs/grade"

let item = (passes, extra = {}) =>
  ({...newItem({pieceId: "p", startMeasure: 5, endMeasure: 5}, 10), passes, ...extra})

describe("bar_progress", function() {
  describe("TROUBLE_BELOW", function() {
    it("is 80", function() {
      expect(TROUBLE_BELOW).toEqual(80)
    })
  })

  describe("passHistory", function() {
    it("reads passes, falling back to recent, null for no item", function() {
      expect(passHistory(null)).toEqual([])
      expect(passHistory(item([[1, 4, 4, GOOD]]))).toEqual([[1, 4, 4, GOOD]])
      let {passes, ...noPasses} = item([[1, 4, 4, GOOD]])
      expect(passHistory({...noPasses, recent: [[2, 4, 3, HARD]]})).toEqual([[2, 4, 3, HARD]])
    })
  })

  describe("passAccuracy", function() {
    it("rounds clean over columns, null for a self entry or no columns", function() {
      expect(passAccuracy([1, 4, 3, GOOD])).toEqual(75)
      expect(passAccuracy([1, 3, 3, EASY])).toEqual(100)
      expect(passAccuracy([1, null, null, GOOD])).toEqual(null)
      expect(passAccuracy([1, 0, 0, null])).toEqual(null)
    })
  })

  describe("isClean", function() {
    it("is every column clean for a detected entry, Good or Easy for a self one", function() {
      expect(isClean([1, 4, 4, GOOD])).toBe(true)
      expect(isClean([1, 4, 3, GOOD])).toBe(false)
      expect(isClean([1, null, null, GOOD])).toBe(true)
      expect(isClean([1, null, null, EASY])).toBe(true)
      expect(isClean([1, null, null, HARD])).toBe(false)
      expect(isClean([1, null, null, AGAIN])).toBe(false)
    })
  })

  describe("learnedness", function() {
    it("is 0 for no item, or an item never played", function() {
      expect(learnedness(null)).toEqual(0)
      expect(learnedness(item([]))).toEqual(0)
    })

    it("counts played with no history as 0, not unplayed", function() {
      expect(learnedness(item([], {attempts: 1}))).toEqual(0)
    })

    it("counts the clean passes at the end of the history, capped at 3", function() {
      let clean = (at) => [at, 4, 4, GOOD]
      let dirty = (at) => [at, 4, 3, GOOD]

      expect(learnedness(item([clean(1), clean(2)]))).toEqual(2)
      expect(learnedness(item([clean(1), dirty(2), clean(3), clean(4), clean(5)]))).toEqual(3)
      expect(learnedness(item([clean(1), clean(2), clean(3), dirty(4)]))).toEqual(0)
      expect(learnedness(item([clean(1), clean(2), clean(3), clean(4), clean(5), clean(6)]))).toEqual(3)
    })

    it("counts self entries Good or Easy as clean, Again or Hard as not", function() {
      let self = grade => [1, null, null, grade]
      expect(learnedness(item([self(EASY), self(GOOD)]))).toEqual(2)
      expect(learnedness(item([self(GOOD), self(HARD)]))).toEqual(0)
      expect(learnedness(item([self(GOOD), self(AGAIN)]))).toEqual(0)
    })

    it("counts detected and self entries mixed", function() {
      let mixed = [[1, 4, 4, GOOD], [2, null, null, EASY], [3, 3, 3, GOOD]]
      expect(learnedness(item(mixed))).toEqual(3)
    })

    it("ignores an entry with 0 columns outright, neither counting nor breaking the run", function() {
      let clean = (at) => [at, 4, 4, GOOD]
      expect(learnedness(item([clean(1), clean(2), [3, 0, 0, null], clean(4)]))).toEqual(3)
    })

    it("reads only the given item's history, under its own hand", function() {
      let lower = item([[1, 4, 4, GOOD]], {hand: "lower"})
      expect(learnedness(lower)).toEqual(1)
    })
  })

  describe("learnedCount", function() {
    it("counts the piece's bars learned under the given hand, independent of other hands", function() {
      let clean3 = [[1, 4, 4, GOOD], [2, 4, 4, GOOD], [3, 4, 4, GOOD]]
      let items = [
        item(clean3, {startMeasure: 1, endMeasure: 1, id: "p:both:1-1"}),
        item([], {startMeasure: 2, endMeasure: 2, id: "p:both:2-2"}),
        item(clean3, {startMeasure: 1, endMeasure: 1, hand: "upper", id: "p:upper:1-1"}),
      ]
      expect(learnedCount(items, [1, 2, 3], "both")).toEqual(1)
      expect(learnedCount(items, [1, 2, 3], "upper")).toEqual(1)
      expect(learnedCount(items, [1, 2, 3], "lower")).toEqual(0)
    })
  })

  describe("sessionMarks", function() {
    it("marks a detected bar by its share of clean columns over the session, at the exact threshold", function() {
      let log = [
        {bars: [{measure: 5, columns: 4, clean: 4, grade: EASY}]},
        {bars: [{measure: 6, columns: 9, clean: 8, grade: GOOD}]}, // 89%
        {bars: [{measure: 7, columns: 7, clean: 5, grade: AGAIN}]}, // 71%
        {bars: [{measure: 8, columns: 5, clean: 4, grade: GOOD}]}, // 80, near
        {bars: [{measure: 9, columns: 100, clean: 79, grade: AGAIN}]}, // 79, trouble
      ]
      let marks = sessionMarks(log)
      expect(marks.get(5)).toEqual({mark: "clean", label: "100%"})
      expect(marks.get(6)).toEqual({mark: "near", label: "89%"})
      expect(marks.get(7)).toEqual({mark: "trouble", label: "71%"})
      expect(marks.get(8)).toEqual({mark: "near", label: "80%"})
      expect(marks.get(9)).toEqual({mark: "trouble", label: "79%"})
      expect(marks.has(10)).toBe(false)
    })

    it("sums a bar's columns across several passes in the log", function() {
      let log = [
        {bars: [{measure: 5, columns: 4, clean: 4, grade: EASY}]},
        {bars: [{measure: 5, columns: 4, clean: 2, grade: AGAIN}]},
      ]
      expect(sessionMarks(log).get(5)).toEqual({mark: "trouble", label: "75%"})
    })

    it("marks a self-only bar by its share of clean passes", function() {
      let log = [
        {bars: [{measure: 5, columns: null, clean: null, grade: EASY}]},
        {bars: [{measure: 5, columns: null, clean: null, grade: GOOD}]},
        {bars: [{measure: 5, columns: null, clean: null, grade: AGAIN}]},
      ]
      expect(sessionMarks(log).get(5)).toEqual({mark: "trouble", label: "2 of 3 clean"})
    })
  })

  describe("endedSummary", function() {
    let record = (extra = {}) => ({notesRead: 100, misses: 9, elapsedSeconds: 1200, ...extra})
    let log = [{bars: [{measure: 5, columns: 4, clean: 4, grade: EASY}]}]

    it("headlines the record's own accuracy, with no comparison without a previous session", function() {
      let summary = endedSummary({record: record(), previous: null, log, acoustic: false})
      expect(summary.headline).toEqual("92%")
      expect(summary.headlineSuffix).toEqual("accuracy")
      expect(summary.comparison).toEqual(null)
    })

    it("compares with the previous session: up, down or level", function() {
      let up = endedSummary({record: record(), previous: record({notesRead: 88, misses: 12}), log, acoustic: false})
      expect(up.comparison).toEqual("Up 4 points on your last session")

      let down = endedSummary({record: record(), previous: record({notesRead: 99, misses: 1}), log, acoustic: false})
      expect(down.comparison).toEqual("Down 7 points on your last session")

      let level = endedSummary({record: record(), previous: record(), log, acoustic: false})
      expect(level.comparison).toEqual("Level with your last session")
    })

    it("words the minutes and bars played", function() {
      expect(endedSummary({record: record({elapsedSeconds: 30}), previous: null, log: [], acoustic: false}).second)
        .toEqual("Under a minute · 0 bars played · each bar's accuracy is marked on the score")
      expect(endedSummary({record: record({elapsedSeconds: 60}), previous: null, log, acoustic: false}).second)
        .toEqual("1 minute · 1 bar played · each bar's accuracy is marked on the score")
      expect(endedSummary({record: record({elapsedSeconds: 1200}), previous: null, log, acoustic: false}).second)
        .toEqual("20 minutes · 1 bar played · each bar's accuracy is marked on the score")
    })

    it("gives an acoustic headline from the record's selfGraded share, and no comparison", function() {
      let acousticRecord = record({notesRead: 0, misses: 0, selfGraded: {passes: 6, clean: 4}})
      let summary = endedSummary({record: acousticRecord, previous: record(), log: [], acoustic: true})
      expect(summary.headline).toEqual("4 of 6")
      expect(summary.headlineSuffix).toEqual("passes clean")
      expect(summary.comparison).toEqual(null)
    })
  })
})
