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

/**
 * @param {number} grade 1-4
 * @returns {string} the grade's word, e.g. "Clean"
 */
export function selfWord(grade) {
  return SELF_GRADES.find(g => g.grade == grade)?.word ?? ""
}
