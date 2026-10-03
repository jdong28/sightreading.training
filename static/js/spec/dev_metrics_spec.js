import * as React from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"

import {
  devMetricsState, storeDevMetricsOpen, formatMs, tempoOf, rangeLabel, columnRows, runReport,
  gradeReason, perColumnRows, itemReviews, handItems, DEV_METRICS_KEY,
} from "st/dev_metrics"
import DevMetricsPanel from "st/components/sight_reading/dev_metrics_panel"
import {AttemptPass, passAttempts} from "st/srs/attempt"
import {sectionCard, MeasureCardDeck, MeasureCardGenerator, IN_ORDER} from "st/measure_cards"
import {newItem} from "st/srs/records"
import {AGAIN, HARD, GOOD, EASY, HESITATION_MIN_MS} from "st/srs/grade"
import {setAppStore} from "st/storage"
import {openTestStore} from "spec/helpers"

// a column of notes on the treble staff at a beat
const col = (beat, ...names) => {
  let column = [...names]
  column.beat = beat
  column.staves = names.map(() => "upper")
  column.clefs = {upper: "g"}
  return column
}

// a column of notes with no score rhythm, as a piece stored before song
// format 2 has: its pace is per column, never per beat
const beatless = (...names) => {
  let column = [...names]
  column.staves = names.map(() => "upper")
  column.clefs = {upper: "g"}
  return column
}

// bar 1: three quarter notes, bar 2: one
const twoBars = () => sectionCard([
  {number: 1, columns: [col(0, "G4"), col(1, "A4"), col(2, "B4")]},
  {number: 2, columns: [col(3, "C5")]},
])

// plays the head column, done at time, its latency time away from the
// column before by default
const play = (pass, time, {misses=[], hit=true, measured={}}={}) => {
  let latency = time - pass.columnStartedAt
  misses.forEach((notes, idx) => pass.miss(notes, {counted: idx == 0, time}))
  let index = pass.done(time, hit ?
    {latency, spread: 0, early: 0, heldCredit: 0, late: null, ...measured} : undefined)
  if (hit) { pass.hit(index) }
}

// a store of localStorage's shape
const memoryStorage = (entries={}) => ({
  getItem: key => key in entries ? entries[key] : null,
  setItem: (key, value) => { entries[key] = String(value) },
  removeItem: key => { delete entries[key] },
  entries,
})

describe("dev metrics", function() {
  describe("toggle", function() {
    it("is off until the URL flag turns it on, then remembered", function() {
      let storage = memoryStorage()
      expect(devMetricsState({search: "", storage})).toEqual({enabled: false, open: false})
      expect(devMetricsState({search: "?devMetrics=1", storage})).toEqual({enabled: true, open: true})
      expect(devMetricsState({search: "", storage})).toEqual({enabled: true, open: true})

      storeDevMetricsOpen(false, storage)
      expect(devMetricsState({search: "", storage})).toEqual({enabled: true, open: false})
      // the flag doesn't reopen a panel closed by hand
      expect(devMetricsState({search: "?devMetrics=1", storage})).toEqual({enabled: true, open: false})

      expect(devMetricsState({search: "?devMetrics=0", storage})).toEqual({enabled: false, open: false})
      expect(storage.entries[DEV_METRICS_KEY]).toBeUndefined()
    })

    it("ignores a flag that is neither 1 nor 0", function() {
      let storage = memoryStorage()
      for (let value of ["", "=", "=false", "=off", "=no", "=2"]) {
        expect(devMetricsState({search: `?devMetrics${value}`, storage})).toEqual(
          {enabled: false, open: false})
      }
      expect(storage.entries[DEV_METRICS_KEY]).toBeUndefined()

      devMetricsState({search: "?devMetrics=1", storage})
      expect(devMetricsState({search: "?devMetrics=false", storage})).toEqual(
        {enabled: true, open: true})
    })

    it("stays off when storage can't be read", function() {
      let storage = {getItem() { throw new Error("blocked") }}
      expect(devMetricsState({search: "?devMetrics=1", storage})).toEqual({enabled: false, open: false})
    })
  })

  it("formats times, tempos and ranges", function() {
    expect(formatMs(null)).toEqual("—")
    expect(formatMs(412.4)).toEqual("412 ms")
    expect(formatMs(12345)).toEqual("12.3 s")
    expect(tempoOf(500)).toEqual(120)
    expect(tempoOf(null)).toBe(null)
    expect(rangeLabel({startMeasure: 4, endMeasure: 4})).toEqual("bar 4")
    expect(rangeLabel({startMeasure: 4, endMeasure: 6, hand: "both"})).toEqual("bars 4–6, hands together")
    expect(rangeLabel({startMeasure: 4, endMeasure: 4, hand: "lower"})).toEqual("bar 4, lower hand")
  })

  describe("live columns", function() {
    it("shows each column's status and what the matcher measured on it", function() {
      let pass = new AttemptPass(twoBars(), {startedAt: 1000})
      pass.drill = {mode: "wait"}
      play(pass, 3000, {measured: {spread: 30, early: 1}})
      play(pass, 3600, {misses: [["A4"], ["A4"]], measured: {latency: 200, heldCredit: 1}})
      pass.done(4000)

      let rows = columnRows(pass)
      expect(rows.map(row => row.status)).toEqual(["hit", "hit", "skipped", "head"])
      expect(rows.map(row => row.bar)).toEqual([1, 1, 1, 2])
      expect(rows[0]).toEqual(jasmine.objectContaining({
        notes: ["G4"], slips: 0, ms: 2000, latency: 2000, spread: 30, early: 1, heldCredit: 0, late: null,
      }))
      expect(rows[1]).toEqual(jasmine.objectContaining({slips: 2, ms: 600, latency: 200, heldCredit: 1}))
      expect(rows[2]).toEqual(jasmine.objectContaining({ms: 400, latency: null}))
    })

    it("calls a column scrolled past missed, as the grade counts it", function() {
      let pass = new AttemptPass(twoBars(), {startedAt: 1000})
      pass.drill = {mode: "scroll", speed: 80}
      play(pass, 3000)
      pass.miss(["A4"], {time: 3400})
      pass.done(3400)
      expect(columnRows(pass).map(row => row.status)).toEqual(["hit", "missed", "head", "to come"])

      play(pass, 3800)
      play(pass, 4200)
      pass.written = {pieceId: "p", hand: "both", at: pass.lastAt}
      expect(runReport(pass).columns[1]).toEqual(
        jasmine.objectContaining({misses: 1, skipped: false}))
    })

    it("marks the columns before the rest of an abandoned pass", function() {
      let pass = new AttemptPass(twoBars(), {from: 2, continued: true, startedAt: 1000})
      expect(columnRows(pass).map(row => row.status)).toEqual(["before", "before", "head", "to come"])
    })
  })

  describe("run", function() {
    let finished = (plays, drill={mode: "wait"}) => {
      let pass = new AttemptPass(twoBars(), {startedAt: 1000})
      pass.drill = drill
      plays.forEach(([time, opts]) => play(pass, time, opts))
      pass.written = {pieceId: "p", hand: "both", at: pass.lastAt}
      return pass
    }

    it("grades a pass as its stored attempts are graded", function() {
      let pass = finished([[3000], [3500], [4000, {misses: [["B4"]]}], [4500]])
      pass.found = {}

      let report = runReport(pass)
      expect(report.graded).toBe(true)
      expect(report.pace).toEqual(500)
      expect(report.tempo).toEqual(120)
      expect(report.ranges.map(range => range.id)).toEqual(["p:both:1-2", "p:both:1-1", "p:both:2-2"])

      let stored = passAttempts(pass, {pieceId: "p", hand: "both"})
        .map(({build}) => build(null).review.grade)
      expect(report.ranges.map(range => range.grade)).toEqual(stored)
      expect(report.ranges.map(range => range.rule)).toEqual(["slip", "slips", "easy"])
      expect(report.ranges[0].reason).toEqual("hard: slips on 1 of 4 columns")
    })

    it("shows each column's hesitation threshold and whether its latency crossed it", function() {
      let pass = finished([[3000], [3500], [6000], [6500]])
      let report = runReport(pass)

      expect(report.pending).toBe(true)
      expect(report.columns.map(column => column.threshold)).toEqual(
        [null, HESITATION_MIN_MS, HESITATION_MIN_MS, HESITATION_MIN_MS])
      expect(report.columns.map(column => column.hesitated)).toEqual([false, false, true, false])
      expect(report.stops).toEqual([1])
      expect(report.ranges[0]).toEqual(jasmine.objectContaining({grade: GOOD, rule: "hesitation"}))
    })

    it("takes the first column played as the one that can't hesitate", function() {
      let pass = finished([
        [2000, {measured: {settled: true, latency: null, heldCredit: 1}}],
        [3500], [4000], [4500],
      ])
      let report = runReport(pass)

      expect(report.pace).toEqual(500)
      expect(report.columns.map(column => column.ms)).toEqual([null, 2500, 500, 500])
      expect(report.columns.map(column => column.latency)).toEqual([null, 2500, 500, 500])
      expect(report.columns.map(column => column.settled)).toEqual([true, false, false, false])
      // the column played after the settled one opens the run, so neither
      // gets a threshold: the grade never hesitates on them, however long
      // the wait
      expect(report.columns.map(column => column.threshold)).toEqual(
        [null, null, HESITATION_MIN_MS, HESITATION_MIN_MS])
      expect(report.columns.map(column => column.hesitated)).toEqual([false, false, false, false])
      expect(columnRows(pass).map(row => row.status)).toEqual(["settled", "hit", "hit", "hit"])
    })

    it("checks an easy pace against the item's usual pace as the pass found it", function() {
      let pass = finished([[3000], [3500], [4000], [4500]])
      let slow = {...newItem({pieceId: "p", hand: "both", startMeasure: 1, endMeasure: 2}, 0),
        attempts: 3, paceMs: 400}
      pass.found = {"p:both:1-2": slow}

      let [card, bar1] = runReport(pass).ranges
      expect(card).toEqual(jasmine.objectContaining({grade: GOOD, rule: "pace", usualPace: 400, firstSight: false}))
      expect(card.reason).toEqual("good: no slip or hesitation, but pace 500 ms/beat > 1.15 × usual 400 ms = 460 ms")
      expect(bar1).toEqual(jasmine.objectContaining({grade: EASY, firstSight: true}))
      expect(bar1.reason).toEqual("easy: no slip or hesitation, at first sight, so no usual pace to keep")
    })

    it("keeps the after-run caption's pace and stops apart from the grade's", function() {
      let pass = finished([[3000], [40000], [80000], [80500]])
      let report = runReport(pass)

      // the grade counts a column paused on, the caption leaves it out and
      // calls it a stop, so the two paces judge different hesitations
      expect(report.pace).toEqual(37000)
      expect(report.columns.every(column => !column.hesitated)).toBe(true)
      expect(report.captionPace).toEqual(500)
      expect(report.captionTempo).toEqual(120)
      expect(report.stops).toEqual([1, 1])
    })

    it("says why a pass isn't graded", function() {
      let pass = new AttemptPass(twoBars(), {from: 2, continued: true, startedAt: 1000})
      pass.drill = {mode: "wait"}
      play(pass, 2000)
      play(pass, 2500)
      let report = runReport(pass)
      expect(report.graded).toBe(false)
      expect(report.why).toMatch(/abandoned/)
    })

    it("reads no pace or hesitation in scroll mode", function() {
      let pass = finished([[3000], [3500], [9000], [9500]], {mode: "scroll", speed: 80})
      let report = runReport(pass)
      expect(report.speed).toEqual(80)
      expect(report.columns.every(column => column.threshold == null && !column.hesitated)).toBe(true)
      expect(report.ranges[0]).toEqual(jasmine.objectContaining({grade: GOOD, rule: "scroll"}))
    })
  })

  it("words each grading rule", function() {
    let counts = {columns: 4, clean: 4, slips: 0, misses: 0, stuck: 0, skipped: 0, hesitations: 0, pace: 500}
    let reason = (change, opts={}) => gradeReason({...counts, ...change}, {mode: "wait", ...opts})

    expect(reason({grade: AGAIN, rule: "skipped", skipped: 1})).toEqual("again: 1 column skipped")
    expect(reason({grade: AGAIN, rule: "stuck", stuck: 2})).toEqual("again: 2 columns stuck (3+ slips)")
    expect(reason({grade: AGAIN, rule: "slips", slips: 2})).toEqual("again: slips on 2 of 4 columns, over 25%")
    expect(reason({grade: HARD, rule: "hesitations", hesitations: 2}))
      .toEqual("hard: hesitations on 2 of 4 columns, over 25%")
    expect(reason({grade: GOOD, rule: "hesitation", hesitations: 1})).toEqual("good: no slip, but 1 hesitation")
    expect(reason({grade: EASY, rule: "easy"}, {usualPace: 500}))
      .toEqual("easy: no slip or hesitation, pace 500 ms/beat ≤ 1.15 × usual 500 ms = 575 ms")
    expect(reason({grade: EASY, rule: "easy"})).toEqual("easy: no slip or hesitation, no usual pace yet")
  })

  it("lists an item's stored reviews newest first with their columns", function() {
    let reviews = [
      {itemId: "p:both:1-1", at: 10, perColumn: [[1, 0, 300, 20, 1, 0, null]]},
      {itemId: "p:both:2-2", at: 20},
      {itemId: "p:both:1-1", at: 30},
    ]
    expect(itemReviews(reviews, "p:both:1-1").map(review => review.at)).toEqual([30, 10])
    expect(perColumnRows(reviews[0].perColumn)).toEqual([
      {slips: 1, stalled: false, latency: 300, spread: 20, early: 1, heldCredit: 0, late: null},
    ])
    expect(perColumnRows(undefined)).toEqual([])
  })

  // the Live tab shows the pass being played; without one it must say why,
  // which is not the same reason for a measure card drill as for a staff one
  describe("the live tab without a pass", function() {
    let container, root
    let matcher = {inspect: () => ({
      waiting: 0, latency: null, touched: [], held: [], early: [], credited: [], onLine: null,
    })}

    let renderPanel = generator => {
      container = document.createElement("div")
      document.body.appendChild(container)
      root = createRoot(container)
      flushSync(() => root.render(React.createElement(DevMetricsPanel, {
        generator, matcher, session: true, close: () => {},
      })))
      return container
    }

    afterEach(function() {
      flushSync(() => root.unmount())
      container.remove()
    })

    let cardDeck = cards => new MeasureCardDeck(cards, {pieceId: "p", order: IN_ORDER, store: {}})

    it("says nothing is to play when a card drill's section has none", function() {
      // a bar of rests alone: the deck picks no card, so the generator's
      // pass is null though the drill does grade the cards it does pick
      let generator = new MeasureCardGenerator(cardDeck([sectionCard([{number: 1, columns: []}])]))

      try {
        expect([generator.pass, generator.deck.playableCount]).toEqual([null, 0])
        expect(renderPanel(generator).textContent).toContain("nothing to play right now")
      } finally {
        generator.stop()
      }
    })

    // today's programme reaches this with every bar playable, once it is
    // complete or every bar it has left rests until the next sitting
    it("says the same when a playable deck has no card to play now", function() {
      let deck = cardDeck([sectionCard([{number: 1, columns: [col(0, "G4")]}])])
      let generator = new MeasureCardGenerator(deck)

      try {
        deck.index = null
        generator.startCard()
        expect([generator.pass, deck.playableCount]).toEqual([null, 1])

        let note = renderPanel(generator).textContent
        expect(note).toContain("nothing to play right now")
        expect(note).not.toContain("The chosen section has no playable column")
      } finally {
        generator.stop()
      }
    })

    it("says a drill with no deck keeps no attempts", function() {
      let el = renderPanel({})
      expect(el.textContent).toContain("keeps no attempts")
      expect(el.textContent).not.toContain("nothing to play right now")
    })
  })

  describe("history of a self-graded review", function() {
    let store, previousStore
    let matcher = {inspect: () => ({
      waiting: 0, latency: null, touched: [], held: [], early: [], credited: [], onLine: null,
    })}

    beforeEach(async function() {
      store = await openTestStore()
      previousStore = setAppStore(store)
    })

    afterEach(async function() {
      setAppStore(previousStore)
      await store.close()
    })

    let waitFor = async (fn, tries=30) => {
      for (let i = 0; i < tries && !fn(); i++) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      return fn()
    }

    it("shows self-graded reviews with no counts line", async function() {
      await store.putPiece({id: "p", title: "P", importedAt: 1000, song: {tracks: [], metadata: {}}})
      let item = newItem({pieceId: "p", startMeasure: 1, endMeasure: 1}, 1000)
      let review = {
        itemId: item.id, at: 2000, pieceId: "p", kind: "attempt", mode: "self",
        grade: GOOD, was: "new", elapsedMs: 4000,
      }
      await store.recordAttempt({item, review})

      let deck = new MeasureCardDeck([sectionCard([{number: 1, columns: [col(0, "G4")]}])], {
        pieceId: "p", order: IN_ORDER, store,
      })
      let generator = new MeasureCardGenerator(deck)

      let container = document.createElement("div")
      document.body.appendChild(container)
      let root = createRoot(container)
      try {
        flushSync(() => root.render(React.createElement(DevMetricsPanel, {
          generator, matcher, session: true, close: () => {},
        })))

        let historyTab = [...container.querySelectorAll("[role=tab]")].find(b => b.textContent == "History")
        flushSync(() => historyTab.click())

        await waitFor(() => container.textContent.includes("self-graded"))
        expect(container.textContent).toContain("self-graded")
        expect(container.textContent).not.toMatch(/clean \d+\/\d+/)
      } finally {
        flushSync(() => root.unmount())
        container.remove()
        generator.stop()
      }
    })

    // a piece whose columns carry no score rhythm paces by column, and the
    // deck's card list says so whether or not a card is being shown
    it("paces a beatless piece by column with no card loaded", async function() {
      await store.putPiece({id: "p", title: "P", importedAt: 1000, song: {tracks: [], metadata: {}}})
      let item = {...newItem({pieceId: "p", startMeasure: 1, endMeasure: 1}, 1000), paceMs: 480}
      await store.recordAttempt({
        item,
        review: {
          itemId: item.id, at: 2000, pieceId: "p", kind: "attempt", mode: "self",
          grade: GOOD, was: "new", elapsedMs: 4000,
        },
      })

      let deck = new MeasureCardDeck([sectionCard([{number: 1, columns: [beatless("G4")]}])], {
        pieceId: "p", order: IN_ORDER, store,
      })
      let generator = new MeasureCardGenerator(deck)
      deck.index = null
      generator.startCard()
      expect(deck.card).toBe(null)

      let container = document.createElement("div")
      document.body.appendChild(container)
      let root = createRoot(container)
      try {
        flushSync(() => root.render(React.createElement(DevMetricsPanel, {
          generator, matcher, session: true, close: () => {},
        })))

        let historyTab = [...container.querySelectorAll("[role=tab]")].find(b => b.textContent == "History")
        flushSync(() => historyTab.click())

        await waitFor(() => container.textContent.includes("480 ms per"))
        expect(container.textContent).toContain("480 ms per column")
        expect(container.textContent).not.toContain("per beat")
        expect(container.textContent).not.toContain(`= ${tempoOf(480)}`)
      } finally {
        flushSync(() => root.unmount())
        container.remove()
        generator.stop()
      }
    })
  })

  it("lists a hand's items in bar order", function() {
    let item = (hand, startMeasure, endMeasure) => ({hand, startMeasure, endMeasure})
    let items = [item("both", 3, 3), item("upper", 1, 1), item("both", 1, 2), item("both", 1, 1)]
    expect(handItems(items, "both")).toEqual([item("both", 1, 1), item("both", 1, 2), item("both", 3, 3)])
  })
})
