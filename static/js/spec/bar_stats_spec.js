import {itemId} from "st/srs/records"
import {localDay, dayStart, HOUR, DAY} from "st/srs/schedule"
import {barStats} from "st/bar_stats"

// local days start at 4am, so noon is safely inside today's local day
let now = dayStart(localDay(Date.now())) + 8 * HOUR

// built like the trouble-spot spec's helper (difficulty_spec.js), plus id
// (from itemId), attempts, hits, misses, lastPracticed and recent
function item({
  pieceId = "p1", hand = "both", startMeasure, endMeasure, beats,
  reps = 0, lapses = 0, d = 0, paceMs,
  attempts = 0, hits = 0, misses = 0, lastPracticed = 0, recent = [],
} = {}) {
  let fields = {
    pieceId, hand, startMeasure: startMeasure ?? endMeasure, endMeasure: endMeasure ?? startMeasure,
    reps, lapses, d, paceMs, attempts, hits, misses, lastPracticed, recent,
  }
  if (beats) { fields.beats = beats }
  return {...fields, id: itemId(fields)}
}

describe("barStats", function() {
  it("gives no hands and no trouble with no items", () => {
    expect(barStats({pieceId: "p1", measure: 12, items: [], measures: [12], now}))
      .toEqual({measure: 12, hands: [], trouble: null})
  })

  it("reads a keyboard-played bar", () => {
    let both = item({
      startMeasure: 12, attempts: 3, hits: 9, misses: 3, lastPracticed: now,
      recent: [[now - 2, 4, 2, 2], [now - 1, 4, 4, 3], [now, 4, 4, 4]],
    })
    let stats = barStats({pieceId: "p1", measure: 12, items: [both], measures: [12], now})
    expect(stats.hands).toEqual([{
      hand: "both", heading: "Hands together", played: 3, lastPlayed: "today",
      recent: ["Stumbled", "Clean", "Easy"], accuracy: 75,
    }])
  })

  it("reads an acoustic-only bar: no hits or misses, so no accuracy", () => {
    let both = item({
      startMeasure: 12, hits: 0, misses: 0, attempts: 2, lastPracticed: now,
      recent: [[now, null, null, 1], [now, null, null, 3]],
    })
    let stats = barStats({pieceId: "p1", measure: 12, items: [both], measures: [12], now})
    expect(stats.hands[0].accuracy).toEqual(null)
    expect(stats.hands[0].recent).toEqual(["Fell apart", "Clean"])
  })

  it("gives one row per hand with a record, in HANDS order, leaving out an empty one", () => {
    let lower = item({hand: "lower", startMeasure: 12, attempts: 1, lastPracticed: now})
    let both = item({hand: "both", startMeasure: 12, attempts: 1, lastPracticed: now})
    let upper = item({hand: "upper", startMeasure: 12, attempts: 0, recent: []})
    let stats = barStats({pieceId: "p1", measure: 12, items: [lower, both, upper], measures: [12], now})
    expect(stats.hands.map(h => h.hand)).toEqual(["both", "lower"])
    expect(stats.hands.map(h => h.heading)).toEqual(["Hands together", "Left hand"])
  })

  it("ignores another bar, a multi-bar range, a beat range and another piece's bar", () => {
    let items = [
      item({startMeasure: 11, attempts: 2, lastPracticed: now}),
      item({startMeasure: 12, endMeasure: 13, attempts: 2, lastPracticed: now}),
      item({startMeasure: 12, beats: [0, 2], attempts: 2, lastPracticed: now}),
      item({pieceId: "p2", startMeasure: 12, attempts: 2, lastPracticed: now}),
    ]
    let stats = barStats({pieceId: "p1", measure: 12, items, measures: [11, 12, 13], now})
    expect(stats.hands).toEqual([])
  })

  it("words how long ago a bar was last played, local days from 4am", () => {
    let yesterday = item({startMeasure: 12, attempts: 1, lastPracticed: now - DAY})
    expect(barStats({pieceId: "p1", measure: 12, items: [yesterday], measures: [12], now}).hands[0].lastPlayed)
      .toEqual("yesterday")

    let threeDays = item({startMeasure: 12, attempts: 1, lastPracticed: now - 3 * DAY})
    expect(barStats({pieceId: "p1", measure: 12, items: [threeDays], measures: [12], now}).hands[0].lastPlayed)
      .toEqual("3 days ago")
  })

  it("gives no lastPlayed or recent for a legacy-style item, accuracy from its totals", () => {
    let legacy = item({startMeasure: 12, attempts: 1, hits: 2, misses: 2, lastPracticed: 0, recent: []})
    let hand = barStats({pieceId: "p1", measure: 12, items: [legacy], measures: [12], now}).hands[0]
    expect(hand.lastPlayed).toEqual(null)
    expect(hand.recent).toEqual([])
    expect(hand.accuracy).toEqual(50)
  })

  it("gives the trouble-spot sentence troubleSpots gives, for the bar it covers", () => {
    let troubled = item({startMeasure: 12, reps: 3, lapses: 2})
    let stats = barStats({pieceId: "p1", measure: 12, items: [troubled], measures: [11, 12, 13], now})
    expect(stats.trouble).toEqual("Slipped back 2 times.")

    let untroubled = barStats({pieceId: "p1", measure: 13, items: [troubled], measures: [11, 12, 13], now})
    expect(untroubled.trouble).toEqual(null)
  })

  it("gives the same sentence to every bar of a merged trouble spot", () => {
    let a = item({startMeasure: 11, reps: 3, lapses: 2})
    let b = item({startMeasure: 12, reps: 3, lapses: 2})
    let measures = [11, 12, 13]
    let first = barStats({pieceId: "p1", measure: 11, items: [a, b], measures, now})
    let second = barStats({pieceId: "p1", measure: 12, items: [a, b], measures, now})
    expect(first.trouble).not.toEqual(null)
    expect(first.trouble).toEqual(second.trouble)
  })
})
