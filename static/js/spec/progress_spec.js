import {
  progressSummary, pitchClassStats, sessionSeconds, readSince, accuracyChangeCaption,
  PROGRESS_DAYS, CLEF_ACCURACY, NOTE_ACCURACY,
} from "st/progress"
import {localDay, dayStart, DAY} from "st/srs/schedule"

let session = (startedAt, fields={}) => ({id: `s${startedAt}`, startedAt, ...fields})

describe("progress", function() {
  describe("progressSummary", function() {
    it("builds a 14-day window oldest to newest, the last flagged today", function() {
      let now = +new Date(2026, 9, 3, 2) // Oct 3, 2am: a 4am rollover day still belongs to Oct 2
      let {days} = progressSummary([], {now})

      expect(days.length).toEqual(PROGRESS_DAYS)
      expect(days.map(day => day.today)).toEqual([
        ...Array(PROGRESS_DAYS - 1).fill(false), true,
      ])
      expect(days[days.length - 1].date).toEqual(2)
      expect(days[0].date).toEqual(19) // 13 days before Oct 2 is Sep 19
    })

    it("groups a session by the 4am local day it starts in", function() {
      let now = +new Date(2026, 9, 2, 12)
      let sessions = [
        session(+new Date(2026, 8, 30, 23, 50), {notesRead: 1}), // Sep 30, 23:50 -> Sep 30's day
        session(+new Date(2026, 9, 1, 0, 30), {notesRead: 1}), // Oct 1, 0:30 -> still Sep 30's day
        session(+new Date(2026, 9, 1, 4, 10), {notesRead: 1}), // Oct 1, 4:10 -> Oct 1's day
      ]

      let {days, cards} = progressSummary(sessions, {now})
      let byDate = Object.fromEntries(days.map(day => [day.date, day]))
      expect(byDate[30].sessions).toEqual(2)
      expect(byDate[1].sessions).toEqual(1)
      expect(cards.eveningsKept).toEqual(2)
    })

    it("counts a session spanning midnight wholly on its start day", function() {
      let now = +new Date(2026, 9, 2, 12)
      let sessions = [session(+new Date(2026, 9, 1, 23, 40), {elapsedSeconds: 2700})]

      let {days} = progressSummary(sessions, {now})
      let byDate = Object.fromEntries(days.map(day => [day.date, day]))
      expect(byDate[1].minutes).toEqual(45)
      expect(byDate[2].minutes).toEqual(0)
      expect(byDate[2].sessions).toEqual(0)
    })

    it("takes minutes from elapsedSeconds, falling back to activeSeconds, then to 0", function() {
      let now = +new Date(2026, 9, 2, 12)
      let sessions = [
        session(+new Date(2026, 9, 1, 20), {elapsedSeconds: 120, activeSeconds: 600}),
        session(+new Date(2026, 9, 1, 21), {activeSeconds: 60}),
        session(+new Date(2026, 9, 1, 22)), // bare: {id, startedAt} only
      ]

      let {days, cards} = progressSummary(sessions, {now})
      let day = days.find(d => d.date == 1)
      expect(day.minutes).toEqual(2 + 1 + 0)
      expect(day.sessions).toEqual(3)
      expect(cards.eveningsKept).toEqual(1)
    })

    it("leaves a day with no session at zero, not kept", function() {
      let now = +new Date(2026, 9, 2, 12)
      let {days, cards} = progressSummary([], {now})
      expect(days.every(day => day.sessions == 0 && day.minutes == 0)).toBe(true)
      expect(cards.eveningsKept).toEqual(0)
    })

    it("keeps a session outside the window out of it, and a future one out entirely", function() {
      let now = +new Date(2026, 9, 2, 12)
      let fifteenDaysAgo = session(dayStart(localDay(now) - 15) + HOUR(1), {notesRead: 1})
      let twentyDaysAgo = session(dayStart(localDay(now) - 20) + HOUR(1), {notesRead: 5, misses: 5})
      let future = session(now + DAY, {notesRead: 1})

      let {days, cards} = progressSummary([fifteenDaysAgo, twentyDaysAgo, future], {now})
      expect(days.every(day => day.sessions == 0)).toBe(true)
      expect(cards.notesRead).toEqual(0)

      // the 20-day-old session still counts toward the accuracy change's
      // previous window
      let withCurrent = session(dayStart(localDay(now)) + HOUR(1), {notesRead: 90, misses: 10})
      let delta = progressSummary([twentyDaysAgo, withCurrent], {now}).cards.accuracyDelta
      expect(delta).toEqual(90 - 50)
    })

    it("reads the headline figures over the window", function() {
      let now = +new Date(2026, 9, 2, 12)
      let a = session(dayStart(localDay(now)) + HOUR(1), {notesRead: 90, misses: 10, elapsedSeconds: 300})
      let b = session(dayStart(localDay(now) - 1) + HOUR(1), {notesRead: 45, misses: 5, elapsedSeconds: 300})
      let prev = session(dayStart(localDay(now) - 14) + HOUR(1), {notesRead: 80, misses: 20})

      let {cards} = progressSummary([a, b, prev], {now})
      expect(cards.notesRead).toEqual(135)
      expect(cards.accuracy).toEqual(90)
      expect(cards.accuracyDelta).toEqual(90 - 80)
      expect(cards.minutes).toEqual(10)

      let noPrev = progressSummary([a, b], {now}).cards
      expect(noPrev.accuracyDelta).toBe(null)
    })

    it("counts an acoustic session's minutes and evening with no notes read or accuracy", function() {
      let now = +new Date(2026, 9, 2, 12)
      let acoustic = session(dayStart(localDay(now)) + HOUR(1), {
        selfGraded: {passes: 3, clean: 2}, notesRead: 0, misses: 0, elapsedSeconds: 600, notes: {},
      })

      let {cards, clefs, notes} = progressSummary([acoustic], {now})
      expect(cards.eveningsKept).toEqual(1)
      expect(cards.minutes).toEqual(10)
      expect(cards.notesRead).toEqual(0)
      expect(cards.accuracy).toBe(null)
      expect(cards.accuracyDelta).toBe(null)
      expect(clefs).toEqual([])
      expect(notes).toEqual([])
    })

    it("folds a mixed session's detected counts into accuracy, ignoring its passes there", function() {
      let now = +new Date(2026, 9, 2, 12)
      let mixed = session(dayStart(localDay(now)) + HOUR(1), {
        notesRead: 9, misses: 1, selfGraded: {passes: 2, clean: 1},
      })

      let {cards} = progressSummary([mixed], {now})
      expect(cards.notesRead).toEqual(9)
      expect(cards.accuracy).toEqual(90)
    })

    describe("by clef", function() {
      it("sums a session's own clefs, and falls a clefless single-hand session back to its staff", function() {
        let now = +new Date(2026, 9, 2, 12)
        let scored = session(dayStart(localDay(now)) + HOUR(1), {
          notesRead: 4, misses: 0, clefs: {g: {hits: 2, misses: 0}, f: {hits: 2, misses: 0}},
        })
        let treble = session(dayStart(localDay(now) - 1) + HOUR(1), {staff: "treble", notesRead: 8, misses: 2})
        let bass = session(dayStart(localDay(now) - 2) + HOUR(1), {staff: "bass", notesRead: 2, misses: 3})
        let grand = session(dayStart(localDay(now) - 3) + HOUR(1), {staff: "grand", notesRead: 5, misses: 0})
        let chord = session(dayStart(localDay(now) - 4) + HOUR(1), {staff: "chord", notesRead: 5, misses: 0})

        let {clefs} = progressSummary([scored, treble, bass, grand, chord], {now})
        expect(clefs).toEqual([
          {sign: "g", label: "Treble", percent: 83, weak: false}, // (2+8)/(2+8+0+2) = 10/12
          {sign: "f", label: "Bass", percent: 57, weak: true}, // (2+2)/(2+2+0+3) = 4/7
        ])
      })

      it("is weak just under CLEF_ACCURACY, not weak at it", function() {
        let now = +new Date(2026, 9, 2, 12)
        let justBelow = session(dayStart(localDay(now)) + HOUR(1), {staff: "treble", notesRead: 79, misses: 21})
        let atThreshold = session(dayStart(localDay(now)) + HOUR(1), {staff: "treble", notesRead: 80, misses: 20})

        expect(progressSummary([justBelow], {now}).clefs[0].percent).toEqual(79)
        expect(progressSummary([justBelow], {now}).clefs[0].weak).toBe(true)
        expect(progressSummary([atThreshold], {now}).clefs[0].percent).toEqual(CLEF_ACCURACY)
        expect(progressSummary([atThreshold], {now}).clefs[0].weak).toBe(false)
      })
    })

    it("scales the chart to the goal, shrinking to fit a longer day", function() {
      let now = +new Date(2026, 9, 2, 12)
      let dayOf = (minutes, offset=0) =>
        session(dayStart(localDay(now) - offset) + HOUR(1), {elapsedSeconds: minutes * 60})

      let small = progressSummary([dayOf(16)], {now, goalMinutes: 10}).scale
      expect(small.pxPerMinute).toBeCloseTo(9, 5)
      expect(small.goalPx).toBeCloseTo(90, 5)

      let long = progressSummary([dayOf(30)], {now, goalMinutes: 10}).scale
      expect(long.pxPerMinute).toBeCloseTo(5, 5)
      expect(long.goalPx).toBeCloseTo(50, 5)

      let biggerGoal = progressSummary([dayOf(1)], {now, goalMinutes: 20}).scale
      expect(biggerGoal.goalPx).toBeCloseTo(90, 5)
    })
  })

  describe("pitchClassStats", function() {
    it("merges a pitch class's spellings, labelling it by the most-missed one", function() {
      let stats = pitchClassStats([{"A#": {hits: 10}, Bb: {misses: 3}}])
      expect(stats.length).toEqual(1)
      expect(stats[0].label).toEqual("Bb")
      expect(stats[0].percent).toEqual(77) // 10 / 13
      expect(stats[0].weak).toBe(false)
    })

    it("orders tiles chromatically from C", function() {
      let stats = pitchClassStats([{E: {hits: 1}, C: {hits: 1}, G: {hits: 1}}])
      expect(stats.map(s => s.label)).toEqual(["C", "E", "G"])
    })

    it("is weak just under NOTE_ACCURACY, not weak at it", function() {
      let below = pitchClassStats([{C: {hits: 74, misses: 26}}])
      let at = pitchClassStats([{C: {hits: 75, misses: 25}}])
      expect(below[0].percent).toEqual(74)
      expect(below[0].weak).toBe(true)
      expect(at[0].percent).toEqual(NOTE_ACCURACY)
      expect(at[0].weak).toBe(false)
    })

    it("skips a key it can't read rather than throwing", function() {
      expect(() => pitchClassStats([{"?": {hits: 1}}])).not.toThrow()
      expect(pitchClassStats([{"?": {hits: 1}}])).toEqual([])
    })

    it("gives no tiles for no notes", function() {
      expect(pitchClassStats([])).toEqual([])
      expect(pitchClassStats([{}])).toEqual([])
    })
  })

  describe("accuracyChangeCaption", function() {
    it("captions a rise, a fall, no change, and nothing when unknown", function() {
      expect(accuracyChangeCaption(3)).toEqual("▲ 3 on the fortnight before")
      expect(accuracyChangeCaption(-3)).toEqual("▼ 3 on the fortnight before")
      expect(accuracyChangeCaption(0)).toEqual("Level with the fortnight before")
      expect(accuracyChangeCaption(null)).toBe(null)
    })
  })

  describe("sessionSeconds", function() {
    it("prefers elapsedSeconds, falls back to activeSeconds, then 0", function() {
      expect(sessionSeconds({elapsedSeconds: 10, activeSeconds: 99})).toEqual(10)
      expect(sessionSeconds({activeSeconds: 20})).toEqual(20)
      expect(sessionSeconds({})).toEqual(0)
      expect(sessionSeconds({elapsedSeconds: NaN, activeSeconds: 5})).toEqual(5)
    })
  })

  describe("readSince", function() {
    it("reaches back far enough for the previous window", function() {
      let now = +new Date(2026, 9, 2, 12)
      expect(readSince(now)).toEqual(dayStart(localDay(now) - 27))
    })
  })
})

function HOUR(h) { return h * 60 * 60 * 1000 }
