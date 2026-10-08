import {itemId} from "st/srs/records"
import {localDay, dayStart, HOUR, DAY} from "st/srs/schedule"
import {daysAgo} from "st/srs/planner"
import {AGAIN, HARD, GOOD, EASY} from "st/srs/grade"
import {barPopup, PIP_COUNT} from "st/bar_stats"

// local days start at 4am, so noon is safely inside today's local day
let now = dayStart(localDay(Date.now())) + 8 * HOUR

const item = (fields={}) => {
  let base = {pieceId: "p", hand: "both", startMeasure: 5, endMeasure: 5, attempts: 1, recent: [], ...fields}
  return {...base, id: itemId(base)}
}
// a detected pass tuple of the given accuracy (columns fixed at 100, so
// clean == accuracy)
const pass = (at, accuracy, grade=GOOD) => [at, 100, accuracy, grade]
const selfPass = (at, grade) => [at, null, null, grade]

const capitalize = words => words.charAt(0).toUpperCase() + words.slice(1)

const flag = (num, start, end, level=3, alsoAt) => ({num, start, end, level, alsoAt})

describe("barPopup", function() {
  it("gives empty, with the New tag, for a bar never played", function() {
    expect(barPopup({pieceId: "p", measure: 5, hand: "both", items: [], now}))
      .toEqual({measure: 5, tag: "New", inPassage: false, empty: true})
  })

  it("gives empty for an item with no attempts", function() {
    let untouched = item({attempts: 0, recent: []})
    let bar = barPopup({pieceId: "p", measure: 5, hand: "both", items: [untouched], now})
    expect(bar.empty).toBe(true)
  })

  it("plots a detected history, latest, best and the day words at its ends", function() {
    let accuracies = [52, 61, 70, 78, 66, 82, 71]
    let history = accuracies.map((acc, idx) => pass(now - (accuracies.length - idx) * DAY, acc))
    let bar = barPopup({
      pieceId: "p", measure: 5, hand: "both",
      items: [item({attempts: accuracies.length, passes: history})],
      now,
    })

    expect(bar.empty).toBe(false)
    expect(bar.latest).toEqual("71%")
    expect(bar.latestWeak).toBe(true)
    expect(bar.best).toEqual("82%")
    expect(bar.chart.points.map(p => p.accuracy)).toEqual(accuracies)
    expect(bar.chart.points.map(p => p.weak)).toEqual([true, true, true, true, true, false, true])
    expect(bar.chart.first).toEqual(capitalize(daysAgo(history[0][0], now)))
    expect(bar.chart.last).toEqual(capitalize(daysAgo(history[history.length - 1][0], now)))
    expect(bar.chart.ariaLabel).toEqual(
      "Accuracy each time played, oldest first: 52%, 61%, 70%, 78%, 66%, 82%, 71%. Target 100%.")
    // none of these passes was clean, so nothing is streaking
    expect(bar.streak).toEqual({count: 0, label: "0 of 3 clean passes in a row"})
  })

  it("counts a clean run at the end of the history, capped at 3 pips, as Learned", function() {
    expect(PIP_COUNT).toEqual(3)

    let two = item({attempts: 3, passes: [pass(now - 2 * DAY, 60), pass(now - DAY, 100), pass(now, 100)]})
    let twoBar = barPopup({pieceId: "p", measure: 5, hand: "both", items: [two], now})
    expect(twoBar.streak).toEqual({count: 2, label: "2 of 3 clean passes in a row"})

    let three = item({attempts: 3, passes: [pass(now - 2 * DAY, 100), pass(now - DAY, 100), pass(now, 100)]})
    let threeBar = barPopup({pieceId: "p", measure: 5, hand: "both", items: [three], now})
    expect(threeBar.streak).toEqual({count: 3, label: "Learned"})
  })

  it("plots only the last 8 entries of a longer history", function() {
    let history = Array.from({length: 10}, (_, idx) => pass(now - (9 - idx) * DAY, 90))
    let bar = barPopup({pieceId: "p", measure: 5, hand: "both", items: [item({attempts: 10, passes: history})], now})
    expect(bar.chart.points.length).toEqual(8)
    expect(bar.chart.first).toEqual(capitalize(daysAgo(history[2][0], now)))
  })

  it("says No passes yet for an item with attempts but no full pass recorded", function() {
    let practiceOnly = item({attempts: 2, recent: [], passes: []})
    let bar = barPopup({pieceId: "p", measure: 5, hand: "both", items: [practiceOnly], now})
    expect(bar.empty).toBe(false)
    expect(bar.noPasses).toBe(true)
    expect(bar.chart).toBeUndefined()
  })

  it("lists self-graded passes as words, with no percentage for them", function() {
    let selfOnly = item({attempts: 3, passes: [selfPass(now - 2 * DAY, AGAIN), selfPass(now - DAY, GOOD), selfPass(now, EASY)]})
    let bar = barPopup({pieceId: "p", measure: 5, hand: "both", items: [selfOnly], now})

    expect(bar.chart).toBeUndefined()
    expect(bar.latest).toEqual("Easy")
    expect(bar.best).toEqual("Easy")
    expect(bar.selfLine).toEqual("Graded by ear: Fell apart → Clean → Easy")
    // Clean and Easy count as clean passes, Fell apart doesn't
    expect(bar.streak.count).toEqual(2)
  })

  it("shows a self line under the chart for a history mixing detected and self passes", function() {
    let mixed = item({attempts: 2, passes: [pass(now - DAY, 90), selfPass(now, HARD)]})
    let bar = barPopup({pieceId: "p", measure: 5, hand: "both", items: [mixed], now})

    expect(bar.chart.points.map(p => p.accuracy)).toEqual([90])
    expect(bar.latest).toEqual("90%")
    expect(bar.selfLine).toEqual("Graded by ear: Stumbled")
  })

  it("tags a bar in a flag in force, including a repeat at alsoAt", function() {
    let flags = [flag(1, 5, 9, 3)]
    expect(barPopup({pieceId: "p", measure: 5, hand: "both", items: [], flags, now}).tag)
      .toEqual("Passage I · Hardest")
    expect(barPopup({pieceId: "p", measure: 5, hand: "both", items: [], flags, now}).inPassage).toBe(true)

    let withRepeat = [flag(2, 5, 6, 2, [[20, 21]])]
    expect(barPopup({pieceId: "p", measure: 20, hand: "both", items: [], flags: withRepeat, now}).tag)
      .toEqual("Passage II · Hard")

    // outside the flag and its repeat: Learned/Learning/New instead
    expect(barPopup({pieceId: "p", measure: 10, hand: "both", items: [], flags, now}).tag).toEqual("New")
  })

  it("tags a played bar Learning, and a learned one Learned, outside any flag", function() {
    let started = item({attempts: 1, passes: [pass(now, 50)]})
    expect(barPopup({pieceId: "p", measure: 5, hand: "both", items: [started], now}).tag).toEqual("Learning")

    let learned = item({attempts: 3, passes: [pass(now - 2 * DAY, 100), pass(now - DAY, 100), pass(now, 100)]})
    expect(barPopup({pieceId: "p", measure: 5, hand: "both", items: [learned], now}).tag).toEqual("Learned")
  })

  it("reads only the requested hand's item", function() {
    let upper = item({hand: "upper", attempts: 3, passes: [pass(now, 100)]})
    let both = barPopup({pieceId: "p", measure: 5, hand: "both", items: [upper], now})
    expect(both.empty).toBe(true)

    let right = barPopup({pieceId: "p", measure: 5, hand: "upper", items: [upper], now})
    expect(right.empty).toBe(false)
  })
})
