// Pure geometry for a clicked bar (st/bar_stats): finds the printed bar
// number of a point over a ScoreCard's drawn measures. Lives in the app
// bundle, like card_shade/card_join, never the engines bundle: it only
// reads the measures an engine's CardResult already reported, the same
// boxes card_shade uses to shade the overview.

import type {CardMeasure} from "./types"

// how many box heights above or below a system a point may fall and still
// pick its bar, so a stem or ledger line above or below the staff still
// hits
export const ROW_SLACK = 1

// barAt(measures, x, y): the printed number of the measure box the point
// (x, y) is nearest, in the svg's own natural pixels (the same units
// CardMeasure boxes are measured in). A candidate's box must contain x;
// its vertical distance is 0 inside the box's own y span, else the gap to
// it, and it is dropped past ROW_SLACK box heights of that gap. The
// nearest candidate wins, the first in array order on a tie (a shared
// barline belongs to the bar on its left), else null.
export function barAt(measures: CardMeasure[], x: number, y: number): number | null {
  let best: CardMeasure | null = null
  let bestDistance = Infinity

  for (const measure of measures) {
    const {box} = measure
    if (x < box.x || x > box.x + box.width) { continue }

    const distance = y < box.y ? box.y - y : y > box.y + box.height ? y - (box.y + box.height) : 0
    if (distance > ROW_SLACK * box.height) { continue }

    if (distance < bestDistance) {
      best = measure
      bestDistance = distance
    }
  }

  return best ? best.number : null
}
