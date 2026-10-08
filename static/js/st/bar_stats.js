// The bar pop-up's model (D6): a clicked bar's own playing stats, a pure
// reader over the cached items, the same single-measure records the planner
// reads. Serves both instrument settings alike, since a keyboard pass and a
// self-graded one write the same item fields; a self-graded attempt simply
// adds no hits or misses. Never reads the async reviews store, and never
// writes anything.

import {itemId} from "st/srs/records"
import {daysAgo} from "st/srs/planner"
import {selfWord} from "st/srs/self_grade"
import {LEVEL_WORDS} from "st/difficulty/index"
import {romanNumeral} from "st/music"
import {learnedness, passHistory, passAccuracy, TROUBLE_BELOW} from "st/bar_progress"

// how many of a bar's pass history entries the pop-up's chart plots
const PLOT_HISTORY = 8

function flagAt(flags, measure) {
  return flags.find(flag =>
    (measure >= flag.start && measure <= flag.end) ||
    (flag.alsoAt || []).some(([from, to]) => measure >= from && measure <= to))
}

// the pop-up's header tag: the flag in force over the bar, else its
// learnedness word
function tagOf(flags, measure, learnedCount, played) {
  let flag = flagAt(flags, measure)
  if (flag) {
    return {text: `Passage ${romanNumeral(flag.num)} · ${LEVEL_WORDS[flag.level]}`, variant: "passage"}
  }
  if (learnedCount >= 3) { return {text: "Learned", variant: "learned"} }
  return played ? {text: "Learning", variant: "learning"} : {text: "New", variant: "new"}
}

// daysAgo (st/srs/planner), capitalised for the pop-up's chart labels
function dayWord(at, now) {
  let word = daysAgo(at, now)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function streakOf(count) {
  return count >= 3 ?
    {filled: 3, label: "Learned", ariaLabel: "Learned"} :
    {filled: count, label: `${count} of 3 clean passes in a row`, ariaLabel: `${count} of 3 clean passes in a row`}
}

/**
 * A clicked bar's pop-up on the score-first sheet music page (D6): its
 * header tag, latest/best figures, the accuracy chart (detected passes) or
 * the self-graded words, and its learnedness streak, for the setup hand
 * only. Its "From your playing" trouble sentence is kept in the Review pane
 * instead (Open question 4b).
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {number} opts.measure the printed bar number clicked
 * @param {string} opts.hand the setup pane's hand setting, one of HANDS
 * @param {Object[]} [opts.items] the piece's items, any hand
 * @param {Object[]} [opts.flags] flagsInForce(annotation), for the tag
 * @param {number} opts.now
 * @returns {Object} see the fields set below; empty is true for a bar never
 * played, where only measure, empty, tag and streak (all zero) are meaningful
 */
export function barPopup({pieceId, measure, hand, items = [], flags = [], now}) {
  let id = itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})
  let item = items.find(i => i.id == id)
  let played = !!item && item.attempts > 0
  let count = learnedness(item)
  let tag = tagOf(flags, measure, count, played)

  if (!played) {
    return {
      measure, empty: true, tag, played: 0,
      latest: null, best: null, chart: null, selfWords: null, noFullPass: false,
      streak: streakOf(count),
    }
  }

  let history = passHistory(item).slice(-PLOT_HISTORY)
  let detected = history.filter(entry => entry[1] != null)
  let selfEntries = history.filter(entry => entry[1] == null)

  let chart = null
  if (detected.length) {
    let points = detected.map(entry => ({pct: passAccuracy(entry)}))
    chart = {
      points,
      ariaLabel: `Accuracy each time played, oldest first: ${points.map(p => `${p.pct}%`).join(", ")}. Target 100%.`,
      firstDay: dayWord(detected[0][0], now),
      lastDay: dayWord(detected[detected.length - 1][0], now),
    }
  }

  let selfWords = selfEntries.length ?
    `Graded by ear: ${selfEntries.map(entry => selfWord(entry[3])).join(" → ")}` : null

  let latest = null
  let best = null
  if (history.length) {
    let last = history[history.length - 1]
    if (last[1] != null) {
      let pct = passAccuracy(last)
      latest = {text: `${pct}%`, oxblood: pct < TROUBLE_BELOW}
    } else {
      latest = {text: selfWord(last[3]), oxblood: false}
    }

    if (detected.length) {
      best = {text: `${Math.max(...detected.map(entry => passAccuracy(entry)))}%`}
    } else if (selfEntries.length) {
      best = {text: selfWord(Math.max(...selfEntries.map(entry => entry[3])))}
    }
  }

  return {
    measure, empty: false, tag, played: item.attempts,
    latest, best, chart, selfWords, noFullPass: !history.length,
    streak: streakOf(count),
  }
}
