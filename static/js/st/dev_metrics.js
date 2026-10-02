// What the developer metrics panel (components/sight_reading/dev_metrics_panel)
// shows, worked out from the data the trainer already keeps: an attempt
// pass's columns as the note matcher measured them (st/srs/attempt), how
// the grade (st/srs/grade) reads a finished pass, and the stored reviews
// (st/srs/records). Nothing here measures or grades anything of its own: a
// run is graded through the same passGrading and gradeRange the stored
// attempts are.

import {passGrading, gradeRange, passPace, columnSkipped} from "st/srs/attempt"
import {
  hesitations, hesitationThreshold, openingColumn, AGAIN, HARD, GOOD, EASY, STUCK_MISSES, SLIP_SHARE,
  HESITATION_SHARE, EASY_PACE,
} from "st/srs/grade"
import {itemId} from "st/srs/records"
import {selfWord} from "st/srs/self_grade"

// the localStorage key of the panel: absent while it's disabled, else
// whether it's open, "open" or "closed"
export const DEV_METRICS_KEY = "st:dev_metrics:v1"

// the URL flag that enables the panel (?devMetrics=1) or disables it
// (?devMetrics=0), remembered in DEV_METRICS_KEY; any other value is ignored
export const DEV_METRICS_PARAM = "devMetrics"

export const GRADE_NAMES = {[AGAIN]: "again", [HARD]: "hard", [GOOD]: "good", [EASY]: "easy"}

/**
 * Whether the panel is enabled and open, after the URL flag has had its say
 * @param {Object} [opts]
 * @param {string} [opts.search] the page's query string
 * @param {Storage} [opts.storage]
 * @returns {{enabled: boolean, open: boolean}}
 */
export function devMetricsState({search=window.location.search, storage=window.localStorage}={}) {
  try {
    let flag = new URLSearchParams(search).get(DEV_METRICS_PARAM)
    if (flag == "0") {
      storage.removeItem(DEV_METRICS_KEY)
    } else if (flag == "1" && !storage.getItem(DEV_METRICS_KEY)) {
      storage.setItem(DEV_METRICS_KEY, "open")
    }

    let value = storage.getItem(DEV_METRICS_KEY)
    return {enabled: !!value, open: value == "open"}
  } catch (err) {
    return {enabled: false, open: false}
  }
}

/**
 * Remembers whether the enabled panel is open
 * @param {boolean} open
 * @param {Storage} [storage]
 */
export function storeDevMetricsOpen(open, storage=window.localStorage) {
  try {
    storage.setItem(DEV_METRICS_KEY, open ? "open" : "closed")
  } catch (err) {
    // the panel just opens closed next time
  }
}

/**
 * @param {number|null|undefined} ms
 * @returns {string} eg. "412 ms", "12.3 s", "—" when not measured
 */
export function formatMs(ms) {
  if (ms == null) { return "—" }
  if (Math.abs(ms) >= 10 * 1000) { return `${(ms / 1000).toFixed(1)} s` }
  return `${Math.round(ms)} ms`
}

/**
 * @param {number|null} pace ms per beat, a beat being a quarter note
 * @returns {number|null} the quarter note tempo, beats a minute
 */
export function tempoOf(pace) {
  return pace > 0 ? Math.round(60 * 1000 / pace) : null
}

/**
 * @param {{startMeasure: number, endMeasure: number, hand?: string}} range
 * @returns {string} eg. "bar 4", "bars 4–6", with the hand when given
 */
export function rangeLabel({startMeasure, endMeasure, hand}) {
  let bars = startMeasure == endMeasure ? `bar ${startMeasure}` : `bars ${startMeasure}–${endMeasure}`
  return hand ? `${bars}, ${hand == "both" ? "hands together" : `${hand} hand`}` : bars
}

// the bar number of a card's column
const columnBar = (card, idx) => card.measures[card.columnMeasures[idx]]

/**
 * The columns of a pass as the matcher measured them, for the live view.
 * @param {AttemptPass} pass
 * @returns {Object[]} one a column of the card: index, bar, notes, status
 * ("hit", "settled" for one completed by keys held from before with none
 * struck at it, "skipped", "missed" for one scrolled past in scroll mode, which
 * the grade counts missed rather than skipped, "head", "to come", or
 * "before" for the columns ahead of where the rest of an abandoned pass took
 * up), slips (every try gone wrong), ms (time on the column) and the
 * matcher's latency, spread, early, heldCredit and late, and the notes the
 * score still sounds into it
 */
export function columnRows(pass) {
  let {card} = pass
  let mode = pass.drill ? pass.drill.mode : null
  return pass.columns.map((column, idx) => {
    let status = idx < pass.from ? "before" :
      column.done ? (column.hit ? (column.settled ? "settled" : "hit") : columnSkipped(column, mode) ? "skipped" : "missed") :
      idx == pass.head ? "head" : "to come"

    return {
      index: idx,
      bar: columnBar(card, idx),
      notes: [...card.columns[idx]],
      sustained: card.columns[idx].sustained || [],
      status,
      slips: column.misses,
      ms: column.ms,
      latency: column.latency,
      spread: column.spread,
      early: column.early,
      heldCredit: column.heldCredit,
      late: column.late,
    }
  })
}

// why a finished pass writes no graded attempt, see passAttempts
function ungradedWhy(pass) {
  if (!pass.drill || !pass.played) { return "nothing was played in it" }
  if (!pass.graded) {
    return "it continued a pass abandoned at Rest, a page change or a rebuild, or it was " +
      "played partly in the other mode"
  }
  if (!pass.complete) { return "it isn't finished" }
  return null
}

/**
 * How the grade read a finished pass, for the run view: its pace, the
 * hesitation threshold of each column and whether its latency crossed it,
 * and each range's counts, grade and the rule that gave it. Each range is
 * graded against its item as the pass found it (pass.found, set once the
 * passes before it are written): until then, and for an item never
 * practised before, as at first sight. The pace and stops of the after-pass
 * caption (passPace, which leaves a pause out of the pace and counts it a
 * stop) are kept apart as captionPace, captionTempo and stops, since they
 * are not what the grade read.
 * @param {AttemptPass} pass finished
 * @returns {Object}
 */
export function runReport(pass) {
  let {card} = pass

  if (pass.selfGrade) {
    return {
      self: true,
      mode: pass.drill ? pass.drill.mode : null,
      grade: pass.selfGrade.grade,
      word: selfWord(pass.selfGrade.grade),
      slipped: pass.selfGrade.slipped || [],
      at: pass.written ? pass.written.at : pass.lastAt,
      measures: card.measures,
    }
  }

  let why = ungradedWhy(pass)
  let report = {
    mode: pass.drill ? pass.drill.mode : null,
    speed: pass.drill ? pass.drill.speed ?? null : null,
    graded: !why,
    why,
    at: pass.written ? pass.written.at : pass.lastAt,
    measures: card.measures,
    beats: card.columns.every(column => column.beat != null),
  }
  if (why) { return report }

  let grading = passGrading(pass)
  let wait = grading.mode == "wait"
  let hesitated = new Set(wait ? hesitations(grading.columns, {pace: grading.pace}) : [])
  let opening = openingColumn(grading.columns)
  let played = passPace(pass)

  let {pieceId, hand} = pass.written || {}
  let found = pass.found || null

  return {
    ...report,
    pace: grading.pace,
    tempo: report.beats ? tempoOf(grading.pace) : null,
    captionPace: played ? played.pace : null,
    captionTempo: played && played.beats ? tempoOf(played.pace) : null,
    stops: played ? played.stops : [],
    pending: !found,
    hand: hand ?? null,
    columns: grading.columns.map((column, idx) => ({
      index: idx,
      bar: columnBar(card, idx),
      notes: [...card.columns[idx]],
      gap: column.gap,
      ms: column.ms,
      latency: column.latency,
      threshold: wait && idx != opening && !column.skipped && !column.settled ? hesitationThreshold(column, grading.pace) : null,
      hesitated: hesitated.has(idx),
      misses: column.misses,
      skipped: column.skipped,
      settled: column.settled,
      stuck: column.misses >= STUCK_MISSES,
    })),
    ranges: grading.ranges.map(range => {
      let id = pieceId == null ? null : itemId({pieceId, hand, ...range})
      let before = found && id ? found[id] || null : null
      let {firstSight, graded} = gradeRange(grading, range.indices, before)
      let usualPace = before ? before.paceMs ?? null : null

      return {
        id,
        label: rangeLabel(range),
        startMeasure: range.startMeasure,
        endMeasure: range.endMeasure,
        firstSight,
        usualPace,
        counts: graded,
        grade: graded.grade,
        rule: graded.rule,
        reason: gradeReason(graded, {mode: grading.mode, firstSight, usualPace}),
        practiceOnly: !!(id && pass.practiceOnly && pass.practiceOnly.includes(id)),
      }
    }),
  }
}

const plural = (n, word) => `${n} ${word}${n == 1 ? "" : "s"}`
const percent = share => `${Math.round(share * 100)}%`

/**
 * The words for the rule of gradeRule that gave a grade.
 * @param {Object} graded gradeAttempt's counts, grade and rule
 * @param {Object} opts
 * @param {string} opts.mode
 * @param {boolean} [opts.firstSight]
 * @param {number|null} [opts.usualPace] the item's pace before the attempt
 * @returns {string} eg. "hard: slips on 1 of 6 columns"
 */
export function gradeReason(graded, {mode, firstSight=false, usualPace=null}) {
  let {columns, slips, stuck, skipped, pace} = graded
  let hesitated = graded.hesitations
  let of = n => `${n} of ${columns} columns`
  let name = GRADE_NAMES[graded.grade]

  let pacing = () => {
    if (firstSight) { return "at first sight, so no usual pace to keep" }
    if (usualPace == null) { return "no usual pace yet" }
    if (pace == null) { return "no pace (too few timed columns)" }
    let limit = EASY_PACE * usualPace
    return `pace ${formatMs(pace)}/beat ${pace <= limit ? "≤" : ">"} ${EASY_PACE} × usual ` +
      `${formatMs(usualPace)} = ${formatMs(limit)}`
  }

  switch (graded.rule) {
    case "skipped": return `${name}: ${plural(skipped, "column")} skipped`
    case "stuck": return `${name}: ${plural(stuck, "column")} stuck (${STUCK_MISSES}+ slips)`
    case "slips": return `${name}: slips on ${of(slips)}, over ${percent(SLIP_SHARE)}`
    case "slip": return `${name}: slips on ${of(slips)}`
    case "hesitations": return `${name}: hesitations on ${of(hesitated)}, over ${percent(HESITATION_SHARE)}`
    case "scroll": return `${name}: no slip; scroll mode is never easy (tempo imposed)`
    case "hesitation": return `${name}: no slip, but ${plural(hesitated, "hesitation")}`
    case "pace": return `${name}: no slip or hesitation, but ${pacing()}`
    case "easy": return `${name}: no slip or hesitation, ${pacing()}`
  }
  return name || "ungraded"
}

/**
 * A stored review's record of its columns (ReviewRecord#perColumn) by name
 * @param {Array[]} [perColumn]
 * @returns {Object[]} slips, stalled, latency, spread, early, heldCredit, late
 */
export function perColumnRows(perColumn) {
  return (perColumn || []).map(([slips, stalled, latency, spread, early, heldCredit, late]) =>
    ({slips, stalled: !!stalled, latency, spread, early, heldCredit, late}))
}

/**
 * The stored reviews of one item, newest first, for the history view
 * @param {ReviewRecord[]} reviews
 * @param {string} id the item id
 * @returns {ReviewRecord[]}
 */
export function itemReviews(reviews, id) {
  return reviews.filter(review => review.itemId == id).sort((a, b) => b.at - a.at)
}

/**
 * The items of a piece under one hand setting, in bar order, a single bar
 * before the ranges it starts
 * @param {ItemRecord[]} items
 * @param {string} hand
 * @returns {ItemRecord[]}
 */
export function handItems(items, hand) {
  return items.filter(item => item.hand == hand && !item.beats)
    .sort((a, b) => a.startMeasure - b.startMeasure || a.endMeasure - b.endMeasure)
}
