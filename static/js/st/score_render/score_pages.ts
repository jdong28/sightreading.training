// Pure geometry for the score-first sheet music page: the width an engine
// engraves a piece's whole section at, pagination of its drawn systems
// (whole systems a page, never a system split across pages), and the %
// overlay boxes a page's bars are tinted, labelled and clicked through
// (see st/components/score_sheet). Reads the measures an engine's
// CardResult already reported (CardMeasure boxes), the same ones card_shade
// and card_hit read. Lives in the app bundle, never the engines bundle.

import type {CardMeasure, CardBox} from "./types"

// the width the whole section is engraved at, the artboards' own width
export const ENGRAVE_MAX_WIDTH = 644

// OSMD's staff space in CSS px at ZOOM 0.8 (osmd.ts), a system's band pads
// 3 of these above its boxes and 2 below
export const SPACE = 8

// the title row, plate padding, toolbar, legend and pager around the page
export const PAGE_CHROME_PX = 320

// the smallest a page's budget is ever let shrink to
export const MIN_PAGE_PX = 280

export interface SystemBand {
  system: number
  top: number
  bottom: number
  measures: CardMeasure[]
}

export interface ScorePage {
  // the drawn svg's own CSS px, natural size (not the viewBox's user units)
  top: number
  bottom: number
  // the drawn svg's natural width, the same on every page (cropped, not
  // redrawn), carried here so barOverlays needs only the page
  width: number
  measures: CardMeasure[]
}

export interface BarOverlay {
  number: number
  // percentages of the page's own drawn size
  left: number
  top: number
  width: number
  height: number
  // the bar's system on this page, and how many systems the page holds,
  // so a caller can tell a bar on the last system of a multi-system page
  // (the bar pop-up opens above it)
  system: number
  systems: number
}

// one system number per measure (by index order), a new one whenever a
// measure's box sits far enough from the previous measure's to be a new
// line rather than the next bar along it. Moved here from card_shade.ts,
// which imports it unchanged
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

// the union of a system's boxes, top and bottom padded by SPACE (see
// systemBands)
function systemExtent(boxes: CardBox[]): {top: number, bottom: number} {
  let top = Infinity, bottom = -Infinity
  for (const box of boxes) {
    top = Math.min(top, box.y)
    bottom = Math.max(bottom, box.y + box.height)
  }
  return {top, bottom}
}

/**
 * One band per system of the drawn measures, in system order: from its
 * boxes' min y - 3*SPACE to max y+height + 2*SPACE, so the band covers the
 * staff with room above and below it.
 * @param measures a whole section's drawn CardMeasure[]
 */
export function systemBands(measures: CardMeasure[]): SystemBand[] {
  const systemOf = systemsOf(measures)
  const bySystem = new Map<number, CardMeasure[]>()

  for (const measure of measures) {
    const system = systemOf.get(measure.index) ?? 0
    const group = bySystem.get(system) || []
    group.push(measure)
    bySystem.set(system, group)
  }

  return [...bySystem.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([system, group]) => {
      const ordered = [...group].sort((a, b) => a.index - b.index)
      const {top, bottom} = systemExtent(ordered.map(m => m.box))
      return {system, top: top - 3 * SPACE, bottom: bottom + 2 * SPACE, measures: ordered}
    })
}

/**
 * The whole section's drawn measures split into pages of whole systems: a
 * page takes whole systems while its natural height (from its top to the
 * next cut) stays within budget, always taking at least one. Pages are cut
 * between consecutive systems at the midpoint of one band's bottom and the
 * next's top; the first page starts at 0 and the last ends at height, the
 * drawn svg's own natural size.
 * @param measures a whole section's drawn CardMeasure[]
 * @param opts.height the drawn svg's natural height, CSS px
 * @param opts.width the drawn svg's natural width, CSS px, carried onto
 * each page for barOverlays
 * @param opts.budget the most natural height a page may hold, CSS px
 */
export function scorePages(
  measures: CardMeasure[],
  {height, width, budget}: {height: number, width: number, budget: number},
): ScorePage[] {
  const bands = systemBands(measures)
  if (!bands.length) { return [] }

  const cutAfter = (i: number) => i == bands.length - 1 ? height : (bands[i].bottom + bands[i + 1].top) / 2

  const pages: ScorePage[] = []
  let pageTop = 0
  let pageBands: SystemBand[] = []

  for (let i = 0; i < bands.length; i++) {
    const cut = cutAfter(i)
    if (pageBands.length && cut - pageTop > budget) {
      const prevCut = cutAfter(i - 1)
      pages.push({top: pageTop, bottom: prevCut, width, measures: pageBands.flatMap(b => b.measures)})
      pageTop = prevCut
      pageBands = []
    }
    pageBands.push(bands[i])
  }

  pages.push({top: pageTop, bottom: height, width, measures: pageBands.flatMap(b => b.measures)})
  return pages
}

/**
 * The % overlay boxes of a page's bars, for the score sheet's bar buttons:
 * every bar of a system shares its band's top and bottom. A split bar (a
 * printed number drawn at two positions, round a repeat) gets two entries
 * with the same number.
 * @param page one of scorePages' pages
 */
export function barOverlays(page: ScorePage): BarOverlay[] {
  if (!page.measures.length) { return [] }

  const bands = systemBands(page.measures)
  const bandOf = new Map<number, SystemBand>()
  for (const band of bands) {
    for (const measure of band.measures) { bandOf.set(measure.index, band) }
  }

  const pageHeight = page.bottom - page.top
  if (!(pageHeight > 0) || !(page.width > 0)) { return [] }

  return page.measures.map(measure => {
    const band = bandOf.get(measure.index)
    const top = band ? band.top - page.top : 0
    const bandHeight = band ? band.bottom - band.top : pageHeight
    return {
      number: measure.number,
      left: measure.box.x / page.width * 100,
      width: measure.box.width / page.width * 100,
      top: top / pageHeight * 100,
      height: bandHeight / pageHeight * 100,
      system: band ? band.system : 0,
      systems: bands.length,
    }
  })
}

/**
 * @param pages scorePages' pages
 * @param number a printed bar number
 * @returns the index of the page to open for that bar, 0 when not found
 */
export function pageOfBar(pages: ScorePage[], number: number): number {
  let found = pages.findIndex(page => page.measures.some(measure => measure.number == number))
  return found < 0 ? 0 : found
}
