// The notes a session gave trouble, read from the SessionRecord NoteStats#
// sessionRecord writes at Rest (see st/storage#putSession, st/note_stats.js):
// the rest strip under the exercises page's stat cards uses them to offer
// "Practise these notes" (st/components/pages/sight_reading_page). Reads the
// record only: never re-measures or re-grades anything, the same rule the
// developer metrics panel follows (st/dev_metrics.js). The rest of what the
// pop-up summary showed is Today's practice (st/practice_day).

import {parseNoteOffset} from "st/music"

// the accuracy rule's cutoff: a note read below it is weak (the progress
// screen's weak tile uses the same rule)
export const TROUBLE_ACCURACY = 75

// the most rows of the notes that gave trouble kept, worst first
export const TROUBLE_ROWS = 4

// the notes that gave trouble: every note with a miss, worst accuracy first
// (ties broken by more misses, then note name, so the order is
// deterministic), cut to limit.
//
// One note can hold two keys in record.notes: a hit is named from the pitch
// played (noteName, always sharp) while a miss is named by the written
// column (letterNoteName, flat in a flat key), so an evening of Bb in F
// major stores {Bb: misses, "A#": hits}. Each row adds up every spelling of
// its pitch class and is labelled the way the note was missed, the spelling
// the player read
export function troubleNotes(record, {limit=TROUBLE_ROWS}={}) {
  let spellings = new Map()

  for (let [note, stats] of Object.entries(record.notes || {})) {
    let pitchClass = parseNoteOffset(note)
    if (!spellings.has(pitchClass)) { spellings.set(pitchClass, []) }
    spellings.get(pitchClass).push({note, hits: stats.hits || 0, misses: stats.misses || 0})
  }

  let rows = []

  for (let group of spellings.values()) {
    let hits = group.reduce((total, one) => total + one.hits, 0)
    let misses = group.reduce((total, one) => total + one.misses, 0)
    if (!misses) { continue }

    // most missed first, so the label is the spelling the misses used
    group.sort((a, b) => b.misses - a.misses || b.hits - a.hits || a.note.localeCompare(b.note))

    let accuracy = Math.round(hits / (hits + misses) * 100)
    rows.push({note: group[0].note, hits, misses, accuracy, weak: accuracy < TROUBLE_ACCURACY})
  }

  rows.sort((a, b) => a.accuracy - b.accuracy || b.misses - a.misses || a.note.localeCompare(b.note))

  return rows.slice(0, limit)
}

// the note names to seed "Practise these notes" with, as the toggles shape
// a focused Random notes generator takes ({"F#": true, …}): the weak rows
// alone, so a focused session isn't spent on a note already read well
export function focusFromRows(rows) {
  return Object.fromEntries(rows.filter(row => row.weak).map(row => [row.note, true]))
}
