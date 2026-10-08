// Pure geometry for a clicked bar (st/components/score_card's onBar): which
// printed bar, if any, a point of a drawn card falls on. Reads the measures
// every engine already returns (CardResult.measures), the same boxes
// card_shade.ts uses to shade the overview, so they are already trusted.
// Lives in the app bundle, like card_join/card_shade, never the engines
// bundle: it only reads what an engine's CardResult already reported.

import type {CardMeasure} from "./types"

// how many box heights above or below a system's band a point may still
// fall and pick that system's bar, so ledger lines and stems above or below
// it still hit it
export const ROW_SLACK = 1

// barAt(measures, x, y): the printed bar number of the measure box the
// point is nearest, in the svg's own CSS pixels (see naturalSize in
// score_card.jsx). A point must sit within a box's x range and within
// ROW_SLACK box heights of its y range to be a candidate; among candidates
// the nearest wins, the first in array order on a tie (a shared barline
// belongs to the bar on its left). null with no candidate.
export function barAt(measures: CardMeasure[], x: number, y: number): number | null {
  let best: {number: number, distance: number} | null = null

  for (const measure of measures) {
    const {box} = measure
    if (x < box.x || x > box.x + box.width) { continue }

    const distance = y < box.y ? box.y - y : y > box.y + box.height ? y - (box.y + box.height) : 0
    if (distance > ROW_SLACK * box.height) { continue }

    if (!best || distance < best.distance) {
      best = {number: measure.number, distance}
    }
  }

  return best ? best.number : null
}
