import {barPopup} from "st/bar_stats"
import {itemId} from "st/srs/records"
import {localDay, dayStart, HOUR, DAY} from "st/srs/schedule"

// local days start at 4am, so noon is safely inside today's local day
let now = dayStart(localDay(Date.now())) + 8 * HOUR

function item({pieceId="p1", hand="both", measure=12, attempts=0, passes=[]}={}) {
  let fields = {pieceId, hand, startMeasure: measure, endMeasure: measure}
  return {...fields, id: itemId(fields), attempts, passes}
}

// a flag in force (st/difficulty/records.flagsInForce)
function flag({num=1, level=3, start=5, end=9, alsoAt}={}) {
  return {num, level, start, end, title: "Hardest", alsoAt}
}

describe("barPopup", function() {
  it("is empty without an item or with no attempts", function() {
    expect(barPopup({pieceId: "p1", measure: 12, hand: "both", items: [], now}).state).toEqual("empty")

    let unplayed = item({measure: 12, attempts: 0})
    expect(barPopup({pieceId: "p1", measure: 12, hand: "both", items: [unplayed], now}).state).toEqual("empty")
  })

  it("gives the empty bar's notice and a New tag", function() {
    let popup = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [], now})
    expect(popup.notice).toEqual("No practice recorded for bar 5 yet.")
    expect(popup.tag).toEqual({text: "New", variant: "muted"})
    expect(popup.streak).toEqual({filled: 0, label: "0 of 3 clean passes in a row", ariaLabel: "0 of 3 clean passes in a row"})
  })

  it("gives latest, best, the chart and day labels from a detected history", function() {
    let at = (n) => now - (6 - n) * DAY
    let passes = [52, 61, 70, 78, 66, 82, 71].map((pct, idx) => [at(idx), 100, pct, 3])
    let bar = item({measure: 5, attempts: 7, passes})
    let popup = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [bar], now})

    expect(popup.state).toEqual("played")
    expect(popup.played).toEqual(7)
    expect(popup.figures.latest).toEqual({value: 71, trouble: true})
    expect(popup.figures.best).toEqual({value: 82, trouble: false})
    expect(popup.chart.values.map(v => v.value)).toEqual([52, 61, 70, 78, 66, 82, 71])
    expect(popup.chart.firstLabel).toEqual("6 days ago")
    expect(popup.chart.lastLabel).toEqual("Today")
    expect(popup.selfLine).toBeNull()
  })

  it("plots only the last 8 entries", function() {
    let passes = Array.from({length: 10}, (_, i) => [now - (9 - i) * DAY, 4, 4, 3])
    let bar = item({measure: 5, attempts: 10, passes})
    let popup = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [bar], now})
    expect(popup.chart.values.length).toEqual(8)
  })

  it("gives no full pass notice when the item has attempts but no history", function() {
    let bar = item({measure: 5, attempts: 2, passes: []})
    let popup = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [bar], now})
    expect(popup.state).toEqual("no-passes")
    expect(popup.notice).toEqual("No full pass through bar 5 recorded yet.")
    expect(popup.played).toEqual(2)
  })

  it("reads self passes as grade words, with no percentage, and no chart without a detected entry", function() {
    let passes = [[now - 2 * DAY, null, null, 2], [now - DAY, null, null, 3], [now, null, null, 4]]
    let bar = item({measure: 5, attempts: 3, passes})
    let popup = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [bar], now})

    expect(popup.chart).toBeNull()
    expect(popup.selfLine).toEqual("Graded by ear: Stumbled → Clean → Easy")
    expect(popup.figures.latest).toEqual({word: "Easy"})
    expect(popup.figures.best).toEqual({word: "Easy"})
  })

  it("shows the self line under the chart when both kinds are in the window", function() {
    let passes = [[now - 2 * DAY, 4, 4, 3], [now - DAY, null, null, 1]]
    let bar = item({measure: 5, attempts: 2, passes})
    let popup = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [bar], now})

    expect(popup.chart).not.toBeNull()
    expect(popup.selfLine).toEqual("Graded by ear: Fell apart")
  })

  it("gives the streak's clean run, 'Learned' at 3, and the exact count in its aria-label", function() {
    let twoClean = item({measure: 5, attempts: 2, passes: [[1, 4, 4, 3], [2, 4, 4, 3]]})
    let popup = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [twoClean], now})
    expect(popup.streak.label).toEqual("2 of 3 clean passes in a row")
    expect(popup.streak.ariaLabel).toEqual("2 of 3 clean passes in a row")
    expect(popup.tag).toEqual({text: "Learning", variant: "muted"})

    let threeClean = item({measure: 5, attempts: 3, passes: [[1, 4, 4, 3], [2, 4, 4, 3], [3, 4, 4, 3]]})
    let learned = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [threeClean], now})
    expect(learned.streak.label).toEqual("Learned")
    expect(learned.streak.ariaLabel).toEqual("3 of 3 clean passes in a row")
    expect(learned.tag).toEqual({text: "Learned", variant: "muted"})
  })

  it("tags a bar inside a flag in force, including an alsoAt recurrence, over its learnedness", function() {
    let bar = item({measure: 5, attempts: 3, passes: [[1, 4, 4, 3], [2, 4, 4, 3], [3, 4, 4, 3]]})
    let inRange = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [bar], flags: [flag({start: 5, end: 9})], now})
    expect(inRange.tag).toEqual({text: "Passage I · Hardest", variant: "flag"})

    let recurrence = barPopup({
      pieceId: "p1", measure: 20, hand: "both", items: [{...bar, startMeasure: 20, endMeasure: 20, id: itemId({pieceId: "p1", hand: "both", startMeasure: 20, endMeasure: 20})}],
      flags: [flag({start: 5, end: 9, alsoAt: [[20, 20]]})], now,
    })
    expect(recurrence.tag).toEqual({text: "Passage I · Hardest", variant: "flag"})

    let outside = barPopup({pieceId: "p1", measure: 30, hand: "both", items: [], flags: [flag({start: 5, end: 9})], now})
    expect(outside.tag.text).toEqual("New")
  })

  it("reads only the requested hand's item", function() {
    let lower = item({measure: 5, hand: "lower", attempts: 2, passes: [[1, 4, 4, 3]]})
    let both = barPopup({pieceId: "p1", measure: 5, hand: "both", items: [lower], now})
    expect(both.state).toEqual("empty")

    let read = barPopup({pieceId: "p1", measure: 5, hand: "lower", items: [lower], now})
    expect(read.state).toEqual("played")
  })
})
