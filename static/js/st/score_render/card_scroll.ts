// Scroll mode on a system an engine drew on one line (renderSystem in
// ./types): where each column the trainer detects sits along the drawing, so
// the system slides under a fixed hit line with the column at the head of
// the drill arriving on it. A column is placed at its drawn heads through
// the join (./card_join), and a column with none (eg. a note the engine left
// out) between the drawn onsets by its beat, so it is still scrolled to and
// past. The trainer's slider counts in units of the drawing's mean gap from
// one onset to the next, as the app's staff counts in columns of one width

import type {CardNote} from "./types"
import type {CardJoin, JoinColumn} from "./card_join"

// how far the slider stops short of 0 while it waits on the head column,
// which the hit line then holds (see enterScrollMode in the trainer)
export const SCROLL_WAIT = 0.5

// the least a column moves the system on, so columns drawn at one place are
// still passed one by one
export const MIN_SCROLL_ADVANCE = 0.05

// the units the system comes on by when it jumps to a column that doesn't
// follow on from the last, the drawing's mean gap from one onset to the next
export const JUMP_LEAD_IN = 1

// the unit of a drawing with a single onset, a quarter note's gap at the
// engines' zoom
const DEFAULT_UNIT = 40

const TICKS = 960

function tick(beats: number): number {
  return Math.round(beats * TICKS)
}

export interface ScrollTrack {
  // the drawn onsets as [beat, x], in order of beat
  points: [number, number][]
  // the slider's unit in pixels, the mean gap between drawn onsets
  unit: number
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// Every drawn onset's x along the system: a column's own heads where the
// join found them (a chord's heads, and never the heads its ties run on to),
// and elsewhere the mean of the heads drawn at that onset that no column
// claims, eg. the notes of the section outside the card on the staff (the
// heads a column's ties run on to are its own, not onsets of their own).
// xOf gives an element's centre along the system
export function scrollTrack(columns: JoinColumn[], join: CardJoin, notes: CardNote[],
  xOf: (el: SVGGElement) => number): ScrollTrack
{
  const noteOf = new Map<SVGGElement, CardNote>()
  for (const note of notes) { noteOf.set(note.el, note) }

  const xs = new Map<number, number>()
  const beats = new Map<number, number>()

  columns.forEach((column, idx) => {
    if (column.beat == null) { return }
    const t = tick(column.beat)
    const struck = (join.heads[idx] || []).filter(el => {
      const note = noteOf.get(el)
      return note && Math.abs(tick(note.onsetBeats) - t) <= 1
    })
    if (!struck.length) { return }
    xs.set(t, mean(struck.map(xOf)))
    beats.set(t, column.beat)
  })

  const claimed = new Set(join.heads.flat())
  const others = new Map<number, number[]>()
  for (const note of notes) {
    const t = tick(note.onsetBeats)
    if (xs.has(t) || claimed.has(note.el)) { continue }
    if (!others.has(t)) { others.set(t, []) }
    others.get(t)!.push(xOf(note.el))
    beats.set(t, note.onsetBeats)
  }
  for (const [t, values] of others) { xs.set(t, mean(values)) }

  const points = [...xs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, x]) => [beats.get(t)!, x] as [number, number])

  const gaps: number[] = []
  for (let i = 1; i < points.length; i++) {
    const gap = points[i][1] - points[i - 1][1]
    if (gap > 0) { gaps.push(gap) }
  }

  return {points, unit: gaps.length ? mean(gaps) : DEFAULT_UNIT}
}

// The x of a beat along the system: a drawn onset's own, else read off the
// line between the drawn onsets either side of it, or past the first or last
// one along the drawing's mean pace. null for a drawing with no onsets
export function trackX(track: ScrollTrack, beat: number): number | null {
  const {points} = track
  if (!points.length) { return null }

  const t = tick(beat)
  let after = points.findIndex(([b]) => tick(b) >= t)
  if (after >= 0 && Math.abs(tick(points[after][0]) - t) <= 1) {
    return points[after][1]
  }

  const [firstBeat, firstX] = points[0]
  const [lastBeat, lastX] = points[points.length - 1]
  const pace = lastBeat > firstBeat ? (lastX - firstX) / (lastBeat - firstBeat) : track.unit

  if (after < 0) {
    return lastX + (beat - lastBeat) * pace
  }
  if (after == 0) {
    return firstX - (firstBeat - beat) * pace
  }

  const [b0, x0] = points[after - 1]
  const [b1, x1] = points[after]
  return x0 + (x1 - x0) * (beat - b0) / (b1 - b0)
}

// the first drawn onset after the beat, if any
function nextOnset(track: ScrollTrack, beat: number): [number, number] | null {
  const t = tick(beat)
  return track.points.find(([b]) => tick(b) > t + 1) || null
}

// How many units the system moves on when the column at the head of the
// drill is done with and next takes its place: the gap between them as
// drawn. A next column not yet known (the gap before a card's next is picked)
// is taken to be the next drawn onset. A next column that doesn't follow on
// from the column (a card looping back, one picked from elsewhere in the
// section, or the column ending the drawing) isn't scrolled to through the
// bars between: the system jumps to it, JUMP_LEAD_IN short of the hit line
export function scrollAdvance(track: ScrollTrack, column: JoinColumn, next?: JoinColumn | null): number {
  const x0 = column.beat == null ? null : trackX(track, column.beat)
  if (x0 == null) { return 1 }

  const onset = nextOnset(track, column.beat!)
  let x1: number | null = null
  if (next && next.beat != null) {
    const follows = tick(next.beat) > tick(column.beat!) + 1 &&
      (!onset || tick(next.beat) <= tick(onset[0]) + 1)
    if (follows) { x1 = trackX(track, next.beat) }
  } else if (onset) {
    x1 = onset[1]
  }

  if (x1 == null) { return JUMP_LEAD_IN }
  return Math.max(MIN_SCROLL_ADVANCE, (x1 - x0) / track.unit)
}

// The system's translation that puts the column of beat on the hit line
// when the slider waits, and value - SCROLL_WAIT units right of it as the
// slider runs down to that
export function scrollOffset(track: ScrollTrack, beat: number, value: number, hitX: number): number | null {
  const x = trackX(track, beat)
  if (x == null) { return null }
  return hitX + (value - SCROLL_WAIT) * track.unit - x
}
