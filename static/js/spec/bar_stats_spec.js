import {itemId} from "st/srs/records"
import {localDay, dayStart, HOUR, DAY} from "st/srs/schedule"
import {troubleSpots} from "st/difficulty/trouble"
import {barStats} from "st/bar_stats"

describe("barStats", function() {
  // local days start at 4am, so this is noon
  let now = dayStart(localDay(Date.now())) + 8 * HOUR

  // built like the trouble-spot spec's helper (difficulty_spec.js), plus
  // id (from itemId), attempts, hits, misses, lastPracticed and recent
  let item = ({
    measure, hand = "both", pieceId = "p1", attempts = 0, hits = 0, misses = 0,
    lastPracticed = 0, recent = [], reps = 0, lapses = 0, d = 0, paceMs,
    startMeasure = measure, endMeasure = measure, beats,
  } = {}) => ({
    id: itemId({pieceId, hand, startMeasure, endMeasure, beats}),
    pieceId, hand, startMeasure, endMeasure, beats,
    attempts, hits, misses, lastPracticed, recent, reps, lapses, d, paceMs,
  })

  let measures = Array.from({length: 20}, (_, idx) => idx + 1)

  it("gives no hands and no trouble with no items", function() {
    expect(barStats({pieceId: "p1", measure: 12, items: [], measures, now}))
      .toEqual({measure: 12, hands: [], trouble: null})
  })

  it("reads a keyboard-played bar's totals, grades and accuracy", function() {
    let items = [item({
      measure: 12, attempts: 3, hits: 9, misses: 3, lastPracticed: now,
      recent: [[now - 2, 4, 2, 2], [now - 1, 4, 4, 3], [now, 4, 4, 4]],
    })]

    let {hands} = barStats({pieceId: "p1", measure: 12, items, measures, now})
    expect(hands).toEqual([{
      hand: "both", heading: "Hands together", played: 3, lastPlayed: "today",
      recent: ["Stumbled", "Clean", "Easy"], accuracy: 75,
    }])
  })

  it("reads an acoustic-only bar's grades, with no accuracy counted", function() {
    let items = [item({
      measure: 12, attempts: 2, hits: 0, misses: 0, lastPracticed: now,
      recent: [[now, null, null, 1], [now, null, null, 3]],
    })]

    let {hands} = barStats({pieceId: "p1", measure: 12, items, measures, now})
    expect(hands[0].accuracy).toBe(null)
    expect(hands[0].recent).toEqual(["Fell apart", "Clean"])
  })

  it("gives one row per hand with a record, in HANDS order, leaving an empty hand out", function() {
    let items = [
      item({measure: 12, hand: "lower", attempts: 2, hits: 4, misses: 0, lastPracticed: now}),
      item({measure: 12, hand: "both", attempts: 1, hits: 2, misses: 0, lastPracticed: now}),
      item({measure: 12, hand: "upper", attempts: 0, recent: []}),
    ]

    let {hands} = barStats({pieceId: "p1", measure: 12, items, measures, now})
    expect(hands.map(h => h.hand)).toEqual(["both", "lower"])
    expect(hands.map(h => h.heading)).toEqual(["Hands together", "Left hand"])
  })

  it("ignores a range item, a beats item, another bar and another piece's item", function() {
    let items = [
      item({measure: 11, attempts: 4, hits: 4, lastPracticed: now}),
      item({startMeasure: 12, endMeasure: 13, attempts: 4, hits: 4, lastPracticed: now}),
      item({measure: 12, beats: [0, 2], attempts: 4, hits: 4, lastPracticed: now}),
      item({measure: 12, pieceId: "p2", attempts: 4, hits: 4, lastPracticed: now}),
    ]

    expect(barStats({pieceId: "p1", measure: 12, items, measures, now}).hands).toEqual([])
  })

  it("gives the day words from lastPracticed, and null with none (a legacy-style item)", function() {
    let yesterday = barStats({
      pieceId: "p1", measure: 12, measures, now,
      items: [item({measure: 12, attempts: 1, hits: 1, lastPracticed: now - DAY})],
    })
    expect(yesterday.hands[0].lastPlayed).toEqual("yesterday")

    let threeDays = barStats({
      pieceId: "p1", measure: 12, measures, now,
      items: [item({measure: 12, attempts: 1, hits: 1, lastPracticed: now - 3 * DAY})],
    })
    expect(threeDays.hands[0].lastPlayed).toEqual("3 days ago")

    let legacy = barStats({
      pieceId: "p1", measure: 12, measures, now,
      items: [item({measure: 12, attempts: 1, hits: 3, misses: 1, lastPracticed: 0})],
    })
    expect(legacy.hands[0]).toEqual({
      hand: "both", heading: "Hands together", played: 1, lastPlayed: null, recent: [], accuracy: 75,
    })
  })

  it("gives the trouble-spot sentence a troubled bar's own stats earn, and null off it", function() {
    let troubled = item({measure: 12, reps: 3, lapses: 2})
    let [spot] = troubleSpots({pieceId: "p1", items: [troubled], measures})
    expect(spot.text).toEqual("Slipped back 2 times.")

    expect(barStats({pieceId: "p1", measure: 12, items: [troubled], measures, now}).trouble)
      .toEqual(spot.text)
    expect(barStats({pieceId: "p1", measure: 13, items: [troubled], measures, now}).trouble)
      .toBe(null)

    let items = [item({measure: 11, reps: 3, lapses: 2}), item({measure: 12, reps: 3, lapses: 2})]
    let eleven = barStats({pieceId: "p1", measure: 11, items, measures, now}).trouble
    let twelve = barStats({pieceId: "p1", measure: 12, items, measures, now}).trouble
    expect(eleven).toEqual(twelve)
    expect(eleven).toBeTruthy()
  })
})
