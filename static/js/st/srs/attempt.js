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
// and the misses are also split by the score staff of the notes blamed.
//
// Each column also keeps what the note matcher (st/note_matcher) measured
// on its hit: its latency, which the grade reads hesitations from, its
// spread, the keys credited early and held over, and in scroll mode how late
// it was on the hit line. A graded review stores them a column (perColumn),
// so a revised grade can be worked out again from the log. A column the
// matcher settled by a key held (none of its keys struck at it) gets no time
// of its own: the next column done is timed from the column before it.
//
// In acoustic mode nothing is detected: the player plays the card and grades
// the pass themself (pass.selfGrade, set by the page). selfAttempts and
// selfPractice are the self-graded counterparts of passAttempts and
// passPractice, writing reviews with mode "self" and none of the above
// measurements (st/srs/self_grade).

import {itemId, newItem, itemWithPractice, withPass, RECENT_ATTEMPTS, STAVES} from "st/srs/records"
import {gradeAttempt, attemptPace, hesitations, openingColumn, GRADE_ALGO} from "st/srs/grade"
import {SELF_PAUSE_MS} from "st/srs/self_grade"

// time on one column longer than this is a pause, left out of elapsed times
export const PAUSE_MS = 30 * 1000

// how far an item's usual pace moves toward the pace of a clean attempt
export const PACE_WEIGHT = 0.25

// what the matcher measures on a column when it is played, see AttemptPass#done
const MEASURES = ["latency", "spread", "early", "heldCredit", "late"]
const UNMEASURED = Object.fromEntries(MEASURES.map(key => [key, null]))

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
    // {grade, bars, slipped} once the player grades the pass themself
    this.selfGrade = null
    this.columns = card.columns.map(() => ({
      misses: 0, counted: 0, hit: false, done: false, settled: false, ms: null,
      staffMisses: {upper: 0, lower: 0},
      ...UNMEASURED,
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
   * @param {string[]} notes the column's notes the miss is blamed on, which say the hand
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
   * @param {Object} [measured] what the matcher measured on the column when
   * it was played (see NoteMatcher#measured): latency, spread, early,
   * heldCredit and late, each null when not measured, and settled when a key
   * held completed it with none of its keys struck at it. A column skipped or
   * scrolled past has none, so the grade reads no hesitation on it
   * @returns {number} its index in the card
   */
  done(time, measured={}) {
    let index = this.head
    let column = this.columns[index]
    column.done = true
    for (let key of MEASURES) {
      column[key] = measured[key] ?? null
    }

    // a settled column has no time of its own: the time since the column
    // before it goes to the next column done
    column.settled = !!measured.settled
    if (!column.settled) {
      if (this.columnStartedAt != null) {
        column.ms = Math.max(0, time - this.columnStartedAt)
      }
      this.columnStartedAt = time
    }

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

/**
 * The measure ranges a pass counts for: the card's own when it spans several
 * measures, then each of its measures, with the indices of their columns
 * (and for the card's own, its bars, each as a range)
 * @param {MeasureCard} card
 * @returns {{startMeasure: number, endMeasure: number, indices: number[], bars?: Object[]}[]}
 */
export function passRanges(card) {
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
 * @param {boolean} [opts.deliberate] a hand alone the player chose, see
 * ItemRecord
 * @returns {Object[]}
 */
export function passPractice(pass, {pieceId, hand, at=pass.lastAt, deliberate}) {
  if (!pass.played) { return [] }

  return passRanges(pass.card).flatMap(({startMeasure, endMeasure, indices}) => {
    let totals = totalsOf(indices.map(idx => pass.columns[idx]))
    if (!totals.hits && !totals.misses) { return [] }
    return [{pieceId, hand, startMeasure, endMeasure, ...totals, at, ...(deliberate ? {deliberate} : {})}]
  })
}

/**
 * Whether a column done with was skipped rather than played: in scroll mode
 * one scrolled past with misses was missed, not skipped
 * @param {Object} column a pass's column
 * @param {string|null} mode the drill's mode
 * @returns {boolean}
 */
export function columnSkipped(column, mode) {
  return column.done && !column.hit && !(mode == "scroll" && column.misses > 0)
}

// what the grade reads of the pass's column at idx: its gap counts from the
// column played before it, as its time does, settled columns left out
function gradedColumn(pass, idx, mode) {
  let column = pass.columns[idx]
  let beat = pass.card.columns[idx].beat
  let played = idx - 1
  while (played >= 0 && pass.columns[played].settled) { played -= 1 }
  let before = played >= 0 ? pass.card.columns[played].beat : null
  let gap = beat != null && before != null ? beat - before : null

  return {
    misses: column.misses,
    skipped: columnSkipped(column, mode),
    settled: column.settled,
    ms: column.ms,
    latency: column.latency,
    gap,
  }
}

const roundOrNull = n => n == null ? null : Math.round(n)

// A review's record of one of its columns, see ReviewRecord#perColumn in
// st/srs/records: [slips, stalled, latency, spread, early, heldCredit, late]
function columnRecord(column, graded) {
  return [
    graded.misses,
    graded.skipped ? 1 : 0,
    roundOrNull(column.latency),
    roundOrNull(column.spread),
    column.early,
    column.heldCredit,
    roundOrNull(column.late),
  ]
}

/**
 * The pace of a pass played through in one go in wait mode, as its grade
 * reads it (see attemptPace and hesitations in st/srs/grade), leaving out
 * the columns the player walked away from as elapsedOf leaves them out of
 * the stored time: null for any other pass, whose pace the player didn't
 * set, and a null pace when no column was played under PAUSE_MS. A column
 * over PAUSE_MS is a stop whatever the pace.
 * @param {AttemptPass} pass complete
 * @returns {{pace: number|null, beats: boolean, stops: number[]}|null} pace
 * in ms per beat (per column when beats is false, the columns carrying no
 * score rhythm), and the bar number of each column stopped on
 */
export function passPace(pass) {
  if (pass.selfGrade) { return null }
  if (!pass.complete || !pass.graded || !pass.played || !pass.drill || pass.drill.mode != "wait") {
    return null
  }

  let {card} = pass
  let columns = pass.columns.map((column, idx) => gradedColumn(pass, idx, "wait"))
  let paused = columns.map(column => column.ms != null && column.ms >= PAUSE_MS)
  let pace = attemptPace(columns.map((column, idx) =>
    paused[idx] ? {...column, ms: null} : column))
  let hesitated = new Set(hesitations(columns, {pace}))
  let opening = openingColumn(columns)

  return {
    pace,
    beats: card.columns.every(column => column.beat != null),
    stops: columns.flatMap((column, idx) => idx > opening && (paused[idx] || hesitated.has(idx)) ?
      [card.measures[card.columnMeasures[idx]]] : []),
  }
}

/**
 * What the grade of a pass played through reads (see passAttempts): the
 * drill it was played in, each of its columns as the grade reads it, the
 * pace hesitations are judged by (the whole card's, for each of its ranges)
 * and the ranges it counts for (see passRanges)
 * @param {AttemptPass} pass played
 * @returns {{mode: string, speed: number|undefined, columns: AttemptColumn[],
 * pace: number|null, ranges: Object[]}}
 */
export function passGrading(pass) {
  let {mode, speed} = pass.drill
  let columns = pass.columns.map((column, idx) => gradedColumn(pass, idx, mode))
  return {mode, speed, columns, pace: attemptPace(columns), ranges: passRanges(pass.card)}
}

/**
 * The grade of one range of a pass (see passGrading) as an attempt at its
 * item as stored before it
 * @param {Object} grading see passGrading
 * @param {number[]} indices the range's columns in the card
 * @param {ItemRecord|null} current the item before the attempt, null for
 * none yet
 * @returns {{firstSight: boolean, lead: boolean, columns: AttemptColumn[],
 * graded: Object}} graded is gradeAttempt's
 */
export function gradeRange({mode, pace, columns: cardColumns}, indices, current) {
  let firstSight = !current || current.attempts == 0 && !current.recent.length
  let lead = indices[0] == 0
  let columns = indices.map(idx => cardColumns[idx])
  let graded = gradeAttempt(columns, {mode, lead, pace, firstSight, usualPace: current?.paceMs})
  return {firstSight, lead, columns, graded}
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
 * @param {boolean} [opts.deliberate] a hand alone the player chose, see
 * ItemRecord
 * @returns {{id: string, build: function(ItemRecord|null): {item: ItemRecord, review: ReviewRecord}}[]}
 * the item id of each attempt, and its item as the attempt leaves it and its
 * review, from the stored item of the id
 */
export function passAttempts(pass, {pieceId, hand, at=pass.lastAt, sessionId, deliberate}) {
  if (!pass.complete || !pass.graded || !pass.played || !pass.drill) { return [] }

  let grading = passGrading(pass)
  let {mode, speed, columns: cardColumns} = grading

  return grading.ranges.map(({startMeasure, endMeasure, indices, bars}) => {
    let range = {pieceId, hand, startMeasure, endMeasure}
    let build = stored => {
      let current = stored || newItem(range, at)
      let {firstSight, lead, columns, graded} = gradeRange(grading, indices, current)

      let collected = indices.map(idx => pass.columns[idx])
      let totals = totalsOf(collected)

      let record = itemWithPractice(current, {...totals, at, deliberate})
      record.recent = [...current.recent, [at, graded.columns, graded.clean, graded.grade]]
        .slice(-RECENT_ATTEMPTS)
      if (startMeasure == endMeasure) {
        record.passes = withPass(current, [at, graded.columns, graded.clean, graded.grade])
      }
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

      let opening = columns[openingColumn(columns, {lead})]
      if (opening && opening.ms != null) {
        review.leadMs = Math.round(opening.ms)
      }

      if (mode == "scroll" && speed != null) {
        review.speed = speed
      }

      // D4(c): the trainer's "Keep tempo" setting was on, so a column that
      // scrolled past the hit line was missed, not waited for (see
      // NoteMatcher#scrollPast); the tolerance is kept with the review so a
      // revised one doesn't change how an old review reads
      if (mode == "scroll" && pass.drill.tempo) {
        review.tempo = pass.drill.tempo
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

      review.perColumn = indices.map(idx => columnRecord(pass.columns[idx], cardColumns[idx]))

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

// the elapsed time from the card shown (or Begin) to the grade, left out
// over SELF_PAUSE_MS, see st/srs/self_grade
function selfElapsed(pass, at) {
  if (pass.columnStartedAt == null) { return undefined }
  let elapsed = Math.round(Math.max(0, at - pass.columnStartedAt))
  return elapsed > SELF_PAUSE_MS ? undefined : elapsed
}

// a range's share of the pass's elapsed time, proportional to its columns;
// the card's own range (range.bars set) gets all of it
function selfElapsedOf(pass, range, total) {
  if (total === undefined) { return undefined }
  if (range.bars) { return total }
  return Math.round(total * range.indices.length / pass.card.columns.length)
}

/**
 * The attempts a self-graded pass makes (see MeasureCardGenerator#selfGrade):
 * one for the card's own range (multi-measure cards) and one for each bar
 * pass.selfGrade.bars names, defaulting to every bar of the card. Each
 * writes a review with mode "self", the pass's grade and none of detection's
 * measurements, with the same interface as passAttempts.
 * @param {AttemptPass} pass complete, with pass.selfGrade set
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {string} opts.hand the item hand, one of HANDS
 * @param {number} [opts.at] when it was graded, the pass's last activity by default
 * @param {string} [opts.sessionId]
 * @param {boolean} [opts.deliberate] a hand alone the player chose, see
 * ItemRecord
 * @returns {{id: string, build: function(ItemRecord|null): {item: ItemRecord, review: ReviewRecord}}[]}
 */
export function selfAttempts(pass, {pieceId, hand, at=pass.lastAt, sessionId, deliberate}) {
  if (!pass.selfGrade || !pass.graded) { return [] }

  let {grade, slipped} = pass.selfGrade
  let selectedBars = pass.selfGrade.bars ?? pass.card.measures
  let total = selfElapsed(pass, at)

  return passRanges(pass.card)
    .filter(range => range.bars || selectedBars.includes(range.startMeasure))
    .map(range => {
      let itemRange = {pieceId, hand, startMeasure: range.startMeasure, endMeasure: range.endMeasure}
      let elapsedMs = selfElapsedOf(pass, range, total)

      let build = stored => {
        let current = stored || newItem(itemRange, at)
        let firstSight = !current || current.attempts == 0 && !current.recent.length

        let record = itemWithPractice(current, {hits: 0, misses: 0, at, elapsedMs, played: true, deliberate})
        record.recent = [...current.recent, [at, null, null, grade]].slice(-RECENT_ATTEMPTS)
        if (itemRange.startMeasure == itemRange.endMeasure) {
          record.passes = withPass(current, [at, null, null, grade])
        }

        let review = {
          itemId: record.id,
          at,
          pieceId,
          ...(sessionId ? {sessionId} : {}),
          kind: "attempt",
          mode: "self",
          grade,
          was: firstSight ? "new" : current.state,
          ...(elapsedMs !== undefined ? {elapsedMs} : {}),
          ...(slipped && slipped.length ? {slipped} : {}),
        }

        return {item: record, review}
      }

      return {id: itemId(itemRange), build}
    })
}

/**
 * The practice of a self-graded pass's ranges not written as an attempt (see
 * selfAttempts): bars the "Where?" follow-up didn't name, for the totals of
 * their items (see recordSectionPractice in st/storage), and with opts.also
 * the ranges of those item ids as well (ranges selfAttempts wrote that
 * MeasureCardGenerator#practiceOnly demotes to practice, eg. an off-schedule
 * bar that didn't fail). Every range appears at most once.
 * @param {AttemptPass} pass complete, with pass.selfGrade set
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {string} opts.hand
 * @param {number} [opts.at]
 * @param {string[]} [opts.also] item ids written as practice too
 * @param {boolean} [opts.deliberate] a hand alone the player chose, see
 * ItemRecord
 * @returns {Object[]}
 */
export function selfPractice(pass, {pieceId, hand, at=pass.lastAt, also, deliberate}={}) {
  if (!pass.selfGrade) { return [] }

  let selectedBars = pass.selfGrade.bars ?? pass.card.measures
  let total = selfElapsed(pass, at)

  return passRanges(pass.card)
    .filter(range => {
      if (!range.bars && !selectedBars.includes(range.startMeasure)) { return true }
      let id = itemId({pieceId, hand, startMeasure: range.startMeasure, endMeasure: range.endMeasure})
      return !!also && also.includes(id)
    })
    .map(range => {
      let elapsedMs = selfElapsedOf(pass, range, total)
      return {
        pieceId, hand,
        startMeasure: range.startMeasure, endMeasure: range.endMeasure,
        hits: 0, misses: 0, played: true, at,
        ...(deliberate ? {deliberate} : {}),
        ...(elapsedMs !== undefined ? {elapsedMs} : {}),
      }
    })
}
