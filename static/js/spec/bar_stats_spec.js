import {itemId} from "st/srs/records"
import {localDay, dayStart, HOUR, DAY} from "st/srs/schedule"
import {barPopup} from "st/bar_stats"
import {HARD, GOOD, EASY} from "st/srs/grade"

// local days start at 4am, so noon is safely inside today's local day
let now = dayStart(localDay(Date.now())) + 8 * HOUR

// built like the trouble-spot spec's helper (difficulty_spec.js), plus id
// (from itemId), attempts, hits, misses, lastPracticed and recent
function item({
  pieceId = "p1", hand = "both", startMeasure, endMeasure, beats,
  reps = 0, lapses = 0, d = 0, paceMs,
  attempts = 0, hits = 0, misses = 0, lastPracticed = 0, recent = [], passes,
} = {}) {
  let fields = {
    pieceId, hand, startMeasure: startMeasure ?? endMeasure, endMeasure: endMeasure ?? startMeasure,
    reps, lapses, d, paceMs, attempts, hits, misses, lastPracticed, recent,
  }
  if (beats) { fields.beats = beats }
  if (passes) { fields.passes = passes }
  return {...fields, id: itemId(fields)}
}

describe("barPopup", function() {
  let flag = (num, level, start, end, alsoAt) => ({num, level, start, end, ...(alsoAt ? {alsoAt} : {})})

  it("gives an empty bar with no item or no attempts, tagged New", function() {
    expect(barPopup({pieceId: "p1", measure: 12, hand: "both", items: [], flags: [], now})).toEqual({
      measure: 12, empty: true, tag: {text: "New", variant: "new"}, played: 0,
      latest: null, best: null, chart: null, selfWords: null, noFullPass: false,
      streak: {filled: 0, label: "0 of 3 clean passes in a row", ariaLabel: "0 of 3 clean passes in a row"},
    })

    let unplayed = item({startMeasure: 12, attempts: 0, passes: []})
    expect(barPopup({pieceId: "p1", measure: 12, hand: "both", items: [unplayed], flags: [], now}).empty).toBe(true)
  })

  it("plots a history of accuracies, latest, best, day words, and the streak", function() {
    let at = i => now - (6 - i) * DAY
    let pcts = [52, 61, 70, 78, 66, 82, 71]
    let history = pcts.map((pct, i) => [at(i), 100, pct, GOOD])
    let played = item({startMeasure: 12, attempts: 7, passes: history})

    let popup = barPopup({pieceId: "p1", measure: 12, hand: "both", items: [played], flags: [], now})
    expect(popup.empty).toBe(false)
    expect(popup.latest).toEqual({text: "71%", oxblood: true})
    expect(popup.best).toEqual({text: "82%"})
    expect(popup.chart.points.map(p => p.pct)).toEqual(pcts)
    expect(popup.chart.firstDay).toEqual("6 days ago")
    expect(popup.chart.lastDay).toEqual("Today")
    expect(popup.selfWords).toEqual(null)
  })

  it("words the streak: 2 of 3 clean in a row, then Learned at 3, tagged Learned", function() {
    let clean = at => [at, 4, 4, GOOD]
    let two = item({startMeasure: 12, attempts: 2, passes: [clean(1), clean(2)]})
    expect(barPopup({pieceId: "p1", measure: 12, hand: "both", items: [two], flags: [], now}).streak.label)
      .toEqual("2 of 3 clean passes in a row")

    let three = item({startMeasure: 12, attempts: 3, passes: [clean(1), clean(2), clean(3)]})
    let popup = barPopup({pieceId: "p1", measure: 12, hand: "both", items: [three], flags: [], now})
    expect(popup.streak.label).toEqual("Learned")
    expect(popup.tag).toEqual({text: "Learned", variant: "learned"})
  })

  it("plots only the last 8 of a longer history", function() {
    let history = Array.from({length: 10}, (_, i) => [i, 4, i % 2 == 0 ? 4 : 3, GOOD])
    let played = item({startMeasure: 12, attempts: 10, passes: history})
    let popup = barPopup({pieceId: "p1", measure: 12, hand: "both", items: [played], flags: [], now})
    expect(popup.chart.points.length).toEqual(8)
  })

  it("gives self-graded words instead of a chart, with no percentage", function() {
    let selfHistory = [[now - 2, null, null, HARD], [now - 1, null, null, GOOD], [now, null, null, EASY]]
    let played = item({startMeasure: 12, attempts: 3, passes: selfHistory})
    let popup = barPopup({pieceId: "p1", measure: 12, hand: "both", items: [played], flags: [], now})
    expect(popup.chart).toEqual(null)
    expect(popup.selfWords).toEqual("Graded by ear: Stumbled → Clean → Easy")
    expect(popup.latest).toEqual({text: "Easy", oxblood: false})
    expect(popup.best).toEqual({text: "Easy"})
  })

  it("gives no full pass recorded when the item has attempts but no history", function() {
    let legacy = item({startMeasure: 12, attempts: 1, hits: 2, misses: 2, passes: []})
    let popup = barPopup({pieceId: "p1", measure: 12, hand: "both", items: [legacy], flags: [], now})
    expect(popup.noFullPass).toBe(true)
    expect(popup.latest).toEqual(null)
  })

  it("tags a bar inside a flag in force, including one reached only through alsoAt", function() {
    let f = flag(1, 3, 5, 9)
    let popup = barPopup({pieceId: "p1", measure: 7, hand: "both", items: [], flags: [f], now})
    expect(popup.tag).toEqual({text: "Passage I · Hardest", variant: "passage"})

    let alsoAtFlag = flag(2, 2, 20, 22, [[7, 7]])
    let popup2 = barPopup({pieceId: "p1", measure: 7, hand: "both", items: [], flags: [alsoAtFlag], now})
    expect(popup2.tag).toEqual({text: "Passage II · Hard", variant: "passage"})
  })

  it("reads only the requested hand's item", function() {
    let upper = item({hand: "upper", startMeasure: 12, attempts: 1, passes: [[now, 4, 4, GOOD]]})
    let popupBoth = barPopup({pieceId: "p1", measure: 12, hand: "both", items: [upper], flags: [], now})
    expect(popupBoth.empty).toBe(true)

    let popupUpper = barPopup({pieceId: "p1", measure: 12, hand: "upper", items: [upper], flags: [], now})
    expect(popupUpper.empty).toBe(false)
  })
})
