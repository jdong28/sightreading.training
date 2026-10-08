// Learnedness (three clean passes in a row at a bar; a miss resets the
// count) and the score page's session marks and ended-session summary,
// read only from ItemRecord#passes (st/srs/records) — a single-bar item's
// exact pass history, every complete pass whether graded or demoted to
// practice — never from the review log or recent alone, which miss clean
// off-schedule laps and hard laps that didn't fail (see AGENTS.md). Pure;
// never read by the scheduler or planner.
//
// The session log the score page keeps (every pass the generator reports
// between Begin and End session, see setOnPass in st/measure_cards) is an
// array of {at, startMeasure, endMeasure, hand, readThrough, self, grade,
// bars}, each bars entry a tuple [measure, columns, clean, grade] in the
// same shape as a passes entry (see barPasses in st/srs/attempt): columns
// and clean null for a self-graded pass.

import {GOOD} from "st/srs/grade"

// the accuracy (or share of clean self passes) at or above which a bar
// reads "near" rather than "trouble"; below it, "trouble"; 100 is "clean"
export const TROUBLE_BELOW = 80

/**
 * A single-bar item's pass history, oldest first: item.passes, or
 * item.recent for an item stored before passes was kept, or [] without one.
 * @param {ItemRecord|null} item
 * @returns {Array[]}
 */
export function passHistory(item) {
  if (!item) { return [] }
  return item.passes || item.recent || []
}

/**
 * The accuracy of one pass entry [at, columns, clean, grade]: null for a
 * self-graded entry (columns and clean null), which is never turned into a
 * percentage.
 * @param {Array} entry
 * @returns {number|null}
 */
export function passAccuracy(entry) {
  let [, columns, clean] = entry
  if (columns == null) { return null }
  return Math.round(100 * clean / columns)
}

/**
 * Whether a pass entry was clean: 100% accuracy for a detected pass (every
 * column clean), or a self grade of Clean or Easy (GOOD or above).
 * @param {Array} entry
 * @returns {boolean}
 */
export function isClean(entry) {
  let [, columns, clean, grade] = entry
  if (columns == null) { return grade >= GOOD }
  return clean == columns
}

/**
 * A single-bar item's learnedness: the clean passes at the end of its pass
 * history (passHistory), oldest first, stopping at the first pass that
 * isn't clean, capped at 3 ("Learned"). A miss resets the count to 0,
 * which also un-learns a learned bar. An entry of 0 columns is ignored
 * (counted toward nothing, never breaking the run). A bar is played when
 * its item has attempts > 0 or any history entry; an unplayed bar gets no
 * tint and no label.
 * @param {ItemRecord|null} item the setup hand's item for the bar
 * @returns {{played: boolean, count: number}} count 0-3, 3 meaning Learned
 */
export function learnedness(item) {
  let played = !!item && (item.attempts > 0 || passHistory(item).length > 0)
  if (!played) { return {played: false, count: 0} }

  let history = passHistory(item).filter(([, columns]) => columns !== 0)
  let count = 0
  for (let i = history.length - 1; i >= 0 && count < 3; i--) {
    if (!isClean(history[i])) { break }
    count += 1
  }

  return {played: true, count}
}

/**
 * The number of a piece's bars learned (learnedness 3) under one hand
 * setting, for the setup pane's "Learned x/N" (N is measures.length).
 * @param {ItemRecord[]} items the piece's items, any hand
 * @param {number[]} measures the piece's printed bar numbers
 * @param {string} hand one of HANDS (st/srs/records), the setup hand (see
 * itemHand in st/data)
 * @returns {number}
 */
export function learnedCount(items, measures, hand) {
  let byMeasure = new Map()
  for (let item of items) {
    if (item.hand == hand && item.startMeasure == item.endMeasure && !item.beats) {
      byMeasure.set(item.startMeasure, item)
    }
  }

  return measures.filter(measure => learnedness(byMeasure.get(measure) || null).count >= 3).length
}

// clean at or above 100, trouble under TROUBLE_BELOW, near between
function tintOf(value) {
  if (value >= 100) { return "clean" }
  if (value >= TROUBLE_BELOW) { return "near" }
  return "trouble"
}

/**
 * The session's marks, one per bar that appears in the log: the bar's
 * accuracy over its passes in the log (Σclean ÷ Σcolumns), or, for a bar
 * with only self passes, the share of them clean, each tinted by the same
 * TROUBLE_BELOW threshold. Bars not in the log get no mark.
 * @param {Object[]} log the score page's session log, oldest first
 * @returns {Map<number, {measure: number, acoustic: boolean, tint: string, label: string}>}
 */
export function sessionMarks(log) {
  let totals = new Map()
  for (let entry of log || []) {
    for (let [measure, columns, clean, grade] of entry.bars) {
      let total = totals.get(measure) || {columns: 0, clean: 0, selfTotal: 0, selfClean: 0}
      if (columns == null) {
        total.selfTotal += 1
        if (grade >= GOOD) { total.selfClean += 1 }
      } else {
        total.columns += columns
        total.clean += clean
      }
      totals.set(measure, total)
    }
  }

  let marks = new Map()
  for (let [measure, total] of totals) {
    if (total.columns > 0) {
      let accuracy = Math.round(100 * total.clean / total.columns)
      marks.set(measure, {measure, acoustic: false, tint: tintOf(accuracy), label: `${accuracy}%`})
    } else if (total.selfTotal > 0) {
      let share = Math.round(100 * total.selfClean / total.selfTotal)
      marks.set(measure, {
        measure, acoustic: true, tint: tintOf(share),
        label: `${total.selfClean} of ${total.selfTotal} clean`,
      })
    }
  }

  return marks
}

// the rounded percent of notes read, or null with neither (accuracyPercent
// in st/components/pages/sight_reading_page, kept private here too, to
// avoid importing the trainer into this pure module)
function accuracyOf(record) {
  let {notesRead, misses} = record
  if (!notesRead && !misses) { return null }
  return Math.round(100 * notesRead / (notesRead + misses))
}

function isPriorOnSamePiece(previous, record) {
  return !!previous.settings && !!record.settings &&
    previous.settings.piece === record.settings.piece &&
    previous.startedAt < record.startedAt &&
    !!(previous.notesRead || previous.misses)
}

function comparisonWords(diff) {
  if (diff > 0) { return `Up ${diff} points on your last session` }
  if (diff < 0) { return `Down ${-diff} points on your last session` }
  return "Level with your last session"
}

function minutesWords(seconds) {
  let minutes = Math.round((seconds || 0) / 60)
  if (minutes <= 0) { return "Under a minute" }
  if (minutes == 1) { return "1 minute" }
  return `${minutes} minutes`
}

function countedMeasures(log) {
  let measures = new Set()
  for (let entry of log || []) {
    for (let [measure] of entry.bars) { measures.add(measure) }
  }
  return measures.size
}

/**
 * The session-ended strip's words (D3): the headline (the session's
 * accuracy, equal to the Accuracy card's figure at End session, or, when
 * the session detected no notes, its share of clean self-graded passes),
 * the comparison with the previous session on this piece, and the second
 * line.
 * @param {Object} opts
 * @param {Object} opts.record the session record as last written
 * (SessionRecord, st/note_stats#sessionRecord)
 * @param {Object|null} [opts.previous] a candidate previous session, used
 * only when it is on this piece, started before this one, and read some
 * notes; the latest such record in getAppStore().recentSessions() is the
 * caller's job to find
 * @param {Object[]} opts.log the score page's session log (see sessionMarks)
 * @param {boolean} [opts.acoustic] the instrument setting; when true and
 * the record has self-graded passes, the headline reads them even if some
 * notes were also detected
 * @returns {{headline: number|string, headlineUnit: "accuracy"|"passes clean",
 * comparison: string|null, detail: string}}
 */
export function endedSummary({record, previous, log, acoustic}) {
  let accuracy = accuracyOf(record)
  let selfGraded = record.selfGraded
  let useSelf = !!selfGraded && (acoustic || accuracy == null)

  let headline = useSelf ? `${selfGraded.clean} of ${selfGraded.passes}` : accuracy
  let headlineUnit = useSelf ? "passes clean" : "accuracy"

  let comparison = null
  if (!useSelf && accuracy != null && previous && isPriorOnSamePiece(previous, record)) {
    let prevAccuracy = accuracyOf(previous)
    if (prevAccuracy != null) {
      comparison = comparisonWords(accuracy - prevAccuracy)
    }
  }

  let bars = countedMeasures(log)
  let detail = `${minutesWords(record.elapsedSeconds)} · ${bars} ${bars == 1 ? "bar" : "bars"} played · ` +
    "each bar's accuracy is marked on the score"

  return {headline, headlineUnit, comparison, detail}
}
