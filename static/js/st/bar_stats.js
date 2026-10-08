// A clicked bar's own playing stats (the roadmap's "click a bar, see how
// you're doing on it"): a pure reader over the cached items, the same
// single-measure records the planner and st/difficulty/trouble read. Serves
// both instrument settings alike, since a keyboard pass and a self-graded
// one write the same item fields; a self-graded attempt simply adds no hits
// or misses. Never reads the async reviews store, and never writes
// anything.

import {HANDS, itemId} from "st/srs/records"
import {daysAgo} from "st/srs/planner"
import {selfWord} from "st/srs/self_grade"
import {troubleSpots} from "st/difficulty/trouble"

export const HAND_HEADINGS = {both: "Hands together", upper: "Right hand", lower: "Left hand"}

// the rounded percent of hits read, or null with neither (same rule as
// accuracyPercent in sight_reading_page.jsx, kept private here too)
function percent(hits, misses) {
  if (!hits && !misses) { return null }
  return Math.round(hits / (hits + misses) * 100)
}

/**
 * A clicked bar's stats, one row per hand with a record, for the trainer's
 * right rail (st/components/sight_reading/bar_stats_plate).
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {number} opts.measure the printed bar number clicked
 * @param {Object[]} opts.items the piece's items (st/srs/records), any hand
 * @param {number[]} opts.measures the piece's printed bar numbers, in score
 * order (st/song_sections.measureNumberList)
 * @param {number} opts.now
 * @returns {{measure: number, hands: Object[], trouble: string|null}}
 */
export function barStats({pieceId, measure, items = [], measures = [], now}) {
  let hands = HANDS.map(hand => {
    let id = itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})
    let item = items.find(i => i.id == id)
    if (!item || !(item.attempts > 0 || (item.recent || []).length > 0)) { return null }

    return {
      hand,
      heading: HAND_HEADINGS[hand],
      played: item.attempts,
      lastPlayed: item.lastPracticed ? daysAgo(item.lastPracticed, now) : null,
      recent: (item.recent || []).map(([, , , grade]) => selfWord(grade)),
      accuracy: percent(item.hits, item.misses),
    }
  }).filter(Boolean)

  let spots = troubleSpots({pieceId, items, measures, flags: []})
  let spot = spots.find(s => s.start <= measure && s.end >= measure)

  return {measure, hands, trouble: spot ? spot.text : null}
}
