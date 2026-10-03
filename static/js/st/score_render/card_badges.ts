// Bar badges over an engine-drawn card during acoustic mode's "Where?"
// (SelfGradeRow, st/srs/self_grade): a small pill above each bar the
// follow-up names, lit once the grade going to it is known, plus a light
// tint over the bar. Pure geometry from the drawn heads' rects (relative to
// the .score_card root, see ScoreCard#placeBadges), which never touches the
// engine's own layout or types (./types, ./osmd, ./verovio)

// a bar is the span of columns from one badge's column up to the next's (or
// the end of the card for the last), so the page only names each bar's
// first column (SightReadingPage#selfGradeBadges); the geometry works out
// the rest from the card's own columns
export interface BarBadge {
  column: number
  label: string
  on: boolean
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface BadgePlacement {
  label: string
  on: boolean
  left: number
  top: number
  tint: {left: number, top: number, width: number, height: number}
}

// the badge's own height, so it sits clear of the row above it
const BADGE_HEIGHT = 18

// about 3.5 staff spaces at OSMD's zoom, clearing the stems of the row's
// highest notes
const STEM_ROOM = 28

const BADGE_PAD = 4
const TINT_PAD = 6

function union(rects: Rect[]): Rect | null {
  if (!rects.length) { return null }
  return rects.reduce((a, r) => ({
    left: Math.min(a.left, r.left),
    top: Math.min(a.top, r.top),
    right: Math.max(a.right, r.right),
    bottom: Math.max(a.bottom, r.bottom),
  }))
}

interface Bar {
  badge: BarBadge
  rects: Rect[]
  left: number
  right: number
}

/**
 * Places a badge and a tint over each of the card's named bars, from the
 * head rects of every column of the card (one entry a column, relative to
 * the .score_card root; a column with no drawn heads is an empty array).
 * @param badges one per bar, in bar order, see BarBadge
 * @param columnRects the card's columns' head rects, by column index
 * @returns one placement per badge, in the same order
 */
export function placeBadges(badges: BarBadge[], columnRects: Rect[][]): BadgePlacement[] {
  if (!badges.length) { return [] }

  let bars: Bar[] = badges.map((badge, i) => {
    let end = i + 1 < badges.length ? badges[i + 1].column : columnRects.length
    let columns = columnRects.slice(badge.column, end)
    let rects = columns.flat()
    let first = union(columns[0] || [])
    let last = union(columns[columns.length - 1] || [])
    let left = first ? Math.max(0, first.left - BADGE_PAD) : 0
    let right = last ? last.right + BADGE_PAD : left

    return {badge, rects, left, right}
  })

  let placements: BadgePlacement[] = []
  let rowStart = 0
  let previousRowBottom = -Infinity

  let flushRow = (end: number) => {
    let row = bars.slice(rowStart, end)
    let rowBox = union(row.flatMap(bar => bar.rects))
    let rowTop = rowBox ? rowBox.top : 0
    let rowBottom = rowBox ? rowBox.bottom : 0
    let top = Math.max(previousRowBottom + 2, rowTop - STEM_ROOM - BADGE_HEIGHT, 0)

    for (let bar of row) {
      placements.push({
        label: bar.badge.label,
        on: bar.badge.on,
        left: bar.left,
        top,
        tint: {
          left: bar.left,
          top: rowTop - TINT_PAD,
          width: bar.right - bar.left,
          height: rowBottom - rowTop + 2 * TINT_PAD,
        },
      })
    }

    previousRowBottom = rowBottom
  }

  for (let i = 1; i <= bars.length; i++) {
    if (i == bars.length || bars[i].left < bars[i - 1].left) {
      flushRow(i)
      rowStart = i
    }
  }

  return placements
}
