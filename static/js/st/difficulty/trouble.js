// "Your trouble spots" (decision 8): bars the player's own practice records
// say are hard, offered as suggestions only. Flagging one is a tap away
// (st/difficulty/decisions.promoteTroubleSpot), which puts it in the review
// waiting for the teacher; nothing here writes anything.
//
// Synchronous over the cached items, the same single-measure records the
// planner reads (st/srs/planner); no review log (stage 5 reads that).

import {AGAIN} from "st/srs/grade"

// how many of an item's last RECENT_ATTEMPTS grades were "again"
function againCount(item) {
  return (item.recent || []).filter(([, , , grade]) => grade == AGAIN).length
}

function median(values) {
  if (!values.length) { return null }
  let sorted = [...values].sort((a, b) => a - b)
  let mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const PACE_RATIO = 1.5
const MIN_REPS = 3
const MIN_LAPSES = 2
const MIN_AGAIN = 2
const MIN_DIFFICULTY = 7

// the signals an item's own grades give, report §2.4's items-only form; an
// item under MIN_REPS graded attempts gives none, however it otherwise reads
function signalsOf(item, medianPace) {
  if (!item || item.reps < MIN_REPS) { return [] }

  let signals = []
  let again = againCount(item)
  if (again >= MIN_AGAIN) { signals.push({kind: "again", count: again}) }
  if ((item.lapses || 0) >= MIN_LAPSES) { signals.push({kind: "lapses", count: item.lapses}) }
  if ((item.d || 0) >= MIN_DIFFICULTY) { signals.push({kind: "difficulty", d: item.d}) }
  if (medianPace && item.paceMs != null && item.paceMs > medianPace * PACE_RATIO) {
    signals.push({kind: "pace", ratio: item.paceMs / medianPace})
  }
  return signals
}

function phraseFor(signal) {
  switch (signal.kind) {
    case "again": return "again at least twice recently"
    case "lapses": return `slipped back ${signal.count} times`
    case "difficulty": return "rated hard by your own practice"
    case "pace": return `slow: about ${signal.ratio.toFixed(1)}× your usual pace`
    case "scaffold": return "needed hands apart last time"
    default: return ""
  }
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

// how strong a signal is, by the one measurement its kind carries: the
// count of "again" and "lapses", the difficulty of "difficulty", the pace
// ratio of "pace". "scaffold" carries none and reads the same either way
function strengthOf(signal) {
  return signal.count ?? signal.ratio ?? signal.d ?? 0
}

// one sentence from a suggestion's signals, the strongest instance of each
// kind if bars merged brought the same kind more than once
function sentenceFor(signals) {
  let byKind = new Map()
  for (let signal of signals) {
    let existing = byKind.get(signal.kind)
    if (!existing || strengthOf(signal) > strengthOf(existing)) { byKind.set(signal.kind, signal) }
  }

  let phrases = [...byKind.values()].map(phraseFor).filter(Boolean)
  if (!phrases.length) { return "" }
  if (phrases.length == 1) { return `${capitalize(phrases[0])}.` }
  return `${capitalize(phrases.slice(0, -1).join(", "))}, and ${phrases[phrases.length - 1]}.`
}

/**
 * Suggestions from the player's own practice, synchronous over the cached
 * items. A bar already inside a flag in force is left out ("not yet
 * flagged" is the teacher's call, not a suggestion to repeat it).
 * @param {Object} opts
 * @param {string} opts.pieceId
 * @param {Object[]} opts.items the piece's items (st/srs/records), any
 * hand; others are ignored
 * @param {number[]} opts.measures the piece's printed bar numbers, in
 * score order (st/song_sections.measureNumberList)
 * @param {Object[]} [opts.flags] the bars to leave out, as flags: the
 * suggestion list passes the flags in force
 * (st/difficulty/records.flagsInForce), the review's evidence line none
 * @returns {Object[]} {start, end, hand, signals, text}, in score order.
 * start/end are printed bar numbers; the measure indices a flag needs come
 * from the song (st/difficulty/decisions.promoteTroubleSpot), never from a
 * position in `measures`
 */
export function troubleSpots({pieceId, items = [], measures = [], flags = []}) {
  let order = new Map(measures.map((measure, idx) => [measure, idx]))

  let byMeasure = new Map()
  for (let item of items) {
    if (item.pieceId != pieceId) { continue }
    if (item.startMeasure != item.endMeasure || item.beats) { continue }
    if (!order.has(item.startMeasure)) { continue }

    let entry = byMeasure.get(item.startMeasure) || {}
    entry[item.hand] = item
    byMeasure.set(item.startMeasure, entry)
  }

  let singleMeasureItems = items.filter(item =>
    item.pieceId == pieceId && item.startMeasure == item.endMeasure && !item.beats)
  let medianPace = median(singleMeasureItems.map(item => item.paceMs).filter(pace => pace != null))

  let inFlag = measure => flags.some(flag =>
    (measure >= flag.start && measure <= flag.end) ||
    (flag.alsoAt || []).some(([from, to]) => measure >= from && measure <= to))

  let troubled = new Map()
  for (let [measure, entry] of byMeasure) {
    if (inFlag(measure)) { continue }

    let signals = ["both", "upper", "lower"].flatMap(hand => signalsOf(entry[hand], medianPace))

    // rule 5: a hand-alone item the hand scaffold made (not the player's
    // own deliberate choice, nor one a flag's tick asked for, which says
    // nothing of how the bar went) marks the bar in trouble, whatever its reps
    let scaffold = ["upper", "lower"].map(hand => entry[hand])
      .find(item => item && !item.deliberate && !item.requested)
    if (scaffold) { signals.push({kind: "scaffold", hand: scaffold.hand}) }

    if (signals.length) {
      troubled.set(measure, {hand: scaffold ? scaffold.hand : "both", signals})
    }
  }

  let sorted = [...troubled.keys()].sort((a, b) => order.get(a) - order.get(b))
  let suggestions = []
  let current = null

  for (let measure of sorted) {
    let {hand, signals} = troubled.get(measure)
    if (current && order.get(measure) == order.get(current.end) + 1 && current.hand == hand) {
      current.end = measure
      current.signals.push(...signals)
    } else {
      if (current) { suggestions.push(current) }
      current = {start: measure, end: measure, hand, signals: [...signals]}
    }
  }
  if (current) { suggestions.push(current) }

  return suggestions.map(s => ({
    start: s.start,
    end: s.end,
    hand: s.hand,
    signals: s.signals,
    text: sentenceFor(s.signals),
  }))
}
