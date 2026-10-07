// Pure geometry for the trainer's score card: which printed bar a click
// lands on. Reads the measures every engine already returns (CardResult.
// measures), the same boxes card_shade.ts shades the overview with, in the
// drawn svg's own natural pixels. Lives in the app bundle, like card_shade/
// card_join/card_scroll, never the engines bundle.

import type {CardMeasure} from "./types"

// how many box-heights above or below a system a click still counts
// towards it (picks up a stem or ledger line sticking out of the staff)
export const ROW_SLACK = 1

export function barAt(measures: CardMeasure[], x: number, y: number): number | null {
  let best: {measure: CardMeasure, distance: number} | null = null

  for (const measure of measures) {
    const {box} = measure
    if (x < box.x || x > box.x + box.width) { continue }

    const distance = y < box.y ? box.y - y :
      y > box.y + box.height ? y - (box.y + box.height) : 0
    if (distance > ROW_SLACK * box.height) { continue }

    if (!best || distance < best.distance) {
      best = {measure, distance}
    }
  }

  return best ? best.measure.number : null
}
