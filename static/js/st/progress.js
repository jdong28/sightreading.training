// Pure derivations for the Salon "Progress" screen
// (st/components/pages/progress_page), read from the practice history the
// trainer already keeps: session records (SessionRecord, see
// NoteStats#sessionRecord and putSession in st/storage). Nothing here
// re-measures anything, the same rule st/dev_metrics.js follows: read
// records, never re-measure.
//
// Every function here takes `now` (and the goal) as a parameter rather than
// reading the clock or the store itself, so the maths needs no mocking.

import {localDay, dayStart, DAY} from "st/srs/schedule"
import {parseNoteOffset} from "st/music"

// the number of days the chart and every headline card cover
export const PROGRESS_DAYS = 14

// a clef's By clef rule is weak below this percent (the doc: "oxblood below
// 80%, gilt above")
export const CLEF_ACCURACY = 80

// a note's By note rule is weak below this percent. Kept here rather than in
// st/session_summary.js because PR 60 (the session summary card, trouble
// notes) hadn't landed when this screen was built: once it has, its
// troubleNotes should read this and pitchClassStats below instead of its own
// rule, so the summary card and this screen call a note weak alike
export const NOTE_ACCURACY = 75

export const CLEF_LABELS = {g: "Treble", f: "Bass", c: "C clef"}

// the plot's height in px, see chartScale
const PLOT_HEIGHT = 150

// the sample scale's goal line, 90px of the 150px plot at the default 10
// minute goal (1 minute ≈ 9px of bar height)
const SAMPLE_GOAL_PX = 90

function finite(value) {
  return typeof value == "number" && Number.isFinite(value)
}

// the rounded percent of hits read, or null with neither (same rule as
// accuracyPercent in sight_reading_page.jsx, kept private here too: that one
// isn't moved because PR 60 rewrites the top of that file)
function percent(hits, misses) {
  if (!hits && !misses) { return null }
  return Math.round(hits / (hits + misses) * 100)
}

// the minutes a session counts towards the chart and the headline cards:
// the session clock (Begin to Rest) when it was kept, else the older
// activeSeconds (records written before PR 53 never carry elapsedSeconds)
export function sessionSeconds(session) {
  let seconds = finite(session.elapsedSeconds) ? session.elapsedSeconds : session.activeSeconds
  return finite(seconds) ? seconds : 0
}

// the earliest startedAt sessionsSince should be asked for: far enough back
// to cover both the shown window and the previous window the accuracy
// change reads
export function readSince(now) {
  return dayStart(localDay(now) - (PROGRESS_DAYS * 2 - 1))
}

// the pitch-class figures of every note read in the window, one per pitch
// class with any data, chromatic from C. notesMaps is each session's `notes`
// map ({C: {hits, misses}, ...}, by note name without octave); a hit is
// keyed by the played pitch (always spelled sharp) and a miss by the written
// column (spelled however the key signature does), so the same pitch class
// can arrive under two different names and must be merged by offset before
// any percentage is taken. The label is the most-missed spelling (ties to
// most hits, then the name), the same rule PR 60's troubleNotes uses so the
// summary card and this grid name a note alike. A key parseNoteOffset can't
// read (eg. from an imported library) is skipped, not thrown
export function pitchClassStats(notesMaps) {
  let byOffset = new Map()

  for (let notes of notesMaps) {
    for (let [name, stats] of Object.entries(notes || {})) {
      let offset
      try {
        offset = parseNoteOffset(name)
      } catch (err) {
        continue
      }

      let entry = byOffset.get(offset)
      if (!entry) {
        entry = {hits: 0, misses: 0, spellings: new Map()}
        byOffset.set(offset, entry)
      }

      let hits = stats.hits || 0
      let misses = stats.misses || 0
      entry.hits += hits
      entry.misses += misses

      let spelling = entry.spellings.get(name) || {hits: 0, misses: 0}
      spelling.hits += hits
      spelling.misses += misses
      entry.spellings.set(name, spelling)
    }
  }

  return [...byOffset.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, entry]) => {
      let [label] = [...entry.spellings.entries()].sort(([aName, a], [bName, b]) =>
        b.misses - a.misses || b.hits - a.hits || (aName < bName ? -1 : aName > bName ? 1 : 0))[0]

      let pct = percent(entry.hits, entry.misses)
      return {offset, label, hits: entry.hits, misses: entry.misses, percent: pct, weak: pct != null && pct < NOTE_ACCURACY}
    })
}

// the By clef rows: one per clef sign with any data, in order g, f, c. A
// session with clefs (see countClefs) is summed sign by sign; a clefless one
// (every exercises session before staffClefs, and a score session before
// #28) falls back to its staff when that staff is single-handed (treble ->
// g, bass -> f); grand, chord and a missing staff are left out, since a
// clefless column can't be split after the fact. A session with nothing
// detected (acoustic, or a bare record) adds nothing either way
function clefStats(sessions) {
  let totals = {}
  let add = (sign, hits, misses) => {
    let stats = totals[sign] = totals[sign] || {hits: 0, misses: 0}
    stats.hits += hits
    stats.misses += misses
  }

  for (let session of sessions) {
    let hits = session.notesRead || 0
    let misses = session.misses || 0

    if (session.clefs) {
      for (let [sign, stats] of Object.entries(session.clefs)) {
        add(sign, stats.hits || 0, stats.misses || 0)
      }
    } else if (!hits && !misses) {
      // nothing detected (acoustic, or a bare pre-#7 record): left out
    } else if (session.staff == "treble") {
      add("g", hits, misses)
    } else if (session.staff == "bass") {
      add("f", hits, misses)
    }
    // "grand", "chord" or a missing staff without session.clefs: left out
  }

  return ["g", "f", "c"]
    .filter(sign => totals[sign])
    .map(sign => {
      let {hits, misses} = totals[sign]
      let pct = percent(hits, misses)
      return {sign, label: CLEF_LABELS[sign], percent: pct, weak: pct != null && pct < CLEF_ACCURACY}
    })
}

// the chart's px-per-minute and the goal line's offset: the plot shrinks to
// fit the longest day's bar (never below the sample scale's 10-minute-goal
// ratio), so a longer day or a smaller goal keeps the goal line at or under
// 60% of the plot
function chartScale(days, goalMinutes) {
  let longest = Math.max(0, ...days.map(day => day.minutes))
  let top = Math.max(goalMinutes * PLOT_HEIGHT / SAMPLE_GOAL_PX, longest)
  let pxPerMinute = top > 0 ? PLOT_HEIGHT / top : 0
  return {pxPerMinute, goalPx: goalMinutes * pxPerMinute, plotHeight: PLOT_HEIGHT}
}

/**
 * Everything the Progress screen renders, derived from the session records
 * of the last 28 days (see readSince): the 14-day chart, the four headline
 * cards, By clef and By note. now and goalMinutes are read once, at render.
 * @param {SessionRecord[]} sessions any order; records outside the 28-day
 * read window are ignored
 * @param {Object} [opts]
 * @param {number} [opts.now]
 * @param {number} [opts.goalMinutes] practiceSettings().dailyGoalMinutes
 * @returns {Object} {days, cards, clefs, notes, showNoteGrid, scale, goalMinutes}
 */
export function progressSummary(sessions, {now = Date.now(), goalMinutes = 10} = {}) {
  let today = localDay(now)
  let windowStart = today - (PROGRESS_DAYS - 1)
  let prevStart = windowStart - PROGRESS_DAYS

  let dayOf = session => localDay(session.startedAt)
  let detected = session => session.startedAt <= now
  let inWindow = session => detected(session) && dayOf(session) >= windowStart && dayOf(session) <= today
  let inPrevWindow = session => detected(session) &&
    dayOf(session) >= prevStart && dayOf(session) < windowStart

  let windowSessions = sessions.filter(inWindow)
  let prevSessions = sessions.filter(inPrevWindow)

  let days = []
  for (let day = windowStart; day <= today; day++) {
    let daySessions = windowSessions.filter(session => dayOf(session) == day)
    days.push({
      day,
      date: new Date(day * DAY).getUTCDate(),
      minutes: daySessions.reduce((sum, session) => sum + sessionSeconds(session) / 60, 0),
      sessions: daySessions.length,
      today: day == today,
    })
  }

  let eveningsKept = days.filter(day => day.sessions > 0).length
  let notesRead = windowSessions.reduce((sum, session) => sum + (session.notesRead || 0), 0)
  let misses = windowSessions.reduce((sum, session) => sum + (session.misses || 0), 0)
  let prevHits = prevSessions.reduce((sum, session) => sum + (session.notesRead || 0), 0)
  let prevMisses = prevSessions.reduce((sum, session) => sum + (session.misses || 0), 0)

  let accuracy = percent(notesRead, misses)
  let prevAccuracy = percent(prevHits, prevMisses)
  let accuracyDelta = accuracy != null && prevAccuracy != null ? accuracy - prevAccuracy : null

  let minutes = Math.round(days.reduce((sum, day) => sum + day.minutes, 0))
  let notes = pitchClassStats(windowSessions.map(session => session.notes))

  return {
    days,
    cards: {eveningsKept, notesRead, accuracy, accuracyDelta, minutes},
    clefs: clefStats(windowSessions),
    notes,
    showNoteGrid: notes.length > 0,
    scale: chartScale(days, goalMinutes),
    goalMinutes,
  }
}

// the accuracy change line beneath the Accuracy card, or null to show
// nothing (either side unknown). Oxblood is never used for a fall; the
// caller keeps the line muted ink in every case
export function accuracyChangeCaption(delta) {
  if (delta == null) { return null }
  if (delta > 0) { return `▲ ${delta} on the fortnight before` }
  if (delta < 0) { return `▼ ${-delta} on the fortnight before` }
  return "Level with the fortnight before"
}
