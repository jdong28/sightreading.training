// A clicked bar's own practice stats, read synchronously over the cached
// items (like st/difficulty/trouble and the planner): how often and when it
// was played, its last few grades and note accuracy, and the "From your
// playing" trouble sentence troubleSpots already computes. Never reads the
// async reviews store; writes nothing.

import {HANDS, itemId} from "st/srs/records"
import {daysAgo} from "st/srs/planner"
import {selfWord} from "st/srs/self_grade"
import {troubleSpots} from "st/difficulty/trouble"

export const HAND_HEADINGS = {both: "Hands together", upper: "Right hand", lower: "Left hand"}

// the rounded percent of hits read, or null with neither (same rule as
// accuracyPercent in sight_reading_page.jsx, kept private here too, like
// st/progress.js's own copy)
function percent(hits, misses) {
  if (!hits && !misses) { return null }
  return Math.round(hits / (hits + misses) * 100)
}

/**
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {number} opts.measure the clicked printed bar number
 * @param {Object[]} opts.items the piece's cached items (st/srs/records)
 * @param {number[]} opts.measures the piece's printed bar numbers, in score
 * order (st/song_sections.measureNumberList)
 * @param {number} opts.now
 * @returns {{measure: number, hands: Object[], trouble: string|null}}
 */
export function barStats({pieceId, measure, items, measures, now}) {
  let hands = []
  for (let hand of HANDS) {
    let id = itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})
    let item = items.find(i => i.id == id)
    if (!item || !(item.attempts > 0 || (item.recent || []).length > 0)) { continue }

    hands.push({
      hand,
      heading: HAND_HEADINGS[hand],
      played: item.attempts,
      lastPlayed: item.lastPracticed ? daysAgo(item.lastPracticed, now) : null,
      recent: (item.recent || []).map(([, , , grade]) => selfWord(grade)),
      accuracy: percent(item.hits, item.misses),
    })
  }

  let spots = troubleSpots({pieceId, items, measures, flags: []})
  let spot = spots.find(s => s.start <= measure && measure <= s.end)

  return {measure, hands, trouble: spot ? spot.text : null}
}
