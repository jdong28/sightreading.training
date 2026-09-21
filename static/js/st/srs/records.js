// The stored records of spaced repetition on imported pieces: items (a
// measure range of one piece under one hand setting), reviews (the append-only
// log of attempts at an item) and studies (a piece the player has begun). The
// local store (st/storage) keeps them in the items, reviews and studies stores
// and writes them with LocalStore#recordAttempt.
//
// Everything that schedules is derived from the reviews; the lifetime totals
// on an item (hits, misses, attempts, lastPracticed, elapsedMs) have the same
// meaning as the section stats of DB_VERSION 3 and are only kept, never used
// to rank anything. Measures are the score's printed bar numbers, as
// everywhere else.

// the hand settings of an item, the words of score_render's Hand
export const HANDS = ["both", "upper", "lower"]

// the score staves a review's misses are counted by, see ReviewRecord
export const STAVES = ["upper", "lower"]

export const ITEM_LEVELS = ["bar", "span", "phrase", "section", "piece"]

export const ITEM_STATES = [
  "learning", "review", "relearning", "merged", "split", "tracked", "suspended",
]

export const REVIEW_KINDS = ["attempt", "legacy", "implied"]

export const STUDY_STATUSES = ["learning", "maintaining", "shelved"]

// how many attempts an item keeps in recent
export const RECENT_ATTEMPTS = 5

/**
 * One measure range of a piece under one hand setting, created the first time
 * it is practiced (or, later, activated by the scheduler). Items practiced
 * outside the scheduler's tree, and every section stats row of DB_VERSION 3,
 * are "tracked": totals and log only, never scheduled.
 * @typedef {Object} ItemRecord
 * @property {string} id see itemId
 * @property {string} pieceId
 * @property {string} hand one of HANDS
 * @property {number} startMeasure
 * @property {number} endMeasure
 * @property {number[]} [beats] reserved: [fromBeat, toBeat] inside the one
 * bar startMeasure == endMeasure
 * @property {string} level one of ITEM_LEVELS, a label for display and
 * queries; scheduling reads state
 * @property {string} state one of ITEM_STATES
 * @property {number} step the ladder rung
 * @property {number} [due] when the item is next due, absent while unscheduled
 * @property {number} [last] the last attempt that moved the schedule
 * @property {number} [s] stability in days
 * @property {number} [d] difficulty, 1-10
 * @property {number} reps
 * @property {number} lapses
 * @property {number} streak
 * @property {number} [lastGrade] 1-4
 * @property {number} hits
 * @property {number} misses
 * @property {number} attempts practice stints on the range with any notes played
 * @property {number} lastPracticed
 * @property {number} [elapsedMs] time spent playing it, kept once timed
 * @property {Array[]} recent the last RECENT_ATTEMPTS attempts, oldest first,
 * as [at, columns, clean, grade]
 * @property {number} [paceMs] the item's usual pace, ms per notated beat (per
 * column without the score's rhythm), a running mean over its clean wait mode
 * attempts (see attemptPace in st/srs/grade)
 * @property {string} [contentKey] a hash of the item's columns, shared by
 * repeated material
 * @property {number} algo the scheduler version that wrote s, d and due, 0
 * for none
 * @property {number} createdAt
 */

/**
 * One entry of the log, keyed by [itemId, at]: one item can't be attempted
 * twice in a millisecond, so importing the same log twice adds nothing and
 * merging two libraries is a union.
 *
 * A "legacy" review carries the totals of a DB_VERSION 3 section stats row
 * (hits, misses, attempts, elapsedMs) and no grade. An "attempt" (one pass
 * through the item's columns) and an "implied" review (credit from a larger
 * attempt) carry the grade and the raw measurements it was worked out from.
 *
 * staffMisses splits the attempt's misses by hand: for each score staff
 * ("upper", "lower", the staves of column.staves), the misses at which a note
 * of that staff wasn't held. A miss with notes of both staves not held counts
 * for both, and both keys are always present (0 when none), so a review of a
 * hands together item says which hand struggled in it.
 * @typedef {Object} ReviewRecord
 * @property {string} itemId
 * @property {number} at
 * @property {string} pieceId
 * @property {string} [sessionId]
 * @property {string} kind one of REVIEW_KINDS
 * @property {number} [grade] 1 again, 2 hard, 3 good, 4 easy; absent on legacy
 * @property {string} [was] the item's state before, "new" at first sight
 * @property {number} [columns]
 * @property {number} [clean] columns hit without a miss
 * @property {number} misses on an attempt every slip (st/srs/grade), on a
 * legacy review the counted misses
 * @property {number} [stuck]
 * @property {number} [skipped]
 * @property {number} [hesitations]
 * @property {number} [elapsedMs] pauses over 30 s left out
 * @property {number} [leadMs] reading time before the first note
 * @property {string} [mode] "wait" or "scroll"
 * @property {number} [speed]
 * @property {Array[]} [bars] multi-bar items: [measure, columns, clean, misses, ms] a bar
 * @property {number[]} [trouble] the indices among the item's columns of those
 * with a miss
 * @property {{upper: number, lower: number}} [staffMisses]
 * @property {number} [r] the recall the scheduler predicted
 * @property {number} [algo] the grading version
 * @property {number} [hits] legacy only
 * @property {number} [attempts] legacy only
 */

/**
 * A piece the player has begun, with room for its phrase map.
 * @typedef {Object} StudyRecord
 * @property {string} pieceId
 * @property {string} status one of STUDY_STATUSES
 * @property {number} startedAt
 * @property {Object} [map] {algo, basis: "musicxml"|"song", computedAt,
 * measures, numbersHash, phrases: [start, end][], sections: [start, end][],
 * strengths: number[], edited}
 */

const isCount = n => Number.isInteger(n) && n >= 0
const isTime = n => typeof n == "number" && Number.isFinite(n)
const optional = (value, test) => value === undefined || test(value)
const oneOf = list => value => list.includes(value)

const isRange = range => Array.isArray(range) && range.length == 2 &&
  range.every(n => typeof n == "number" && Number.isFinite(n)) && range[0] <= range[1]

/**
 * The id of the item of a measure range and hand:
 * `${pieceId}:${hand}:${startMeasure}-${endMeasure}`, or for a beat range
 * inside one bar `${pieceId}:${hand}:${measure}@${fromBeat}-${toBeat}`.
 * @param {{pieceId: string, hand: string, startMeasure: number, endMeasure: number, beats?: number[]}} item
 * @returns {string}
 */
export function itemId({pieceId, hand, startMeasure, endMeasure, beats}) {
  let range = beats ? `${startMeasure}@${beats[0]}-${beats[1]}` : `${startMeasure}-${endMeasure}`
  return `${pieceId}:${hand}:${range}`
}

/**
 * @param {*} item
 * @returns {boolean} whether item has the shape of a stored item
 */
export function validItem(item) {
  return !!item && typeof item == "object" &&
    typeof item.pieceId == "string" && item.pieceId != "" &&
    HANDS.includes(item.hand) &&
    Number.isInteger(item.startMeasure) && Number.isInteger(item.endMeasure) &&
    item.startMeasure <= item.endMeasure &&
    optional(item.beats, beats => isRange(beats) && item.startMeasure == item.endMeasure) &&
    item.id === itemId(item) &&
    ITEM_LEVELS.includes(item.level) && ITEM_STATES.includes(item.state) &&
    isCount(item.step) &&
    optional(item.due, isTime) && optional(item.last, isTime) &&
    optional(item.s, isTime) && optional(item.d, isTime) &&
    isCount(item.reps) && isCount(item.lapses) && isCount(item.streak) &&
    optional(item.lastGrade, oneOf([1, 2, 3, 4])) &&
    isCount(item.hits) && isCount(item.misses) && isCount(item.attempts) &&
    isTime(item.lastPracticed) && optional(item.elapsedMs, isCount) &&
    Array.isArray(item.recent) && item.recent.length <= RECENT_ATTEMPTS &&
    item.recent.every(entry => Array.isArray(entry) && entry.length == 4) &&
    optional(item.paceMs, isTime) && optional(item.contentKey, key => typeof key == "string") &&
    isCount(item.algo) && isTime(item.createdAt)
}

const validStaffMisses = misses => !!misses && typeof misses == "object" &&
  Object.keys(misses).length == STAVES.length && STAVES.every(staff => isCount(misses[staff]))

/**
 * @param {*} review
 * @returns {boolean} whether review has the shape of a stored review
 */
export function validReview(review) {
  if (!review || typeof review != "object" ||
      typeof review.pieceId != "string" || review.pieceId == "" ||
      typeof review.itemId != "string" || !review.itemId.startsWith(`${review.pieceId}:`) ||
      !isTime(review.at) || !REVIEW_KINDS.includes(review.kind) ||
      !optional(review.sessionId, id => typeof id == "string") ||
      !isCount(review.misses) || !optional(review.elapsedMs, isCount)) {
    return false
  }

  if (review.kind == "legacy") {
    return review.grade === undefined && isCount(review.hits) && isCount(review.attempts)
  }

  return [1, 2, 3, 4].includes(review.grade) &&
    (review.was == "new" || ITEM_STATES.includes(review.was)) &&
    isCount(review.columns) && isCount(review.clean) && isCount(review.stuck) &&
    isCount(review.skipped) && isCount(review.hesitations) &&
    optional(review.leadMs, isCount) &&
    ["wait", "scroll"].includes(review.mode) && optional(review.speed, isTime) &&
    optional(review.bars, bars => Array.isArray(bars) &&
      bars.every(bar => Array.isArray(bar) && bar.length == 5)) &&
    optional(review.trouble, trouble => Array.isArray(trouble) && trouble.every(isCount)) &&
    optional(review.staffMisses, validStaffMisses) &&
    optional(review.r, isTime) && isCount(review.algo) &&
    review.hits === undefined && review.attempts === undefined
}

/**
 * @param {*} study
 * @returns {boolean} whether study has the shape of a stored study
 */
export function validStudy(study) {
  return !!study && typeof study == "object" &&
    typeof study.pieceId == "string" && study.pieceId != "" &&
    STUDY_STATUSES.includes(study.status) && isTime(study.startedAt) &&
    optional(study.map, map => !!map && typeof map == "object")
}

/**
 * A new, tracked item of a measure range, with nothing practiced.
 * @param {{pieceId: string, hand?: string, startMeasure: number, endMeasure: number}} range
 * @param {number} [createdAt]
 * @returns {ItemRecord}
 */
export function newItem({pieceId, hand="both", startMeasure, endMeasure}, createdAt=Date.now()) {
  let fields = {pieceId, hand, startMeasure, endMeasure}
  return {
    id: itemId(fields),
    ...fields,
    level: startMeasure == endMeasure ? "bar" : "span",
    state: "tracked",
    step: 0,
    reps: 0,
    lapses: 0,
    streak: 0,
    hits: 0,
    misses: 0,
    attempts: 0,
    lastPracticed: 0,
    recent: [],
    algo: 0,
    createdAt,
  }
}

/**
 * The item a DB_VERSION 3 section stats row (or one in a library file of
 * LIBRARY_VERSION 4 and earlier) becomes: tracked, for both hands, since the
 * rows mixed every hand setting, with its totals verbatim.
 * @param {Object} stats a section stats row
 * @param {number} [createdAt]
 * @returns {ItemRecord}
 */
export function itemFromSectionStats(stats, createdAt=Date.now()) {
  let item = {
    ...newItem(stats, createdAt),
    hits: stats.hits,
    misses: stats.misses,
    attempts: stats.attempts,
    lastPracticed: stats.lastPracticed,
  }

  if (stats.elapsedMs !== undefined) {
    item.elapsedMs = stats.elapsedMs
  }

  return item
}

/**
 * The legacy review of a section stats row, so the log accounts for the
 * totals it carried.
 * @param {Object} stats a section stats row
 * @returns {ReviewRecord}
 */
export function legacyReview(stats) {
  let review = {
    itemId: itemId({...stats, hand: "both"}),
    at: stats.lastPracticed,
    pieceId: stats.pieceId,
    kind: "legacy",
    hits: stats.hits,
    misses: stats.misses,
    attempts: stats.attempts,
  }

  if (stats.elapsedMs !== undefined) {
    review.elapsedMs = stats.elapsedMs
  }

  return review
}

/**
 * An item with one practice stint on it added to its totals, as section
 * stats were added up before items.
 * @param {ItemRecord} item
 * @param {{hits: number, misses: number, at: number, elapsedMs?: number}} practice
 * @returns {ItemRecord}
 */
export function itemWithPractice(item, {hits, misses, at, elapsedMs}) {
  let record = {
    ...item,
    hits: item.hits + hits,
    misses: item.misses + misses,
    attempts: item.attempts + (hits || misses ? 1 : 0),
    lastPracticed: Math.max(item.lastPracticed, at),
  }

  // only items timed once carry the field
  if (elapsedMs !== undefined || item.elapsedMs !== undefined) {
    record.elapsedMs = (item.elapsedMs || 0) + Math.round(elapsedMs || 0)
  }

  return record
}

/**
 * The records of a piece under another piece id, as a library import
 * remaps a piece matched to a stored one.
 * @param {ItemRecord} item
 * @param {string} pieceId
 * @returns {ItemRecord}
 */
export function itemForPiece(item, pieceId) {
  let record = {...item, pieceId}
  record.id = itemId(record)
  return record
}

/**
 * @param {ReviewRecord} review
 * @param {string} pieceId
 * @returns {ReviewRecord}
 */
export function reviewForPiece(review, pieceId) {
  return {
    ...review,
    pieceId,
    itemId: `${pieceId}${review.itemId.slice(review.pieceId.length)}`,
  }
}

/**
 * The section stats of DB_VERSION 3, as a view over items: one row per
 * measure range with the totals of every hand setting added up, in the order
 * each range first appears in items. Beat range items aren't a section.
 * @param {ItemRecord[]} items
 * @returns {Object[]} section stats rows
 */
export function sectionStatsOf(items) {
  let rows = new Map()
  for (let item of items) {
    if (item.beats) {
      continue
    }

    let key = `${item.pieceId}\n${item.startMeasure}\n${item.endMeasure}`
    let row = rows.get(key)
    if (!row) {
      row = {
        pieceId: item.pieceId,
        startMeasure: item.startMeasure,
        endMeasure: item.endMeasure,
        hits: 0,
        misses: 0,
        attempts: 0,
        lastPracticed: 0,
      }
      rows.set(key, row)
    }

    row.hits += item.hits
    row.misses += item.misses
    row.attempts += item.attempts
    row.lastPracticed = Math.max(row.lastPracticed, item.lastPracticed)
    if (item.elapsedMs !== undefined) {
      row.elapsedMs = (row.elapsedMs || 0) + item.elapsedMs
    }
  }

  return [...rows.values()]
}
