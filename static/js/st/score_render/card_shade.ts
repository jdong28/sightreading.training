// Pure geometry for the passages view's shaded overview (st/difficulty):
// turns a flagged range of printed bars into the bands a ScoreCard draws
// over its engraving, one per system the range crosses. Lives in the app
// bundle, like card_join/card_scroll, never the engines bundle: it only
// reads the measures an engine's CardResult already reported.

import type {CardMeasure, CardBox} from "./types"

export interface Shade {
  id: string
  // printed bar numbers, inclusive
  from: number
  to: number
  level: 1 | 2 | 3
  on: boolean
  label: string
}

export interface ShadeBand {
  id: string
  level: 1 | 2 | 3
  on: boolean
  // only the first band of a shade carries its label
  label: string | null
  box: CardBox
}

function union(boxes: CardBox[]): CardBox {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const box of boxes) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.width)
    bottom = Math.max(bottom, box.y + box.height)
  }
  return {x: left, y: top, width: right - left, height: bottom - top}
}

// one system number per measure (by index order), a new one whenever a
// measure's box sits far enough from the previous measure's to be a new
// line rather than the next bar along it
function systemsOf(measures: CardMeasure[]): Map<number, number> {
  const ordered = [...measures].sort((a, b) => a.index - b.index)
  const systemOf = new Map<number, number>()
  let system = -1
  let lastY: number | null = null

  for (const measure of ordered) {
    if (lastY == null || Math.abs(measure.box.y - lastY) > measure.box.height / 2) {
      system += 1
    }
    systemOf.set(measure.index, system)
    lastY = measure.box.y
  }

  return systemOf
}

// shadeBands(measures, shades): for each shade, one band per system it
// crosses (consecutive measures on one system merge; a printed number
// covering two positions, a bar split round a repeat, shades both), the
// first band of each shade carrying its label.
export function shadeBands(measures: CardMeasure[], shades: Shade[]): ShadeBand[] {
  const systemOf = systemsOf(measures)
  const byIndex = [...measures].sort((a, b) => a.index - b.index)
  const bands: ShadeBand[] = []

  for (const shade of shades) {
    const matching = byIndex.filter(m => m.number >= shade.from && m.number <= shade.to)
    if (!matching.length) { continue }

    let group: CardMeasure[] = []
    let groupSystem: number | null = null
    let first = true

    const flush = () => {
      if (!group.length) { return }
      bands.push({
        id: shade.id,
        level: shade.level,
        on: shade.on,
        label: first ? shade.label : null,
        box: union(group.map(m => m.box)),
      })
      first = false
      group = []
    }

    for (const measure of matching) {
      const system = systemOf.get(measure.index) ?? 0
      if (groupSystem != null && system != groupSystem) {
        flush()
      }
      group.push(measure)
      groupSystem = system
    }
    flush()
  }

  return bands
}
