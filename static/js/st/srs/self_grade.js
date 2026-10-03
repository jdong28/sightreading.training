// The vocabulary of acoustic mode's self-grading: the four grades a player
// taps after playing a card on an acoustic piano, anchored to what happened
// rather than a raw rating, because raw self-ratings are biased (Bergee 1997;
// Hewitt 2015). Each grade is FSRS's own again/hard/good/easy input
// (st/srs/schedule), so a self-graded review schedules exactly as a detected
// one of the same grade.

/**
 * @typedef {Object} SelfGrade
 * @property {number} key 1-4, also the hotkey
 * @property {string} word the grade's name, e.g. "Clean"
 * @property {number} grade 1 again, 2 hard, 3 good, 4 easy
 * @property {string} definition what the grade means, by what happened
 */

/** @type {SelfGrade[]} */
export const SELF_GRADES = [
  {key: 1, word: "Fell apart", grade: 1, definition: "stopped, went back or lost the place"},
  {key: 2, word: "Stumbled", grade: 2, definition: "kept going, but wrong notes or rhythm slipped"},
  {key: 3, word: "Clean", grade: 3, definition: "right notes and rhythm, some hesitation"},
  {key: 4, word: "Easy", grade: 4, definition: "right notes and rhythm, steady"},
]

// elapsed time over this is a pause, not play: left off the review and
// practice stint it would otherwise inflate
export const SELF_PAUSE_MS = 5 * 60 * 1000

// the least the grade row must have shown what it is showing before it will
// take an answer (see SelfGradeRow#settled): a tap or key press sooner than
// this after the row changed what it shows — a new card, or the "Where?"
// question taking the pills' place — is a repeat of the one before it, and
// would answer for what it replaced. The flash (SELF_GRADE_FLASH_MS) makes
// this guard visible on the tapped pill; the dwell stays as the backstop on
// the next card or question, which the flash doesn't cover
export const SELF_GRADE_DWELL_MS = 500

// how long a tapped grade is shown recorded, pill in place, before it is
// actually written (see SightReadingPage#writeSelfGrade): makes today's
// double-tap guard (SELF_GRADE_DWELL_MS) visible, rather than silent
export const SELF_GRADE_FLASH_MS = 500

// the instruction the receipt line holds before the first grade of a session
// (see self_grade_receipt.jsx)
export const SELF_GRADE_INSTRUCTION =
  "Play the card, then tap the grade it earned. Each grade is recorded for the bars on the card."

/**
 * @param {number} grade 1-4
 * @returns {string} the grade's word, e.g. "Clean"
 */
export function selfWord(grade) {
  return SELF_GRADES.find(g => g.grade == grade)?.word ?? ""
}

function barsLabel(start, end) {
  return start == end ? `bar ${start}` : `bars ${start}–${end}`
}

/**
 * The words of the receipt line (st/components/sight_reading/self_grade_receipt)
 * after a self-graded pass, see MeasureCardGenerator#selfReceipt /
 * PlanGenerator#selfReceipt.
 * @param {Object} receipt
 * @param {number} receipt.lap the card's graded laps this sitting, or null
 * when it isn't looping
 * @param {number} receipt.startMeasure
 * @param {number} receipt.endMeasure
 * @param {number} receipt.grade 1-4
 * @param {number[]|null} [receipt.bars] the Where? answer's bar, if any
 * @param {string[]} [receipt.slipped]
 * @param {{measure: number, words: string}|null} [receipt.when] the bar the
 * grade went to and when it comes back (today's programme only)
 * @returns {{head: string, grade: string, where: string|null, slipped: string|null, when: string|null}}
 */
export function receiptParts(receipt) {
  let {lap, startMeasure, endMeasure, grade, bars, slipped, when} = receipt
  let range = barsLabel(startMeasure, endMeasure)

  return {
    head: lap ? `Pass ${lap} recorded · ${range}` : `Recorded · ${range}`,
    grade: selfWord(grade),
    where: bars && bars.length ? `in bar ${bars.join(", ")}` : null,
    slipped: slipped && slipped.length ? `${slipped.join(", ")} slipped` : null,
    when: when ? `bar ${when.measure} ${when.words}` : null,
  }
}
