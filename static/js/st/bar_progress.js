// A bar's progress on the score-first sheet music page: learnedness (how
// many clean passes in a row a bar has, out of 3, under one hand), the marks
// a session leaves on its bars, and the words of the session-ended strip.
// Pure, reading only ItemRecord#passes (or recent, for an item that doesn't
// carry it yet) and the session log the trainer keeps (see
// MeasureCardGenerator#setOnPass); never the scheduler or planner, and never
// written back anywhere.

import {GOOD} from "st/srs/grade"

// the line between "nearly" and "trouble" everywhere on the score page:
// session marks, the pop-up's figures and the difficulty chart
export const TROUBLE_BELOW = 80

/**
 * A single-bar item's pass history, oldest first: its own passes (see
 * withPass in st/srs/records), or its recent for an item that doesn't carry
 * the field yet (one not written since passes was kept).
 * @param {ItemRecord|null} item
 * @returns {Array[]} entries [at, columns, clean, grade]
 */
export function passHistory(item) {
  if (!item) { return [] }
  return item.passes !== undefined ? item.passes : (item.recent || [])
}

/**
 * The accuracy of one pass history entry: round(100 * clean / columns) for
 * a detected entry, null for a self-graded one (columns null) or one with no
 * columns.
 * @param {Array} entry [at, columns, clean, grade]
 * @returns {number|null}
 */
export function passAccuracy(entry) {
  let [, columns, clean] = entry
  if (columns == null || !(columns > 0)) { return null }
  return Math.round(100 * clean / columns)
}

/**
 * Whether one pass history entry is clean: every column clean for a
 * detected entry (columns == clean, both over 0), or graded Good or Easy for
 * a self-graded one (columns null).
 * @param {Array} entry [at, columns, clean, grade]
 * @returns {boolean}
 */
export function isClean(entry) {
  let [, columns, clean, grade] = entry
  if (columns == null) { return grade >= GOOD }
  return columns > 0 && clean === columns
}

/**
 * A bar's learnedness under one hand (build note 2): the clean passes at the
 * end of its history (oldest first), stopping at the first that isn't clean,
 * capped at 3. An entry with 0 columns (nothing playable) is ignored outright,
 * neither counted nor breaking the run.
 * @param {ItemRecord|null} item the single-bar item of the hand, or null for
 * one never played
 * @returns {number} 0-3
 */
export function learnedness(item) {
  let history = passHistory(item)
  let count = 0

  for (let i = history.length - 1; i >= 0; i -= 1) {
    let entry = history[i]
    if (entry[1] === 0) { continue }
    if (!isClean(entry)) { break }
    count += 1
    if (count >= 3) { break }
  }

  return count
}

/**
 * The number of a piece's bars learned (learnedness 3) under one hand (see
 * C5): independent of the scheduler's own "learned" (graduated off the
 * ladder), which this never reads.
 * @param {ItemRecord[]} items the piece's items, any hand
 * @param {number[]} measures the piece's printed bar numbers
 * @param {string} hand one of HANDS
 * @returns {number}
 */
export function learnedCount(items, measures, hand) {
  let byMeasure = new Map()
  for (let item of items) {
    if (item.hand == hand && item.startMeasure == item.endMeasure && !item.beats) {
      byMeasure.set(item.startMeasure, item)
    }
  }

  return measures.filter(measure => learnedness(byMeasure.get(measure) || null) == 3).length
}

// the share of clean entries past which a mark is "clean", at or past
// TROUBLE_BELOW "near", else "trouble"
function markOf(sharePercent) {
  if (sharePercent >= 100) { return "clean" }
  return sharePercent >= TROUBLE_BELOW ? "near" : "trouble"
}

/**
 * The marks a session's log leaves on the bars it touched (build note 5 /
 * C3), keyed by printed bar number: a detected bar's mark and label come
 * from the share of its columns played clean over the whole session; a
 * bar with only self-graded passes in the log instead shares its clean
 * passes (C4). Bars never in the log are left out.
 * @param {Object[]} log the trainer's session log: entries reported by
 * MeasureCardGenerator#setOnPass / PlanGenerator's equivalent, each with a
 * bars array of {measure, columns, clean, grade}
 * @returns {Map<number, {mark: string, label: string}>}
 */
export function sessionMarks(log) {
  let byMeasure = new Map()
  for (let entry of log) {
    for (let bar of entry.bars) {
      if (!byMeasure.has(bar.measure)) { byMeasure.set(bar.measure, []) }
      byMeasure.get(bar.measure).push(bar)
    }
  }

  let marks = new Map()
  for (let [measure, bars] of byMeasure) {
    let detected = bars.filter(bar => bar.columns != null)
    if (detected.length) {
      let columns = detected.reduce((sum, bar) => sum + bar.columns, 0)
      let clean = detected.reduce((sum, bar) => sum + bar.clean, 0)
      let pct = columns > 0 ? Math.round(100 * clean / columns) : 0
      marks.set(measure, {mark: markOf(pct), label: `${pct}%`})
    } else {
      let clean = bars.filter(bar => bar.grade >= GOOD).length
      let pct = bars.length > 0 ? 100 * clean / bars.length : 0
      marks.set(measure, {mark: markOf(pct), label: `${clean} of ${bars.length} clean`})
    }
  }

  return marks
}

// the rounded percent of hits read, or null with neither (accuracyPercent in
// sight_reading_page.jsx, duplicated here to keep this module free of a
// dependency on the trainer's own page)
function accuracyOf(hits, misses) {
  if (!hits && !misses) { return null }
  return Math.round(hits / (hits + misses) * 100)
}

const pluralize = (n, word) => `${n} ${word}${n == 1 ? "" : "s"}`

/**
 * The words of the session-ended strip (build note 5 / C3): the headline
 * figure (the Accuracy card's last reading, or the self-graded share), the
 * comparison with the piece's previous session, and the second line.
 * @param {Object} opts
 * @param {Object} opts.record the session record as last written
 * (SessionRecord: notesRead, misses, elapsedSeconds, selfGraded)
 * @param {Object|null} opts.previous the piece's previous session record, or
 * null for none (the caller resolves this: the latest recentSessions()
 * record on this piece, started before this one, with notesRead+misses > 0)
 * @param {Object[]} opts.log the trainer's session log (see sessionMarks)
 * @param {boolean} opts.acoustic whether the session was played acoustically
 * @returns {{headline: string, headlineSuffix: string, comparison: string|null, second: string}}
 */
export function endedSummary({record, previous, log, acoustic}) {
  let bars = new Set(log.flatMap(entry => entry.bars.map(bar => bar.measure)))
  let seconds = record.elapsedSeconds || 0
  let minutesWords = seconds < 60 ? "Under a minute" : pluralize(Math.round(seconds / 60), "minute")
  let second = `${minutesWords} · ${pluralize(bars.size, "bar")} played · each bar's accuracy is marked on the score`

  if (acoustic) {
    let {passes = 0, clean = 0} = record.selfGraded || {}
    return {headline: `${clean} of ${passes}`, headlineSuffix: "passes clean", comparison: null, second}
  }

  let pct = accuracyOf(record.notesRead, record.misses)
  let comparison = null
  if (previous) {
    let previousPct = accuracyOf(previous.notesRead, previous.misses)
    if (pct != null && previousPct != null) {
      let diff = pct - previousPct
      comparison = diff > 0 ? `Up ${diff} points on your last session` :
        diff < 0 ? `Down ${-diff} points on your last session` : "Level with your last session"
    }
  }

  return {headline: `${pct}%`, headlineSuffix: "accuracy", comparison, second}
}
