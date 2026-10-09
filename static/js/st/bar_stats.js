// A clicked bar's own playing stats (score-first design §D6): a pure reader
// over the cached items and the piece's flagged passages, for the score
// page's bar pop-up (st/components/sight_reading/bar_popup). Serves both
// instrument settings alike, since a keyboard pass and a self-graded one
// write the same item fields. Never reads the async reviews store, and
// never writes anything. The trouble-spot sentence of the old bar stats
// plate (PR 70) is dropped; it stays reachable in the Review pane.

import {itemId} from "st/srs/records"
import {selfWord} from "st/srs/self_grade"
import {daysAgo} from "st/srs/planner"
import {romanNumeral} from "st/music"
import {LEVEL_WORDS} from "st/difficulty/index"
import {passHistory, passAccuracy, learnedness, TROUBLE_BELOW} from "st/bar_progress"

// the history's plotted entries, newest kept, oldest dropped (§D6)
const MAX_PLOTTED = 8

// the streak's pips (§D6: "three 16px pips")
export const PIP_COUNT = 3

const capitalize = words => words.charAt(0).toUpperCase() + words.slice(1)

// whether a measure lies in a flag in force, its own range or a repeat
function inForce(flag, measure) {
  if (measure >= flag.start && measure <= flag.end) { return true }
  return (flag.alsoAt || []).some(([from, to]) => measure >= from && measure <= to)
}

// "Graded by ear: Stumbled → Clean → Easy" (§D6)
function selfLine(entries) {
  return `Graded by ear: ${entries.map(([, , , grade]) => selfWord(grade)).join(" → ")}`
}

/**
 * A clicked bar's stats (score-first design §D6), for the bar pop-up.
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {number} opts.measure the printed bar number clicked
 * @param {string} opts.hand the setup pane's hand, one of HANDS (st/srs/records)
 * @param {Object[]} [opts.items] the piece's items, any hand
 * @param {Object[]} [opts.flags] the piece's flagged passages in force,
 * hardest first (st/difficulty/records flagsInForce)
 * @param {number} opts.now
 * @returns {Object} {measure, tag, inPassage, empty, played, noPasses,
 * latest, latestWeak, best, chart, selfLine, streak}; only measure, tag,
 * inPassage and empty are given when empty is true. chart is null without a
 * detected entry to plot, see renderVals' row() in the design's Main.dc.html
 */
export function barPopup({pieceId, measure, hand, items=[], flags=[], now}) {
  let id = itemId({pieceId, hand, startMeasure: measure, endMeasure: measure})
  let item = items.find(i => i.id == id) || null

  let flag = flags.find(f => inForce(f, measure))
  let learned = learnedness(item)
  let tag = flag ? `Passage ${romanNumeral(flag.num)} · ${LEVEL_WORDS[flag.level]}` :
    learned === 3 ? "Learned" : learned != null ? "Learning" : "New"
  let inPassage = !!flag

  if (!item || !(item.attempts > 0)) {
    return {measure, tag, inPassage, empty: true}
  }

  let plotted = passHistory(item).slice(-MAX_PLOTTED)
  let detected = plotted.filter(entry => entry[1] != null)
  let selfEntries = plotted.filter(entry => entry[1] == null)

  let result = {
    measure, tag, inPassage, empty: false, played: item.attempts, noPasses: plotted.length == 0,
  }

  if (detected.length) {
    let accuracies = detected.map(passAccuracy)
    let latest = accuracies[accuracies.length - 1]
    result.latest = `${latest}%`
    result.latestWeak = latest < TROUBLE_BELOW
    result.best = `${Math.max(...accuracies)}%`
    result.chart = {
      points: accuracies.map(accuracy => ({accuracy, weak: accuracy < TROUBLE_BELOW})),
      first: capitalize(daysAgo(detected[0][0], now)),
      last: capitalize(daysAgo(detected[detected.length - 1][0], now)),
      ariaLabel: `Accuracy each time played, oldest first: ${accuracies.join("%, ")}%. Target 100%.`,
    }
    if (selfEntries.length) {
      result.selfLine = selfLine(selfEntries)
    }
  } else if (selfEntries.length) {
    let grades = selfEntries.map(([, , , grade]) => grade)
    result.latest = selfWord(grades[grades.length - 1])
    result.best = selfWord(Math.max(...grades))
    result.selfLine = selfLine(selfEntries)
  }

  let streak = Math.min(learned ?? 0, PIP_COUNT)
  result.streak = {
    count: streak,
    label: streak >= PIP_COUNT ? "Learned" : `${streak} of 3 clean passes in a row`,
  }

  return result
}
