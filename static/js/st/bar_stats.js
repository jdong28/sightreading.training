// A clicked bar's pop-up model (st/components/sight_reading/bar_popup): one
// hand's learnedness, pass history chart and streak, read-only from the
// cached items and the piece's flagged passages (st/difficulty). Serves
// both instrument settings alike: a self-graded pass carries no columns or
// clean count, only a grade. Never reads the async reviews store.

import {itemId} from "st/srs/records"
import {daysAgo} from "st/srs/planner"
import {selfWord} from "st/srs/self_grade"
import {romanNumeral} from "st/music"
import {LEVEL_WORDS} from "st/difficulty/index"
import {passHistory, passAccuracy, learnedness, TROUBLE_BELOW} from "st/bar_progress"

const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : s

// whether a flag (st/difficulty/records.flagsInForce) covers measure,
// directly or at one of its alsoAt recurrences
function inFlag(flag, measure) {
  return (measure >= flag.start && measure <= flag.end) ||
    (flag.alsoAt || []).some(([from, to]) => measure >= from && measure <= to)
}

// the setup hand's item for the bar, or null
function barItem(pieceId, measure, hand, items) {
  let id = itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})
  return items.find(i => i.id == id) || null
}

// the header tag: the flag in force, else the bar's learnedness
function tagOf(flag, learned) {
  if (flag) {
    return {text: `Passage ${romanNumeral(flag.num)} · ${LEVEL_WORDS[flag.level]}`, variant: "flag"}
  }

  let text = !learned.played ? "New" : learned.count >= 3 ? "Learned" : "Learning"
  return {text, variant: "muted"}
}

// the streak pips and words: the aria-label always gives the exact count,
// even where the visible word is "Learned"
function streakOf(learned) {
  return {
    filled: learned.count,
    label: learned.count >= 3 ? "Learned" : `${learned.count} of 3 clean passes in a row`,
    ariaLabel: `${learned.count} of 3 clean passes in a row`,
  }
}

// Latest/Best from the window's detected entries (accuracy), or, with none,
// the window's self grade words
function figuresOf(detected, self) {
  if (detected.length) {
    let accuracies = detected.map(passAccuracy)
    let latest = accuracies[accuracies.length - 1]
    let best = Math.max(...accuracies)
    return {
      latest: {value: latest, trouble: latest < TROUBLE_BELOW},
      best: {value: best, trouble: best < TROUBLE_BELOW},
    }
  }

  let bestGrade = Math.max(...self.map(([, , , grade]) => grade))
  return {
    latest: {word: selfWord(self[self.length - 1][3])},
    best: {word: selfWord(bestGrade)},
  }
}

// the accuracy chart's model, oldest first, null without a detected entry
// in the window (self passes never plot, see selfLineOf)
function chartOf(detected, now) {
  if (!detected.length) { return null }

  let values = detected.map(entry => {
    let value = passAccuracy(entry)
    return {value, trouble: value < TROUBLE_BELOW}
  })

  return {
    values,
    ariaLabel: `Accuracy each time played, oldest first: ${values.map(v => `${v.value}%`).join(", ")}. Target 100%.`,
    firstLabel: capitalize(daysAgo(detected[0][0], now)),
    lastLabel: capitalize(daysAgo(detected[detected.length - 1][0], now)),
  }
}

// the self passes in the window, as one line under the chart (or in place
// of it, with no detected entry), null without one
function selfLineOf(self) {
  if (!self.length) { return null }
  return `Graded by ear: ${self.map(([, , , grade]) => selfWord(grade)).join(" → ")}`
}

/**
 * A clicked bar's stats, for the pop-up anchored to it on the score
 * (st/components/sight_reading/bar_popup).
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {number} opts.measure the printed bar number clicked
 * @param {string} opts.hand the setup pane's hand, one of HANDS (st/srs/records)
 * @param {Object[]} [opts.items] the piece's items, any hand
 * @param {Object[]} [opts.flags] the piece's flags in force (st/difficulty/
 * records.flagsInForce)
 * @param {number} [opts.now]
 * @returns {{measure: number, tag: Object, streak: Object, played: number,
 * state: "empty"|"no-passes"|"played", notice?: string, figures?: Object,
 * chart?: Object|null, selfLine?: string|null}}
 */
export function barPopup({pieceId, measure, hand, items = [], flags = [], now = Date.now()}) {
  let item = barItem(pieceId, measure, hand, items)
  let flag = flags.find(f => inFlag(f, measure))
  let learned = learnedness(item)
  let tag = tagOf(flag, learned)
  let streak = streakOf(learned)

  if (!item || !(item.attempts > 0)) {
    return {measure, tag, streak, played: 0, state: "empty", notice: `No practice recorded for bar ${measure} yet.`}
  }

  let history = passHistory(item).slice(-8)
  if (!history.length) {
    return {
      measure, tag, streak, played: item.attempts, state: "no-passes",
      notice: `No full pass through bar ${measure} recorded yet.`,
    }
  }

  let detected = history.filter(entry => entry[1] != null)
  let self = history.filter(entry => entry[1] == null)

  return {
    measure, tag, streak, played: item.attempts, state: "played",
    figures: figuresOf(detected, self),
    chart: chartOf(detected, now),
    selfLine: selfLineOf(self),
  }
}
