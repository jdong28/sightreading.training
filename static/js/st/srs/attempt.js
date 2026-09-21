// One attempt at a card of an imported piece: a pass through its columns,
// first to last (a looping card makes one a lap), collected as it is played
// and then written as the records of st/srs/records.
//
// A finished pass is graded (st/srs/grade) as an attempt at every measure of
// the card, each from its own columns, and, for a card of several measures,
// at the card's range too, whose review breaks the attempt down by bar. A pass
// abandoned before its last column (Rest, the page left, the drill rebuilt)
// only adds its hits, misses and time to those items' totals, as does the
// rest of the card played after it: a pass is only graded when it was played
// from its first column to its last in one go. Items are per hand setting,
// and the misses are also split by the score staff of the notes not held.

import {itemId, newItem, itemWithPractice, RECENT_ATTEMPTS, STAVES} from "st/srs/records"
import {gradeAttempt, attemptPace, GRADE_ALGO} from "st/srs/grade"

// time on one column longer than this is a pause, left out of elapsed times
export const PAUSE_MS = 30 * 1000

// how far an item's usual pace moves toward the pace of a clean attempt
export const PACE_WEIGHT = 0.25

/**
 * One pass through a card's columns (a MeasureCard of st/measure_cards,
 * whose columns may carry the score's beat and staves, see
 * extractSectionColumns in st/song_sections), from its column from.
 */
export class AttemptPass {
  /**
   * @param {MeasureCard} card
   * @param {Object} [opts]
   * @param {number} [opts.from=0] the first column played in the pass
   * @param {boolean} [opts.continued] the rest of an abandoned pass, never
   * graded
   * @param {number} [opts.startedAt] when the first column was shown
   */
  constructor(card, {from=0, continued=false, startedAt=null}={}) {
    this.card = card
    this.from = from
    this.continued = continued
    this.head = from
    this.columnStartedAt = startedAt
    this.lastAt = startedAt
    // the drill the pass is played in, {mode, speed}, set when first played
    this.drill = null
    this.columns = card.columns.map(() => ({
      misses: 0, counted: 0, hit: false, done: false, ms: null, staffMisses: {upper: 0, lower: 0},
    }))
  }

  /** @returns {boolean} whether every column has been done with */
  get complete() {
    return this.head >= this.columns.length
  }

  /** @returns {boolean} whether any column was done with or missed */
  get touched() {
    return this.head > this.from || this.columns.some(column => column.misses)
  }

  /** @returns {boolean} whether any column was hit or counted missed */
  get played() {
    return this.columns.some(column => column.hit || column.counted)
  }

  /** @returns {boolean} whether the pass is graded once complete */
  get graded() {
    return !this.continued && this.from == 0
  }

  /**
   * Times the first column afresh, for a pass not played yet
   * @param {number} time
   */
  restart(time) {
    this.columnStartedAt = time
    this.lastAt = time
  }

  /**
   * A miss on the head column.
   * @param {string[]} notes the column's notes not held, which say the hand
   * @param {Object} [opts]
   * @param {boolean} [opts.counted=true] false for a further slip on a column
   * the stats already counted missed, which only the grade reads
   * @param {number} [opts.time]
   */
  miss(notes, {counted=true, time}={}) {
    let column = this.columns[this.head]
    if (!column) { return }

    column.misses += 1
    if (counted) { column.counted += 1 }
    for (let staff of notesStaves(this.card.columns[this.head], notes)) {
      column.staffMisses[staff] += 1
    }

    if (time != null) { this.lastAt = time }
  }

  /**
   * The head column is done with (played, skipped or scrolled past)
   * @param {number} time
   * @returns {number} its index in the card
   */
  done(time) {
    let index = this.head
    let column = this.columns[index]
    column.done = true
    if (this.columnStartedAt != null) {
      column.ms = Math.max(0, time - this.columnStartedAt)
    }

    this.columnStartedAt = time
    this.lastAt = time
    this.head += 1
    return index
  }

  /**
   * The column at index, just done with, was played
   * @param {number} index
   */
  hit(index) {
    this.columns[index].hit = true
  }
}

// the score staves of the notes of a card column, eg. ["upper"], each once
function notesStaves(column, notes) {
  if (!column || !column.staves) { return [] }

  let staves = new Set()
  column.forEach((note, idx) => {
    if (notes.includes(note)) { staves.add(column.staves[idx]) }
  })
  return STAVES.filter(staff => staves.has(staff))
}

/**
 * The clef signs a card column's notes were read in, eg. ["g", "f"] for a
 * chord across a grand staff, from its staves and clefs.
 * @param {string[]} column
 * @param {string[]} [notes] only these of its notes, all by default
 * @returns {string[]}
 */
export function columnClefs(column, notes=column) {
  if (!column || !column.clefs) { return [] }

  let signs = notesStaves(column, notes).map(staff => column.clefs[staff]).filter(Boolean)
  return [...new Set(signs)]
}

// The measure ranges a pass counts for: the card's own when it spans several
// measures, then each of its measures, with the indices of their columns
function passRanges(card) {
  let bars = card.measures.map((measure, idx) => ({
    startMeasure: measure,
    endMeasure: measure,
    indices: card.columnMeasures.flatMap((m, col) => m == idx ? [col] : []),
  })).filter(bar => bar.indices.length)

  if (card.measures.length < 2) {
    return bars
  }

  return [{
    startMeasure: card.startMeasure,
    endMeasure: card.endMeasure,
    indices: card.columns.map((column, idx) => idx),
    bars,
  }, ...bars]
}

const elapsedOf = columns => Math.round(columns.reduce((sum, column) =>
  sum + (column.ms != null && column.ms < PAUSE_MS ? column.ms : 0), 0))

// the totals the columns add to their item
function totalsOf(columns) {
  return {
    hits: columns.filter(column => column.hit).length,
    misses: columns.reduce((sum, column) => sum + column.counted, 0),
    elapsedMs: elapsedOf(columns),
  }
}

/**
 * The practice of a pass that won't be graded, for the totals of its items
 * (see recordSectionPractice in st/storage): one entry per range with a
 * column hit or missed.
 * @param {AttemptPass} pass
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {string} opts.hand the item hand, one of HANDS
 * @param {number} [opts.at] when it was practiced, the pass's last activity
 * by default
 * @returns {Object[]}
 */
export function passPractice(pass, {pieceId, hand, at=pass.lastAt}) {
  if (!pass.played) { return [] }

  return passRanges(pass.card).flatMap(({startMeasure, endMeasure, indices}) => {
    let totals = totalsOf(indices.map(idx => pass.columns[idx]))
    if (!totals.hits && !totals.misses) { return [] }
    return [{pieceId, hand, startMeasure, endMeasure, ...totals, at}]
  })
}

// what the grade reads of the pass's column at idx
function gradedColumn(pass, idx, mode) {
  let column = pass.columns[idx]
  let beat = pass.card.columns[idx].beat
  let before = idx > 0 ? pass.card.columns[idx - 1].beat : null
  let gap = beat != null && before != null ? beat - before : null

  return {
    misses: column.misses,
    // a column scrolled past was missed, not skipped
    skipped: column.done && !column.hit && !(mode == "scroll" && column.misses > 0),
    ms: column.ms,
    gap,
  }
}

/**
 * The attempts a finished pass makes, one for each range of the pass (the
 * card's, then each of its measures), each graded from its own columns.
 * Each is built from its item as stored when it is written (see
 * LocalStore#recordAttempt), so attempts written one after another add up.
 * Nothing for a pass never played or not played through in one go.
 * @param {AttemptPass} pass complete
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {string} opts.hand the item hand, one of HANDS
 * @param {number} [opts.at] when it was played, the pass's last activity by default
 * @param {string} [opts.sessionId]
 * @returns {{id: string, build: function(ItemRecord|null): {item: ItemRecord, review: ReviewRecord}}[]}
 * the item id of each attempt, and its item as the attempt leaves it and its
 * review, from the stored item of the id
 */
export function passAttempts(pass, {pieceId, hand, at=pass.lastAt, sessionId}) {
  if (!pass.complete || !pass.graded || !pass.played || !pass.drill) { return [] }

  let {mode, speed} = pass.drill
  let cardColumns = pass.columns.map((column, idx) => gradedColumn(pass, idx, mode))
  let pace = attemptPace(cardColumns)

  return passRanges(pass.card).map(({startMeasure, endMeasure, indices, bars}) => {
    let range = {pieceId, hand, startMeasure, endMeasure}
    let build = stored => {
      let current = stored || newItem(range, at)
      let firstSight = current.attempts == 0 && !current.recent.length

      let lead = indices[0] == 0
      let columns = indices.map(idx => cardColumns[idx])
      let graded = gradeAttempt(columns, {mode, lead, pace, firstSight, usualPace: current.paceMs})

      let collected = indices.map(idx => pass.columns[idx])
      let totals = totalsOf(collected)

      let record = itemWithPractice(current, {...totals, at})
      record.recent = [...current.recent, [at, graded.columns, graded.clean, graded.grade]]
        .slice(-RECENT_ATTEMPTS)
      if (graded.pace != null && !graded.slips && !graded.skipped) {
        let usual = current.paceMs == null ? graded.pace :
          current.paceMs + (graded.pace - current.paceMs) * PACE_WEIGHT
        record.paceMs = Math.round(usual)
      }

      let review = {
        itemId: record.id,
        at,
        pieceId,
        ...(sessionId ? {sessionId} : {}),
        kind: "attempt",
        grade: graded.grade,
        was: firstSight ? "new" : current.state,
        columns: graded.columns,
        clean: graded.clean,
        misses: graded.misses,
        stuck: graded.stuck,
        skipped: graded.skipped,
        hesitations: graded.hesitations,
        elapsedMs: totals.elapsedMs,
        mode,
        algo: GRADE_ALGO,
      }

      if (lead && columns[0].ms != null) {
        review.leadMs = Math.round(columns[0].ms)
      }

      if (mode == "scroll" && speed != null) {
        review.speed = speed
      }

      if (bars) {
        review.bars = bars.map(bar => {
          let barColumns = bar.indices.map(idx => cardColumns[idx])
          return [
            bar.startMeasure,
            bar.indices.length,
            barColumns.filter(column => !column.misses && !column.skipped).length,
            barColumns.reduce((sum, column) => sum + column.misses, 0),
            elapsedOf(bar.indices.map(idx => pass.columns[idx])),
          ]
        })
      }

      let trouble = columns.flatMap((column, idx) => column.misses ? [idx] : [])
      if (trouble.length) {
        review.trouble = trouble
      }

      if (indices.some(idx => pass.card.columns[idx].staves)) {
        review.staffMisses = Object.fromEntries(STAVES.map(staff =>
          [staff, collected.reduce((sum, column) => sum + column.staffMisses[staff], 0)]))
      }

      return {item: record, review}
    }

    return {id: itemId(range), build}
  })
}
