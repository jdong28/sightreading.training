import {barStats, HAND_HEADINGS} from "st/bar_stats"
import {itemId, newItem} from "st/srs/records"
import {localDay, dayStart, HOUR, DAY} from "st/srs/schedule"

describe("barStats", function() {
  let now = dayStart(localDay(Date.now())) + 8 * HOUR // noon, local days start at 4am
  let pieceId = "p1"
  let measures = Array.from({length: 20}, (_, idx) => idx + 1)

  // a stored item of the shape barStats reads, defaults matching newItem's
  // untouched record plus the fields a practised item carries
  let item = ({
    measure, hand = "both", attempts = 0, hits = 0, misses = 0, lastPracticed = 0, recent = [],
    reps = 0, lapses = 0, startMeasure, endMeasure, beats, pieceId: forPiece = pieceId,
  } = {}) => {
    let start = startMeasure ?? measure
    let end = endMeasure ?? measure
    let fields = {pieceId: forPiece, hand, startMeasure: start, endMeasure: end, ...(beats ? {beats} : {})}
    return {
      ...newItem(fields),
      id: itemId(fields),
      attempts, hits, misses, lastPracticed, recent, reps, lapses,
    }
  }

  it("gives empty hands and no trouble with no items", function() {
    expect(barStats({pieceId, measure: 12, items: [], measures, now}))
      .toEqual({measure: 12, hands: [], trouble: null})
  })

  it("reads a keyboard-played bar's totals, recent grades (oldest first) and accuracy", function() {
    let played = item({
      measure: 12, attempts: 3, hits: 9, misses: 3, lastPracticed: now,
      recent: [[now - 2, 4, 2, 2], [now - 1, 4, 4, 3], [now, 4, 4, 4]],
    })
    let result = barStats({pieceId, measure: 12, items: [played], measures, now})
    expect(result.hands).toEqual([{
      hand: "both", heading: "Hands together", played: 3, lastPlayed: "today",
      recent: ["Stumbled", "Clean", "Easy"], accuracy: 75,
    }])
  })

  it("reads an acoustic-only bar: no accuracy, self-graded recent words", function() {
    let selfGraded = item({
      measure: 12, attempts: 2, hits: 0, misses: 0,
      recent: [[now, null, null, 1], [now, null, null, 3]],
    })
    let result = barStats({pieceId, measure: 12, items: [selfGraded], measures, now})
    expect(result.hands[0].accuracy).toEqual(null)
    expect(result.hands[0].recent).toEqual(["Fell apart", "Clean"])
  })

  it("gives one row per hand with a record, leaving out an empty hand", function() {
    let lower = item({measure: 12, hand: "lower", attempts: 1})
    let both = item({measure: 12, hand: "both", attempts: 1})
    let upper = item({measure: 12, hand: "upper", attempts: 0, recent: []})
    let result = barStats({pieceId, measure: 12, items: [lower, both, upper], measures, now})
    expect(result.hands.map(h => h.hand)).toEqual(["both", "lower"])
    expect(result.hands.map(h => h.heading)).toEqual(["Hands together", "Left hand"])
  })

  it("ignores another bar, a multi-bar range, a beats item, and another piece", function() {
    let otherBar = item({measure: 11, attempts: 3})
    let range = item({measure: 12, startMeasure: 12, endMeasure: 13, attempts: 3})
    let beatsItem = item({measure: 12, beats: [0, 2], attempts: 3})
    let otherPiece = item({measure: 12, pieceId: "p2", attempts: 3})
    let result = barStats({
      pieceId, measure: 12, items: [otherBar, range, beatsItem, otherPiece], measures, now,
    })
    expect(result.hands).toEqual([])
  })

  it("reads lastPlayed in days, and a legacy item with no lastPracticed", function() {
    let yesterday = item({measure: 1, attempts: 1, lastPracticed: now - DAY})
    expect(barStats({pieceId, measure: 1, items: [yesterday], measures, now}).hands[0].lastPlayed)
      .toEqual("yesterday")

    let threeDays = item({measure: 2, attempts: 1, lastPracticed: now - 3 * DAY})
    expect(barStats({pieceId, measure: 2, items: [threeDays], measures, now}).hands[0].lastPlayed)
      .toEqual("3 days ago")

    let legacy = item({measure: 3, attempts: 1, hits: 2, misses: 0, lastPracticed: 0, recent: []})
    let result = barStats({pieceId, measure: 3, items: [legacy], measures, now}).hands[0]
    expect(result.lastPlayed).toEqual(null)
    expect(result.recent).toEqual([])
    expect(result.accuracy).toEqual(100)
  })

  it("gives the trouble sentence troubleSpots would give, and null for an untroubled bar beside one", function() {
    let troubled = item({measure: 12, hand: "both", attempts: 3, reps: 3, lapses: 2})
    let result = barStats({pieceId, measure: 12, items: [troubled], measures, now})
    expect(result.trouble).toEqual("Slipped back 2 times.")

    let clean = barStats({pieceId, measure: 13, items: [troubled], measures, now})
    expect(clean.trouble).toEqual(null)
  })

  it("gives the same sentence to two adjacent troubled bars that merge into one spot", function() {
    let a = item({measure: 11, hand: "both", attempts: 3, reps: 3, lapses: 2})
    let b = item({measure: 12, hand: "both", attempts: 3, reps: 3, lapses: 2})
    let atA = barStats({pieceId, measure: 11, items: [a, b], measures, now})
    let atB = barStats({pieceId, measure: 12, items: [a, b], measures, now})
    expect(atA.trouble).toEqual(atB.trouble)
    expect(atA.trouble).not.toEqual(null)
  })

  it("exports HAND_HEADINGS matching the plate's row headings", function() {
    expect(HAND_HEADINGS).toEqual({both: "Hands together", upper: "Right hand", lower: "Left hand"})
  })
})
