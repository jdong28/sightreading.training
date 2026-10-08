// A bar's own practice, read from its single-bar item alone (st/srs/records
// ItemRecord#passes, falling back to recent for an item stored before the
// field was kept), and the session just played, read from the page's session
// log (SightReadingPage#sessionLog, one entry per finished pass from the
// generator's onPass hook, st/measure_cards). This is the score-first score
// page's reading of "how am I doing on this bar", independent of the
// scheduler and the planner: learnedness ("three clean passes in a row") is
// never fed back into applyGrade, replay or the queue, and the scheduler's
// own "learned" (graduated to review) is a different thing shown nowhere by
// these functions.

import {GOOD} from "st/srs/grade"

// the accuracy under which a bar (or a session's bars) reads "trouble"
// rather than "near": the line between the session marks' near/trouble
// tints, the bar pop-up's oxblood figures and the difficulty legend
export const TROUBLE_BELOW = 80

const percent = (hits, misses) => {
  if (!hits && !misses) { return null }
  return Math.round(hits / (hits + misses) * 100)
}

/**
 * A bar's pass history, oldest first, see ItemRecord#passes in st/srs/records.
 * An item without the field reads as if passes == recent; no item at all
 * reads as never played.
 * @param {Object|null} item the bar's single-bar item under one hand
 * @returns {Array[]} entries [at, columns, clean, grade]
 */
export function passHistory(item) {
  if (!item) { return [] }
  return item.passes ?? item.recent ?? []
}

/**
 * The accuracy of one pass at a bar (§C1): round(100 × clean ÷ columns).
 * null for a self-graded entry (no columns), which is never turned into a
 * percentage (§C4).
 * @param {Array} entry [at, columns, clean, grade]
 * @returns {number|null}
 */
export function passAccuracy([, columns, clean]) {
  if (!columns) { return null }
  return Math.round(100 * clean / columns)
}

/**
 * Whether one pass at a bar was clean: a detected pass with every column
 * clean (100% ⇔ a clean pass, §C1), or a self-graded pass graded Clean or
 * Easy (grade ≥ GOOD, §C4).
 * @param {Array} entry [at, columns, clean, grade]
 * @returns {boolean}
 */
export function isClean(entry) {
  let [, columns, clean, grade] = entry
  if (columns == null) { return grade != null && grade >= GOOD }
  return columns > 0 && clean == columns
}

/**
 * A bar's learnedness (§C2, build note 2): the clean passes in a row at the
 * end of its history (passHistory), oldest-to-newest, stopping at the first
 * pass that isn't clean, capped at 3 (3 is "Learned"). A pass of 0 columns
 * is ignored outright. null when the bar hasn't been played: no item, or
 * one with no attempts and no history.
 * @param {Object|null} item the bar's single-bar item under the setup hand
 * @returns {number|null} 0, 1, 2 or 3; null unplayed
 */
export function learnedness(item) {
  let history = passHistory(item).filter(entry => entry[1] !== 0)
  if (!item || !(item.attempts > 0 || history.length > 0)) { return null }

  let count = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (!isClean(history[i])) { break }
    count += 1
  }

  return Math.min(count, 3)
}

/**
 * The setup pane's "Learned x/N" (§C5): the piece's bars whose learnedness
 * is 3 under the given hand, out of measures.
 * @param {Object[]} items the piece's items, any hand
 * @param {number[]} measures the piece's printed bar numbers
 * @param {string} hand one of HANDS (st/srs/records)
 * @returns {number}
 */
export function learnedCount(items, measures, hand) {
  let byMeasure = new Map()
  for (let item of items) {
    if (item.hand == hand && item.startMeasure == item.endMeasure && !item.beats) {
      byMeasure.set(item.startMeasure, item)
    }
  }

  return measures.filter(measure => learnedness(byMeasure.get(measure) || null) === 3).length
}

// clean (100%), near (TROUBLE_BELOW% or more) or trouble, from a share 0-100
function markKind(share) {
  return share >= 100 ? "clean" : share >= TROUBLE_BELOW ? "near" : "trouble"
}

/**
 * The session's marks on every bar it played (§C3/§C4): a detected bar's
 * accuracy over its passes in the log (Σclean/Σcolumns), labelled "71%"; a
 * self-graded-only bar's share of clean passes, labelled "2 of 3 clean".
 * @param {Object[]} log the page's session log, one entry per finished pass
 * reported by MeasureCardGenerator#setOnPass: {bars: [{measure, columns,
 * clean, grade}], ...}
 * @returns {Map<number, {kind: "clean"|"near"|"trouble", label: string}>}
 */
export function sessionMarks(log) {
  let detected = new Map()
  let self = new Map()

  for (let entry of log) {
    for (let bar of entry.bars) {
      if (bar.columns == null) {
        let s = self.get(bar.measure) || {passes: 0, clean: 0}
        s.passes += 1
        if (bar.grade >= GOOD) { s.clean += 1 }
        self.set(bar.measure, s)
      } else {
        let d = detected.get(bar.measure) || {columns: 0, clean: 0}
        d.columns += bar.columns
        d.clean += bar.clean
        detected.set(bar.measure, d)
      }
    }
  }

  let marks = new Map()
  for (let [measure, {columns, clean}] of detected) {
    let accuracy = Math.round(100 * clean / columns)
    marks.set(measure, {kind: markKind(accuracy), label: `${accuracy}%`})
  }
  for (let [measure, {passes, clean}] of self) {
    let share = Math.round(100 * clean / passes)
    marks.set(measure, {kind: markKind(share), label: `${clean} of ${passes} clean`})
  }

  return marks
}

// "Under a minute", "1 minute" or "N minutes", from elapsed seconds
function minutesWords(seconds) {
  let minutes = Math.round((seconds || 0) / 60)
  if (minutes < 1) { return "Under a minute" }
  return minutes == 1 ? "1 minute" : `${minutes} minutes`
}

// the previous session on a piece (§C3): the latest of sessions with
// settings.piece == pieceId, startedAt before the one just ended, and notes
// played; sessions is unsorted and unfiltered (eg. getAppStore().recentSessions())
function previousSession(sessions, pieceId, before) {
  let candidates = sessions.filter(session =>
    session.settings?.piece == pieceId && session.startedAt < before &&
    (session.notesRead || session.misses))
  return candidates.reduce((latest, session) =>
    !latest || session.startedAt > latest.startedAt ? session : latest, null)
}

/**
 * The session-ended strip's words (§C3/§C4): the headline (the session's
 * accuracy, or its share of clean self-graded passes when nothing was
 * detected), the comparison with the previous session on this piece (none
 * for an acoustic-only record, or without one), and the second line
 * (minutes, bars played).
 * @param {Object} opts
 * @param {Object} opts.record the session just ended (SessionRecord, see
 * NoteStats#sessionRecord)
 * @param {string} opts.pieceId
 * @param {Object[]} [opts.sessions] every session to compare against (eg.
 * st/storage LocalStore#recentSessions()); only the latest on this piece,
 * before this one, with notes played, is read
 * @param {Object[]} opts.log the page's session log, see sessionMarks
 * @returns {{headline: string, headlineItalic: string, comparison:
 * string|null, detail: string}}
 */
export function endedSummary({record, pieceId, sessions=[], log}) {
  let accuracy = percent(record.notesRead, record.misses)
  let bars = new Set(log.flatMap(entry => entry.bars.map(bar => bar.measure))).size

  let headline, headlineItalic
  if (accuracy == null && record.selfGraded) {
    headline = `${record.selfGraded.clean} of ${record.selfGraded.passes}`
    headlineItalic = "passes clean"
  } else {
    headline = `${accuracy ?? 0}%`
    headlineItalic = "accuracy"
  }

  let comparison = null
  if (accuracy != null) {
    let previous = previousSession(sessions, pieceId, record.startedAt)
    let previousAccuracy = previous && percent(previous.notesRead, previous.misses)
    if (previousAccuracy != null) {
      let diff = accuracy - previousAccuracy
      comparison = diff > 0 ? `Up ${diff} points on your last session` :
        diff < 0 ? `Down ${-diff} points on your last session` :
        "Level with your last session"
    }
  }

  let detail = `${minutesWords(record.elapsedSeconds)} · ${bars} ${bars == 1 ? "bar" : "bars"} played · ` +
    "each bar's accuracy is marked on the score"

  return {headline, headlineItalic, comparison, detail}
}
