// Pagination of a whole engraved piece for the score-first score page
// (st/components/score_sheet): turns an engine's CardResult.measures (the
// whole piece, engraved once at a reader-sized width) into pages of whole
// systems, and each page's bar overlay boxes in percent. Pure geometry,
// reading only what an engine's CardResult already reports, like
// card_shade.ts/card_hit.ts; lives in the app bundle, never the engines
// bundle.

import type {CardMeasure} from "./types"

// the width the artboards' pages were engraved at: at 1440 css px wide it
// reproduces the design (5 bars a system, scaled up to the page box); a
// phone-width box engraves at its own width instead, so it stays readable
export const ENGRAVE_MAX_WIDTH = 644

// OSMD's staff space in CSS px at ZOOM 0.8 (./osmd), the padding a system's
// band keeps above (3 spaces) and below (2 spaces) its measures' own boxes
export const SPACE = 8

// the title row, plate padding, toolbar, legend and pager's own height,
// subtracted from the viewport to budget a page
export const PAGE_CHROME_PX = 320

// the least a page's budget is ever let shrink to
export const MIN_PAGE_PX = 280

/**
 * One system number per measure (by index order): a new one whenever a
 * measure's box sits far enough from the previous measure's to be a new
 * line rather than the next bar along it. Moved here from card_shade.ts,
 * which imports it back, with no change of behaviour.
 */
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

export interface SystemBand {
  top: number
  bottom: number
  measures: CardMeasure[]
}

/**
 * Each system's band (score-first design §D5): from its measures' boxes'
 * min y − 3·SPACE to max y+height + 2·SPACE, in the natural CSS px of the
 * svg the measures were drawn in.
 * @param measures the whole piece's, as one engine draw gives them
 * @returns bands in system order, each measures in score order
 */
export function systemBands(measures: CardMeasure[]): SystemBand[] {
  const systemOf = systemsOf(measures)
  const bySystem = new Map<number, CardMeasure[]>()
  for (const measure of measures) {
    const system = systemOf.get(measure.index) ?? 0
    if (!bySystem.has(system)) { bySystem.set(system, []) }
    bySystem.get(system)!.push(measure)
  }

  return [...bySystem.keys()].sort((a, b) => a - b).map(system => {
    const group = [...bySystem.get(system)!].sort((a, b) => a.index - b.index)
    const top = Math.min(...group.map(m => m.box.y)) - 3 * SPACE
    const bottom = Math.max(...group.map(m => m.box.y + m.box.height)) + 2 * SPACE
    return {top, bottom, measures: group}
  })
}

export interface ScorePage {
  index: number
  // natural CSS px of the drawn svg, this page's cut top and bottom
  top: number
  bottom: number
  bands: SystemBand[]
  measures: CardMeasure[]
}

function buildPage(bands: SystemBand[], top: number, bottom: number, index: number): ScorePage {
  return {index, top, bottom, bands, measures: bands.flatMap(band => band.measures)}
}

/**
 * The whole piece's pages (score-first design §D5): whole systems, taken
 * greedily while the page's natural height (the next cut less its top) fits
 * the budget, always at least one; cut between two systems at the midpoint
 * of the first's bottom and the second's top. The first page starts at 0
 * and the last ends at the svg's natural height, whatever its last
 * system's own band says.
 * @param measures the whole piece's
 * @param opts.height the drawn svg's natural height (CSS px)
 * @param opts.budget the most natural px a page may hold
 */
export function scorePages(
  measures: CardMeasure[], {height, budget}: {height: number, budget: number},
): ScorePage[] {
  const bands = systemBands(measures)
  if (!bands.length) { return [] }

  const cutAfter = (i: number) => i == bands.length - 1 ? height : (bands[i].bottom + bands[i + 1].top) / 2

  const pages: ScorePage[] = []
  let startIdx = 0
  let pageTop = 0

  for (let i = 0; i < bands.length; i++) {
    const cut = cutAfter(i)
    const overflow = cut - pageTop > budget && i > startIdx

    if (overflow) {
      const prevCut = cutAfter(i - 1)
      pages.push(buildPage(bands.slice(startIdx, i), pageTop, prevCut, pages.length))
      pageTop = prevCut
      startIdx = i
    }

    if (i == bands.length - 1) {
      pages.push(buildPage(bands.slice(startIdx), pageTop, height, pages.length))
    }
  }

  return pages
}

export interface BarOverlay {
  number: number
  left: number
  top: number
  width: number
  height: number
}

/**
 * A page's bar overlay boxes, in percent of the drawn svg's own natural
 * size (score-first design §D5): left/width from the measure's own box,
 * top/height shared by every bar of its system's band. A split bar (a
 * printed number at two drawn positions, round a repeat) gets two overlays
 * carrying the same number.
 * @param page
 * @param width the drawn svg's natural width (CSS px)
 */
export function barOverlays(page: ScorePage, width: number): BarOverlay[] {
  const pageHeight = page.bottom - page.top
  const overlays: BarOverlay[] = []

  for (const band of page.bands) {
    const top = (band.top - page.top) / pageHeight * 100
    const bandHeight = (band.bottom - band.top) / pageHeight * 100
    for (const measure of band.measures) {
      overlays.push({
        number: measure.number,
        left: measure.box.x / width * 100,
        width: measure.box.width / width * 100,
        top,
        height: bandHeight,
      })
    }
  }

  return overlays
}

/**
 * The page to open for a bar.
 * @param pages
 * @param number the printed bar number
 * @returns the page's index, 0 when the bar isn't on any page
 */
export function pageOfBar(pages: ScorePage[], number: number): number {
  const idx = pages.findIndex(page => page.measures.some(measure => measure.number == number))
  return idx < 0 ? 0 : idx
}
