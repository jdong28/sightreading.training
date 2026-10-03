// Pure derivations for the session summary card
// (st/components/sight_reading/session_summary.jsx), shown at Rest from the
// SessionRecord NoteStats#sessionRecord writes (see st/storage#putSession,
// st/note_stats.js). Reads the record only: never re-measures or re-grades
// anything, the same rule the developer metrics panel follows
// (st/dev_metrics.js).

import {displayNoteName} from "st/music"

// the accuracy rule's cutoff: gilt at or above, oxblood below (section 4 of
// docs/design/salon-de-chopin.md; the progress screen's weak tile, a later
// step, uses the same rule)
export const TROUBLE_ACCURACY = 75

// "Notes that gave trouble" shows at most this many rows, worst first
export const TROUBLE_ROWS = 4

// whether the record has any MIDI-detected notes, as opposed to only
// acoustic self-graded passes (st/srs/self_grade)
export function detectedSession(record) {
  return (record.notesRead || 0) + (record.misses || 0) > 0
}

// seconds -> "m:ss", the same format the live stat cards use
function formatElapsed(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0))
  let minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

// the four stat cards: the live detected four (Elapsed, Accuracy, Notes
// read, Best streak), or the three live acoustic cards (Elapsed, Passes,
// Clean) for a session with nothing detected
export function summaryCards(record) {
  let elapsed = formatElapsed(record.elapsedSeconds ?? record.activeSeconds)

  if (!detectedSession(record) && record.selfGraded) {
    return [
      {label: "Elapsed", value: elapsed},
      {label: "Passes", value: record.selfGraded.passes},
      {label: "Clean", value: record.selfGraded.clean},
    ]
  }

  let notesRead = record.notesRead || 0
  let misses = record.misses || 0
  let accuracy = notesRead || misses ? Math.round(notesRead / (notesRead + misses) * 100) : null

  return [
    {label: "Elapsed", value: elapsed},
    {
      label: "Accuracy", accent: true,
      value: accuracy == null ? "—" : accuracy,
      suffix: accuracy == null ? null : "%",
    },
    {label: "Notes read", value: notesRead},
    {label: "Best streak", value: record.bestStreak || 0},
  ]
}

// the rows of "Notes that gave trouble": every note with a miss, worst
// accuracy first (ties broken by more misses, then note name, so the order
// is deterministic), cut to limit
export function troubleNotes(record, {limit=TROUBLE_ROWS}={}) {
  let rows = Object.entries(record.notes || {})
    .filter(([, stats]) => stats.misses > 0)
    .map(([note, stats]) => {
      let hits = stats.hits || 0
      let misses = stats.misses || 0
      let accuracy = Math.round(hits / (hits + misses) * 100)
      return {note, hits, misses, accuracy, weak: accuracy < TROUBLE_ACCURACY}
    })

  rows.sort((a, b) => a.accuracy - b.accuracy || b.misses - a.misses || a.note.localeCompare(b.note))

  return rows.slice(0, limit)
}

// one italic insight sentence, or null when there's nothing to say (the
// card then renders with tone: 'plain', which suppresses the line). rows is
// troubleNotes(record)'s result, worst first
export function summaryInsight(record, rows) {
  if (!detectedSession(record) && record.selfGraded) {
    let {passes, clean} = record.selfGraded
    return passes ? `${clean} of ${passes} passes clean.` : null
  }

  if (!record.misses) {
    return detectedSession(record) ? "Not a note out of place this evening." : null
  }

  let weakest = rows[0]
  return weakest ? `${displayNoteName(weakest.note)} asked the most of you tonight.` : null
}

// the note names to seed "Practise these notes" with, as the toggles shape
// a focused Random notes generator takes ({"F#": true, …}): exactly the
// notes shown on the card, no more
export function focusFromRows(rows) {
  return Object.fromEntries(rows.map(row => [row.note, true]))
}
