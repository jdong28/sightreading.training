// The grade of one attempt at an item, worked out from what detection saw on
// each of its columns, never asked of the player: again, hard, good or easy.
//
// Only the notes are judged. The score's rhythm enters in one place, and only
// to excuse: a column's latency (from it becoming the head to the first of its
// own keys down, see NoteMatcher#measured) is compared with the player's own
// pace in the attempt scaled by the notated gap before it, so a column after
// a long note is never taken for a hesitation. The latency, not the time on
// the column, is what hesitates: a column completed late because a key was
// held instead of struck again, or rolled slowly, was started on time. The
// thresholds are a first guess; reviews keep the raw measurements and
// GRADE_ALGO, so history can be graded again by a revised function.

// the version of this grading, stored on each review as algo: 1 read
// hesitations from the time on each column, 2 from its latency
export const GRADE_ALGO = 2

export const AGAIN = 1
export const HARD = 2
export const GOOD = 3
export const EASY = 4

// misses on one column that say the player doesn't know its notes
export const STUCK_MISSES = 3
// the share of columns with a slip past which the attempt failed
export const SLIP_SHARE = 0.25
// the share of columns hesitated on past which the attempt was hard
export const HESITATION_SHARE = 0.25
// a column's latency passes both of these to be a hesitation
export const HESITATION_MIN_MS = 1500
export const HESITATION_PACE = 2.5
// the most an easy attempt's pace may be above the item's usual pace
export const EASY_PACE = 1.15

/**
 * What detection saw on one column of an attempt.
 * @typedef {Object} AttemptColumn
 * @property {number} misses slips on the column, each try with a wrong key
 * pressed
 * @property {boolean} [skipped] passed over without being played
 * @property {number|null} [ms] time on the column: from the column before
 * it done to it done, which the pace is worked out from
 * @property {number|null} [latency] from the column becoming the head to the
 * first of its own keys down, which a hesitation is read from; null (or
 * absent) when not measured, never a hesitation
 * @property {number|null} [gap] notated beats from the column before it,
 * null when the column carries no score rhythm
 */

const median = values => {
  let sorted = [...values].sort((a, b) => a - b)
  let mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const beatsOf = column => column.gap > 0 ? column.gap : 1

/**
 * The player's own pace in an attempt: the median over its columns of the
 * time on each per notated beat before it (per column when the score's
 * rhythm isn't known), leaving out the first column when it opens the
 * attempt, as its time is spent reading, and skipped or untimed columns.
 * @param {AttemptColumn[]} columns
 * @param {Object} [opts]
 * @param {boolean} [opts.lead=true] whether columns[0] opens the attempt
 * @returns {number|null} ms per beat, null without a timed column
 */
export function attemptPace(columns, {lead=true}={}) {
  let paces = columns
    .filter((column, idx) => !(lead && idx == 0) && !column.skipped && column.ms != null)
    .map(column => column.ms / beatsOf(column))

  return paces.length ? median(paces) : null
}

/**
 * The counts an attempt is graded by.
 * @param {AttemptColumn[]} columns
 * @param {Object} opts
 * @param {string} opts.mode "wait" or "scroll"; only wait mode times the
 * player, so scroll mode never hesitates
 * @param {boolean} [opts.lead=true] whether columns[0] opens the attempt,
 * never a hesitation
 * @param {number|null} [opts.pace] the pace to judge hesitations by, the
 * attempt's own by default (see attemptPace), eg. a whole card's for one of
 * its bars
 * @returns {{columns: number, clean: number, slips: number, misses: number,
 * stuck: number, skipped: number, hesitations: number, pace: number|null}}
 */
export function attemptCounts(columns, {mode, lead=true, pace}) {
  if (pace === undefined) {
    pace = attemptPace(columns, {lead})
  }

  let counts = {
    columns: columns.length, clean: 0, slips: 0, misses: 0, stuck: 0, skipped: 0, hesitations: 0,
    pace: mode == "wait" ? pace : null,
  }

  for (let column of columns) {
    counts.misses += column.misses
    if (column.skipped) {
      counts.skipped += 1
    } else if (!column.misses) {
      counts.clean += 1
    }

    if (column.misses) { counts.slips += 1 }
    if (column.misses >= STUCK_MISSES) { counts.stuck += 1 }
  }

  if (mode == "wait") {
    counts.hesitations = hesitations(columns, {lead, pace}).length
  }

  return counts
}

/**
 * The columns of an attempt played in wait mode that were hesitated on: a
 * column whose latency passes both HESITATION_MIN_MS and HESITATION_PACE
 * times the pace for the notated beats before it. The column opening the
 * attempt never is.
 * @param {AttemptColumn[]} columns
 * @param {Object} opts
 * @param {boolean} [opts.lead=true] whether columns[0] opens the attempt
 * @param {number|null} opts.pace ms per beat, see attemptPace
 * @returns {number[]} their indices
 */
export function hesitations(columns, {lead=true, pace}) {
  return columns.flatMap((column, idx) => hesitated(column, pace) && !(lead && idx == 0) ? [idx] : [])
}

function hesitated(column, pace) {
  if (column.skipped || column.latency == null || pace == null) { return false }
  return column.latency > Math.max(HESITATION_MIN_MS, HESITATION_PACE * pace * beatsOf(column))
}

/**
 * The grade of an attempt from its counts:
 * - again: a column skipped or stuck, or slips on over a quarter of them
 * - hard: any slip, or hesitations on over a quarter of them
 * - good: no slip
 * - easy: no slip and no hesitation in wait mode, at first sight or at no
 *   more than EASY_PACE times the item's usual pace
 * @param {Object} counts see attemptCounts
 * @param {Object} opts
 * @param {string} opts.mode "wait" or "scroll", which is never easy as the
 * tempo was imposed
 * @param {boolean} [opts.firstSight] the item's first attempt
 * @param {number} [opts.usualPace] the item's paceMs
 * @returns {number} AGAIN, HARD, GOOD or EASY
 */
export function gradeOf(counts, {mode, firstSight=false, usualPace}) {
  let {columns, slips, stuck, skipped, hesitations, pace} = counts
  let n = Math.max(1, columns)

  if (skipped > 0 || stuck > 0 || slips / n > SLIP_SHARE) {
    return AGAIN
  }

  if (slips > 0 || hesitations / n > HESITATION_SHARE) {
    return HARD
  }

  let atPace = firstSight || usualPace == null || pace == null || pace <= EASY_PACE * usualPace
  if (mode == "wait" && hesitations == 0 && atPace) {
    return EASY
  }

  return GOOD
}

/**
 * The counts and grade of an attempt, see attemptCounts and gradeOf.
 * @param {AttemptColumn[]} columns
 * @param {Object} opts the options of both
 * @returns {Object} the counts with grade
 */
export function gradeAttempt(columns, opts) {
  let counts = attemptCounts(columns, opts)
  return {...counts, grade: gradeOf(counts, opts)}
}
