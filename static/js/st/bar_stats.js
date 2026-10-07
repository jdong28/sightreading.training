// A clicked bar's own practice stats (st/components/sight_reading/bar_stats_plate):
// how often it has been played and when, its last few grades, note
// accuracy, and the "From your playing" trouble sentence (st/difficulty/
// trouble). Synchronous over the cached items, the same single-measure
// records the planner and troubleSpots read; never the async reviews log.
// Both MIDI keyboard and acoustic piano practice write the same item
// fields, so this one reader serves both. Read-only: nothing here writes
// anything.

import {HANDS, itemId} from "st/srs/records"
import {daysAgo} from "st/srs/planner"
import {selfWord} from "st/srs/self_grade"
import {troubleSpots} from "st/difficulty/trouble"

export const HAND_HEADINGS = {both: "Hands together", upper: "Right hand", lower: "Left hand"}

// the rounded percent of hits read, or null with neither (same rule as
// accuracyPercent in sight_reading_page.jsx and st/progress.js's own copy)
function percent(hits, misses) {
  if (!hits && !misses) { return null }
  return Math.round(hits / (hits + misses) * 100)
}

/**
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {number} opts.measure the clicked bar's printed number
 * @param {Object[]} opts.items the piece's items (st/srs/records), any hand
 * setting; a multi-bar range, a beats item or another piece's item is
 * ignored by construction, since lookup is by the single-bar item id
 * @param {number[]} opts.measures the piece's printed bar numbers, in score
 * order (st/song_sections.measureNumberList)
 * @param {number} opts.now
 * @returns {Object} {measure, hands: [{hand, heading, played, lastPlayed,
 * recent, accuracy}], trouble}. hands is in HANDS order, holding only a
 * hand whose single-bar item has attempts or a graded pass
 */
export function barStats({pieceId, measure, items, measures, now}) {
  let hands = HANDS.map(hand => {
    let id = itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})
    let record = items.find(item => item.id == id)
    if (!record || (!record.attempts && !record.recent.length)) { return null }

    return {
      hand,
      heading: HAND_HEADINGS[hand],
      played: record.attempts,
      lastPlayed: record.lastPracticed ? daysAgo(record.lastPracticed, now) : null,
      recent: record.recent.map(entry => selfWord(entry[3])),
      accuracy: percent(record.hits, record.misses),
    }
  }).filter(Boolean)

  let spot = troubleSpots({pieceId, items, measures, flags: []})
    .find(spot => measure >= spot.start && measure <= spot.end)

  return {measure, hands, trouble: spot ? spot.text : null}
}
