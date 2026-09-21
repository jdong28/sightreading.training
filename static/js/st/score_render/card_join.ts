// Joins a card an engine drew (./types) to the columns the trainer detects
// (extractSectionColumns in st/song_sections): each column's notes are found
// among the drawn notes by pitch and onset, the heads their ties run on to
// along with them, so the trainer can mark the column at the head of the
// drill, the ones done and the ones missed with a class on their drawn heads,
// never touching the engine's layout. Detection stays the judge: a drawn note
// no column plays (a grace note, a note outside the staff's range) is left
// unmarked, and a column with no drawn head is still played, just not marked

import {parseNote} from "../music"
import type {CardNote} from "./types"

// what a column carries for the join, see extractSectionColumns
export interface JoinColumn extends Array<string> {
  // the quarter note it falls on, on the song model's clock
  beat?: number
  // one entry a note: its tieTo is the beat of the head its tie runs on to,
  // its voice the score's
  notation?: ({tieTo?: number | null, voice?: number | null} | null)[]
  // drawn, not played: a tied continuation head carries the next tieTo
  extras?: {kind: string, name?: string, beat: number, tieTo?: number | null}[]
}

export interface CardJoin {
  // the drawn heads of each column, by column index
  heads: SVGGElement[][]
  // the drawn notes no column plays
  unmatched: CardNote[]
}

export const MARK_CLASSES = {
  current: "score_note_current",
  done: "score_note_done",
  missed: "score_note_missed",
}

// the onset grid the two clocks are compared on, 1/960 of a quarter note, as
// onsetKey in ./card_source
const TICKS = 960

function tick(beats: number): number {
  return Math.round(beats * TICKS)
}

function key(pitch: number, beats: number): string {
  return `${pitch}:${tick(beats)}`
}

// whether every column carries its beat, the one thing the join needs of the
// score's notation: a piece stored before the song model kept the score's
// rhythm (see SONG_FORMAT in st/sheet_music_deck) can't be joined
export function joinable(columns: JoinColumn[]): boolean {
  return columns.length > 0 && columns.every(column => column.beat != null && Number.isFinite(column.beat))
}

export function joinCard(columns: JoinColumn[], notes: CardNote[]): CardJoin {
  const byKey = new Map<string, CardNote[]>()
  for (const note of notes) {
    const k = key(note.pitch, note.onsetBeats)
    if (!byKey.has(k)) { byKey.set(k, []) }
    byKey.get(k)!.push(note)
  }

  const used = new Set<CardNote>()

  // the drawn notes of pitch at beats not yet joined, a tick either side of
  // the grid included, and only those of voice when it is given
  const take = (into: SVGGElement[], pitch: number, beats: number, voice?: number | null) => {
    const t = tick(beats)
    for (const k of [`${pitch}:${t}`, `${pitch}:${t - 1}`, `${pitch}:${t + 1}`]) {
      for (const note of byKey.get(k) || []) {
        if (used.has(note) || (voice != null && note.voice != voice)) { continue }
        used.add(note)
        into.push(note.el)
      }
    }
  }

  // where each tied continuation head runs on to, by pitch and beat
  const tieOn = new Map<string, number | null>()
  for (const column of columns) {
    for (const extra of column.extras || []) {
      if (extra.kind != "head" || !extra.name || !("tieTo" in extra)) { continue }
      tieOn.set(key(parseNote(extra.name), extra.beat), extra.tieTo ?? null)
    }
  }

  // the beats of the heads each column note's ties run on to, in order
  const tiedBeats = (column: JoinColumn, idx: number, pitch: number): number[] => {
    const beats: number[] = []
    let to = column.notation?.[idx]?.tieTo ?? null
    while (to != null && !beats.some(beat => tick(beat) == tick(to!))) {
      beats.push(to)
      to = tieOn.get(key(pitch, to)) ?? null
    }
    return beats
  }

  const heads: SVGGElement[][] = columns.map(() => [])
  const notesOf = (fn: (into: SVGGElement[], column: JoinColumn, idx: number, pitch: number) => void) => {
    columns.forEach((column, colIdx) => {
      if (column.beat == null) { return }
      column.forEach((name, idx) => fn(heads[colIdx], column, idx, parseNote(name)))
    })
  }

  // A tied head can fall where another voice strikes the same pitch, eg. an
  // ostinato tied over the bar onto the whole note of the voice below it, so
  // the heads are taken in passes: first the tied heads of the tied note's
  // own voice, then the heads struck at each column's beat, then the tied
  // heads left, when the engine's voices aren't the score's
  notesOf((into, column, idx, pitch) => {
    const voice = column.notation?.[idx]?.voice
    if (voice == null) { return }
    for (const beat of tiedBeats(column, idx, pitch)) { take(into, pitch, beat, voice) }
  })
  notesOf((into, column, idx, pitch) => take(into, pitch, column.beat!))
  notesOf((into, column, idx, pitch) => {
    for (const beat of tiedBeats(column, idx, pitch)) { take(into, pitch, beat) }
  })

  return {heads, unmatched: notes.filter(note => !used.has(note))}
}

// Marks the columns' drawn heads: the one at the head of the drill (null for
// none) current, those before it done, and any column a miss was counted on
// missed, whether done or still current
export function markCard(join: CardJoin, {head, missed}: {head: number | null, missed: Iterable<number>}) {
  const missedSet = new Set(missed)

  join.heads.forEach((els, idx) => {
    for (const el of els) {
      el.classList.toggle(MARK_CLASSES.current, idx === head)
      el.classList.toggle(MARK_CLASSES.done, head != null && idx < head)
      el.classList.toggle(MARK_CLASSES.missed, missedSet.has(idx))
    }
  })
}
