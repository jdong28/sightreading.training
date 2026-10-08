// Pure pagination and hit-testing for the score-first sheet music page's
// engraved score (D5): turns one engine draw's CardMeasure boxes into pages
// of whole systems, and each page's bars into the overlay boxes the score
// view's buttons use for shading, labelling and hit-testing (the DOM does
// the hit-testing at any scale, never coordinates). Lives in the app
// bundle, like card_shade/card_hit: it only reads what an engine's
// CardResult already reported. systemsOf also backs card_shade's own
// shadeBands, unchanged.

import type {CardMeasure} from "./types"

// the width the score view engraves a page at (the artboards' own width);
// smaller on a narrow viewport, see the score view's own budget math
export const ENGRAVE_MAX_WIDTH = 644

// OSMD's staff space in CSS px at the score view's draw zoom (osmd.ts's
// ZOOM 0.8, 10px staff space at zoom 1)
export const SPACE = 8

// the title row, plate padding, toolbar, legend and pager around the page,
// subtracted from the viewport to give a page's height budget
export const PAGE_CHROME_PX = 320

// the smallest a page's height budget is ever let shrink to
export const MIN_PAGE_PX = 280

export interface SystemBand {
  system: number
  top: number
  bottom: number
  measures: CardMeasure[]
}

export interface ScorePage {
  top: number
  bottom: number
  bands: SystemBand[]
  measures: CardMeasure[]
}

export interface BarOverlay {
  number: number
  index: number
  left: number
  width: number
  top: number
  height: number
}

// one system number per measure (by index order), a new one whenever a
// measure's box sits far enough from the previous measure's to be a new
// line rather than the next bar along it. Moved here from card_shade.ts,
// which imports it back unchanged, so both the shaded overview and this
// page's pagination agree on where one system ends and the next begins.
export function systemsOf(measures: CardMeasure[]): Map<number, number> {
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

// each system's band: from its boxes' min y - 3 spaces to max y+height + 2
// spaces (matching the artboards' bar boxes), in system (score) order
export function systemBands(measures: CardMeasure[]): SystemBand[] {
  const systemOf = systemsOf(measures)
  const bySystem = new Map<number, CardMeasure[]>()

  for (const measure of measures) {
    const system = systemOf.get(measure.index) ?? 0
    if (!bySystem.has(system)) { bySystem.set(system, []) }
    bySystem.get(system)!.push(measure)
  }

  return [...bySystem.entries()]
    .sort(([a], [b]) => a - b)
    .map(([system, systemMeasures]) => {
      const top = Math.min(...systemMeasures.map(m => m.box.y)) - 3 * SPACE
      const bottom = Math.max(...systemMeasures.map(m => m.box.y + m.box.height)) + 2 * SPACE
      return {system, top, bottom, measures: systemMeasures}
    })
}

/**
 * The pages a card's systems are split across: whole systems only, cut at
 * the midpoint between consecutive bands, greedily filling each page up to
 * the budget (always at least one system), the first page from 0 and the
 * last to the svg's full natural height, whatever its last band's bottom.
 * @param measures a card's CardResult.measures, at least one
 * @param opts.height the drawn svg's natural height, CSS px
 * @param opts.budget the most natural px a page may hold
 */
export function scorePages(measures: CardMeasure[], {height, budget}: {height: number, budget: number}): ScorePage[] {
  const bands = systemBands(measures)
  if (!bands.length) { return [] }

  // boundaries[i] is the cut before band i (0 for the first), boundaries[bands.length] is height
  const boundaries = bands.map((band, idx) => {
    if (idx == 0) { return 0 }
    const previous = bands[idx - 1]
    return (previous.bottom + band.top) / 2
  })
  boundaries.push(height)

  const pages: ScorePage[] = []
  let start = 0
  while (start < bands.length) {
    let end = start
    while (end + 1 < bands.length && boundaries[end + 2] - boundaries[start] <= budget) {
      end += 1
    }

    const included = bands.slice(start, end + 1)
    pages.push({
      top: boundaries[start],
      bottom: boundaries[end + 1],
      bands: included,
      measures: included.flatMap(band => band.measures),
    })
    start = end + 1
  }

  return pages
}

/**
 * The overlay box of every bar position on a page, in fractions (0-1) of
 * the page's own width and height: left/width from the bar's own box, top/
 * height from its system's band, so every bar of a system shares its band's
 * top and bottom, as in the artboard. A split bar (two positions, one
 * number) gives two overlays.
 * @param page one of scorePages' pages
 * @param width the drawn svg's natural width, CSS px
 */
export function barOverlays(page: ScorePage, width: number): BarOverlay[] {
  const pageHeight = page.bottom - page.top
  const overlays: BarOverlay[] = []

  for (const band of page.bands) {
    const top = (band.top - page.top) / pageHeight
    const bandHeight = (band.bottom - band.top) / pageHeight
    for (const measure of band.measures) {
      overlays.push({
        number: measure.number,
        index: measure.index,
        left: measure.box.x / width,
        width: measure.box.width / width,
        top,
        height: bandHeight,
      })
    }
  }

  return overlays
}

/** The index of the page a bar number should be opened to, or null. */
export function pageOfBar(pages: ScorePage[], number: number): number | null {
  const index = pages.findIndex(page => page.measures.some(measure => measure.number == number))
  return index < 0 ? null : index
}
